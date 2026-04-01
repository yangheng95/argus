import { existsSync } from "fs"
import path from "path"
import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"

import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { installRuntimeShims } from "@/runtime/shims"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import { OrchestratorGit } from "./git"
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
  effectiveMaxExecutorGroups,
  orchestratorState,
} from "./helpers"
import {
  createGoalRun,
  createFixRun,
  ensureExecutorSession,
  persistDelivery,
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
} from "./persist"
import { sessionStreamHooks } from "./session-stream"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { TaskAgent } from "./task-agent"
import {
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findRun,
  findTask,
  goalRunQueueTaskID,
  listActiveGoalRunsByCoordinator,
  listGoalRunsByCoordinator,
  listGoalsByPlan,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type GoalRunRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Snapshot } from "@/snapshot"
import { Worktree } from "@/worktree"
import { readyGoalNodes, pendingBlockingGoals, hasBlockingFailures } from "@/goal/scheduler"
import { buildGoalPrompt, createGoalSession, applyGoalDelivery, cleanupGoalWorkspace } from "@/goal/runner"
import { Identifier } from "@/id/id"
import { agentStream } from "./agent-stream"

const log = Log.create({ service: "orchestrator-runtime" })
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + 15 * 60 * 1000), 10) // must exceed fetch + Task Agent eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()
const EXECUTOR_SUBMIT_TIMEOUT_MS = 60_000 // 60s for executor.submit()
const eventBridgeAborts = new Map<string, AbortController>() // runID → AbortController for consumeExecutorEvents
// Guard: runs that have already notified Task Agent via run_completed.
// Prevents syncRun from re-calling completeRun every 1.5s cycle, which would
// abort the running Task Agent mid-eval/delivery.
const agentNotifiedRuns = new Set<string>()

// Per-run merge serialization: ensures parallel goal deliveries are merged one at a time.
// Without this, concurrent applyGoalDelivery() calls can overwrite each other's changes.
const mergeLocksPerRun = new Map<string, Promise<void>>()
async function serializedMerge(runID: string, fn: () => Promise<void>) {
  const prev = mergeLocksPerRun.get(runID) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  mergeLocksPerRun.set(runID, next)
  await next
}


// Unattended-mode safeguards
const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "30000", 10) // auto-reject stale interactions (30s default)
const RUN_MAX_EXECUTION_MS = parseInt(process.env.OPENCORVUS_RUN_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10) // max run execution time (2h default)
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

async function projectExecutorEventToSession(taskID: string, run: RunRow, event: {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}) {
  if (run.executor === "opencode" || !run.session_id) return
  const payload = event.payload ?? {}
  const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : run.session_id
  if (!sessionID) return
  if (event.type === "executor.progress") return

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
    transcript.delete(run.id)
  }
}

