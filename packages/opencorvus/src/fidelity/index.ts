/**
 * `fidelity` agent — orchestrator-driven goal-coverage reviewer.
 *
 * Lives at the top level (not under `architect/`) because per the agent
 * isolation rule (CLAUDE.md rule 22 / rule 24) every agent has the same
 * outward shape. Architect produces the goal set; orchestrator calls
 * fidelity next, and on `needs_correction` re-upserts the corrected set.
 *
 * Public surface:
 *   - reviewFidelity(input)       → FidelityResult (terminal verdict)
 *   - applyFidelityCorrections()  → updated goal list
 */
export { reviewFidelity, applyFidelityCorrections } from "./agent"
export type {
  FidelityIssue,
  GoalCorrection,
  MissingGoal,
  FidelityResult,
} from "./agent"
