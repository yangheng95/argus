import { existsSync } from "fs"
import path from "path"
import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"

import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import {
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { ProtocolStore } from "@/protocol/store"
import {
  buildOperatorPrompt,
  orchestratorState,
} from "./helpers"
import {
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
} from "./persist"

import {
  findDeliveryByRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findRun,
  findTask,
  goalRunQueueTaskID,
  listActiveGoalRunsByCoordinator,
  listGoalRunsByCoordinator,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type GoalRunRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { applyGoalDelivery, cleanupGoalWorkspace } from "@/goal/runner"
import { Worktree } from "@/worktree"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator-runtime" })
const processStartTime = Date.now()
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + 15 * 60 * 1000), 10) // must exceed fetch + Task Agent eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()

const GOAL_HEARTBEAT_INTERVAL_MS = 30_000 // emit progress heartbeat every 30s per goal
const eventBridgeAborts = new Map<string, AbortController>() // goalRunID or runID → AbortController
// Guard: runs that have already notified Task Agent via run_completed.
// Prevents syncRun from re-notifying Task Agent every poll cycle.
const agentNotifiedRuns = new Set<string>()
// Per-run merge serialization: ensures parallel goal deliveries are merged one at a time.
const mergeLocksPerRun = new Map<string, Promise<void>>()

async function serializedMerge(runID: string, fn: () => Promise<void>) {
  const prev = mergeLocksPerRun.get(runID) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  mergeLocksPerRun.set(runID, next)
  await next
}


// Unattended-mode safeguards
const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "30000", 10) // auto-reject stale interactions (30s default)
const PIPELINE_STALE_MS = 10 * 60 * 1000 // 10 min — pipeline tasks stuck longer without in-memory tracking are recovered

type TranscriptState = {
  message: Message.Assistant
  text?: Message.TextPart
  reasoning?: Message.ReasoningPart
  tools: Map<string, Message.ToolPart>
  usage: {
    input: number
    output: number
    total: number
    cost: number
  }
}

const transcript = new Map<string, TranscriptState>()

