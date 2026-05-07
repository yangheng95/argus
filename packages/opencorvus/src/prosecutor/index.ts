/**
 * `prosecutor` agent — adversarial half of the Dynamic Adversarial Metrics
 * loop. Files concrete counterexamples for failure modes the deliver agent
 * missed and (capped at 1/iter, 3/task) proposes diagnostic challenge
 * metrics.
 *
 * Lives at the top level (not under `delivery/`) for the same reason
 * `integrity/` does — every agent has the same outward shape.
 *
 * session.kind for prosecutor is "evaluator" (historical naming retained
 * so the overlay does not need to re-key its existing renderers).
 *
 * Public surface:
 *   - runProsecutor(input) → ProsecutorRunResult
 *   - createProsecutorTools(input) — exposed for tests / orchestrator wiring
 */
export {
  runProsecutor,
  createProsecutorTools,
} from "./agent"
export type {
  ProsecutorRunInput,
  ProsecutorRunResult,
  ProsecutorCollector,
  CreateProsecutorToolsInput,
  ArchitectSeedInput,
} from "./agent"
