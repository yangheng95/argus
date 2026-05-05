/**
 * Goal contract type — the interface between the Architect (producer) and
 * the rest of the system.
 *
 * Invariants:
 * ① Architect Agent is the sole producer of goal rows. Requirements produces
 *    REQ-N + foundational decisions only; it never writes goals.
 * ② DB mapping is lossless: each field gets its own column, no compression.
 * ③ acceptance_specs must be deterministic shell + rubric.
 * ④ owned_paths records collaboration responsibility, not a write sandbox.
 * ⑤ Contract is frozen after Architect finalize. The Architect may edit it by
 *    being re-invoked (add / modify / split / remove goals), and the
 *    orchestrator may point-fix a field via `modify_goal`; otherwise the
 *    contract does not change while a goal is executing.
 */

import type { AcceptanceSpec } from "@/acceptance/types"

export interface GoalContractFields {
  /** Unique goal ID. */
  id: string
  /** Short goal title (standalone, not merged into description). */
  title: string
  /** What this goal accomplishes — the full objective statement. */
  objective: string
  /**
   * Typed acceptance specs (IR). Evaluator translates these to heuristic
   * commands and rubric checks — no free-form text interpretation.
   */
  acceptance_specs: AcceptanceSpec[]
  /** Files this goal is responsible for coordinating; not an edit sandbox. */
  owned_paths: string[]
  /** Goal IDs this depends on (must complete before this goal starts). */
  depends_on: string[]
  /** blocking = must pass for task success. advisory = failure doesn't block. */
  priority: "blocking" | "advisory"
  /** Goal category. */
  kind: string
  /** Requirement IDs from user input that this goal covers (for integrity tracing). */
  requirement_ids: string[]
  /**
   * Interfaces this goal EXPORTS for dependent goals.
   * Declared at requirements time so dependents can code against them before this goal completes.
   * Example: ["getStocks(): Stock[]", "type Stock = { id: string; name: string; price: number }"]
   */
  exports: string[]
  /**
   * Interfaces this goal IMPORTS from its dependencies.
   * Must be a subset of the union of all depends_on goals' exports.
   */
  imports: string[]
}
