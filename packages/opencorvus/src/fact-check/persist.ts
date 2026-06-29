/**
 * Fact-Check Attempt persistence + idempotency lookup.
 *
 * Per fact-check agent contract §3.3, fact-check results live as
 * append-only `engine_artifact` rows with kind="fact_check_attempt".
 *
 * Idempotency key:
 *   (invoked_by_orchestrator_session_id, target_session_id,
 *    target_message_id, target_message_content_hash)
 *
 * Repeated orchestrator calls with the same key return the cached row
 * (rule 8 single source — the orchestrator does not need to track
 * "already checked"; the artifact stream is the truth).
 */

import { and, desc, eq, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { EngineArtifactTable } from "@/engine/engine.sql"
import type { FactCheckAttemptArtifact, FactCheckReport } from "./schema"

export interface FactCheckAttemptRow {
  artifactID: string
  taskID: string
  payload: FactCheckAttemptArtifact
  timeCreated: number
}

export interface RecordFactCheckAttemptInput {
  taskID: string
  factCheckSessionID: string
  targetSessionID: string
  targetAgent: string
  targetMessageID: string
  targetMessageContentHash: string
  invokedByOrchestratorSessionID: string
  report: FactCheckReport
  timeStarted: number
  timeCompleted?: number
  outcome: FactCheckAttemptArtifact["outcome"]
  /** Inject `now()` for deterministic tests; defaults to Date.now() when omitted. */
  now?: number
}

/** Insert a new fact_check_attempt artifact. Returns the artifact id. */
export function recordFactCheckAttempt(input: RecordFactCheckAttemptInput): string {
  const id = Identifier.ascending("artifact")
  const now = input.now ?? Date.now()
  const payload: FactCheckAttemptArtifact = {
    fact_check_session_id: input.factCheckSessionID,
    target_session_id: input.targetSessionID,
    target_agent: input.targetAgent,
    target_message_id: input.targetMessageID,
    target_message_content_hash: input.targetMessageContentHash,
    invoked_by_orchestrator_session_id: input.invokedByOrchestratorSessionID,
    report: input.report,
    time_started: input.timeStarted,
    time_completed: input.timeCompleted ?? now,
    outcome: input.outcome,
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        kind: "fact_check_attempt",
        label: `fact_check-${input.outcome}`,
        payload: payload as unknown as Record<string, unknown>,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

export interface FactCheckAttemptLookupInput {
  invokedByOrchestratorSessionID: string
  targetSessionID: string
  targetMessageID: string
  targetMessageContentHash: string
}

/**
 * Look up a fact_check_attempt by the full idempotency key. Returns the
 * most recent matching row (in practice there is at most one per key, but
 * the query is ordered desc(time_created) for robustness).
 *
 * Only `outcome="completed"` rows count as cache hits — aborted / tool_error
 * attempts should not block a retry that might now succeed.
 */
export function findFactCheckAttempt(input: FactCheckAttemptLookupInput): FactCheckAttemptRow | undefined {
  return Database.use((db) => {
    const rows = db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.kind, "fact_check_attempt"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.invoked_by_orchestrator_session_id') = ${input.invokedByOrchestratorSessionID}`,
          sql`json_extract(${EngineArtifactTable.payload}, '$.target_session_id') = ${input.targetSessionID}`,
          sql`json_extract(${EngineArtifactTable.payload}, '$.target_message_id') = ${input.targetMessageID}`,
          sql`json_extract(${EngineArtifactTable.payload}, '$.target_message_content_hash') = ${input.targetMessageContentHash}`,
          sql`json_extract(${EngineArtifactTable.payload}, '$.outcome') = 'completed'`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .all()
    if (rows.length === 0) return undefined
    const row = rows[0]
    return {
      artifactID: row.id,
      taskID: row.task_id,
      payload: row.payload as unknown as FactCheckAttemptArtifact,
      timeCreated: row.time_created,
    }
  })
}

/** Enumerate all fact_check_attempt rows for a task, newest first. Used by
 *  read_context to surface fact-check evidence to the orchestrator LLM
 *  and by integrity replay (impl step 7). */
export function listFactCheckAttempts(taskID: string): FactCheckAttemptRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "fact_check_attempt")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all()
      .map((row) => ({
        artifactID: row.id,
        taskID: row.task_id,
        payload: row.payload as unknown as FactCheckAttemptArtifact,
        timeCreated: row.time_created,
      })),
  )
}
