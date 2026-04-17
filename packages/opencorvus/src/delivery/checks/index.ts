/**
 * Public API barrel for the `delivery/checks` module.
 *
 * External callers import from "@/delivery/checks" — never from sub-modules.
 * Internal sibling files use relative imports (./types, ./per-goal, ...).
 */

export * from "./types"
export { evaluateGoal, resolveEvalDir, type EvaluatorTier } from "./per-goal"
export {
  resolveConfig,
  resolvedChecks,
  discoverChecks,
  commandGroups,
  autoSpecCheck,
  autoJudge,
  autoCodeReview,
  autoArtifact,
} from "./discovery"
export {
  runRubric,
  type RubricEvaluationInput,
  type RubricEvaluationResult,
} from "./llm-judge-runner"
export {
  findRenderedIndex,
  findBrowserExecutable,
  runVisualDiff,
  summarizeVisualReport,
  type VisualDiffOptions,
  type VisualDiffReport,
} from "./visual"
