import { ExecutorRegistry } from "@/executor/registry"
import { Config } from "@/config/config"

import { Instance } from "@/project/instance"
import { Database, and, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { orchestratorState } from "./orchestrator-state"
import { persistFailedRunEvaluation, updateGoalRun } from "./persist"

import {
  findAcceptanceByRun,
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
} from "./store"
import { Identifier } from "@/id/id"
import { EXECUTOR_ACTIVE_RUN_STATUSES, RUNTIME_MONITORED_RUN_STATUSES, isLiveGoalRunStatus } from "./catalog"
import { PerRunState } from "./per-run-state"
import { isInteractionBlockingReason } from "./run-blocking"
import { isTaskCancelled } from "./task-status"

const log = Log.create({ service: "engine-runtime" })
const ACCEPTANCE_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_ACCEPTANCE_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.acceptance() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(
  process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(ACCEPTANCE_FETCH_TIMEOUT_MS + 15 * 60 * 1000),
  10,
) // must exceed fetch + Orchestrator eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()

const eventBridgeAborts = new Map<string, AbortController>() // goalRunID or runID → AbortController

const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "300000", 10) // auto-reject stale interactions (5min default)

/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  try {
    const runs = listLiveRunsForProject(Instance.project.id)
    return runs.some((r) => (EXECUTOR_ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status))
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
            log.error("syncRun failed or timed out", {
              runID: row.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }),
        ),
      )
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
    let run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    const goalRuns = listGoalRunsForRun(runID)
    if (goalRuns.length === 0) return

    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      if (run.status !== "blocked") {
        await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
      }
      return
    }

    if (run.status === "blocked" && isInteractionBlockingReason(run.blocking_reason)) {
      run = await hooks.updateRun(run, { status: "running", blocking_reason: null, error: null }, "Run resumed")
    }

    if (goalRuns.some((goalRun) => isLiveGoalRunStatus(goalRun.status))) return

    const fingerprint = terminalGoalBatchFingerprint(goalRuns)
    if (hasGoalBatchNotification({ taskID: run.task_id, runID: run.id, fingerprint })) return

    if (run.status === "blocked") {
      await hooks.updateRun(run, { status: "running", blocking_reason: null, error: null }, "Goal runs settled")
    }

    const task = findTask(run.task_id)
    if (task && isTaskCancelled(task)) {
      log.info("goal batch settled after task cancellation; not waking orchestrator", {
        taskID: run.task_id,
        runID: run.id,
      })
      return
    }
    const { dispatchTaskLoop } = await import("@/engine/queue")
    const dispatchResult = await dispatchTaskLoop({
      taskID: run.task_id,
    })
    if (dispatchResult === "started") {
      recordGoalBatchNotification({ taskID: run.task_id, runID: run.id, fingerprint, goalRuns })
    }
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
    const acceptance = findAcceptanceByRun(run.id)
    const queueTaskID = run.executor_ref?.queue_task_id
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      const now = Date.now()
      const cfg = await Config.get()
      const autoQuestion = cfg.experimental?.auto_question === true
      const stale = pending.filter((p) => {
        if (now - (p.time_created ?? 0) <= INTERACTION_STALE_MS) return false
        if (p.request_type === "question") return autoQuestion
        return false
      })
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", {
            id: interaction.id,
            type: interaction.request_type,
            ageMs: now - (interaction.time_created ?? 0),
          })
          Database.use((db) =>
            db
              .update(EngineInteractionRequestTable)
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
            await hooks.updateRun(
              run,
              { status: "accepted", blocking_reason: null },
              "Stale interactions auto-rejected",
            )
          }
        } else {
          if (run.status !== "blocked") {
            await hooks.updateRun(
              run,
              { status: "blocked", blocking_reason: stillPending[0].request_type },
              "Run blocked",
            )
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

    if (!queueTaskID) {
      if (run.status === "blocked" && isInteractionBlockingReason(run.blocking_reason)) {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run resumed")
      }
      return
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

    const executor = ExecutorRegistry.require(run.executor)
    const queue = await Promise.race([
      executor.status(queueTaskID),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`executor.status() timeout (${EXECUTOR_STATUS_TIMEOUT_MS}ms)`)),
          EXECUTOR_STATUS_TIMEOUT_MS,
        ),
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
      const RUN_STALL_MS = 60 * 60 * 1000 // 60 min
      const lastActivity = run.time_updated ?? run.time_started ?? run.time_created ?? Date.now()
      const inactiveMs = Date.now() - lastActivity
      if (inactiveMs > RUN_STALL_MS) {
        log.warn("run stalled — no activity", { runID: run.id, inactiveMs })
        try {
          await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID })
        } catch {}
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
        // updateRun → engine/state.ts detects the terminal transition and
        // calls PerRunState.finalize(run.id), so no manual cleanup here.
        await hooks.updateRun(
          run,
          { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() },
          "Run completed",
        )
        // No auto-restart of runTaskLoop here. If the task loop is already
        // in flight it is awaiting pool.drain and will continue naturally.
        // If it is not (rare race on crash recovery), the next user message
        // will start a fresh loop via continueTaskMessage. Silent background
        // restart contradicts the user-message-driven model.
      }
    }
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
  }
  // PerRunState.finalize is driven by updateRun's terminal transition below.
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

function terminalGoalBatchFingerprint(
  goalRuns: Array<{
    id: string
    status: string
  }>,
) {
  return goalRuns
    .map((goalRun) => [goalRun.id, goalRun.status].join(":"))
    .sort()
    .join("|")
}

function hasGoalBatchNotification(input: { taskID: string; runID: string; fingerprint: string }) {
  return Boolean(
    Database.use((db) =>
      db
        .select({ id: EngineArtifactTable.id })
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.run_id, input.runID),
            eq(EngineArtifactTable.kind, "goal_batch_notification" as EngineArtifactKind),
            sql`json_extract(${EngineArtifactTable.payload}, '$.fingerprint') = ${input.fingerprint}`,
          ),
        )
        .limit(1)
        .get(),
    ),
  )
}

function recordGoalBatchNotification(input: {
  taskID: string
  runID: string
  fingerprint: string
  goalRuns: Array<{ id: string; status: string }>
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: null,
        kind: "goal_batch_notification" as EngineArtifactKind,
        label: "goal-batch-wake-dispatched",
        payload: {
          task_id: input.taskID,
          run_id: input.runID,
          fingerprint: input.fingerprint,
          goal_runs: input.goalRuns
            .map((goalRun) => ({ id: goalRun.id, status: goalRun.status }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          time_dispatched: now,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
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
      : (firstQuestionHeader(event.payload?.questions) ?? "Executor input required")
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
      EngineProtocol.emit(
        Event.InteractionRequested,
        {
          taskID,
          runID,
          interactionID,
          requestType: event.type === "approval_request" ? "permission" : "question",
          summary: title,
        },
        { taskID, runID, interactionID, source: "runtime.interaction" },
      ),
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
  return input
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const next = item as Record<string, unknown>
      if (typeof next.question !== "string" || !next.question) return []
      return [next.question]
    })
    .join("\n\n")
}
