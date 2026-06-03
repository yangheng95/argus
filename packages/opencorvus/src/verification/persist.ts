/**
 * Verification evidence persistence — artifact-backed (phase 6-b).
 *
 * Pre-phase-6: wrote to `engine_evaluation`.
 * Post-phase-6: writes a single `engine_artifact` row per evidence with
 *   kind="verification-evidence", label="evidence-<scope>". The payload
 *   carries the full VerificationEvidence shape so reads reconstruct
 *   the same structure without a JOIN-heavy schema.
 *
 * Public API (`persistEvidence / queryEvidence / findLatestGoalRunEvidence /
 * findGoalRunEvidence / findLatestAcceptanceEvidence / findPreviousAcceptanceEvidence`)
 * signatures stay stable for artifact-backed evidence readers.
 *
 * Post-DAM Phase 5 note: signature-based convergence detection lives in
 * `src/metrics/arbiter.ts`; this module persists verification evidence only.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import {
  EngineArtifactTable,
  type EngineEvaluationCheck,
  type EngineEvaluationScope,
  type EngineEvaluationStatus,
  type EngineEvaluationVerdict,
} from "@/engine/engine.sql"

/** Artifact-table kind + label pair that marks a row as verification evidence. */
const ARTIFACT_KIND = "verification-evidence" as const
function labelForScope(scope: EngineEvaluationScope): string {
  return `evidence-${scope}`
}

/** A "verification evidence" — the domain name for a verification-evidence artifact row. */
export interface VerificationEvidence {
  id: string
  taskID: string
  runID: string
  goalRunID?: string
  acceptanceID?: string
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[]
  timeCompleted?: number
  timeCreated: number
  timeUpdated: number
}

/** Serialisation shape persisted in `engine_artifact.payload`. */
type EvidencePayload = {
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[]
  time_completed: number | null
} & Record<string, unknown>

function rowToEvidence(row: {
  id: string
  task_id: string
  run_id: string | null
  goal_run_id: string | null
  acceptance_id: string | null
  payload: unknown
  time_created: number
  time_updated: number
}): VerificationEvidence | undefined {
  const payload = row.payload as EvidencePayload | null
  if (!payload || typeof payload !== "object") return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id ?? "",
    goalRunID: row.goal_run_id ?? undefined,
    acceptanceID: row.acceptance_id ?? undefined,
    scope: payload.scope,
    status: payload.status,
    verdict: payload.verdict,
    summary: payload.summary,
    checks: Array.isArray(payload.checks) ? payload.checks : [],
    timeCompleted: payload.time_completed ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export interface PersistEvidenceInput {
  taskID: string
  runID: string
  /** Required when scope="goal_run"; otherwise omit. Enforced below. */
  goalRunID?: string
  /** Required when scope="acceptance"; otherwise omit. Enforced below. */
  acceptanceID?: string
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[]
  timeCompleted?: number
  now?: number
}

/** Insert one new evidence row as an engine_artifact. Returns the persisted
 *  `VerificationEvidence`. Does NOT update goal_run / acceptance status —
 *  callers own those state transitions; this function only owns the
 *  artifact row. */
export function persistEvidence(input: PersistEvidenceInput): VerificationEvidence {
  if (input.scope === "goal_run" && !input.goalRunID) {
    throw new Error("persistEvidence: scope='goal_run' requires goalRunID")
  }
  if (input.scope === "acceptance" && !input.acceptanceID) {
    throw new Error("persistEvidence: scope='acceptance' requires acceptanceID")
  }
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  const payload: EvidencePayload = {
    scope: input.scope,
    status: input.status,
    verdict: input.verdict,
    summary: input.summary,
    checks: input.checks ?? [],
    time_completed: input.timeCompleted ?? null,
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID ?? null,
        acceptance_id: input.acceptanceID ?? null,
        kind: ARTIFACT_KIND,
        label: labelForScope(input.scope),
        payload,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return {
    id,
    taskID: input.taskID,
    runID: input.runID,
    goalRunID: input.goalRunID,
    acceptanceID: input.acceptanceID,
    scope: input.scope,
    status: input.status,
    verdict: input.verdict,
    summary: input.summary,
    checks: input.checks ?? [],
    timeCompleted: input.timeCompleted,
    timeCreated: now,
    timeUpdated: now,
  }
}

/** Latest evidence for a given goal (across all goal_runs for that goal).
 *  Returns undefined when the goal has never been evaluated. Shared by the
 *  retry-prompt builder and acceptance evidence checks.
 *
 *  Joins against `engine_goal_run` to resolve goal → goal_run; the JOIN
 *  dependency goes away in phase 6-d when that table is removed in favour
 *  of session + artifact projection. */
export function findLatestGoalRunEvidence(goalID: string): VerificationEvidence | undefined {
  // Phase-6-d: goal_run rows are append-only artifacts; the logical goal_run_id
  // is carried on each row. Filter to artifacts whose goal_run_id appears in
  // the goal_run_attempt rows for the given goal_id, then pick the newest.
  const goalRunIDs = Database.use((db) =>
    db
      .selectDistinct({ goal_run_id: EngineArtifactTable.goal_run_id })
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.goal_id') = ${goalID}`,
        ),
      )
      .all()
      .map((r) => r.goal_run_id)
      .filter((x): x is string => !!x),
  )
  if (goalRunIDs.length === 0) return undefined
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          inArray(EngineArtifactTable.goal_run_id, goalRunIDs),
          eq(EngineArtifactTable.kind, ARTIFACT_KIND),
          eq(EngineArtifactTable.label, labelForScope("goal_run")),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row)
}

/** Latest evidence for a specific goal_run. Useful during acceptance when the
 *  orchestrator needs to read each goal's most recent on_goal results. */
export function findGoalRunEvidence(goalRunID: string): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.goal_run_id, goalRunID),
          eq(EngineArtifactTable.kind, ARTIFACT_KIND),
          eq(EngineArtifactTable.label, labelForScope("goal_run")),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row)
}

/** Latest acceptance-scope evidence for a task. */
export function findLatestAcceptanceEvidence(taskID: string): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, ARTIFACT_KIND),
          eq(EngineArtifactTable.label, labelForScope("acceptance")),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row)
}
