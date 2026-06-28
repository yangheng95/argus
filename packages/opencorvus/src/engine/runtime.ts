import { Instance } from "@/project/instance"
import { NamedError } from "@opencorvus-ai/util/error"
import { Database, and, eq, sql } from "@/storage/db"
import z from "zod"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
  type EngineArtifactKind,
  type EngineInteractionType,
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
  listLiveRuns,
  listGoalRunsForRun,
  listLiveRunsForProject,
  type RunRow,
} from "./store"
import { Identifier } from "@/id/id"
import { EXECUTOR_ACTIVE_RUN_STATUSES, isLiveGoalRunStatus } from "./catalog"

export const ActiveExecutorSessionsError = NamedError.create(
  "ActiveExecutorSessionsError",
  z.object({
    message: z.string(),
    operation: z.string(),
  }),
)

function hasExecutorActiveRuns(runs: RunRow[]): boolean {
  return runs.some((r) => (EXECUTOR_ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status))
}

export function activeExecutorSessionsError(operation: string) {
  return new ActiveExecutorSessionsError({
    operation,
    message: `Active executor sessions exist; refusing ${operation}.`,
  })
}

/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  return hasExecutorActiveRuns(listLiveRunsForProject(Instance.project.id))
}

/** Check if any executor session is active across all registered project tasks. */
export function hasAnyActiveSessions(): boolean {
  return hasExecutorActiveRuns(listLiveRuns())
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
      const goalRefillWakes = await Promise.all(rows.map((row) => syncRun(row.id, hooks)))
      return {
        observedRuns: rows.length,
        dispatchedLivenessWakes: goalRefillWakes.filter(Boolean).length,
      }
    } finally {
      current.syncing = false
    }
  }

  /**
   * Observe terminal goal runs and wake the orchestrator for FIFO refill.
   * Runtime writes durable facts only; graph repair and next goal selection
   * remain LLM-owned in the next orchestrator turn.
   */
  async function syncTerminalGoalRefills(runID: string, _hooks: RuntimeHooks): Promise<boolean> {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    if (run.status === "blocked" && run.blocking_reason === "orchestrator_stream_error") return false
    const goalRuns = listGoalRunsForRun(runID)

    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) return false

    const refillFacts: Array<{
      fingerprint: string
      terminalGoalRun: { id: string; goal_id: string; status: string }
      liveSiblingGoalRuns: Array<{ id: string; goal_id: string; status: string }>
    }> = []
    for (const terminalGoalRun of goalRuns.filter((goalRun) => !isLiveGoalRunStatus(goalRun.status))) {
      const fingerprint = terminalGoalRefillFingerprint(terminalGoalRun)
      if (hasTerminalGoalRefillWakeFact({ taskID: run.task_id, runID: run.id, fingerprint })) continue
      const liveSiblingGoalRuns = goalRuns.filter(
        (goalRun) => goalRun.id !== terminalGoalRun.id && isLiveGoalRunStatus(goalRun.status),
      )
      refillFacts.push({ fingerprint, terminalGoalRun, liveSiblingGoalRuns })
    }
    if (refillFacts.length === 0) return false

    let factsRecorded = false
    const recordRefillFacts = (dispatchResult: "started" | "queued") => {
      for (const { fingerprint, terminalGoalRun, liveSiblingGoalRuns } of refillFacts) {
        recordTerminalGoalRefillWakeFact({
          taskID: run.task_id,
          runID: run.id,
          fingerprint,
          terminalGoalRun,
          liveSiblingGoalRuns,
          dispatchResult,
        })
      }
      factsRecorded = true
    }

    const { dispatchTaskLoop } = await import("@/engine/queue")
    const dispatchResult = await dispatchTaskLoop({
      taskID: run.task_id,
      beforeAcceptedWake: ({ result }) => recordRefillFacts(result),
    })
    if (dispatchResult !== "started" && dispatchResult !== "queued") return false
    if (!factsRecorded) {
      throw new Error(`dispatchTaskLoop accepted terminal refill wake without recording facts: ${run.task_id}`)
    }
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

    const interactionProjection = await syncInteractionBlocker(run, hooks)
    if (interactionProjection) return false

    // Runtime sync is an observation surface. It records terminal-goal refill
    // wakes and projects durable interaction blockers. It does not poll
    // executor queues or auto-reject interactions.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      return syncTerminalGoalRefills(runID, hooks)
    }
    return false
  }
}

