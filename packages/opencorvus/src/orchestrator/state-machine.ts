/**
 * Formal task state machine — single source of truth for valid status
 * transitions, terminal/active/interruptable classification, and
 * UI control derivation.
 */
import type { OrchestratorTaskStatus } from "./orchestrator.sql"

export type TaskStatus = OrchestratorTaskStatus

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

// Agent-driven transitions: the Task Agent decides the path, so intermediate
// states can be skipped (e.g. queued → planning, queued → running).
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued:           ["spec_generating", "goal_decomposing", "planning", "planned", "running", "cancelled", "failed"],
  spec_generating:  ["queued", "goal_decomposing", "planning", "planned", "running", "cancelled", "failed"],
  goal_decomposing: ["queued", "planning", "planned", "running", "cancelled", "failed"],
  planning:         ["queued", "planned", "running", "cancelled", "failed"],
  planned:          ["queued", "running", "cancelled", "failed"],
  running:          ["blocked", "evaluating", "delivering", "completed", "cancelled", "failed"],
  blocked:          ["running", "cancelled", "failed"],
  evaluating:       ["running", "delivering", "failed", "cancelled"],
  delivering:       ["completed", "running", "failed", "cancelled"],
  completed:        [],
  failed:           ["queued", "running"],
  cancelled:        ["queued", "running"],
}

/**
 * Returns true if transitioning from `from` to `to` is a valid task
 * status change. Identity transitions (from === to) are always valid.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Throws if the transition is invalid. Use in `updateTask()` to guard
 * against illegal status changes.
 */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} → ${to}`)
  }
}

// ---------------------------------------------------------------------------
// Status classifiers
// ---------------------------------------------------------------------------

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"])

const INTERRUPTABLE: ReadonlySet<TaskStatus> = new Set([
  "queued", "spec_generating", "goal_decomposing", "planning",
  "planned", "running", "blocked", "evaluating", "delivering",
])

const ACTIVE: ReadonlySet<TaskStatus> = new Set([
  "queued", "spec_generating", "goal_decomposing", "planning",
  "planned", "running", "evaluating", "delivering",
])

/** Terminal states — no further transitions expected. */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status)
}

/** Active (non-terminal, non-blocked) states. */
export function isActive(status: TaskStatus): boolean {
  return ACTIVE.has(status)
}

/** Interruptable states — the stop button should be available. */
export function isInterruptable(status: TaskStatus): boolean {
  return INTERRUPTABLE.has(status)
}
