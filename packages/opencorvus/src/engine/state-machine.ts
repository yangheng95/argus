/**
 * Formal task state machine — single source of truth for valid status
 * transitions, terminal/active/interruptable classification, and
 * UI control derivation.
 */
import type { EngineTaskStatus } from "./engine.sql"

export type TaskStatus = EngineTaskStatus

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

// Agent-driven: "active" is the primary working state. Agent decides what to do.
// No granular states — the agent's reasoning determines the flow.
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued:    ["active", "cancelled", "failed"],
  active:    ["completed", "failed", "cancelled", "queued"],
  completed: [],
  failed:    ["queued", "active"],
  cancelled: ["queued", "active"],
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
  "queued", "active",
])

const ACTIVE: ReadonlySet<TaskStatus> = new Set([
  "queued", "active",
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