async function ensureTranscriptState(taskID: string, run: RunRow, sessionID: string) {
  const current = transcript.get(run.id)
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
  transcript.set(run.id, next)
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

async function prepareRun(task: TaskRow, run: RunRow, plan: PlanRow | undefined, hooks: RuntimeHooks) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  if (task.time_started) return task
  const prepared = await OrchestratorGit.prepare(task, plan)
  if (!prepared.error) return prepared.task
  const now = Date.now()
  await hooks.updateRun(run, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  }
  return
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
      recoverOrphanedTasks()
    } finally {
      current.syncing = false
    }
  }

  export async function dispatch(runID: string, hooks: RuntimeHooks) {
    installRuntimeShims()
    const run = requireRun(runID)
    if (run.status !== "queued") return
    let task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)

    // Per-goal parallel dispatch: when maxConcurrentGoals > 1,
    // dispatch each goal individually with its own worktree.
    const maxGoals = effectiveMaxExecutorGroups(task)
    if (maxGoals > 1) {
      const goals = listGoalsByPlan(plan.id)
      if (goals.length > 1) {
        return dispatchGoalRuns(runID, hooks)
      }
    }

    // Single-executor serial dispatch (existing path, maxConcurrentGoals=1 or single goal)
    const base = typeof run.metadata?.prompt_override === "string" ? run.metadata.prompt_override : plan.prompt
    const brief = WorkbenchService.compileBrief({
      taskID: task.id,
      runID: run.id,
      planVersionID: plan.id,
      sessionID: task.session_id,
    })
    const prompt = [brief.content, base].join("\n\n")
    const strategy = run.metadata?.strategy as string | undefined
    const source: "planner" | "evaluator" | "system" =
      strategy === "operator_note" ? "system" : strategy === "retry_same_plan" ? "evaluator" : "planner"
    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)
    const executor = ExecutorRegistry.require(run.executor)
    const submission = await Promise.race([
      executor.submit({
        sessionID,
        prompt,
        priority: task.priority,
        source,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`executor.submit() timeout (${EXECUTOR_SUBMIT_TIMEOUT_MS}ms)`)), EXECUTOR_SUBMIT_TIMEOUT_MS),
      ),
    ])
    const now = Date.now()
    await Promise.all([
      hooks.updateRun(
        run,
        {
          status: "accepted",
          executor_ref: {
            session_id: submission.sessionID,
            queue_task_id: submission.queueTaskID,
          },
          time_started: now,
        },
        "Run accepted by executor",
      ),
      hooks.updateTask(
        task,
        {
          status: "running",
          time_started: task.time_started ?? now,
        },
        "Run dispatched",
      ),
    ])
    const session = ensureExecutorSession({
      taskID: task.id,
      runID: run.id,
      provider: run.executor,
      refs: {
        provider_session_id: submission.sessionID,
        queue_task_id: submission.queueTaskID,
      },
      settings: {
        cwd: Instance.directory,
      },
      started: now,
    })
    // Register executor session so bridge can resolve sessionID → taskID for SSE
    if (sessionID) registerGoalRunSession(sessionID, task.id)
    // Start executor event bridge (fire-and-forget background coroutine)
    consumeExecutorEvents(task.id, run.id, run.executor, sessionID, session.id)
  }

  // ═══════════════════════════════════════════════════════════════════
  // Per-Goal Parallel Dispatch (spec Phase 2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Dispatch ready goals individually, each with its own worktree and executor session.
   * Called from dispatch() when maxConcurrentGoals > 1 and multiple goals exist.
   */
  async function dispatchGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    let task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)

    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared

    const now = Date.now()
    await Promise.all([
      hooks.updateRun(run, { status: "accepted", time_started: now }, "Per-goal parallel dispatch"),
      hooks.updateTask(task, { status: "running", time_started: task.time_started ?? now }, "Dispatching goals in parallel"),
    ])

    await queueReadyGoalRuns(task, run, plan, hooks)
  }

  /**
   * Dispatch up to maxConcurrentGoals ready goals.
   * Each goal gets its own worktree, session, and executor submission.
   */
  async function queueReadyGoalRuns(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
    const maxGoals = effectiveMaxExecutorGroups(task)
    const active = listActiveGoalRunsByCoordinator(run.id)
    const slots = maxGoals - active.length
    if (slots <= 0) return 0

    const nodes = listPlanNodesByPlan(plan.id)
    const goals = listGoalsByPlan(plan.id)
    // Always respect dependencies — parallel only affects concurrency (slot count).
    // Layer 0 goals (no deps) run in parallel up to maxGoals slots.
    // Layer 1+ goals wait for their deps to complete, then run in parallel.
    const ready = readyGoalNodes(nodes, goals)
    const batch = ready.slice(0, slots)
    if (batch.length === 0) return 0

    await Promise.all(batch.map((entry) => queueGoalRun(task, run, plan, entry, hooks)))
    log.info("queued goal runs", { runID: run.id, queued: batch.length, active: active.length, ready: ready.length })
    return batch.length
  }

  /**
   * Dispatch a single goal: worktree → session → executor submit → event bridge.
   */
  async function queueGoalRun(
    task: TaskRow,
    run: RunRow,
    plan: PlanRow,
    entry: { node: { id: string; goal_id: string } & Record<string, unknown>; goal: { id: string; description: string } & Record<string, unknown> },
    hooks: RuntimeHooks,
  ) {
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)

    // 0. Mark goal as "running" to prevent re-dispatch.
    //    readyGoalNodes() only returns goals with status="pending".
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "running", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, entry.goal.id))
        .run(),
    )

    let worktreeDir: string | undefined
    try {
      // 1. Create isolated worktree with synchronous checkout
      const worktreeInfo = await Worktree.create({
        name: `goal-${entry.goal.id.slice(-8)}`,
        checkout: "sync",
      })
      worktreeDir = worktreeInfo.directory

      // 2. Create goal session scoped to worktree
      const goalSession = await createGoalSession(task as any, entry.goal as any, worktreeDir)

      // 3. Create GoalRun record
      // No base_ref needed — delivery extraction uses worktree's native git diff against HEAD
      const goalRun = createGoalRun({
        taskID: task.id,
        goalID: entry.goal.id,
        planNodeID: entry.node.id,
        coordinatorRunID: run.id,
        sessionID: goalSession.id,
        executor: run.executor,
        workspaceDir: worktreeDir,
        metadata: {
          worktree_branch: worktreeInfo.branch,
        },
      })

      // 4. Build goal-specific prompt (with owned_paths + dependency context)
      const allGoals = listGoalsByPlan(plan.id)
      const prompt = buildGoalPrompt({
        plan: plan as any,
        node: entry.node as any,
        goal: entry.goal as any,
        taskRequest: plan.prompt,
        allGoals,
      })

      // 5. Submit to executor with cwd=worktree
      const executor = ExecutorRegistry.require(run.executor)
      const submission = await Promise.race([
        executor.submit({
          sessionID: goalSession.id,
          prompt,
          priority: task.priority,
          source: "planner",
          cwd: worktreeDir,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`executor.submit() timeout for goal ${entry.goal.id}`)), EXECUTOR_SUBMIT_TIMEOUT_MS),
        ),
      ])

      // 6. Update goal run with executor refs
      updateGoalRun(goalRun.id, {
        status: "accepted",
        time_started: Date.now(),
        metadata: {
          ...((goalRun.metadata as Record<string, unknown>) ?? {}),
          queue_task_id: submission.queueTaskID,
          provider_session_id: submission.sessionID,
        },
      })

      // 7. Create executor session record
      const executorSession = ensureExecutorSession({
        taskID: task.id,
        runID: run.id,
        provider: run.executor,
        refs: {
          provider_session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
        settings: { cwd: worktreeDir },
        started: Date.now(),
        goalRunID: goalRun.id,
      })

      // 8. Start event bridge
      registerGoalRunSession(goalSession.id, task.id)
      consumeExecutorEvents(task.id, run.id, run.executor, goalSession.id, executorSession.id, goalRun.id)

      log.info("dispatched goal run", {
        runID: run.id,
        goalID: entry.goal.id,
        goalRunID: goalRun.id,
        worktreeDir,
      })
    } catch (err) {
      // Dispatch failed — mark goal as "failed" so it doesn't block dependents forever.
      log.error("goal dispatch failed", { goalID: entry.goal.id, error: err instanceof Error ? err.message : String(err) })
      Database.use((db) =>
        db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, entry.goal.id))
          .run(),
      )
      if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
      throw err // Let caller handle run-level failure
    }
  }

  /** Guard: prevent concurrent finalization of the same goal run */
  const finalizingGoalRuns = new Set<string>()

  /**
   * Sync per-goal executor runs: check status of each active goal run,
   * finalize completed ones, dispatch newly-ready goals.
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    const task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!plan) return

    // Run execution timeout
    const started = run.time_started ?? run.time_created
    if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
      log.warn("per-goal run exceeded max execution time", { runID, maxMs: RUN_MAX_EXECUTION_MS })
      await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
      return
    }

    const activeGoalRuns = listActiveGoalRunsByCoordinator(runID)
    if (activeGoalRuns.length === 0) {
      // No active goal runs — check if we need to dispatch more or finalize
      await continueGoalPipeline(task, run, plan, hooks)
      return
    }

    const executor = ExecutorRegistry.require(run.executor)

    for (const goalRun of activeGoalRuns) {
      const queueTaskID = goalRunQueueTaskID(goalRun)
      if (!queueTaskID) continue

      try {
        const queue = await Promise.race([
          executor.status(queueTaskID),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`executor.status() timeout for goal run ${goalRun.id}`)), EXECUTOR_STATUS_TIMEOUT_MS),
          ),
        ])

        if (queue.status === "completed") {
          if (finalizingGoalRuns.has(goalRun.id)) {
            log.warn("skipping duplicate finalization", { goalRunID: goalRun.id })
          } else {
            finalizingGoalRuns.add(goalRun.id)
            try {
              await finalizeGoalRun(task, run, plan, goalRun, hooks)
            } finally {
              finalizingGoalRuns.delete(goalRun.id)
            }
          }
        } else if (queue.status === "failed") {
          log.error("goal run executor failed", { runID, goalRunID: goalRun.id, error: queue.error })
          updateGoalRun(goalRun.id, { status: "failed", error: queue.error ?? "Executor failed", time_completed: Date.now() })
          updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
          // Update goal status to "failed"
          Database.use((db) =>
            db.update(OrchestratorGoalTable)
              .set({ status: "failed", time_updated: Date.now() })
              .where(eq(OrchestratorGoalTable.id, goalRun.goal_id))
              .run(),
          )
          if (goalRun.workspace_dir) {
            await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
          }
        }
      } catch (err) {
        log.warn("goal run status check failed", {
          runID,
          goalRunID: goalRun.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // After processing, check if more goals can be dispatched
    await continueGoalPipeline(task, run, plan, hooks)
  }

  /**
   * Finalize a completed goal run:
   * 1. Extract delivery from executor
   * 2. Persist delivery linked to goal run
   * 3. Merge worktree changes to main workspace (serialized)
   * 4. Update goal status
   * 5. Cleanup worktree
   */
  async function finalizeGoalRun(task: TaskRow, run: RunRow, plan: PlanRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
    stopEventBridge(goalRun.id) // Stop the per-goal event bridge (keyed by goalRunID)
    updateGoalRunExecutorSessionStatus(goalRun.id, "completed")

    // 1. Extract delivery by computing diff in the worktree.
    //    For worktree mode: use the worktree's native git to diff against the base commit.
    //    The Snapshot system shares a single git index across all worktrees which causes
    //    race conditions — worktree's own git is authoritative.
    let delivery: { summary: string; diffs: Array<{ file: string; [key: string]: unknown }> }
    try {
      if (goalRun.workspace_dir) {
        const { deliveryFromWorktreeGit } = await import("@/goal/runner")
        delivery = await deliveryFromWorktreeGit(goalRun.workspace_dir, `Goal ${goalRun.goal_id?.slice(-8) ?? "unknown"}`)
      } else {
        // No worktree — fall back to executor.delivery (serial mode)
        const executor = ExecutorRegistry.require(run.executor)
        delivery = await Promise.race([
          executor.delivery({ sessionID: goalRun.session_id!, since: goalRun.time_started ?? goalRun.time_created }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("executor.delivery() timeout")), DELIVERY_FETCH_TIMEOUT_MS)),
        ])
      }
    } catch (err) {
      log.error("goal delivery extraction failed", { goalRunID: goalRun.id, error: err instanceof Error ? err.message : String(err) })
      updateGoalRun(goalRun.id, { status: "failed", error: `Delivery extraction failed: ${err instanceof Error ? err.message : String(err)}`, time_completed: Date.now() })
      Database.use((db) => db.update(OrchestratorGoalTable).set({ status: "failed", time_updated: Date.now() }).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).run())
      if (goalRun.workspace_dir) await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
      return
    }

    log.info("goal delivery extracted", { goalRunID: goalRun.id, files: delivery.diffs.length })

    // 2. Persist delivery linked to goal run
    const deliveryID = Identifier.ascending("delivery")
    persistDelivery({ task, run, goalRunID: goalRun.id, deliveryID, delivery, now: Date.now() })

    // 3. Merge worktree changes to main workspace
    if (goalRun.workspace_dir && delivery.diffs.length > 0) {
      try {
        const goalRow = Database.use((db) => db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).get())
        const goalMeta = goalRow?.metadata && typeof goalRow.metadata === "object" ? goalRow.metadata as Record<string, unknown> : {}
        const ownedPaths = Array.isArray(goalMeta.owned_paths) ? goalMeta.owned_paths as string[] : []
        // Serialize merges per-run: parallel goals must merge one at a time
        await serializedMerge(run.id, () =>
          applyGoalDelivery({
            directory: Instance.directory,
            delivery: { diffs: delivery.diffs as any },
            ownedPaths,
          }),
        )
      } catch (err) {
        log.error("goal delivery merge failed", { goalRunID: goalRun.id, error: err instanceof Error ? err.message : String(err) })
        updateGoalRun(goalRun.id, { status: "failed", error: `Merge failed: ${err instanceof Error ? err.message : String(err)}`, time_completed: Date.now() })
        Database.use((db) => db.update(OrchestratorGoalTable).set({ status: "failed", time_updated: Date.now() }).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).run())
        const failedGoal = listGoalsByPlan(plan.id).find((g) => g.id === goalRun.goal_id)
        if (failedGoal) {
          OrchestratorProtocol.emit(Event.GoalFailed, { taskID: task.id, goalID: failedGoal.id, summary: `${failedGoal.description}: Merge failed` }, { source: "runtime.finalizeGoalRun" })
        }
        await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
        return
      }
    }

    // 3b. Verify merge: check that non-deleted files actually exist in the target directory
    if (goalRun.workspace_dir && delivery.diffs.length > 0) {
      const expectedFiles = delivery.diffs
        .filter((d: any) => d.status !== "deleted")
        .map((d: any) => ({ rel: d.file as string, abs: path.resolve(Instance.directory, d.file as string) }))
      const missingFiles = expectedFiles.filter((f) => !existsSync(f.abs))
      if (missingFiles.length > 0) {
        log.error("goal delivery merge verification failed: files missing after apply", {
          goalRunID: goalRun.id,
          total: expectedFiles.length,
          missing: missingFiles.length,
          files: missingFiles.slice(0, 10).map((f) => f.rel),
        })
        updateGoalRun(goalRun.id, {
          status: "failed",
          error: `Merge verification failed: ${missingFiles.length}/${expectedFiles.length} files not written to target directory`,
          time_completed: Date.now(),
        })
        Database.use((db) => db.update(OrchestratorGoalTable).set({ status: "failed", time_updated: Date.now() }).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).run())
        const failedGoal = listGoalsByPlan(plan.id).find((g) => g.id === goalRun.goal_id)
        if (failedGoal) {
          OrchestratorProtocol.emit(Event.GoalFailed, { taskID: task.id, goalID: failedGoal.id, summary: `${failedGoal.description}: Merge verification failed — ${missingFiles.length} files missing` }, { source: "runtime.finalizeGoalRun" })
        }
        await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
        return
      }
    }

    // 4. Mark goal run completed and update goal status
    updateGoalRun(goalRun.id, { status: "completed", time_completed: Date.now() })

    // Update the goal's status to "passed" (individual goal success)
    const goal = listGoalsByPlan(plan.id).find((g) => g.id === goalRun.goal_id)
    if (goal) {
      Database.use((db) =>
        db.update(OrchestratorGoalTable)
          .set({ status: "passed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run(),
      )
      OrchestratorProtocol.emit(Event.GoalPassed, { taskID: task.id, goalID: goal.id, summary: goal.description }, { source: "runtime.finalizeGoalRun" })
    }

    // 5. Cleanup worktree
    if (goalRun.workspace_dir) {
      await cleanupGoalWorkspace(goalRun.workspace_dir).catch((err) => {
        log.warn("worktree cleanup failed (non-fatal)", { goalRunID: goalRun.id, error: String(err) })
      })
    }

    log.info("goal run finalized", {
      runID: run.id,
      goalRunID: goalRun.id,
      goalID: goalRun.goal_id,
      files: delivery.diffs.length,
    })
  }

  /**
   * After goal runs complete/fail, check if:
   * - More ready goals can be dispatched
   * - All goals are done → finalize the run
   * - Blocking goals failed → handle failure
   */
  async function continueGoalPipeline(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
    const goals = listGoalsByPlan(plan.id)
    const activeRuns = listActiveGoalRunsByCoordinator(run.id)

    // Try to dispatch more ready goals
    const queued = await queueReadyGoalRuns(task, run, plan, hooks)
    if (queued > 0) return

    // If goals are still executing, wait
    if (activeRuns.length > 0) return

    // Check if blocking goals failed
    if (hasBlockingFailures(goals)) {
      TaskAgent.processTask(task.id, {
        kind: "executor_failed",
        runID: run.id,
        error: "Blocking goal(s) failed during parallel execution",
      }).catch(err => log.error("task agent failed on goal failure", { taskID: task.id, error: String(err) }))
      return
    }

    // Check if there are pending blocking goals with no ready path
    const pending = pendingBlockingGoals(goals)
    if (pending.length > 0) {
      // Pending goals exist but none are ready — dependency chain broken
      TaskAgent.processTask(task.id, {
        kind: "executor_failed",
        runID: run.id,
        error: `${pending.length} blocking goal(s) pending but not ready (dependency failure)`,
      }).catch(err => log.error("task agent failed on dependency failure", { taskID: task.id, error: String(err) }))
      return
    }

    // All goals done — aggregate per-goal deliveries into a run-level delivery,
    // then finalize the run. completeRun looks for findDeliveryByRun(run.id)
    // which only finds deliveries without goalRunID.
    if (!findDeliveryByRun(run.id)) {
      const goalRuns = listGoalRunsByCoordinator(run.id)
      const allDiffs: Array<{ file: string; [key: string]: unknown }> = []
      const seenFiles = new Set<string>()
      const summaries: string[] = []
      for (const gr of goalRuns) {
        const d = findDeliveryByGoalRun(gr.id)
        if (!d) continue
        if (d.summary) summaries.push(d.summary)
        const result = d.result as { diffs?: Array<{ file: string; [key: string]: unknown }> } | null
        if (!result?.diffs) continue
        for (const diff of result.diffs) {
          if (!seenFiles.has(diff.file)) {
            seenFiles.add(diff.file)
            allDiffs.push(diff)
          }
        }
      }
      const deliveryID = Identifier.ascending("delivery")
      persistDelivery({
        task,
        run,
        deliveryID,
        delivery: {
          summary: summaries.length > 0 ? summaries.join("\n") : "Per-goal delivery aggregate",
          diffs: allDiffs,
        },
        now: Date.now(),
      })
      log.info("aggregated per-goal deliveries into run delivery", { runID: run.id, goals: goalRuns.length, files: allDiffs.length })
    }

    log.info("all goals completed, finalizing run", { runID: run.id })
    await completeRun(run, hooks)
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
            task.status === "blocked" ? hooks.updateTask(task, { status: "running", blocking_reason: null }, "Stale interactions auto-rejected") : undefined,
          ])
        } else {
          await Promise.all([
            run.status !== "blocked" ? hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked") : undefined,
            task.status !== "blocked" ? hooks.updateTask(task, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Awaiting user input") : undefined,
          ])
          return
        }
      } else {
        await Promise.all([
          run.status !== "blocked" ? hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked") : undefined,
          task.status !== "blocked" ? hooks.updateTask(task, { status: "blocked", blocking_reason: pending[0].request_type }, "Awaiting user input") : undefined,
        ])
        return
      }
    }

    if (run.status === "completed" && delivery) {
      await completeRun(run, hooks)
      return
    }

    if (run.status === "completed" && !delivery) {
      log.error("run completed but no delivery found", { runID: run.id, taskID: run.task_id })
      await failRun(run, "Run marked completed but no delivery was persisted", hooks)
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
      if (task.status === "blocked") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run resumed")
      }
      return
    }

    if (queue.status === "running") {
      const started = run.time_started ?? run.time_created
      if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
        log.warn("run exceeded max execution time", { runID: run.id, maxMs: RUN_MAX_EXECUTION_MS, elapsedMs: Date.now() - started })
        try { await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID }) } catch {}
        await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (task.status !== "running") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      await completeRun(run, hooks)
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
          status: "running",
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
          status: "running",
          summary: "Operator note queued a follow-up run",
        }, { taskID: task.id, source: "runtime.operator" }),
      )
    })
    return nextRunID
  }

  export async function queueRetry(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks) {
    const nextRunID = createFixRun(task, run, summary)
    await dispatch(nextRunID, hooks)
    return nextRunID
  }
}


