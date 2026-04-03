/**
 * Architect Agent types — cross-goal coordination contracts.
 *
 * The Architect Agent sits between Decompose and Plan:
 * - Reads ALL GoalContracts (full set, not per-goal)
 * - Resolves abstract exports/imports into precise contracts
 * - Writes binding consensus to Decision Log
 * - Outputs ArchitectBlueprint for Planner context injection
 */

// ---------------------------------------------------------------------------
// RecommendedNext — every sub-agent outputs call recommendations
// ---------------------------------------------------------------------------

/** A recommendation from a sub-agent for what the Task Agent should do next. */
export interface RecommendedNext {
  /** Target agent/tool name. */
  agent: string
  /** Arguments to pass (e.g., { goalID: "..." }). */
  args?: Record<string, unknown>
  /** Why this is recommended. */
  reason: string
  /** 0-1 confidence score. */
  confidence: number
  /** How strongly the agent recommends this action. */
  priority: "required" | "suggested" | "optional"
}

// ---------------------------------------------------------------------------
// Architect Decision Log key categories
// ---------------------------------------------------------------------------

/** The 6 key categories that Architect Agent writes to Decision Log. */
export type ArchitectDecisionKey =
  | "directory_blueprint"
  | "interface_contract"
  | "export_manifest"
  | "shared_type"
  | "naming_convention"
  | "dependency_order"

// ---------------------------------------------------------------------------
// ArchitectBlueprint — structured summary injected into Planner context
// ---------------------------------------------------------------------------

/** A single contract entry resolved by the Architect Agent. */
export interface ArchitectContract {
  /** Which Decision Log key category this belongs to. */
  category: ArchitectDecisionKey
  /** Human-readable title. */
  title: string
  /** The precise specification (e.g., actual TypeScript interface code). */
  spec: string
  /** Which goal IDs this contract relates to. */
  goalIDs: string[]
}

/**
 * Structured output of the Architect Agent.
 * Injected into Planner context so each goal knows the precise cross-goal contracts.
 */
export interface ArchitectBlueprint {
  /** All resolved contracts. */
  contracts: ArchitectContract[]
  /** One-line summary of what was decided. */
  summary: string
}

// ---------------------------------------------------------------------------
// ArchitectResult — full return value from Architect Agent
// ---------------------------------------------------------------------------

export interface ArchitectResult {
  blueprint: ArchitectBlueprint
  /** Number of Decision Log entries written. */
  entriesWritten: number
  /** Recommended next actions for Task Agent. */
  recommendedNext: RecommendedNext[]
}
