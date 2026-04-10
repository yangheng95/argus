export { DecomposeAgent, type DecomposeResult, type RedecomposeContext } from "./agent"
export { DecomposeService, DecomposeFailureError } from "./service"
export type { DecomposeOutput, ParsedGoalContract, DecomposeDecision, ParsedRequirement, TraceabilityEntry } from "./types"
export { reviewFidelity, applyFidelityCorrections, type FidelityResult, type FidelityIssue, type GoalCorrection, type MissingGoal } from "./fidelity"
