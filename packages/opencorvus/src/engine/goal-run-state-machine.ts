import type { EngineGoalRunStatus } from "./engine.sql"

export type GoalRunStatus = EngineGoalRunStatus

const VALID_TRANSITIONS: Record<GoalRunStatus, readonly GoalRunStatus[]> = {
  queued: ["accepted", "planning", "running", "failed", "aborted"],
  accepted: ["planning", "running", "evaluating", "blocked", "completed", "failed", "aborted"],
  planning: ["running", "evaluating", "blocked", "completed", "failed", "aborted"],
  running: ["evaluating", "blocked", "completed", "failed", "aborted"],
  evaluating: ["blocked", "completed", "failed", "aborted"],
  blocked: ["accepted", "planning", "running", "evaluating", "completed", "failed", "aborted"],
  completed: ["aborted"],
  failed: [],
  aborted: [],
}

export function canGoalRunTransition(from: GoalRunStatus, to: GoalRunStatus): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertGoalRunTransition(from: GoalRunStatus, to: GoalRunStatus): void {
  if (!canGoalRunTransition(from, to)) {
    throw new Error(`Invalid goal_run transition: ${from} -> ${to}`)
  }
}