export async function projectExecutorEventToSession(taskID: string, run: RunRow, goalSessionID: string, event: {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}) {
  // opencode executor manages its own session natively — projecting events
  // would create duplicate messages and break standby/completion detection.
  // opencode session messages reach the panel via task-message-protocol-bridge
  // (the session is registered with registerGoalRunSession).
  if (run.executor === "opencode") return
  if (!goalSessionID) return
  if (event.type === "executor.progress") return

  const payload = event.payload ?? {}
  const sessionID = goalSessionID

  // Normalize event type: CodingEventInfo uses underscores (tool_call, text_delta)
  // while the session protocol uses dots (tool.call, message.part.delta).
  // Accept both formats.
  const type = event.type.replace(/_/g, ".")

  const state = await ensureTranscriptState(taskID, run, sessionID)
  if (!state) return

  // text.delta = normalized from CodingEventInfo "text_delta"
  if (type === "text.delta") {
    const delta = typeof event.summary === "string" ? event.summary : typeof payload.text === "string" ? payload.text : ""
    if (!delta) return
    if (!state.text) {
      state.text = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "text",
        text: "",
      } satisfies Message.TextPart) as Message.TextPart
    }
    state.text!.text += delta
    await Session.updatePartDelta({
      sessionID,
      messageID: state.message.id,
      partID: state.text!.id,
      field: "text",
      delta,
    })
    return
  }

  if (type === "message.part.delta") {
    if (payload.field !== "text" || typeof payload.delta !== "string" || payload.delta.length === 0) return
    if (!state.text) {
      state.text = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "text",
        text: "",
      } satisfies Message.TextPart) as Message.TextPart
    }
    state.text!.text += payload.delta
    await Session.updatePartDelta({
      sessionID,
      messageID: state.message.id,
      partID: state.text!.id,
      field: "text",
      delta: payload.delta,
    })
    return
  }

  if (type === "reasoning.delta") {
    const delta = typeof event.summary === "string" ? event.summary : ""
    if (!delta) return
    if (!state.reasoning) {
      state.reasoning = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "reasoning",
        text: "",
        time: {
          start: Date.now(),
        },
      } satisfies Message.ReasoningPart) as Message.ReasoningPart
    }
    state.reasoning!.text += delta
    await Session.updatePartDelta({
      sessionID,
      messageID: state.message.id,
      partID: state.reasoning!.id,
      field: "text",
      delta,
    })
    return
  }

  if (type === "tool.call") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    const id = typeof payload.id === "string" ? payload.id : Identifier.ascending("call")
    const part = await Session.updatePart({
      id: state.tools.get(id)?.id ?? Identifier.ascending("part"),
      messageID: state.message.id,
      sessionID,
      type: "tool",
      callID: id,
      tool: typeof payload.name === "string" ? payload.name : "tool",
      state: {
        status: "running",
        input: toolInput(payload.input),
        title: typeof payload.name === "string" ? payload.name : "Tool call",
        metadata: {},
        time: {
          start: Date.now(),
        },
      },
    } satisfies Message.ToolPart) as Message.ToolPart
    state.tools.set(id, part)
    return
  }

  if (type === "tool.result") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    const id = typeof payload.id === "string" ? payload.id : ""
    const match = id ? state.tools.get(id) : undefined
    if (!match) return
    const matchState = match.state as { input: Record<string, unknown>; time?: { start: number } }
    const next = await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: match.state.input,
        output: typeof payload.output === "string" ? payload.output : "",
        title: match.tool,
        metadata: {},
        time: {
          start: matchState.time?.start ?? Date.now(),
          end: Date.now(),
        },
      },
    } satisfies Message.ToolPart) as Message.ToolPart
    state.tools.set(id, next)
    return
  }

  if (type === "usage.updated") {
    state.usage = {
      input: toNumber(payload.inputTokens),
      output: toNumber(payload.outputTokens),
      total: toNumber(payload.totalTokens),
      cost: toNumber(payload.costUSD),
    }
    return
  }

  if (type === "session.idle" || type === "session.error") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    if (type === "session.idle" && !state.text && typeof payload.output === "string" && payload.output.trim()) {
      state.text = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "text",
        text: payload.output,
      } satisfies Message.TextPart) as Message.TextPart
    }
    if (event.type === "session.error" && typeof payload.error === "string" && payload.error) {
      if (!state.text) {
        state.text = await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: state.message.id,
          sessionID,
          type: "text",
          text: payload.error,
        } satisfies Message.TextPart) as Message.TextPart
      } else if (!state.text.text.trim()) {
        state.text.text = payload.error
        await Session.updatePart(state.text)
      }
    }
    const completed = Date.now()
    state.message = await Session.updateMessage({
      ...state.message,
      time: {
        ...state.message.time,
        completed,
      },
      cost: state.usage.cost,
      tokens: {
        total: state.usage.total || undefined,
        input: state.usage.input,
        output: state.usage.output,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } satisfies Message.Assistant) as Message.Assistant
    transcript.delete(sessionID)
  }
}

async function ensureTranscriptState(taskID: string, run: RunRow, sessionID: string) {
  const current = transcript.get(sessionID)
  if (current) return current
  const parentID = await transcriptParentID(sessionID, taskID, run.id)
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    parentID,
    modelID: run.executor,
    providerID: run.executor,
    mode: run.executor,
    agent: run.executor,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    time: {
      created: Date.now(),
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  } satisfies Message.Assistant) as Message.Assistant
  const next = {
    message,
    tools: new Map<string, Message.ToolPart>(),
    usage: {
      input: 0,
      output: 0,
      total: 0,
      cost: 0,
    },
    text: undefined as Message.TextPart | undefined,
    reasoning: undefined as Message.ReasoningPart | undefined,
  }
  transcript.set(sessionID, next)
  return next
}

async function transcriptParentID(sessionID: string, taskID: string, runID: string) {
  const rows = await Session.messages({ sessionID, limit: 20 }).catch(() => [])
  const user = rows.findLast((item) => item.info.role === "user")
  if (user?.info.role === "user") return user.info.id
  return `${taskID}:${runID}`
}

async function flushTranscriptText(state: {
  text?: Message.TextPart
  reasoning?: Message.ReasoningPart
}) {
  if (state.text) await Session.updatePart(state.text)
  if (state.reasoning) await Session.updatePart({
    ...state.reasoning,
    time: {
      ...state.reasoning.time,
      end: Date.now(),
    },
  } satisfies Message.ReasoningPart)
}

function toolInput(input: unknown) {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== "string") return {}
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  return input ? { value: input } : {}
}

