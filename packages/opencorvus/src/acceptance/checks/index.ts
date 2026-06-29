/**
 * Public API barrel for the `acceptance/checks` module.
 *
 * External callers import from "@/acceptance/checks" — never from sub-modules.
 * Internal sibling files use relative imports (./types, ./discovery, ...).
 *
 * Per-goal evaluator (`evaluateGoal` + `runRubric`) was removed on 2026-04-20:
 * acceptance_specs are now passed to integrity acceptance review as INFORMATION and
 * verified via LLM judgment + run_command, not deterministic scorer runs.
 * `discovery.ts` retains the project-shape helpers (build/test/lint command
 * sniffing); rendered-vs-reference diff primitives now live under runtime.
 */

export * from "./types"
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
  runVisualDiff,
  summarizeVisualReport,
  type VisualDiffOptions,
  type VisualDiffReport,
} from "@/runtime/visual-page"
export { findBrowserExecutable } from "@/browser/runtime"
export { buildAcceptanceEvidenceManifest } from "./project-assessment"
