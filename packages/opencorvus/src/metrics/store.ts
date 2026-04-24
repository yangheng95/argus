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
 *   - Counterexample novelty dedup: inserting a hash that already exists on
 *     the same task flips into idempotent no-op rather than double-counting
 *     novelty_score.
 */
import { and, asc, count, eq, sql } from "drizzle-orm"
import { NamedError } from "@opencorvus-ai/util/error"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import {
  EngineCounterexampleTable,
  EngineIterationTable,
  EngineMetricResultTable,
  EngineMetricSpecTable,
} from "./metrics.sql"
import type {
  Counterexample,
  IterationSnapshot,
  MetricResult,
  MetricSpec,
} from "./types"
import z from "zod"

export const MetricWriteError = NamedError.create(
  "MetricWriteError",
  z.object({ message: z.string(), code: z.string() }),
)

const MAX_CHALLENGE_PER_ITER = 1
const MAX_CHALLENGE_PER_TASK = 3

// ---------------------------------------------------------------------------
// Architect bulk persist — take the RequirementsResult metric specs and
// insert them as baselines. Challenge seeds are stashed on task.metadata
// for the Prosecutor to read in Phase 4.
// ---------------------------------------------------------------------------

interface ArchitectMetricsInput {
  task_id: string
  /** Architect-level goal id → DB goal id (from orchestrator's llmToDBID map). */
  goal_id_map: ReadonlyMap<string, string>
  goal_metric_specs: ReadonlyArray<{
    goal_id: string
    name: string
    description: string
    unit: string
    direction: "higher_better" | "lower_better"
    target: number
    floor: number
    weight: number
    gate_class: "blocking" | "diagnostic" | "efficiency"
    evaluator_kind: "shell" | "judge" | "query" | "aggregator"
    evaluator_config: Record<string, unknown>
    source_requirement_ids: string[]
  }>
  global_metric_specs: ReadonlyArray<{
    name: string
    description: string
    unit: string
    direction: "higher_better" | "lower_better"
    target: number
    floor: number
    weight: number
    gate_class: "blocking" | "diagnostic" | "efficiency"
    evaluator_kind: "shell" | "judge" | "query" | "aggregator"
    evaluator_config: Record<string, unknown>
    source_requirement_ids: string[]
  }>
}

/**
 * Persist all Architect-emitted baseline specs for a task. Called once, right
 * after insertGoalRows(). Throws if any spec references an unknown goal id
 * (the caller should have built goal_id_map from the same llmToDBID map used
 * to remap depends_on).
 */
export function persistArchitectMetrics(input: ArchitectMetricsInput): {
  goal_specs_written: number
  global_specs_written: number
} {
  let goalWritten = 0
  let globalWritten = 0
  for (const m of input.goal_metric_specs) {
    const dbGoalID = input.goal_id_map.get(m.goal_id)
    if (!dbGoalID) {
      throw new MetricWriteError({
        message: `goal metric "${m.name}" references unknown architect goal "${m.goal_id}"`,
        code: "unknown_goal",
      })
    }
    registerBaselineSpec({
      task_id: input.task_id,
      scope: "goal",
      goal_id: dbGoalID,
      name: m.name,
      description: m.description,
      unit: m.unit,
      direction: m.direction,
      target: m.target,
      floor: m.floor,
      weight: m.weight,
      gate_class: m.gate_class,
      evaluator_kind: m.evaluator_kind,
      evaluator_config: m.evaluator_config,
      source_requirement_ids: m.source_requirement_ids,
    })
    goalWritten++
  }
  for (const m of input.global_metric_specs) {
    registerBaselineSpec({
      task_id: input.task_id,
      scope: "global",
      goal_id: null,
      name: m.name,
      description: m.description,
      unit: m.unit,
      direction: m.direction,
      target: m.target,
      floor: m.floor,
      weight: m.weight,
      gate_class: m.gate_class,
      evaluator_kind: m.evaluator_kind,
      evaluator_config: m.evaluator_config,
      source_requirement_ids: m.source_requirement_ids,
    })
    globalWritten++
  }
  return { goal_specs_written: goalWritten, global_specs_written: globalWritten }
}

