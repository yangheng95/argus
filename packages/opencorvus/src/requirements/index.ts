/**
 * Requirements Agent — public API.
 *
 * Re-exports from the internal decompose/ module under the canonical
 * "Requirements Agent" name used in the architecture documentation.
 * The decompose/ directory retains the implementation to preserve git history.
 */
export {
  DecomposeAgent as RequirementsAgent,
  DECOMPOSE_SYSTEM as REQUIREMENTS_SYSTEM,
  type DecomposeResult as RequirementsResult,
  type RedecomposeContext,
} from "@/decompose/agent"

export {
  DecomposeService as RequirementsService,
  DecomposeFailureError as RequirementsFailureError,
} from "@/decompose/service"

export {
  parseDecomposeText as parseRequirementsText,
  type DecomposeOutput as RequirementsOutput,
  type ParsedGoalContract,
  type DecomposeDecision as RequirementsDecision,
  type ParsedRequirement,
  type TraceabilityEntry,
} from "@/decompose/parse"

export {
  reviewFidelity,
  applyFidelityCorrections,
  type FidelityResult,
  type FidelityIssue,
  type GoalCorrection,
  type MissingGoal,
} from "@/decompose/fidelity"
