/**
 * Architect Agent types — authoritative goal decomposer.
 *
 * The Architect sits between Requirements and Dispatch. It reads the
 * requirement list + foundational decisions, explores the codebase, and
 * produces the final goal set along with metric specs, challenge seeds,
 * traceability, and cross-goal interface contracts. On a re-run (triggered
 * by delivery/evaluation feedback) it also refines the existing goal set.
 */
import type { GoalContractFields } from "@/pipeline/types"
import type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
import type { FidelityResult } from "./fidelity"

// ---------------------------------------------------------------------------
// Architect Decision Log key categories
// ---------------------------------------------------------------------------

/** The 6 key categories that Architect writes to the Decision Log. */
export type ArchitectDecisionKey =
  | "directory_blueprint"
  | "interface_contract"
  | "export_manifest"
  | "shared_type"
  | "naming_convention"
  | "dependency_order"

// ---------------------------------------------------------------------------
// ArchitectContract — one cross-goal consensus entry
// ---------------------------------------------------------------------------

export interface ArchitectContract {
  category: ArchitectDecisionKey
  title: string
  spec: string
  goalIDs: string[]
}

// ---------------------------------------------------------------------------
// Metric specs emitted by the Architect (per-goal + global).
//
// LLM-facing: `goal_id` refers to the Architect's own string id (e.g.
// "goal_api"), not the DB row. The orchestrator maps LLM id → DB id at
// persistence time. Field semantics match engine_metric_spec exactly
// except `source` / `created_by` / `frozen_at` / `id` which are assigned
// by the store layer. See docs/spec-dynamic-adversarial-metrics.md for
// gate-class rules.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Traceability — REQ-N → goal mapping emitted by the Architect.
// ---------------------------------------------------------------------------

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

// ---------------------------------------------------------------------------
// Re-run inputs — delivery/evaluation feedback that triggers refinement
// ---------------------------------------------------------------------------

/**
 * Context supplied by the Orchestrator when asking the Architect to refine
 * an existing goal set after delivery rejection. The Architect may add,
 * modify, split, or remove goals in response.
 */
export interface ArchitectRetryContext {
  previousGoals: Array<{
    id: string
    title: string
    status: string
    evidence: string
  }>
  failureAnalysis: {
    classification: string
    summary: string
    rootCause: string
    suggestedStrategy: string
    avoidApproaches: string[]
  }
}

// ---------------------------------------------------------------------------
// ArchitectResult — full return value
// ---------------------------------------------------------------------------

export interface ArchitectResult {
  /** Final goal set (post-fidelity-correction). */
  goals: GoalContractFields[]
  /** Goal IDs the Architect chose to drop during a re-run. */
  removedGoalIDs: string[]
  goalMetricSpecs: ArchitectGoalMetricSpec[]
  globalMetricSpecs: ArchitectGlobalMetricSpec[]
  challengeSeeds: ArchitectChallengeSeed[]
  traceability: TraceabilityEntry[]
  /** Cross-goal interface contracts written to the Decision Log. */
  contracts: ArchitectContract[]
  /** Fidelity verdict produced at the end of the Architect session. */
  fidelity: FidelityResult
  /** One-line summary of what was decomposed and coordinated. */
  summary: string
}

/**
 * Architect-agent output before the fidelity gate. Emitted to the
 * `onDecomposed` callback of `ArchitectAgent.coordinate` so callers can
 * persist goals as facts immediately, without blocking on fidelity.
 *
 * Per rule 23 (no FSM): goals are facts produced by the architect agent;
 * fidelity is a separate quality artifact. Coupling them so goals only
 * land in the DB after fidelity returns turns fidelity into a hardcoded
 * gate that wedges the whole task when the LLM provider hangs (observed
 * with alibaba-coding-plan-cn 5+ min thinking idles). The orchestrator
 * loop should be free to re-wake on a stream-error artifact and read
 * the persisted goals; if the fidelity verdict eventually arrives, a
 * second persist call applies any in-place corrections.
 */
export interface ArchitectDecomposition {
  goals: GoalContractFields[]
  removedGoalIDs: string[]
  goalMetricSpecs: ArchitectGoalMetricSpec[]
  globalMetricSpecs: ArchitectGlobalMetricSpec[]
  challengeSeeds: ArchitectChallengeSeed[]
  traceability: TraceabilityEntry[]
  contracts: ArchitectContract[]
  summary: string
}

// ---------------------------------------------------------------------------
// Re-export primitives the Architect receives from Requirements as input.
// ---------------------------------------------------------------------------

export type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
