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
  effectiveMaxExecutorGroups,
  orchestratorState,
} from "./helpers"
import {
  createGoalRun,
  ensureExecutorSession,
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
} from "./persist"
import { sessionStreamHooks } from "./session-stream"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { TaskAgent } from "@/task-agent/agent"
import {
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findEvaluationByRun,
  findGoalRun,
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
  type GoalRow,
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
import { runGoalPipeline, type PipelineEvent, type GoalContract, type GoalContractFields } from "@/pipeline"

function goalRowToContract(row: GoalRow | ({ id: string; title: string } & Record<string, unknown>)): GoalContractFields & Record<string, unknown> {
  const r = row as Record<string, unknown>
  return {
    ...row,
    id: row.id,
    title: row.title,
    objective: (r.objective as string) ?? "",
    done_definition: (r.done_definition as string) ?? "",
    owned_paths: (r.owned_paths as string[]) ?? [],
    depends_on: (r.depends_on as string[]) ?? [],
    priority: ((r.priority as string) ?? "blocking") as "blocking" | "advisory",
    kind: (r.kind as string) ?? "feature",
    requirement_ids: (r.requirement_ids as string[]) ?? [],
    exports: (r.exports as string[]) ?? [],
    imports: (r.imports as string[]) ?? [],
  }
}

const log = Log.create({ service: "orchestrator-runtime" })
const processStartTime = Date.now()
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + 15 * 60 * 1000), 10) // must exceed fetch + Task Agent eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()
const EXECUTOR_SUBMIT_TIMEOUT_MS = 60_000 // 60s for executor.submit()
const GOAL_STALL_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_GOAL_STALL_TIMEOUT_MS || String(30 * 60 * 1000), 10) // 30 min per-goal stall threshold
const GOAL_HEARTBEAT_INTERVAL_MS = 30_000 // emit progress heartbeat every 30s per goal
const eventBridgeAborts = new Map<string, AbortController>() // goalRunID or runID → AbortController
// Guard: runs that have already notified Task Agent via run_completed.
// Prevents syncRun from re-notifying Task Agent every poll cycle.
const agentNotifiedRuns = new Set<string>()
// Per-run merge serialization: ensures parallel goal deliveries are merged one at a time.
const mergeLocksPerRun = new Map<string, Promise<void>>()
// Per-run pipeline lock: serializes notifyGoalResult calls so concurrent event bridges
// don't race on dispatch/completion checks.
const pipelineLocksPerRun = new Map<string, Promise<void>>()
// Per-goal-run last activity timestamp: used by syncGoalRuns for stall detection.
const goalRunLastActivity = new Map<string, number>()

async function serializedMerge(runID: string, fn: () => Promise<void>) {
  const prev = mergeLocksPerRun.get(runID) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  mergeLocksPerRun.set(runID, next)
  await next
}

