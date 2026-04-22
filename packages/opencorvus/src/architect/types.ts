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
import type {
  ArchitectChallengeSeed,
  ArchitectGlobalMetricSpec,
  ArchitectGoalMetricSpec,
  ParsedRequirement,
  RequirementsDecision,
  TraceabilityEntry,
} from "@/requirements/types"
import type { FidelityResult } from "@/requirements/fidelity"

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

// ---------------------------------------------------------------------------
// Re-export primitive types used by consumers
// ---------------------------------------------------------------------------

export type {
  ArchitectChallengeSeed,
  ArchitectGlobalMetricSpec,
  ArchitectGoalMetricSpec,
  ParsedRequirement,
  RequirementsDecision,
  TraceabilityEntry,
} from "@/requirements/types"
