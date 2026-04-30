import { ExecutorRegistry } from "@/executor/registry"
import { Config } from "@/config/config"

import { Instance } from "@/project/instance"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
} from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { buildOperatorPrompt } from "./helpers"
import { orchestratorState } from "./orchestrator-state"
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
  findActiveRunForTask,
  findTask,
  listActiveGoalRunsForRun,
  listGoalRunsForRun,
  listLiveRunsForProject,
  requireTask,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"
import { EXECUTOR_ACTIVE_RUN_STATUSES, RUNTIME_MONITORED_RUN_STATUSES } from "./catalog"
import { PerRunState } from "./per-run-state"

const log = Log.create({ service: "engine-runtime" })
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + 15 * 60 * 1000), 10) // must exceed fetch + Orchestrator eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()

const eventBridgeAborts = new Map<string, AbortController>() // goalRunID or runID → AbortController

const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "300000", 10) // auto-reject stale interactions (5min default)


/**
 * Revive zombie tasks — those with status=active but no orchestrator-loop
 * in flight. The orchestrator-loop is fire-and-forget per wake event:
 * `Orchestrator.processTask` returns and the loop exits. Normally each
 * orchestrator decision (`task_report`, `dispatch`, `inject_*`, …)
 * schedules its own follow-up wake, so the loop re-enters until the task
 * reaches terminal. But when `processTask` returns WITHOUT making a
 * decision — e.g. the orchestrator's LLM stream got aborted by the
 * `stream-activity` watchdog (`stream idle > 180000ms` from
 * `alibaba-coding-plan-cn` blips, which MEMORY documents as transient) —
 * no decision means no follow-up wake means the task sits "active"
 * forever with nobody driving it. The `resumeActiveTaskLoop` API was
 * defined for exactly this safety net but was never wired up; this poll
 * is the missing wiring.
 *
 * Explicit orchestrator stream errors are different: once the wake persisted
 * `orchestrator-stream-error`, `recordOrchestratorStreamError` is the single
 * source of truth and says the next wake must be external. Reviving that task
 * automatically replays the same failed wake forever when the failure is
 * deterministic preflight configuration.
 */
function hasExplicitOrchestratorStreamErrorSinceTaskStart(task: TaskRow): boolean {
  const startedAt = task.time_started ?? task.time_created
  const row = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id })
      .from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, task.id),
        eq(EngineArtifactTable.kind, "orchestrator-stream-error"),
        sql`${EngineArtifactTable.time_created} >= ${startedAt}`,
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .get(),
  )
  return !!row
}

