/**
 * Verification evidence persistence — reads & writes on `engine_evaluation`.
 *
 * Post-DAM Phase 5: this table carries the delivery-agent verdict summary
 * only. Signature-based convergence detection has been removed —
 * convergence now lives in the metric trajectory (src/metrics/arbiter.ts).
 * The `engine_evaluation` row is just a verdict wrapper.
 */
import { and, desc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import {
  EngineEvaluationTable,
  EngineGoalRunTable,
  type EngineEvaluationCheck,
  type EngineEvaluationScope,
  type EngineEvaluationStatus,
  type EngineEvaluationVerdict,
} from "@/engine/engine.sql"

/** A "verification evidence" — the domain name for an `engine_evaluation` row. */
export interface VerificationEvidence {
  id: string
  taskID: string
  runID: string
  goalRunID?: string
  deliveryID?: string
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[]
  timeCompleted?: number
  timeCreated: number
  timeUpdated: number
}

function rowToEvidence(row: {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string | null
  delivery_id: string | null
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[] | null
  time_completed: number | null
  time_created: number
  time_updated: number
}): VerificationEvidence {
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    goalRunID: row.goal_run_id ?? undefined,
    deliveryID: row.delivery_id ?? undefined,
    scope: row.scope,
    status: row.status,
    verdict: row.verdict,
    summary: row.summary,
    checks: Array.isArray(row.checks) ? row.checks : [],
    timeCompleted: row.time_completed ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export interface PersistEvidenceInput {
  taskID: string
  runID: string
  /** Required when scope="goal_run"; otherwise omit. Enforced below. */
  goalRunID?: string
  /** Required when scope="delivery"; otherwise omit. Enforced below. */
  deliveryID?: string
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[]
  timeCompleted?: number
  now?: number
}

/** Insert one new evidence row. Returns the persisted `VerificationEvidence`.
 *  Does NOT update goal_run / delivery status — callers own those state
 *  transitions; this function only owns the evaluation row. */
export function persistEvidence(input: PersistEvidenceInput): VerificationEvidence {
  if (input.scope === "goal_run" && !input.goalRunID) {
    throw new Error("persistEvidence: scope='goal_run' requires goalRunID")
  }
  if (input.scope === "delivery" && !input.deliveryID) {
    throw new Error("persistEvidence: scope='delivery' requires deliveryID")
  }
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("evaluation")
  const row = {
    id,
    task_id: input.taskID,
    run_id: input.runID,
    goal_run_id: input.goalRunID ?? null,
    delivery_id: input.deliveryID ?? null,
    scope: input.scope,
    status: input.status,
    verdict: input.verdict,
    summary: input.summary,
    checks: input.checks ?? [],
    time_completed: input.timeCompleted ?? null,
    time_created: now,
    time_updated: now,
  }
  Database.use((db) => db.insert(EngineEvaluationTable).values(row).run())
  return rowToEvidence(row as any)
}

/** Latest evidence for a given goal (across all goal_runs for that goal).
 *  Returns undefined when the goal has never been evaluated. Shared by the
 *  retry-prompt builder and delivery's short-circuit check. */
export function findLatestGoalRunEvidence(goalID: string): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select({
        id: EngineEvaluationTable.id,
        task_id: EngineEvaluationTable.task_id,
        run_id: EngineEvaluationTable.run_id,
        goal_run_id: EngineEvaluationTable.goal_run_id,
        delivery_id: EngineEvaluationTable.delivery_id,
        scope: EngineEvaluationTable.scope,
        status: EngineEvaluationTable.status,
        verdict: EngineEvaluationTable.verdict,
        summary: EngineEvaluationTable.summary,
        checks: EngineEvaluationTable.checks,
        time_completed: EngineEvaluationTable.time_completed,
        time_created: EngineEvaluationTable.time_created,
        time_updated: EngineEvaluationTable.time_updated,
      })
      .from(EngineEvaluationTable)
      .innerJoin(EngineGoalRunTable, eq(EngineEvaluationTable.goal_run_id, EngineGoalRunTable.id))
      .where(
        and(
          eq(EngineGoalRunTable.goal_id, goalID),
          eq(EngineEvaluationTable.scope, "goal_run"),
        ),
      )
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row as any)
}

/** Latest evidence for a specific goal_run. Useful during delivery when the
 *  orchestrator needs to read each goal's most recent on_goal results. */
export function findGoalRunEvidence(goalRunID: string): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(
        and(
          eq(EngineEvaluationTable.goal_run_id, goalRunID),
          eq(EngineEvaluationTable.scope, "goal_run"),
        ),
      )
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row as any)
}

/** Latest delivery-scope evidence for a task. */
export function findLatestDeliveryEvidence(taskID: string): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(
        and(
          eq(EngineEvaluationTable.task_id, taskID),
          eq(EngineEvaluationTable.scope, "delivery"),
        ),
      )
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  return rowToEvidence(row as any)
}

/** Second-most-recent delivery-scope evidence for a task. */
export function findPreviousDeliveryEvidence(
  taskID: string,
  excludeEvidenceID: string,
): VerificationEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(
        and(
          eq(EngineEvaluationTable.task_id, taskID),
          eq(EngineEvaluationTable.scope, "delivery"),
        ),
      )
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(2)
      .all(),
  )
  const prior = row.find((r) => r.id !== excludeEvidenceID)
  if (!prior) return undefined
  return rowToEvidence(prior as any)
}

