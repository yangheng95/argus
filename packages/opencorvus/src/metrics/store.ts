/**
 * Persistence layer for Dynamic Adversarial Metrics.
 *
 * Enforces:
 *   - Frozen-ruler: baseline specs may only be inserted while no iteration
 *     row exists for the task; they are never UPDATED or DELETED (the SQL
 *     trigger in ddl.ts raises on UPDATE; this layer simply never emits one).
 *   - Challenge budget: ≤1 challenge metric per iteration, ≤3 per task total.
 *   - Challenge gate class: always 'diagnostic'. Challenge cannot block accept.
 *   - Scope/goal_id invariant: scope='goal' ⇔ goal_id NOT NULL;
 *     scope='global' ⇔ goal_id NULL.
 */
import { and, asc, count, eq, sql } from "drizzle-orm"
import { NamedError } from "@opencorvus-ai/util/error"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { EngineIterationTable, EngineMetricResultTable, EngineMetricSpecTable } from "./metrics.sql"
import type { IterationSnapshot, MetricResult, MetricSpec } from "./types"
import z from "zod"

export const MetricWriteError = NamedError.create(
  "MetricWriteError",
  z.object({ message: z.string(), code: z.string() }),
)

// ---------------------------------------------------------------------------
// Baseline specs
// ---------------------------------------------------------------------------

interface BaselineSpecInput {
  task_id: string
  scope: "goal" | "global"
  goal_id: string | null
  name: string
  description: string
  unit: string
  direction: "higher_better" | "lower_better"
  target: number
  floor: number
  weight: number
  gate_class: "blocking" | "diagnostic" | "efficiency"
  evaluator_kind: "shell" | "judge" | "prebuilt" | "query" | "aggregator"
  evaluator_config: Record<string, unknown>
  source_requirement_ids: string[]
}

/**
 * Insert a baseline (architect-authored) metric spec. Throws if:
 *   - scope / goal_id invariant violated
 *   - the task already has any iteration row (modeling window closed)
 *   - the task does not exist
 *
 * Baseline rows are immutable after insert; the SQL trigger enforces this.
 */
// audit-2026-04-29 W2-V39 — re-promoted to `export`. Commit f5d98cbee
// "refactor(metrics): demote unused store.ts exports" missed that
// test/metrics/store.test.ts (and executor.test.ts) import this
// function directly to lock the baseline-spec persistence contract.
// The tests treat this as a public API; the demotion was wrong about
// "unused" — broke tests at module-load → cascade-polluted other suites.
export function registerBaselineSpec(input: BaselineSpecInput): MetricSpec {
  validateScopeInvariant(input.scope, input.goal_id)
  return Database.transaction((tx) => {
    const iterExists = tx
      .select({ c: count() })
      .from(EngineIterationTable)
      .where(eq(EngineIterationTable.task_id, input.task_id))
      .get()
    if (iterExists && iterExists.c > 0) {
      throw new MetricWriteError({
        message: `cannot register baseline spec for task ${input.task_id}: modeling window closed (${iterExists.c} iterations exist)`,
        code: "modeling_window_closed",
      })
    }
    const now = Date.now()
    const id = Identifier.ascending("metric_spec")
    const row = {
      id,
      task_id: input.task_id,
      scope: input.scope,
      goal_id: input.goal_id,
      name: input.name,
      description: input.description,
      unit: input.unit,
      direction: input.direction,
      target: input.target,
      floor: input.floor,
      weight: input.weight,
      gate_class: input.gate_class,
      evaluator_kind: input.evaluator_kind,
      evaluator_config: input.evaluator_config,
      source_requirement_ids: input.source_requirement_ids,
      source: "baseline" as const,
      frozen_at: now,
      created_by: "architect" as const,
    }
    tx.insert(EngineMetricSpecTable).values(row).run()
    return row
  })
}

// ---------------------------------------------------------------------------
// Metric results
// ---------------------------------------------------------------------------

