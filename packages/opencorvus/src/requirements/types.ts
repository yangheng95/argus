/**
 * Requirements data shapes — canonical types shared by the agent and its
 * structured tool collector.
 *
 * These were previously co-located with a YAML-like text parser in
 * `requirements/parse.ts`. The parser has been removed (Zod tool calls are now
 * the only path); the types live here so multiple modules can import the
 * shape without dragging in dead parsing code.
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

import type { AcceptanceSpec } from "@/acceptance/types"

export interface ParsedGoalContract {
  id: string
  title: string
  objective: string
  acceptance_specs: AcceptanceSpec[]
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
  priority: "blocking" | "advisory"
  kind: string
  requirement_ids: string[]
  source: "explicit" | "implicit"
}

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

export interface RequirementsOutput {
  summary: string
  requirements: ParsedRequirement[]
  decisions: RequirementsDecision[]
  goals: ParsedGoalContract[]
  traceability: TraceabilityEntry[]
  goal_metric_specs: ArchitectGoalMetricSpec[]
  global_metric_specs: ArchitectGlobalMetricSpec[]
  challenge_seeds: ArchitectChallengeSeed[]
}

/**
 * Architect-emitted metric specifications.
 *
 * These are LLM-facing — `goal_id` refers to the architect's own string ID
 * (e.g. "goal_api"), not the DB row. Mapping to DB goal IDs happens at
 * persistence time (see orchestrator/tools.ts requirements phase).
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
 * probing. Phase 4 consumes these when the Prosecutor runs its first pass.
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
