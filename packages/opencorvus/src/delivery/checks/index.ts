/**
 * Public API barrel for the `delivery/checks` module.
 *
 * External callers import from "@/delivery/checks" — never from sub-modules.
 * Internal sibling files use relative imports (./types, ./discovery, ...).
 *
 * Per-goal evaluator (`evaluateGoal` + `runRubric`) was removed on 2026-04-20:
 * acceptance_specs are now passed to integrity acceptance review as INFORMATION and
 * verified via LLM judgment + run_command, not deterministic scorer runs.
 * `discovery.ts` retains the project-shape helpers (build/test/lint command
 * sniffing) because the acceptance prompt still cites them for sanity
 * checks; `visual.ts` keeps the rendered-vs-reference diff because that is
 * a delivery-time concern driven by the LLM comparing attachments.
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
} from "./visual"
export { findBrowserExecutable } from "@/browser/runtime"
export {
  buildDeliveryEvidenceManifest,
} from "./project-gate"
