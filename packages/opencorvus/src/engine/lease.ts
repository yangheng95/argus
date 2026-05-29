const OWNER = `${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`

/**
 * Process-unique owner stamp for goal-run liveness (owner-stamp orphan
 * detection). Stamped onto a goal_run when this process drives it into a
 * live status; a live goal_run whose owner ≠ this value belongs to a dead
 * (restarted) process and is physically orphaned. `OWNER` embeds pid + boot
 * timestamp + random, so it changes on every restart (PID reuse safe).
 * Load-bearing invariant: one opencorvus process per project (single owner).
 * Spec: specs/new-arch/2026-05-29-goal-run-owner-orphan-liveness.md
 */
export function processOwner() {
  return OWNER
}
