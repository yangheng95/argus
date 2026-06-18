import { Instance } from "@/project/instance"
import { Database, and, eq, sql } from "@/storage/db"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { orchestratorState } from "./orchestrator-state"

import {
  findInteractionByExternal,
  findPendingInteractions,
  findRun,
  findActiveRunForTask,
  findTask,
  listGoalRunsForRun,
  listLiveRunsForProject,
  type RunRow,
} from "./store"
import { Identifier } from "@/id/id"
import { EXECUTOR_ACTIVE_RUN_STATUSES, isLiveGoalRunStatus } from "./catalog"

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
  export async function monitorRuns(hooks: RuntimeHooks) {
    const current = orchestratorState()
    if (current.syncing) return { observedRuns: 0 }
    current.syncing = true
    try {
      const rows = listLiveRunsForProject(Instance.project.id).filter((row) => {
        const task = findTask(row.task_id)
        if (!task || task.time_completed !== null) return false
        return findActiveRunForTask(row.task_id)?.id === row.id
      })
      const noLiveGoalWakes = await Promise.all(rows.map((row) => syncRun(row.id, hooks)))
      return {
        observedRuns: rows.length,
        dispatchedLivenessWakes: noLiveGoalWakes.filter(Boolean).length,
      }
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
  async function syncNoLiveGoalRuns(runID: string, _hooks: RuntimeHooks): Promise<boolean> {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    const goalRuns = listGoalRunsForRun(runID)
    if (goalRuns.some((goalRun) => isLiveGoalRunStatus(goalRun.status))) return false

    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) return false

    const fingerprint = noLiveGoalWakeFingerprint(goalRuns)
    if (hasNoLiveGoalWakeFact({ taskID: run.task_id, runID: run.id, fingerprint })) return false

    const { dispatchTaskLoop } = await import("@/engine/queue")
    const dispatchResult = await dispatchTaskLoop({ taskID: run.task_id })
    if (dispatchResult !== "started") return false
    recordNoLiveGoalWakeFact({ taskID: run.task_id, runID: run.id, fingerprint, goalRuns })
    return true
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    const activeRun = findActiveRunForTask(task.id)
    if (!activeRun) return
    await syncRun(activeRun.id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks): Promise<boolean> {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    const task = findTask(run.task_id)
    if (!task || task.time_completed !== null) return false
    if (findActiveRunForTask(run.task_id)?.id !== run.id) return false

    // Runtime sync is an observation surface. It records no-live-goal
    // liveness wakes only; it does not poll executor queues, auto-reject
    // interactions, or rewrite run status.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      return syncNoLiveGoalRuns(runID, hooks)
    }
    return false
  }
}

type RuntimeHooks = import("./runtime-hooks").RuntimeHooks

function noLiveGoalWakeFingerprint(
  goalRuns: Array<{
    id: string
    status: string
  }>,
) {
  if (goalRuns.length === 0) return "no-goal-runs"
  return goalRuns
    .map((goalRun) => [goalRun.id, goalRun.status].join(":"))
    .sort()
    .join("|")
}

function hasNoLiveGoalWakeFact(input: { taskID: string; runID: string; fingerprint: string }) {
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

function recordNoLiveGoalWakeFact(input: {
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
        label: input.goalRuns.length === 0 ? "no-live-goal-wake-dispatched" : "goal-batch-wake-dispatched",
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