type RuntimeHooks = import("./runtime-hooks").RuntimeHooks

async function syncInteractionBlocker(run: RunRow, hooks: RuntimeHooks): Promise<boolean> {
  const pending = findPendingInteractions(run.id)
  if (pending.length > 0) {
    const blocker = pending[0].request_type
    if (run.status === "blocked" && !isInteractionBlocker(run.blocking_reason)) return true
    if (run.status !== "blocked" || run.blocking_reason !== blocker) {
      await hooks.updateRun(
        run,
        {
          status: "blocked",
          blocking_reason: blocker,
          error: pending[0].title || pending[0].body || `Pending ${blocker} interaction`,
        },
        `${blocker} interaction pending`,
      )
    }
    return true
  }

  if (!isInteractionBlocker(run.blocking_reason)) return false
  if (!hasResolvedInteractionForBlocker(run.id, run.blocking_reason, run.time_updated)) return false
  await hooks.updateRun(
    run,
    {
      status: "running",
      blocking_reason: null,
      error: null,
    },
    `${run.blocking_reason} interaction resolved`,
  )
  return true
}

function isInteractionBlocker(input: string | null | undefined): input is EngineInteractionType {
  return input === "permission" || input === "question"
}

function hasResolvedInteractionForBlocker(runID: string, blocker: EngineInteractionType, blockedAt: number) {
  return Boolean(
    Database.use((db) =>
      db
        .select({ id: EngineInteractionRequestTable.id })
        .from(EngineInteractionRequestTable)
        .where(
          and(
            eq(EngineInteractionRequestTable.run_id, runID),
            eq(EngineInteractionRequestTable.request_type, blocker),
            sql`${EngineInteractionRequestTable.status} != 'pending'`,
            sql`${EngineInteractionRequestTable.time_updated} >= ${blockedAt}`,
          ),
        )
        .limit(1)
        .get(),
    ),
  )
}

function terminalGoalRefillFingerprint(goalRun: { id: string; status: string }) {
  return `${goalRun.id}:${goalRun.status}`
}

function hasTerminalGoalRefillWakeFact(input: { taskID: string; runID: string; fingerprint: string }) {
  return Boolean(
    Database.use((db) =>
      db
        .select({ id: EngineArtifactTable.id })
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.run_id, input.runID),
            eq(EngineArtifactTable.kind, "goal_refill_notification" as EngineArtifactKind),
            sql`json_extract(${EngineArtifactTable.payload}, '$.fingerprint') = ${input.fingerprint}`,
          ),
        )
        .limit(1)
        .get(),
    ),
  )
}

function recordTerminalGoalRefillWakeFact(input: {
  taskID: string
  runID: string
  fingerprint: string
  terminalGoalRun: { id: string; goal_id: string; status: string }
  liveSiblingGoalRuns: Array<{ id: string; goal_id: string; status: string }>
  dispatchResult: "started" | "queued"
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.terminalGoalRun.id,
        kind: "goal_refill_notification" as EngineArtifactKind,
        label: "goal-refill-wake-dispatched",
        payload: {
          task_id: input.taskID,
          run_id: input.runID,
          fingerprint: input.fingerprint,
          terminal_goal_run: {
            id: input.terminalGoalRun.id,
            goal_id: input.terminalGoalRun.goal_id,
            status: input.terminalGoalRun.status,
          },
          live_sibling_goal_runs: input.liveSiblingGoalRuns
            .map((goalRun) => ({ id: goalRun.id, goal_id: goalRun.goal_id, status: goalRun.status }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          dispatch_result: input.dispatchResult,
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
