import type { EngineRunStatus } from "./engine.sql"

export type RunStatus = EngineRunStatus

const VALID_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["accepted", "running", "failed", "aborted"],
  accepted: ["running", "blocked", "completed", "failed", "aborted"],
  running: ["blocked", "completed", "failed", "aborted"],
  blocked: ["accepted", "running", "completed", "failed", "aborted"],
  completed: [],
  failed: [],
  aborted: [],
}

export function canRunTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canRunTransition(from, to)) {
    throw new Error(`Invalid run transition: ${from} -> ${to}`)
  }
}