async function completeRun(run: RunRow, hooks: RuntimeHooks) {
  // Guard: prevent syncRun from re-triggering completeRun every cycle while
  // Task Agent is processing eval/delivery/publish.
  if (agentNotifiedRuns.has(run.id)) return

  installRuntimeShims()
  stopEventBridge(run.id)
  updateExecutorSessionStatus(run.id, "completed")

  const task = requireTask(run.task_id)
  if (task.active_run_id !== run.id) return

  // If delivery already exists (e.g. per-goal aggregation or prior restart),
  // just mark run completed and notify Task Agent.
  const existingDelivery = findDeliveryByRun(run.id)
  if (existingDelivery) {
    if (run.status !== "completed") {
      await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
    }
    agentNotifiedRuns.add(run.id)
    TaskAgent.processTask(task.id, {
      kind: "run_completed",
      runID: run.id,
    }).catch(err => log.error("task agent failed on run_completed", { taskID: task.id, error: String(err) }))
    return
  }

  // Fetch delivery from executor
  if (!run.session_id) throw new Error(`Run ${run.id} has no session`)
  const completedAt = Date.now()
  await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: completedAt }, "Run completed")

  let delivery: Awaited<ReturnType<ReturnType<typeof ExecutorRegistry.require>["delivery"]>>
  try {
    const executor = ExecutorRegistry.require(run.executor)
    delivery = await Promise.race([
      executor.delivery({
        sessionID: run.session_id,
        since: run.time_started ?? run.time_created,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("executor.delivery() timeout")), DELIVERY_FETCH_TIMEOUT_MS),
      ),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("completeRun: delivery fetch failed", { runID: run.id, error: msg })
    // Notify Task Agent with executor_failed so it can decide recovery
    agentNotifiedRuns.add(run.id)
    TaskAgent.processTask(task.id, {
      kind: "executor_failed",
      runID: run.id,
      error: `Delivery fetch failed: ${msg}`,
    }).catch(e => log.error("task agent failed on delivery fetch error", { taskID: task.id, error: String(e) }))
    return
  }

  const now = Date.now()
  const deliveryID = Identifier.ascending("delivery")
  persistDelivery({ task, run, deliveryID, delivery, now })

  await Plugin.trigger("delivery.ready", {
    taskID: task.id,
    runID: run.id,
    deliveryID,
    delivery: {
      summary: delivery.summary,
      changedFiles: delivery.diffs.map((item) => item.file),
      diffs: delivery.diffs,
    },
  }, { actions: [] }).catch(() => undefined)

  log.info("delivery fetched, notifying task agent", { runID: run.id, taskID: task.id })

  // Notify Task Agent — it controls eval → delivery verify → publish via tools
  agentNotifiedRuns.add(run.id)
  TaskAgent.processTask(task.id, {
    kind: "run_completed",
    runID: run.id,
  }).catch(err => log.error("task agent failed on run_completed", { taskID: task.id, error: String(err) }))
}

