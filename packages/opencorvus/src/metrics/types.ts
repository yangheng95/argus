/**
 * Architect-authored metrics — typed surface.
 *
 * The modeling layer (Architect / RequirementsAgent) produces MetricSpec rows
 * exactly once at task start; the ruler is frozen after that.
 */
import z from "zod"

export const MetricScope = z.enum(["goal", "global"])
export type MetricScope = z.infer<typeof MetricScope>

export const MetricDirection = z.enum(["higher_better", "lower_better"])
export type MetricDirection = z.infer<typeof MetricDirection>

/**
 * Gate class controls whether a metric can veto `accept`:
 *  - blocking    → counts in S_k, must meet floor+target for accept
 *  - diagnostic  → counts in S_k (down-weighted by Architect), never blocks
 *  - efficiency  → excluded from S_k; trend signal only (stalled / abort)
 */
export const MetricGateClass = z.enum(["blocking", "diagnostic", "efficiency"])
export type MetricGateClass = z.infer<typeof MetricGateClass>

export const MetricEvaluatorKind = z.enum([
  "shell", // invoke a shell command, map exit/stdout to raw_value
  "judge", // LLM-judge with rubric → ordinal level → normalized value
  "query", // SQL query over engine_* tables
  "aggregator", // composes other metric_result rows by op (mean/min/max/sum)
])
export type MetricEvaluatorKind = z.infer<typeof MetricEvaluatorKind>

export const MetricSource = z.enum(["baseline", "challenge"])
export type MetricSource = z.infer<typeof MetricSource>

export const MetricCreatedBy = z.enum(["architect"])
export type MetricCreatedBy = z.infer<typeof MetricCreatedBy>

/**
 * Immutable metric definition. `frozen_at` is set on insert; the store layer
 * rejects every UPDATE/DELETE on baseline rows to preserve comparability of
 * S_k across iterations.
 */
export const MetricSpec = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  scope: MetricScope,
  /** NULL iff scope='global'; NOT NULL iff scope='goal'. Enforced at write. */
  goal_id: z.string().nullable(),
  name: z.string().min(1),
  description: z.string().min(1),
  unit: z.string().min(1), // 'ratio'|'count'|'latency_ms'|...
  direction: MetricDirection,
  target: z.number(),
  floor: z.number(),
  weight: z.number().min(0),
  gate_class: MetricGateClass,
  evaluator_kind: MetricEvaluatorKind,
  /** JSON config interpreted by the Metric Executor dispatcher. */
  evaluator_config: z.record(z.string(), z.unknown()),
  source_requirement_ids: z.array(z.string()),
  source: MetricSource,
  frozen_at: z.number().int(),
  created_by: MetricCreatedBy,
})
export type MetricSpec = z.infer<typeof MetricSpec>

/** Raw measurement row. One per (spec, iteration). */
export const MetricResult = z.object({
  id: z.string().min(1),
  metric_spec_id: z.string().min(1),
  task_id: z.string().min(1),
  iteration: z.number().int().min(0),
  goal_run_id: z.string().nullable(),
  raw_value: z.number(),
  /** Direction-adjusted, clipped to [0,1]. */
  normalized_value: z.number().min(0).max(1),
  met_target: z.boolean(),
  met_floor: z.boolean(),
  /** URI into artifact store. Always set; "" allowed only for aggregator. */
  evidence_ref: z.string(),
  /**
   * Evidence freshness is a hard constraint, not a scoring factor: when 0 the
   * result is considered invalid and does not contribute to aggregate_score.
   * Executor must flip this to 1 each iteration by re-running; cached reuse
   * is explicitly forbidden.
   */
  evidence_fresh: z.boolean(),
  computed_at: z.number().int(),
})
export type MetricResult = z.infer<typeof MetricResult>

export const CounterexampleSeverity = z.enum(["blocking", "diagnostic"])
export type CounterexampleSeverity = z.infer<typeof CounterexampleSeverity>

export const CounterexampleTargetScope = z.enum(["goal", "global"])
export type CounterexampleTargetScope = z.infer<typeof CounterexampleTargetScope>

export const Counterexample = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  iteration_found: z.number().int().min(0),
  /** NULL while still open. */
  iteration_resolved: z.number().int().min(0).nullable(),
  /**
   * Deterministic fingerprint of the reproducer + target. Used to dedup so
   * repeated surfacing of the same reproducer contributes 0 to novelty_score
   * that iteration, which is what feeds `stalled`.
   */
  novelty_hash: z.string().min(1),
  target_scope: CounterexampleTargetScope,
  /** goal_id when scope='goal'; free-form risk id when scope='global'. */
  target_ref: z.string().min(1),
  claim: z.string().min(1),
  reproducer: z.string().min(1),
  severity: CounterexampleSeverity,
  linked_metric_spec_id: z.string().nullable(),
})
export type Counterexample = z.infer<typeof Counterexample>

export const ArbiterVerdict = z.enum([
  "continue", // next driver reads trajectory + counterexamples and decides what to do
  "accept", // terminal success
  "stalled", // no progress for N iterations, terminal but not failure
  "abort", // hard failure (regression cascade / iteration ceiling)
])
export type ArbiterVerdict = z.infer<typeof ArbiterVerdict>

/** Materialized per-iteration snapshot consumed by the Arbiter. */
export const IterationSnapshot = z.object({
  task_id: z.string().min(1),
  iteration: z.number().int().min(0),
  aggregate_score: z.number(),
  /** {goal_id → score}. JSON text in DB; typed object in memory. */
  per_goal_score: z.record(z.string(), z.number()),
  global_score: z.number(),
  delta_vs_prev: z.number(),
  novelty_score: z.number().min(0),
  blocking_unmet_count: z.number().int().min(0),
  open_counterexamples: z.number().int().min(0),
  regressed_blocking: z.number().int().min(0),
  arbiter_verdict: ArbiterVerdict,
})
export type IterationSnapshot = z.infer<typeof IterationSnapshot>