async function serializedPipeline(runID: string, fn: () => Promise<void>) {
  const prev = pipelineLocksPerRun.get(runID) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  pipelineLocksPerRun.set(runID, next)
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

async function projectExecutorEventToSession(taskID: string, run: RunRow, goalSessionID: string, event: {
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
      recoverOrphanedTasks()
    } finally {
      current.syncing = false
    }
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
    entry: { node: { id: string; goal_id: string } & Record<string, unknown>; goal: { id: string; title: string } & Record<string, unknown> },
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

      // Pre-register event bridge so syncGoalRuns orphan detection
      // doesn't race with the async dispatch flow below.
      eventBridgeAborts.set(goalRun.id, new AbortController())

      // 4. Build goal-specific prompt (with owned_paths + dependency context + explicit cwd)
      const allGoals = listGoalsByPlan(plan.id)
      const prompt = buildGoalPrompt({
        plan: plan as any,
        node: entry.node as any,
        goal: entry.goal as any,
        taskRequest: plan.prompt,
        taskID: task.id,
        allGoals,
        cwd: worktreeDir,
      })

      // 5. Submit to executor with cwd=worktree
      //    Each goal gets its own executor instance — no shared state between parallel goals.
      const executor = ExecutorRegistry.createInstance(run.executor)
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

      // 8. Start goal pipeline (event-driven, self-driving)
      // Register BOTH sessions so bridge can resolve taskID for their events:
      // - goalSession: the goal-scoped session (receives projected events for non-opencode executors)
      // - executorSession: the opencode executor's native session (publishes message events directly)
      registerGoalRunSession(goalSession.id, task.id, "executor")
      registerGoalRunSession(executorSession.id, task.id, "executor")
      const pipelineContract: GoalContract = {
        goal: goalRowToContract(entry.goal),
        planNode: entry.node as any,
        run,
        task,
        plan,
        allGoals: listGoalsByPlan(plan.id).map(goalRowToContract),
      }
      consumeGoalPipeline({
        contract: pipelineContract,
        executor,
        goalRunID: goalRun.id,
        goalSessionID: goalSession.id,
        executorSessionID: executorSession.id,
        queueTaskID: submission.queueTaskID,
        executorProvider: run.executor,
        workDir: worktreeDir,
        hooks,
      })

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

  /**
   * Sync per-goal runs: timeout enforcement + orphan recovery ONLY.
   *
   * Goal completion is driven exclusively by consumeExecutorEvents (event-driven).
   * This function NEVER calls notifyGoalResult — that is the event bridge's
   * sole responsibility. Two actors advancing the same state machine causes races.
   *
   * This function handles:
   * 1. Run-level timeout → failRun
   * 2. Orphan detection: goal runs from a previous process (no event bridge) → mark failed
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    if (!run.plan_version_id) return

    // 1. Run execution timeout
    const started = run.time_started ?? run.time_created
    if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
      log.warn("per-goal run exceeded max execution time", { runID, maxMs: RUN_MAX_EXECUTION_MS })
      await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
      return
    }

    // 2. Orphan detection: goal runs created BEFORE the current process started
    //    that have no event bridge. These are leftovers from a crashed process.
    //    The executor process is dead — we can only mark them failed so
    //    notifyGoalResult (called by the LAST surviving event bridge) can
    //    detect the failure and notify the Task Agent.
    const activeGoalRuns = listActiveGoalRunsByCoordinator(runID)
    for (const goalRun of activeGoalRuns) {
      // Pipeline-internal finalization — no external guard needed
      if (eventBridgeAborts.has(goalRun.id)) continue
      if ((goalRun.time_created ?? 0) >= processStartTime) continue
      log.warn("orphaned goal run from previous process, marking failed", { runID, goalRunID: goalRun.id })
      updateGoalRun(goalRun.id, { status: "failed", error: "Orphaned: event bridge lost (process restart)", time_completed: Date.now() })
      updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
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

    // 3. Per-goal stall detection: active goals whose event bridge exists but
    //    hasn't received any executor event for GOAL_STALL_TIMEOUT_MS.
    //    This catches executor processes that silently hang without producing events.
    const now = Date.now()
    const refreshedGoalRuns = listActiveGoalRunsByCoordinator(runID)
    for (const goalRun of refreshedGoalRuns) {
      // Pipeline-internal finalization — no external guard needed
      if (!eventBridgeAborts.has(goalRun.id)) continue // orphan detection handles bridgeless goals
      const lastActivity = goalRunLastActivity.get(goalRun.id) ?? goalRun.time_started ?? goalRun.time_created ?? 0
      const staleMs = now - lastActivity
      if (staleMs < GOAL_STALL_TIMEOUT_MS) continue
      log.warn("goal run stalled — no executor activity", { runID, goalRunID: goalRun.id, staleMs, thresholdMs: GOAL_STALL_TIMEOUT_MS })
      stopEventBridge(goalRun.id)
      updateGoalRun(goalRun.id, {
        status: "failed",
        error: `Goal stalled: no executor activity for ${Math.round(staleMs / 60000)}min`,
        time_completed: now,
      })
      updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
      Database.use((db) =>
        db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: now })
          .where(eq(OrchestratorGoalTable.id, goalRun.goal_id))
          .run(),
      )
      if (goalRun.workspace_dir) {
        await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
      }
    }

    // After orphan + stall cleanup: if we actually marked orphans AND no event bridges
    // remain for this run, the pipeline is fully dead (process restart killed
    // everything). Only then do we failRun — this is the ONLY case where
    // syncGoalRuns touches the pipeline.
    const remaining = listActiveGoalRunsByCoordinator(runID)
    const hasAnyBridge = remaining.some((gr) => eventBridgeAborts.has(gr.id))
    if (remaining.length === 0 && !hasAnyBridge && !agentNotifiedRuns.has(run.id)) {
      // Double-check: were there actually failed goals from cleanup (orphan or stall)?
      // If all goal runs completed normally via event bridges, remaining=0
      // is expected and notifyGoalResult was already called by the bridge.
      const allGoalRuns = listGoalRunsByCoordinator(runID)
      const cleanupFailCount = allGoalRuns.filter((gr) =>
        gr.status === "failed" && (gr.error?.includes("Orphaned") || gr.error?.includes("stalled")),
      ).length
      if (cleanupFailCount > 0) {
        const task = requireTask(run.task_id)
        if (task.active_run_id === run.id) {
          log.warn("all goal runs dead after cleanup, failing run", { runID, cleanupFailCount })
          agentNotifiedRuns.add(run.id)
          await failRun(run, `All goal runs failed (${cleanupFailCount} orphaned/stalled)`, hooks)
        }
      }
    }
  }

  // finalizeGoalRun — DELETED. Replaced by:
  //   runGoalPipeline (pipeline/goal-pipeline.ts) — delivery extraction + goal status
  //   mergeGoalDelivery (below, module-level)     — merge + commit + verify
  //   consumeGoalPipeline (below, module-level)   — wires pipeline events to orchestrator

  /**
   * After goal runs complete/fail, check if:
   * - More ready goals can be dispatched
   * - All goals are done → finalize the run
   * - Blocking goals failed → handle failure
   */
  /**
   * Notify Task Agent that a goal completed or failed.
   * Infrastructure ONLY notifies — does NOT dispatch next goals or complete runs.
   * Task Agent decides what to do next.
   */
  async function notifyGoalResult(task: TaskRow, run: RunRow, goalID: string, result: "completed" | "failed") {
    await serializedPipeline(run.id, async () => {
      if (agentNotifiedRuns.has(run.id)) return

      const activeRuns = listActiveGoalRunsByCoordinator(run.id)

      // If other goals still executing, don't notify yet — wait for all in this batch
      if (activeRuns.length > 0) return

      // All goals in current batch done — notify Task Agent
      const { listGoals: listAllGoals } = await import("./store")
      const goals = listAllGoals(task.id) as GoalRow[]
      const failedGoals = goals.filter(g => g.status === "failed" && g.priority === "blocking")

      if (failedGoals.length > 0) {
        const failSummary = failedGoals.map(g => `${g.title}`).join(", ")
        log.info("batch complete with failures, notifying Task Agent", { taskID: task.id, failed: failSummary })
        TaskAgent.processTask(task.id, {
          kind: "executor_failed",
          runID: run.id,
          error: `Goal(s) failed: ${failSummary}. Use read_context to see evidence, then decide next step.`,
        }).catch(err => log.error("task agent notification failed", { taskID: task.id, error: String(err) }))
      } else {
        log.info("batch complete, notifying Task Agent", { taskID: task.id, runID: run.id })
        TaskAgent.processTask(task.id, {
          kind: "run_completed",
          runID: run.id,
        }).catch(err => log.error("task agent notification failed", { taskID: task.id, error: String(err) }))
      }
    })
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
      // Legacy single-executor path: notify Task Agent (delivery extraction
      // is handled by the per-goal pipeline in the new architecture).
      if (!agentNotifiedRuns.has(run.id)) {
        agentNotifiedRuns.add(run.id)
        stopEventBridge(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        TaskAgent.processTask(task.id, {
          kind: delivery ? "run_completed" : "executor_failed",
          runID: run.id,
          ...(delivery ? {} : { error: "Run marked completed but no delivery was persisted" }),
        } as any).catch(err => log.error("task agent notification failed", { taskID: task.id, error: String(err) }))
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
      // Legacy single-executor path: mark run completed and notify Task Agent.
      if (!agentNotifiedRuns.has(run.id)) {
        agentNotifiedRuns.add(run.id)
        stopEventBridge(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
        TaskAgent.processTask(task.id, {
          kind: "run_completed",
          runID: run.id,
        }).catch(err => log.error("task agent notification failed", { taskID: task.id, error: String(err) }))
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

  /**
   * Dispatch a single goal by ID (called by execute_goal tool).
   * Creates worktree, submits to executor, starts event bridge.
   */
  export async function dispatchSingleGoal(taskID: string, runID: string, goalID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task ${taskID} not found`)
    const run = findRun(runID)
    if (!run) throw new Error(`Run ${runID} not found`)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : null
    const { listGoals: listTaskGoals } = await import("./store")
    const goal = (listTaskGoals(taskID) as GoalRow[]).find(g => g.id === goalID)
    if (!goal) throw new Error(`Goal ${goalID} not found`)

    // Find plan node for this goal (may not exist if agent skipped planning)
    const nodes = plan ? listPlanNodesByPlan(plan.id) : []
    const node = nodes.find(n => n.goal_id === goalID) ?? { id: `inline_${goalID}`, goal_id: goalID, title: goal.title, brief: goal.done_definition }

    await queueGoalRun(task, run, plan ?? { id: "", task_id: taskID, summary: "", prompt: "" } as any, { node: node as any, goal: goal as any }, hooks)
  }

  /**
   * Dispatch all dependency-ready goals in parallel (called by Task Agent's dispatch_ready_goals action).
   * Returns number of goals dispatched.
   */
  export async function dispatchReadyGoals(taskID: string, runID: string, planID: string, hooks: RuntimeHooks): Promise<number> {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task ${taskID} not found`)
    const run = findRun(runID)
    if (!run) throw new Error(`Run ${runID} not found`)
    const plan = findPlan(planID)
    if (!plan) throw new Error(`Plan ${planID} not found`)
    return queueReadyGoalRuns(task, run, plan, hooks)
  }

  // Internal accessor for event bridge (module-level, outside namespace).
  export const _internal = {
    notifyGoalResult,
  }
}


/**
 * Recover tasks stuck in non-terminal states without an active Task Agent.
 * Re-triggers the Task Agent for orphaned tasks.
 */
async function recoverOrphanedTasks() {
  const { TaskAgent } = await import("@/task-agent/agent")
  const strandedTasks = Database.use((db) =>
    db.select().from(OrchestratorTaskTable).where(and(
      eq(OrchestratorTaskTable.project_id, Instance.project.id),
      inArray(OrchestratorTaskTable.status, ["queued", "active"]),
    )).all(),
  )
  const now = Date.now()
  for (const task of strandedTasks) {
    const updated = task.time_status_changed ?? task.time_updated ?? task.time_created ?? 0
    const age = now - updated
    if (age < PIPELINE_STALE_MS) continue
    if (TaskAgent.isRunning(task.id)) continue
    log.warn("recovering orphaned task — re-triggering Task Agent", { taskID: task.id, status: task.status, ageMs: age })
    // Active tasks with a run → re-trigger as run_completed; otherwise fresh start
    const trigger = task.status === "active" && task.active_run_id
      ? { kind: "run_completed" as const, runID: task.active_run_id }
      : { kind: "created" as const }
    TaskAgent.processTask(task.id, trigger).catch((err) =>
      log.error("orphan recovery failed", { taskID: task.id, error: String(err) }),
    )
  }
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id) // serial bridge
  // Stop all per-goal event bridges (abort propagates to executor via consumeExecutorEvents)
  const goalRuns = listActiveGoalRunsByCoordinator(run.id)
  for (const gr of goalRuns) {
    stopEventBridge(gr.id) // aborts the controller → consumeExecutorEvents loop breaks → executor.abort() called
    updateGoalRun(gr.id, { status: "failed", error: `Parent run failed: ${error}`, time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(gr.id, "failed")
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


/**
 * Goal pipeline consumer: runs GoalPipeline and reacts to its events.
 *
 * Replaces consumeExecutorEvents as the goal completion driver.
 * Pipeline handles: executor event stream → delivery extraction → goal_run/goal status.
 * Consumer handles: session projection → merge + commit → worktree cleanup → pipeline advancement.
 */
function consumeGoalPipeline(ctx: {
  contract: GoalContract
  executor: import("@/executor/compat").ExecutorAdapter
  goalRunID: string
  goalSessionID: string
  executorSessionID: string
  queueTaskID: string
  executorProvider: RunRow["executor"]
  workDir: string
  hooks: RuntimeHooks
}) {
  const { contract, executor, goalRunID, goalSessionID, executorSessionID, queueTaskID, executorProvider, workDir, hooks } = ctx
  const { task, run, plan, goal } = contract
  const ctrl = eventBridgeAborts.get(goalRunID) ?? new AbortController()
  eventBridgeAborts.set(goalRunID, ctrl)

  // Register abort handler
  ctrl.signal.addEventListener("abort", () => {
    executor.abort({ sessionID: goalSessionID, queueTaskID }).catch(() => {})
  }, { once: true })

  goalRunLastActivity.set(goalRunID, Date.now())

  ;(async () => {
    try {
      const pipeline = runGoalPipeline(contract, {
        executor,
        workDir,
        sessionID: goalSessionID,
        executorSessionID,
        queueTaskID,
        signal: ctrl.signal,
      })

      for await (const event of pipeline) {
        if (ctrl.signal.aborted) break

        switch (event.type) {
          case "executor_event":
            // Project to session system for overlay visibility
            upsertExecutorInteraction(task.id, run.id, goalSessionID, executorSessionID, executorProvider, event.event)
            const currentRun = findRun(run.id)
            if (currentRun) {
              await projectExecutorEventToSession(task.id, currentRun, goalSessionID, event.event)
            }
            goalRunLastActivity.set(goalRunID, Date.now())
            break

          case "heartbeat":
            goalRunLastActivity.set(goalRunID, Date.now())
            break

          case "completed": {
            // Orchestrator responsibility: merge + commit + cleanup + dispatch next
            const goalRun = findGoalRun(goalRunID)
            if (goalRun?.workspace_dir && event.delivery.diffs.length > 0) {
              await mergeGoalDelivery(task, run, plan, goalRun, event.delivery, hooks)
            }
            if (goalRun?.workspace_dir) {
              await cleanupGoalWorkspace(goalRun.workspace_dir).catch((err) => {
                log.warn("worktree cleanup failed (non-fatal)", { goalRunID, error: String(err) })
              })
            }
            log.info("goal completed, notifying Task Agent", { goalRunID, goalID: goal.id })
            await OrchestratorRuntime._internal.notifyGoalResult(task, run, goal.id, "completed")
            break
          }

          case "failed": {
            const goalRun = findGoalRun(goalRunID)
            if (goalRun?.workspace_dir) {
              await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
            }
            log.warn("goal failed, notifying Task Agent", { goalRunID, goalID: goal.id, error: event.error })
            await OrchestratorRuntime._internal.notifyGoalResult(task, run, goal.id, "failed")
            break
          }

          case "aborted":
            log.info("goal pipeline aborted", { goalRunID })
            break
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        log.warn("goal pipeline consumer error", { goalRunID, error: String(err) })
      }
    } finally {
      eventBridgeAborts.delete(goalRunID)
      goalRunLastActivity.delete(goalRunID)
    }
  })()
}

/**
 * Merge goal delivery to main workspace (orchestrator responsibility).
 * Serialized per-run. Commits merged files to advance HEAD for subsequent worktrees.
 */
async function mergeGoalDelivery(
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
      await $`git add -- ${files}`.quiet().cwd(Instance.directory).nothrow()
      const label = goalRun.goal_id?.slice(-8) ?? "unknown"
      await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${"goal-merge: " + label}`.quiet().cwd(Instance.directory).nothrow()
      log.info("committed goal merge to advance HEAD", { goalRunID: goalRun.id, files: files.length })
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
