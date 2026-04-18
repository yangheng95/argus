/**
 * Per-run in-process state that is NOT persisted to DB.
 *
 * These maps exist because two cross-cutting concerns need process-local
 * coordination even though every authoritative run/goal_run state change
 * goes through SQLite:
 *
 *   - `mergeLocks`     — serialize concurrent delivery merges for a single
 *                        run (parallel goals deliver out-of-order; git
 *                        cannot merge concurrently into the same baseRef).
 *   - `agentNotified`  — idempotency guard ensuring runTaskLoop is triggered
 *                        exactly once per run on `queue.status === "completed"`.
 *                        Concurrent syncRun polls see the same pre-terminal
 *                        run.status and would both call updateRun; the set
 *                        short-circuits the second caller before it tries.
 *
 * Every run eventually reaches a terminal status (completed / failed /
 * aborted). When it does, `finalize(runID)` must be called exactly once to
 * release both entries. The canonical trigger is `engine/state.ts::updateRun`
 * on terminal transitions — this places finalize on the one authoritative
 * write path, so no caller (failRun, abortRuns, tool-triggered abort,
 * orphan-recovery) can bypass it.
 *
 * Process restart wipes these maps by nature; the DB remains the source of
 * truth, and recovery flows (`engine/recovery.ts`) re-derive live state.
 */

const mergeLocks = new Map<string, Promise<void>>()
const agentNotified = new Set<string>()

export const PerRunState = {
  /**
   * Serialize work that touches a run's shared resource (git worktree merge).
   * Calls to the same runID are chained; errors propagate to the awaiter but
   * do not poison the chain (next call starts fresh from the settled promise).
   */
  async serializedMerge(runID: string, fn: () => Promise<void>): Promise<void> {
    const prev = mergeLocks.get(runID) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    mergeLocks.set(runID, next)
    await next
  },

  /**
   * Mark a run as notified to the orchestrator. Returns `true` if this was
   * the first notification (caller should proceed), `false` if already
   * notified (caller should short-circuit).
   */
  claimAgentNotification(runID: string): boolean {
    if (agentNotified.has(runID)) return false
    agentNotified.add(runID)
    return true
  },

  /**
   * Release all in-process state for a run that has reached a terminal
   * status. Idempotent — safe to call multiple times. Must be invoked by
   * `state.ts::updateRun` on every terminal transition.
   */
  finalize(runID: string): void {
    mergeLocks.delete(runID)
    agentNotified.delete(runID)
  },

  /** Test-only snapshot. */
  snapshot(): { mergeLocks: number; agentNotified: number } {
    return { mergeLocks: mergeLocks.size, agentNotified: agentNotified.size }
  },
}