async function reviveZombieTasks(): Promise<void> {
  // Lazy imports avoid the runtime ↔ queue ↔ task-status circular deps
  // the rest of this file already navigates via dynamic `await import`.
  const { listProjectTasks } = await import("./store")
  const { isTaskActive } = await import("./task-status")
  const { resumeActiveTaskLoop, isLoopInFlight } = await import("./queue")

  const tasks = listProjectTasks(Instance.project.id, 50)
  for (const task of tasks) {
    if (!isTaskActive(task)) continue
    if (isLoopInFlight(task.id)) continue
    if (hasExplicitOrchestratorStreamErrorSinceTaskStart(task)) {
      log.info("reviveZombieTasks: explicit orchestrator stream error exists, waiting for external wake", { taskID: task.id })
      continue
    }
    log.info("reviveZombieTasks: task is active with no loop in flight, resuming", { taskID: task.id })
    await resumeActiveTaskLoop(task.id).catch((err) => {
      log.warn("reviveZombieTasks: resume failed", {
        taskID: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
}

/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  try {
    const runs = listLiveRunsForProject(Instance.project.id)
    return runs.some((r) =>
      (EXECUTOR_ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status),
    )
  } catch {
    return false
  }
}

export namespace EngineRuntime {
  /**
   * Monitor active runs (executor status). No pipeline advancement.
   * Pipeline advancement is now driven by the Orchestrator.
   */
  export async function monitorRuns(hooks: RuntimeHooks) {
    const current = orchestratorState()

    // Sync active runs — guarded to prevent overlapping sync waves.
    if (current.syncing) return
    current.syncing = true
    try {
      const rows = listLiveRunsForProject(Instance.project.id)
        .filter((r) => (RUNTIME_MONITORED_RUN_STATUSES as readonly string[]).includes(r.status))
        .map((r) => ({ id: r.id }))
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
      await reviveZombieTasks()
    } finally {
      current.syncing = false
    }
  }

  /**
   * Per-goal execution is owned by GoalPool + the event bridge.
   *
   * Startup orphan cleanup was moved to engine/recovery.ts so runtime polling
   * no longer tries to reconcile previous-process state here.
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    void runID
    void hooks
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    const activeRun = findActiveRunForTask(task.id)
    if (!activeRun) return
    await syncRun(activeRun.id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)

    // Per-goal parallel mode: if this run has ANY goal runs (active or completed),
    // delegate to syncGoalRuns which handles both active-goal polling and pipeline continuation.
    // Using listGoalRunsForRun (ALL statuses) to detect per-goal mode even when
    // all goals have already completed but the run hasn't been finalized yet.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      const allGoalRuns = listGoalRunsForRun(runID)
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
      const cfg = await Config.get()
      const autoQuestion = cfg.experimental?.auto_question === true
      const stale = pending.filter((p) => {
        if ((now - (p.time_created ?? 0)) <= INTERACTION_STALE_MS) return false
        if (p.request_type === "question") return autoQuestion
        return false
      })
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", { id: interaction.id, type: interaction.request_type, ageMs: now - (interaction.time_created ?? 0) })
          Database.use((db) =>
            db.update(EngineInteractionRequestTable)
              .set({ status: "rejected", time_resolved: now, time_updated: now })
              .where(eq(EngineInteractionRequestTable.id, interaction.id))
              .run(),
          )
        }
        // Phase-6-f-4: task.blocking_reason cache column removed. Blocking is
        // a run-scoped signal now (run.blocking_reason + pending interactions).
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          if (run.status === "blocked") {
            await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Stale interactions auto-rejected")
          }
        } else {
          if (run.status !== "blocked") {
            await hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked")
          }
          return
        }
      } else {
        if (run.status !== "blocked") {
          await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
        }
        return
      }
    }

    if (run.status === "completed") {
      // Already-completed runs reach this branch only when syncRun's downstream
      // path (queue.status === "completed") hasn't yet handled this run. That
      // path claims via PerRunState.claimAgentNotification in the same tick,
      // so by the time we'd otherwise re-enter here the run.status check above
      // already short-circuited. After process restart, completed runs are
      // filtered out before syncRun reaches them (queueTaskID check below).
      // Nothing left for this branch to do — just return.
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
      // Phase-6-f-4: task.blocking_reason cache removed — run-scoped only.
      return
    }

    if (queue.status === "running") {
      // Single-session operator runs: use DB timestamps for inactivity detection.
      // (GoalPool-managed runs don't reach this path.)
      const RUN_STALL_MS = 30 * 60 * 1000 // 30 min
      const lastActivity = run.time_updated ?? run.time_started ?? run.time_created ?? Date.now()
      const inactiveMs = Date.now() - lastActivity
      if (inactiveMs > RUN_STALL_MS) {
        log.warn("run stalled — no activity", { runID: run.id, inactiveMs })
        try { await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID }) } catch {}
        await failRun(run, `Run stalled — no activity for ${Math.round(inactiveMs / 60000)}min`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      // Phase-6-f-2/4: task.status / blocking_reason caches removed.
      // Promote to active via time_started stamp if not yet started.
      if (task.time_started == null) {
        await hooks.updateTask(task, { status: "active" }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      // Single-executor path: mark run completed and trigger task loop.
      if (PerRunState.claimAgentNotification(run.id)) {
        stopEventBridge(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        // updateRun → engine/state.ts detects the terminal transition and
        // calls PerRunState.finalize(run.id), so no manual cleanup here.
        await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
        // No auto-restart of runTaskLoop here. If the task loop is already
        // in flight it is awaiting pool.drain and will continue naturally.
        // If it is not (rare race on crash recovery), the next user message
        // will start a fresh loop via continueTaskMessage. Silent background
        // restart contradicts the user-message-driven model.
      }
    }
  }

  export async function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
    // Phase-6-f-2: operator notes are allowed on failed tasks (they revive
    // the task via a new run) but not on completed / cancelled tasks.
    const { isTaskCompleted, isTaskCancelled, deriveTaskStatus } = await import("./task-status")
    if (isTaskCompleted(task) || isTaskCancelled(task)) {
      throw new Error(`Cannot create operator run: task ${task.id} is in terminal state "${deriveTaskStatus(task)}"`)
    }
    const { createRun } = await import("./writer")
    const { updateTask } = await import("./state")
    const { findActivePlanForTask } = await import("./store")
    const created = createRun({
      taskID: task.id,
      planVersionID: findActivePlanForTask(task.id)?.id ?? null,
      sessionID: run.session_id ?? null,
      executor: run.executor,
      status: "queued",
      phase: "execute",
      metadata: {
        previous_run_id: run.id,
        strategy: "operator_note",
        prompt_override: buildOperatorPrompt(note),
      },
      summary: "Run queued from operator note",
    })
    await updateTask(
      task,
      {
        status: "active",
        error: null,
        time_completed: null,
      },
      "Operator note queued a follow-up run",
    )
    return created.id
  }

}



async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id) // serial bridge
  // Stop all per-goal event bridges (abort propagates to executor via consumeExecutorEvents)
  // Infrastructure only writes goal_run.status — goal.status is Orchestrator's decision
  const goalRuns = listActiveGoalRunsForRun(run.id)
  for (const gr of goalRuns) {
    stopEventBridge(gr.id) // aborts the controller → consumeExecutorEvents loop breaks → executor.abort() called
    updateGoalRun(gr.id, { status: "failed", error: `Parent run failed: ${error}`, time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(gr.id, "failed")
  }
  // PerRunState.finalize is driven by updateRun's terminal transition below;
  // executor_session is the only extra cleanup this path owns.
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  // Task loop detects run failure via task status check and re-enters Decision Point.
  // No fire-and-forget trigger needed.
  if (findActiveRunForTask(task.id)?.id === run.id) {
    log.info("run failed, task loop will detect and re-decide", { taskID: task.id, runID: run.id })
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

type RuntimeHooks = import("./runtime-hooks").RuntimeHooks


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
    db.insert(EngineInteractionRequestTable)
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
      EngineProtocol.emit(Event.InteractionRequested, {
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