interface MetricResultInput {
  metric_spec_id: string
  task_id: string
  iteration: number
  goal_run_id: string | null
  raw_value: number
  normalized_value: number
  met_target: boolean
  met_floor: boolean
  evidence_ref: string
  evidence_fresh: boolean
}

export function writeMetricResult(input: MetricResultInput): MetricResult {
  const id = Identifier.ascending("metric_result")
  const now = Date.now()
  const row: MetricResult = {
    id,
    metric_spec_id: input.metric_spec_id,
    task_id: input.task_id,
    iteration: input.iteration,
    goal_run_id: input.goal_run_id,
    raw_value: input.raw_value,
    normalized_value: clip01(input.normalized_value),
    met_target: input.met_target,
    met_floor: input.met_floor,
    evidence_ref: input.evidence_ref,
    evidence_fresh: input.evidence_fresh,
    computed_at: now,
  }
  Database.use((db) => db.insert(EngineMetricResultTable).values(row).run())
  return row
}

// ---------------------------------------------------------------------------
// Iteration rows
// ---------------------------------------------------------------------------

export function writeIterationSnapshot(snapshot: IterationSnapshot): void {
  Database.use((db) =>
    db
      .insert(EngineIterationTable)
      .values({
        task_id: snapshot.task_id,
        iteration: snapshot.iteration,
        aggregate_score: snapshot.aggregate_score,
        per_goal_score_json: snapshot.per_goal_score,
        global_score: snapshot.global_score,
        delta_vs_prev: snapshot.delta_vs_prev,
        novelty_score: snapshot.novelty_score,
        blocking_unmet_count: snapshot.blocking_unmet_count,
        open_counterexamples: snapshot.open_counterexamples,
        regressed_blocking: snapshot.regressed_blocking,
        arbiter_verdict: snapshot.arbiter_verdict,
      })
      .run(),
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function readSpecsForTask(taskID: string): MetricSpec[] {
  const rows = Database.use((db) =>
    db.select().from(EngineMetricSpecTable).where(eq(EngineMetricSpecTable.task_id, taskID)).all(),
  )
  return rows as MetricSpec[]
}

export function readResultsForIteration(taskID: string, iteration: number): MetricResult[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineMetricResultTable)
      .where(and(eq(EngineMetricResultTable.task_id, taskID), eq(EngineMetricResultTable.iteration, iteration)))
      .all(),
  )
  return rows as MetricResult[]
}

export function readIterationHistory(taskID: string): IterationSnapshot[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineIterationTable)
      .where(eq(EngineIterationTable.task_id, taskID))
      .orderBy(asc(EngineIterationTable.iteration))
      .all(),
  )
  return rows.map((r) => ({
    task_id: r.task_id,
    iteration: r.iteration,
    aggregate_score: r.aggregate_score,
    per_goal_score: (r.per_goal_score_json ?? {}) as Record<string, number>,
    global_score: r.global_score,
    delta_vs_prev: r.delta_vs_prev,
    novelty_score: r.novelty_score,
    blocking_unmet_count: r.blocking_unmet_count,
    open_counterexamples: r.open_counterexamples,
    regressed_blocking: r.regressed_blocking,
    arbiter_verdict: r.arbiter_verdict,
  }))
}

export function readPreviousAggregateScore(taskID: string, iteration: number): number {
  if (iteration === 0) return 0
  const row = Database.use((db) =>
    db
      .select({ aggregate_score: EngineIterationTable.aggregate_score })
      .from(EngineIterationTable)
      .where(and(eq(EngineIterationTable.task_id, taskID), eq(EngineIterationTable.iteration, iteration - 1)))
      .get(),
  )
  return row?.aggregate_score ?? 0
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateScopeInvariant(scope: "goal" | "global", goalID: string | null): void {
  if (scope === "goal" && goalID === null) {
    throw new MetricWriteError({
      message: "scope='goal' requires goal_id",
      code: "scope_invariant",
    })
  }
  if (scope === "global" && goalID !== null) {
    throw new MetricWriteError({
      message: "scope='global' forbids goal_id",
      code: "scope_invariant",
    })
  }
}

function clip01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}