function toNumber(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  try {
    return Database.use((db) =>
      db.select({ id: OrchestratorRunTable.id })
        .from(OrchestratorRunTable)
        .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
        .where(and(
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorRunTable.status, ["accepted", "running"]),
        ))
        .limit(1)
        .get(),
    ) !== undefined
  } catch {
    return false
  }
}

export namespace OrchestratorRuntime {
  // Legacy alias — kept so existing callers compile; routes to monitorRuns.
  export const poll = monitorRuns

  /**
   * Monitor active runs (executor status). No pipeline advancement.
   * Pipeline advancement is now driven by the Task Agent.
   */
  export async function monitorRuns(hooks: RuntimeHooks) {
    const current = orchestratorState()

    // Sync active runs — guarded to prevent overlapping sync waves.
    if (current.syncing) return
    current.syncing = true
    try {
      const rows = Database.use((db) =>
        db
          .select({ id: OrchestratorRunTable.id })
          .from(OrchestratorRunTable)
          .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
          .where(
            and(
              eq(OrchestratorTaskTable.project_id, Instance.project.id),
              inArray(OrchestratorRunTable.status, ["accepted", "running", "blocked", "completed"]),
            ),
          )
          .all(),
      )
      await Promise.allSettled(
        rows.map((row) =>
          Promise.race([
            syncRun(row.id, hooks),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error(`syncRun timeout for run ${row.id}`)), SYNC_RUN_TIMEOUT_MS),
            ),
          ]).catch((err) => {
            log.error("syncRun failed or timed out", { runID: row.id, error: err instanceof Error ? err.message : String(err) })
          }),
        ),
      )
    } finally {
      current.syncing = false
    }
  }

  /**
   * Sync per-goal runs: stall detection + orphan recovery.
   *
   * Goal completion is driven by GoalPool (within the Task Control Loop).
   * GoalPool handles per-goal stall detection internally (goal-pool.ts).
   *
   * This function only handles orphan detection: goal runs from a previous
   * process that have no event bridge (leftovers from a crash).
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    if (!run.plan_version_id) return

    // Orphan detection: goal runs created BEFORE the current process started
    // that have no event bridge. These are leftovers from a crashed process.
    // The executor process is dead — mark them failed so the task loop
    // can detect the failure and let Task Agent decide next steps.
    const activeGoalRuns = listActiveGoalRunsByCoordinator(runID)
    for (const goalRun of activeGoalRuns) {
      if (eventBridgeAborts.has(goalRun.id)) continue
      if ((goalRun.time_created ?? 0) >= processStartTime) continue
      log.warn("orphaned goal_run from previous process", { runID, goalRunID: goalRun.id, goalID: goalRun.goal_id })
      updateGoalRun(goalRun.id, { status: "failed", error: "Orphaned: event bridge lost (process restart)", time_completed: Date.now() })
      updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
      if (goalRun.workspace_dir) {
        await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
      }
    }

    // After orphan cleanup: if all goal runs are dead and no event bridges remain,
    // the pipeline is fully dead (process restart killed everything).
    const remaining = listActiveGoalRunsByCoordinator(runID)
    const hasAnyBridge = remaining.some((gr) => eventBridgeAborts.has(gr.id))
    if (remaining.length === 0 && !hasAnyBridge && !agentNotifiedRuns.has(run.id)) {
      const allGoalRuns = listGoalRunsByCoordinator(runID)
      const orphanFailCount = allGoalRuns.filter((gr) =>
        gr.status === "failed" && gr.error?.includes("Orphaned"),
      ).length
      if (orphanFailCount > 0) {
        const task = requireTask(run.task_id)
        if (task.active_run_id === run.id) {
          log.warn("all goal runs dead after orphan cleanup, failing run", { runID, orphanFailCount })
          agentNotifiedRuns.add(run.id)
          await failRun(run, `All goal runs failed (${orphanFailCount} orphaned)`, hooks)
        }
      }
    }
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    if (!task.active_run_id) return
    await syncRun(task.active_run_id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)

    // Per-goal parallel mode: if this run has ANY goal runs (active or completed),
    // delegate to syncGoalRuns which handles both active-goal polling and pipeline continuation.
    // Using listGoalRunsByCoordinator (ALL statuses) to detect per-goal mode even when
    // all goals have already completed but the run hasn't been finalized yet.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      const allGoalRuns = listGoalRunsByCoordinator(runID)
      if (allGoalRuns.length > 0) {
        await syncGoalRuns(runID, hooks)
        return
      }
    }

    const task = requireTask(run.task_id)
    const delivery = findDeliveryByRun(run.id)
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      const now = Date.now()
      const stale = pending.filter((p) => (now - (p.time_created ?? 0)) > INTERACTION_STALE_MS)
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", { id: interaction.id, type: interaction.request_type, ageMs: now - (interaction.time_created ?? 0) })
          Database.use((db) =>
            db.update(OrchestratorInteractionRequestTable)
              .set({ status: "rejected", time_resolved: now, time_updated: now })
              .where(eq(OrchestratorInteractionRequestTable.id, interaction.id))
              .run(),
          )
        }
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          await Promise.all([
            run.status === "blocked" ? hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Stale interactions auto-rejected") : undefined,
            task.status === "active" && task.blocking_reason ? hooks.updateTask(task, { status: "active", blocking_reason: null }, "Stale interactions auto-rejected") : undefined,
          ])
        } else {
          await Promise.all([
            run.status !== "blocked" ? hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked") : undefined,
            !task.blocking_reason ? hooks.updateTask(task, { status: "active", blocking_reason: stillPending[0].request_type }, "Awaiting user input") : undefined,
          ])
          return
        }
      } else {
        await Promise.all([
          run.status !== "blocked" ? hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked") : undefined,
          !task.blocking_reason ? hooks.updateTask(task, { status: "active", blocking_reason: pending[0].request_type }, "Awaiting user input") : undefined,
        ])
        return
      }
    }

    if (run.status === "completed") {
      // Legacy single-executor path: trigger task loop (not fire-and-forget TaskAgent)
      if (!agentNotifiedRuns.has(run.id)) {
        agentNotifiedRuns.add(run.id)
        stopEventBridge(run.id)
        mergeLocksPerRun.delete(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        Promise.all([import("@/orchestrator/task-loop"), import("@/orchestrator/state")]).then(([{ runTaskLoop }, { hooks: getHooks }]) => {
          runTaskLoop({
            taskID: task.id,
            trigger: {
              kind: "batch_complete",
              runID: run.id,
              summary: { passed: 0, failed: 0, total: 0 },
            },
            hooks: getHooks(),
          }).catch(err => log.error("task loop failed (legacy syncRun)", { taskID: task.id, error: String(err) }))
        })
      }
      return
    }

    if (run.status === "failed" || run.status === "aborted") {
      return
    }

    const queueTaskID = run.executor_ref?.queue_task_id
    if (!queueTaskID) return
    const executor = ExecutorRegistry.require(run.executor)
    const queue = await Promise.race([
      executor.status(queueTaskID),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`executor.status() timeout (${EXECUTOR_STATUS_TIMEOUT_MS}ms)`)), EXECUTOR_STATUS_TIMEOUT_MS),
      ),
    ])

    if (queue.status === "queued" || queue.status === "retrying") {
      if (run.status === "blocked") {
        await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Run resumed")
      }
      if (task.blocking_reason) {
        await hooks.updateTask(task, { status: "active", blocking_reason: null }, "Run resumed")
      }
      return
    }

    if (queue.status === "running") {
      // Legacy single-session run: use DB timestamps for inactivity detection.
      // (GoalPool-managed runs don't reach this path.)
      const LEGACY_RUN_STALL_MS = 30 * 60 * 1000 // 30 min
      const lastActivity = run.time_updated ?? run.time_started ?? run.time_created ?? Date.now()
      const inactiveMs = Date.now() - lastActivity
      if (inactiveMs > LEGACY_RUN_STALL_MS) {
        log.warn("run stalled — no activity (legacy syncRun)", { runID: run.id, inactiveMs })
        try { await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID }) } catch {}
        await failRun(run, `Run stalled — no activity for ${Math.round(inactiveMs / 60000)}min`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (task.status !== "active") {
        await hooks.updateTask(task, { status: "active", blocking_reason: null }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      // Legacy single-executor path: mark run completed and trigger task loop.
      if (!agentNotifiedRuns.has(run.id)) {
        agentNotifiedRuns.add(run.id)
        stopEventBridge(run.id)
        mergeLocksPerRun.delete(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
        Promise.all([import("@/orchestrator/task-loop"), import("@/orchestrator/state")]).then(([{ runTaskLoop }, { hooks: getHooks }]) => {
          runTaskLoop({
            taskID: task.id,
            trigger: { kind: "batch_complete", runID: run.id, summary: { passed: 0, failed: 0, total: 0 } },
            hooks: getHooks(),
          }).catch(err => log.error("task loop failed (legacy syncRun completed)", { taskID: task.id, error: String(err) }))
        })
      }
    }
  }

  export async function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(`Cannot create operator run: task ${task.id} is in terminal state "${task.status}"`)
    }
    const nextRunID = Identifier.ascending("run")
    const now = Date.now()
    Database.transaction((db) => {
      db.insert(OrchestratorRunTable)
        .values({
          id: nextRunID,
          task_id: task.id,
          plan_version_id: task.active_plan_version_id,
          session_id: run.session_id,
          executor: run.executor,
          status: "queued",
          phase: "execute",
          retry_count: 0,
          metadata: {
            previous_run_id: run.id,
            strategy: "operator_note",
            prompt_override: buildOperatorPrompt(note),
          },
          time_created: now,
          time_updated: now,
        })
        .run()
      db.update(OrchestratorTaskTable)
        .set({
          active_run_id: nextRunID,
          status: "active",
          error: null,
          blocking_reason: null,
          time_completed: null,
          time_updated: now,
        })
        .where(eq(OrchestratorTaskTable.id, task.id))
        .run()
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.RunCreated, {
          taskID: task.id,
          runID: nextRunID,
          status: "queued",
          summary: "Run queued from operator note",
        }, { taskID: task.id, runID: nextRunID, source: "runtime.operator" }),
      )
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.TaskUpdated, {
          taskID: task.id,
          status: "active",
          summary: "Operator note queued a follow-up run",
        }, { taskID: task.id, source: "runtime.operator" }),
      )
    })
    return nextRunID
  }

}



async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id) // serial bridge
  // Stop all per-goal event bridges (abort propagates to executor via consumeExecutorEvents)
  // Infrastructure only writes goal_run.status — goal.status is Task Agent's decision
  const goalRuns = listActiveGoalRunsByCoordinator(run.id)
  for (const gr of goalRuns) {
    stopEventBridge(gr.id) // aborts the controller → consumeExecutorEvents loop breaks → executor.abort() called
    updateGoalRun(gr.id, { status: "failed", error: `Parent run failed: ${error}`, time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(gr.id, "failed")
    if (gr.workspace_dir) await cleanupGoalWorkspace(gr.workspace_dir).catch(() => {})
  }
  // Clean up in-memory tracking — run is dead, prevent stale map entries and leaks
  mergeLocksPerRun.delete(run.id)
  agentNotifiedRuns.delete(run.id)
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  // Task loop detects run failure via task status check and re-enters Decision Point.
  // No fire-and-forget trigger needed.
  if (task.active_run_id === run.id) {
    log.info("run failed, task loop will detect and re-decide", { taskID: task.id, runID: run.id })
  }
}

function requirementIDsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).source_requirement_ids
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  const ids = (metadata as Record<string, unknown>).requirement_ids
  if (Array.isArray(ids)) return ids.filter((item): item is string => typeof item === "string" && item.length > 0)
  return []
}


/**
 * Merge goal delivery to main workspace (orchestrator responsibility).
 * Serialized per-run. Commits merged files to advance HEAD for subsequent worktrees.
 */
