/**
 * Per-run in-process state that is NOT persisted to DB.
 *
 * `agentNotified` is an idempotency guard ensuring runTaskLoop is triggered
 * exactly once per run on `queue.status === "completed"`. Concurrent syncRun
 * polls see the same pre-terminal run.status and would both call updateRun;
 * the set short-circuits the second caller before it tries.
 *
 * Every run eventually reaches a terminal status (completed / failed /
 * aborted). When it does, `finalize(runID)` must be called exactly once to
 * release the entry. The canonical trigger is `engine/state.ts::updateRun`
 * on terminal transitions — this places finalize on the one authoritative
 * write path, so no caller (failRun, abortRuns, tool-triggered abort,
 * orphan-recovery) can bypass it.
 *
 * Process restart wipes this set by nature; the DB remains the source of
 * truth, and recovery flows (`engine/recovery.ts`) re-derive live state.
 */

const agentNotified = new Set<string>()

export const PerRunState = {
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
    agentNotified.delete(runID)
  },

  /** Test-only snapshot. */
  snapshot(): { agentNotified: number } {
    return { agentNotified: agentNotified.size }
  },
}