/**
 * Recover tasks stuck in non-terminal states without an active Task Agent.
 * Re-triggers the Task Agent for orphaned tasks.
 */
async function recoverOrphanedTasks() {
  const { TaskAgent } = await import("./task-agent")
  const strandedTasks = Database.use((db) =>
    db.select().from(OrchestratorTaskTable).where(and(
      eq(OrchestratorTaskTable.project_id, Instance.project.id),
      inArray(OrchestratorTaskTable.status, [
        "queued", "spec_generating", "goal_decomposing", "planning",
        "evaluating", "delivering", // Task Agent controls eval/delivery — recover if stalled
      ]),
    )).all(),
  )
  const now = Date.now()
  for (const task of strandedTasks) {
    const updated = task.time_status_changed ?? task.time_updated ?? task.time_created ?? 0
    const age = now - updated
    if (age < PIPELINE_STALE_MS) continue
    if (TaskAgent.isRunning(task.id)) continue
    log.warn("recovering orphaned task — re-triggering Task Agent", { taskID: task.id, status: task.status, ageMs: age })
    // Tasks in evaluating/delivering were waiting for Task Agent to run eval/delivery — re-trigger with run_completed
    const trigger = (task.status === "evaluating" || task.status === "delivering") && task.active_run_id
      ? { kind: "run_completed" as const, runID: task.active_run_id }
      : { kind: "created" as const }
    TaskAgent.processTask(task.id, trigger).catch((err) =>
      log.error("orphan recovery failed", { taskID: task.id, error: String(err) }),
    )
  }
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id) // serial bridge
  // Stop all per-goal event bridges for this run
  const goalRuns = listActiveGoalRunsByCoordinator(run.id)
  for (const gr of goalRuns) {
    stopEventBridge(gr.id)
    if (gr.workspace_dir) await cleanupGoalWorkspace(gr.workspace_dir).catch(() => {})
  }
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  if (task.active_run_id === run.id) {
    // Notify Task Agent to decide recovery instead of directly failing the task
    TaskAgent.processTask(task.id, {
      kind: "executor_failed",
      runID: run.id,
      error,
    }).catch(err => log.error("task agent failed on executor_failed", { taskID: task.id, error: String(err) }))
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


/** 将 executor 的实时事件桥接到 Bus，供 SSE 转发给前端 */
function consumeExecutorEvents(
  taskID: string,
  runID: string,
  executorName: Parameters<typeof ExecutorRegistry.require>[0],
  sessionID: string,
  executorSessionID: string,
  goalRunID?: string,
) {
  const executor = ExecutorRegistry.require(executorName)
  if (!executor.capabilities().events) return
  // Create an AbortController so we can stop the event bridge when the run/goal completes/fails.
  // Per-goal bridges use goalRunID as key; serial bridges use runID.
  const bridgeKey = goalRunID || runID
  const ctrl = new AbortController()
  eventBridgeAborts.set(bridgeKey, ctrl)
  // 异步消费 — 不阻塞 dispatch 返回
  ;(async () => {
    try {
      for await (const event of executor.events({ sessionID })) {
        if (ctrl.signal.aborted) break
        upsertExecutorInteraction(taskID, runID, sessionID, executorSessionID, executorName, event)
        // Project executor events into the Message session system.
        // This creates real ToolPart/TextPart/ReasoningPart objects that flow
        // through the standard message protocol bridge → ProtocolStore → SSE.
        // No separate RunProgress/RunOutput publishing needed.
        await projectExecutorEventToSession(taskID, requireRun(runID), event)
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        log.warn("executor event bridge ended", { taskID, runID, error: String(err) })
      }
    } finally {
      eventBridgeAborts.delete(bridgeKey)
    }
  })()
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
