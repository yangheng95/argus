/**
 * Architect Agent types — authoritative goal decomposer.
 *
 * The Architect sits between Requirements and Dispatch. It reads the
 * requirement list + foundational decisions, explores the codebase, and
 * produces the final goal set along with traceability, fidelity coverage,
 * assembly ownership, and cross-goal interface contracts. On a re-run (triggered
 * by delivery/evaluation feedback) it also refines the existing goal set.
 */
import type { GoalContractFields } from "@/pipeline/types"
import type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
import type {
  AssemblyOwnerEntry,
  ReferenceCoverageEntry,
  SourceCoverageEntry,
} from "./fidelity"

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
// Traceability — REQ-N → goal mapping emitted by the Architect.
// ---------------------------------------------------------------------------

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

export interface ArchitectFidelityCoverage {
  sourceCoverage: SourceCoverageEntry[]
  referenceCoverage: ReferenceCoverageEntry[]
  assemblyOwners: AssemblyOwnerEntry[]
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
  /** Final goal set produced by the architect agent. Architecture review is
   *  advisory feedback recorded after Build; non-pass review routes rework to
   *  affected goal IDs, but does not re-upsert or mutate this goal set by itself. */
  goals: GoalContractFields[]
  /** Goal IDs the Architect chose to drop during a re-run. */
  removedGoalIDs: string[]
  traceability: TraceabilityEntry[]
  fidelity: ArchitectFidelityCoverage
  /** Cross-goal interface contracts written to the Decision Log. */
  contracts: ArchitectContract[]
  /** One-line summary of what was decomposed and coordinated. */
  summary: string
}

// ---------------------------------------------------------------------------
// Re-export primitives the Architect receives from Requirements as input.
// ---------------------------------------------------------------------------

export type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