// ---------------------------------------------------------------------------
// Baseline specs (Architect only)
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
  evaluator_kind: "shell" | "judge" | "query" | "aggregator"
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
function registerBaselineSpec(input: BaselineSpecInput): MetricSpec {
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
// Challenge specs (Prosecutor only)
// ---------------------------------------------------------------------------

interface ChallengeSpecInput {
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
  evaluator_kind: "shell" | "judge" | "query" | "aggregator"
  evaluator_config: Record<string, unknown>
  source_requirement_ids: string[]
  /** Iteration in which this challenge was proposed. */
  iteration: number
}

/**
 * Insert a Prosecutor challenge metric. gate_class is fixed to 'diagnostic';
 * challenges cannot veto accept. Budget: ≤1/iteration, ≤3/task.
 */
export function addChallengeMetric(input: ChallengeSpecInput): MetricSpec {
  validateScopeInvariant(input.scope, input.goal_id)
  return Database.transaction((tx) => {
    const totalRow = tx
      .select({ c: count() })
      .from(EngineMetricSpecTable)
      .where(
        and(
          eq(EngineMetricSpecTable.task_id, input.task_id),
          eq(EngineMetricSpecTable.source, "challenge"),
        ),
      )
      .get()
    const total = totalRow?.c ?? 0
    if (total >= MAX_CHALLENGE_PER_TASK) {
      throw new MetricWriteError({
        message: `challenge budget exhausted: task ${input.task_id} already has ${total}/${MAX_CHALLENGE_PER_TASK} challenge metrics`,
        code: "challenge_budget_task",
      })
    }
    const iterRow = tx
      .select({ c: count() })
      .from(EngineMetricSpecTable)
      .where(
        and(
          eq(EngineMetricSpecTable.task_id, input.task_id),
          eq(EngineMetricSpecTable.source, "challenge"),
          sql`json_extract(${EngineMetricSpecTable.evaluator_config}, '$._iteration') = ${input.iteration}`,
        ),
      )
      .get()
    const perIter = iterRow?.c ?? 0
    if (perIter >= MAX_CHALLENGE_PER_ITER) {
      throw new MetricWriteError({
        message: `challenge budget exhausted: iteration ${input.iteration} already has ${perIter}/${MAX_CHALLENGE_PER_ITER} challenges`,
        code: "challenge_budget_iteration",
      })
    }
    const now = Date.now()
    const id = Identifier.ascending("metric_spec")
    // Stamp iteration into evaluator_config so future writes can budget-check
    // without a separate column.
    const evaluator_config = { ...input.evaluator_config, _iteration: input.iteration }
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
      gate_class: "diagnostic" as const,
      evaluator_kind: input.evaluator_kind,
      evaluator_config,
      source_requirement_ids: input.source_requirement_ids,
      source: "challenge" as const,
      frozen_at: now,
      created_by: "prosecutor" as const,
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
// Counterexamples
// ---------------------------------------------------------------------------

interface CounterexampleInput {
  task_id: string
  iteration_found: number
  novelty_hash: string
  target_scope: "goal" | "global"
  target_ref: string
  claim: string
  reproducer: string
  severity: "blocking" | "diagnostic"
  linked_metric_spec_id: string | null
}

/**
 * Insert or return existing counterexample by (task_id, novelty_hash). If the
 * hash is already present, returns the existing row without incrementing any
 * novelty counter — that's the dedup rule that feeds `stalled`.
 */
export function upsertCounterexample(input: CounterexampleInput): Counterexample {
  return Database.transaction((tx) => {
    const existing = tx
      .select()
      .from(EngineCounterexampleTable)
      .where(
        and(
          eq(EngineCounterexampleTable.task_id, input.task_id),
          eq(EngineCounterexampleTable.novelty_hash, input.novelty_hash),
        ),
      )
      .get()
    if (existing) return existing as Counterexample
    const row = {
      id: Identifier.ascending("counterexample"),
      task_id: input.task_id,
      iteration_found: input.iteration_found,
      iteration_resolved: null,
      novelty_hash: input.novelty_hash,
      target_scope: input.target_scope,
      target_ref: input.target_ref,
      claim: input.claim,
      reproducer: input.reproducer,
      severity: input.severity,
      linked_metric_spec_id: input.linked_metric_spec_id,
    }
    tx.insert(EngineCounterexampleTable).values(row).run()
    return row
  })
}

export function resolveCounterexample(id: string, iteration: number): void {
  Database.use((db) =>
    db
      .update(EngineCounterexampleTable)
      .set({ iteration_resolved: iteration })
      .where(eq(EngineCounterexampleTable.id, id))
      .run(),
  )
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
    db
      .select()
      .from(EngineMetricSpecTable)
      .where(eq(EngineMetricSpecTable.task_id, taskID))
      .all(),
  )
  return rows as MetricSpec[]
}

export function readResultsForIteration(
  taskID: string,
  iteration: number,
): MetricResult[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineMetricResultTable)
      .where(
        and(
          eq(EngineMetricResultTable.task_id, taskID),
          eq(EngineMetricResultTable.iteration, iteration),
        ),
      )
      .all(),
  )
  return rows as MetricResult[]
}

export function readCounterexamplesForTask(taskID: string): Counterexample[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineCounterexampleTable)
      .where(eq(EngineCounterexampleTable.task_id, taskID))
      .all(),
  )
  return rows as Counterexample[]
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

export function readPreviousAggregateScore(
  taskID: string,
  iteration: number,
): number {
  if (iteration === 0) return 0
  const row = Database.use((db) =>
    db
      .select({ aggregate_score: EngineIterationTable.aggregate_score })
      .from(EngineIterationTable)
      .where(
        and(
          eq(EngineIterationTable.task_id, taskID),
          eq(EngineIterationTable.iteration, iteration - 1),
        ),
      )
      .get(),
  )
  return row?.aggregate_score ?? 0
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateScopeInvariant(
  scope: "goal" | "global",
  goalID: string | null,
): void {
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