export async function mergeGoalDelivery(
  task: TaskRow, run: RunRow, plan: PlanRow, goalRun: GoalRunRow,
  delivery: { diffs: Array<{ file: string; [key: string]: unknown }> },
  hooks: RuntimeHooks,
) {
  const goalRow = goalRun.goal_id ? Database.use((db) =>
    db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).get(),
  ) : undefined
  const ownedPaths = Array.isArray(goalRow?.owned_paths) ? goalRow.owned_paths : []

  await serializedMerge(run.id, async () => {
    await applyGoalDelivery({
      directory: Instance.directory,
      delivery: { diffs: delivery.diffs as any },
      ownedPaths,
    })
    const { $ } = await import("bun")
    const files = delivery.diffs.map((d) => d.file as string)
    if (files.length > 0) {
      // Git operations serialized with Worktree.create/remove via shared lock
      await Worktree.lock(async () => {
        const addResult = await $`git add -- ${files}`.quiet().cwd(Instance.directory).nothrow()
        if (addResult.exitCode !== 0) {
          log.error("goal merge: git add failed", {
            goalRunID: goalRun.id,
            exitCode: addResult.exitCode,
            stderr: addResult.stderr.toString().slice(0, 500),
          })
        }
        const label = goalRun.goal_id?.slice(-8) ?? "unknown"
        const commitResult = await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${"goal-merge: " + label}`.quiet().cwd(Instance.directory).nothrow()
        if (commitResult.exitCode !== 0) {
          const stderr = commitResult.stderr.toString()
          if (!stderr.includes("nothing to commit")) {
            log.error("goal merge: git commit failed", {
              goalRunID: goalRun.id,
              exitCode: commitResult.exitCode,
              stderr: stderr.slice(0, 500),
            })
          }
        }
        log.info("committed goal merge to advance HEAD", { goalRunID: goalRun.id, files: files.length })
      })
    }
  })

  // Verify merge
  if (delivery.diffs.length > 0) {
    const { getMerger } = await import("@/goal/merge")
    const expected = delivery.diffs
      .filter((d: any) => d.status !== "deleted" && getMerger(d.file as string) !== "skip")
      .map((d: any) => ({ rel: d.file as string, abs: path.resolve(Instance.directory, d.file as string) }))
    const missing = expected.filter((f) => !existsSync(f.abs))
    if (missing.length > 0) {
      log.error("merge verification failed", { goalRunID: goalRun.id, missing: missing.length })
      // Non-fatal for pipeline flow — delivery was already persisted, goal_run already completed
      // The overall evaluator will catch integration issues
    }
  }
}



/** Stop the event bridge for a run (called when run completes/fails/aborts). */
function stopEventBridge(runID: string) {
  const ctrl = eventBridgeAborts.get(runID)
  if (ctrl) {
    ctrl.abort()
    eventBridgeAborts.delete(runID)
  }
}

type RuntimeHooks = {
  updateTask: (
    row: TaskRow,
    values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<typeof OrchestratorRunTable.$inferInsert>,
    summary: string,
  ) => Promise<RunRow>
}


function upsertExecutorInteraction(
  taskID: string,
  runID: string,
  sessionID: string,
  executorSessionID: string,
  provider: RunRow["executor"],
  event: {
    type: string
    summary?: string
    payload?: Record<string, unknown>
  },
) {
  if (event.type !== "approval_request" && event.type !== "input_request") return
  const rawID = event.payload?.id
  const requestID = typeof rawID === "string" || typeof rawID === "number" ? String(rawID) : undefined
  if (!requestID) return
  const externalID = `protocol:${executorSessionID}:${requestID}`
  if (findInteractionByExternal(externalID)) return
  const now = Date.now()
  const interactionID = Identifier.ascending("interaction")
  const title =
    event.type === "approval_request"
      ? `Executor approval: ${String(event.payload?.approval ?? "request")}`
      : firstQuestionHeader(event.payload?.questions) ?? "Executor input required"
  const body =
    event.type === "approval_request"
      ? String(event.summary ?? event.payload?.approval ?? "Approval requested")
      : questionBody(event.payload?.questions) || "The executor requested additional input."
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: taskID,
        run_id: runID,
        session_id: sessionID,
        external_id: externalID,
        request_type: event.type === "approval_request" ? "permission" : "question",
        status: "pending",
        title,
        body,
        payload: {
          protocol_request: true,
          provider,
          executor_session_id: executorSessionID,
          request_id: requestID,
          request_kind: event.type,
          ...(event.payload ?? {}),
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.InteractionRequested, {
        taskID,
        runID,
        interactionID,
        requestType: event.type === "approval_request" ? "permission" : "question",
        summary: title,
      }, { taskID, runID, interactionID, source: "runtime.interaction" }),
    )
  })
}

function firstQuestionHeader(input: unknown) {
  if (!Array.isArray(input)) return
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const next = item as Record<string, unknown>
    if (typeof next.header === "string" && next.header) return next.header
  }
}

function questionBody(input: unknown) {
  if (!Array.isArray(input)) return ""
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const next = item as Record<string, unknown>
    if (typeof next.question !== "string" || !next.question) return []
    return [next.question]
  }).join("\n\n")
}
