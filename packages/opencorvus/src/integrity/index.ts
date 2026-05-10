export {
  reviewIntegrity,
  applyIntegrityCorrections,
  type IntegrityResult,
  type IntegrityDimensionResult,
  type IntegrityVerdict,
  type IntegrityIssue,
  type GoalCorrection,
  type MissingGoal,
} from "./agent"
export {
  INTEGRITY_DIMENSIONS,
  renderDimensionCatalogue,
  type IntegrityDimension,
  type IntegrityIssueType,
} from "./dimensions"
export {
  computeRequirementStatusSnapshot,
  extractVisibleReqID,
  type RequirementStatusRow,
  type RequirementClaimingGoal,
  type RequirementSpecOutcome,
  type RequirementSnapshotRunStatus,
  type RequirementStatusDeps,
} from "./requirement-status"
export { renderIntegrityMarkdown } from "./render-markdown"
