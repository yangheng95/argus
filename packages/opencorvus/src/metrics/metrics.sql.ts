import { integer, real, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core"
import { EngineTaskTable, EngineGoalTable } from "@/engine/engine.sql"
import { Timestamps } from "@/storage/schema.sql"
import type {
  ArbiterVerdict,
  CounterexampleSeverity,
  CounterexampleTargetScope,
  MetricCreatedBy,
  MetricDirection,
  MetricEvaluatorKind,
  MetricGateClass,
  MetricScope,
  MetricSource,
} from "./types"

/**
 * Frozen metric definitions — produced once at task start by the Architect
 * (source='baseline'). Baseline rows are immutable (see store.ts).
 */
export const EngineMetricSpecTable = sqliteTable(
  "engine_metric_spec",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    scope: text().notNull().$type<MetricScope>(),
    goal_id: text().references(() => EngineGoalTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull(),
    unit: text().notNull(),
    direction: text().notNull().$type<MetricDirection>(),
    target: real().notNull(),
    floor: real().notNull(),
    weight: real().notNull(),
    gate_class: text().notNull().$type<MetricGateClass>(),
    evaluator_kind: text().notNull().$type<MetricEvaluatorKind>(),
    evaluator_config: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    source_requirement_ids: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    source: text().notNull().$type<MetricSource>(),
    frozen_at: integer().notNull(),
    created_by: text().notNull().$type<MetricCreatedBy>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_metric_spec_task_idx").on(table.task_id),
    index("engine_metric_spec_scope_idx").on(table.task_id, table.scope),
    index("engine_metric_spec_source_idx").on(table.task_id, table.source),
    index("engine_metric_spec_goal_idx").on(table.goal_id),
  ],
)

/**
 * Per-iteration raw measurements. evidence_fresh=0 explicitly invalidates the
 * row — aggregate_score computation must drop it rather than credit a stale
 * value.
 */
export const EngineMetricResultTable = sqliteTable(
  "engine_metric_result",
  {
    id: text().primaryKey(),
    metric_spec_id: text()
      .notNull()
      .references(() => EngineMetricSpecTable.id, { onDelete: "cascade" }),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    iteration: integer().notNull(),
    /** Phase-6-d: plain text pointer to the logical goal_run id (was FK to
     *  engine_goal_run). */
    goal_run_id: text(),
    raw_value: real().notNull(),
    normalized_value: real().notNull(),
    met_target: integer({ mode: "boolean" }).notNull(),
    met_floor: integer({ mode: "boolean" }).notNull(),
    evidence_ref: text().notNull(),
    evidence_fresh: integer({ mode: "boolean" }).notNull(),
    computed_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("engine_metric_result_task_iter_idx").on(table.task_id, table.iteration),
    index("engine_metric_result_spec_idx").on(table.metric_spec_id),
  ],
)

/**
 * Counterexample evidence (read-only after legacy acceptance hardening was
 * retired; the table is preserved for legacy acceptance reads, but no production
 * writer exists today). iteration_resolved NULL ⇔ still open. novelty_hash
 * dedups re-surfacing of the same reproducer.
 */
export const EngineCounterexampleTable = sqliteTable(
  "engine_counterexample",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    iteration_found: integer().notNull(),
    iteration_resolved: integer(),
    novelty_hash: text().notNull(),
    target_scope: text().notNull().$type<CounterexampleTargetScope>(),
    target_ref: text().notNull(),
    claim: text().notNull(),
    reproducer: text().notNull(),
    severity: text().notNull().$type<CounterexampleSeverity>(),
    linked_metric_spec_id: text().references(() => EngineMetricSpecTable.id, {
      onDelete: "set null",
    }),
    ...Timestamps,
  },
  (table) => [
    index("engine_counterexample_task_idx").on(table.task_id),
    index("engine_counterexample_open_idx").on(table.task_id, table.iteration_resolved),
    index("engine_counterexample_novelty_idx").on(table.task_id, table.novelty_hash),
  ],
)

/**
 * Aggregated per-iteration snapshot. Arbiter reads the trailing window of
 * these rows to decide continue/accept/stalled/abort.
 * PK (task_id, iteration) — never more than one row per iteration.
 */
export const EngineIterationTable = sqliteTable(
  "engine_iteration",
  {
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    iteration: integer().notNull(),
    aggregate_score: real().notNull(),
    /** JSON encoded {goal_id → score} map. */
    per_goal_score_json: text({ mode: "json" }).$type<Record<string, number>>().notNull(),
    global_score: real().notNull(),
    delta_vs_prev: real().notNull(),
    novelty_score: real().notNull(),
    blocking_unmet_count: integer().notNull(),
    open_counterexamples: integer().notNull(),
    regressed_blocking: integer().notNull(),
    arbiter_verdict: text().notNull().$type<ArbiterVerdict>(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.task_id, table.iteration] }),
  ],
)
