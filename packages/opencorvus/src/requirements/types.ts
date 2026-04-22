/**
 * Requirements data shapes — narrow scope: REQ-N list + foundational decisions.
 *
 * The Requirements Agent no longer produces goals, metric specs, challenge
 * seeds, traceability, or cross-goal contracts. The Architect owns every
 * part of decomposition. `Architect*` types below live here only because
 * the Architect output-tools import them; Phase 3 of the decompose
 * migration relocates them under `@/architect/types`.
 */

export interface ParsedRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
}

export interface RequirementsDecision {
  key: string
  value: string
  reason: string
}

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

export interface RequirementsOutput {
  summary: string
  requirements: ParsedRequirement[]
  decisions: RequirementsDecision[]
}

/**
 * Architect-emitted metric specifications.
 *
 * These are LLM-facing — `goal_id` refers to the architect's own string ID
 * (e.g. "goal_api"), not the DB row. Mapping to DB goal IDs happens at
 * persistence time.
 *
 * Field semantics match engine_metric_spec exactly except that `source` /
 * `created_by` / `frozen_at` / `id` are assigned by the store layer.
 *
 * See docs/spec-dynamic-adversarial-metrics.md for gate-class rules.
 */
export interface ArchitectGoalMetricSpec {
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
}

export interface ArchitectGlobalMetricSpec {
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
 * Prosecutor priors — candidate challenges the Architect thinks are worth
 * probing. Phase 4 (delivery) consumes these when the Prosecutor runs its
 * first pass.
 */
export interface ArchitectChallengeSeed {
  id: string
  scope: "goal" | "global"
  /** goal_id when scope='goal'; free-form risk identifier when scope='global'. */
  target_ref: string
  claim: string
  rationale: string
  priority_hint: "high" | "medium" | "low"
}
