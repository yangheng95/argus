/**
 * In-memory dispatch queue — the tool→loop channel for goal dispatch.
 *
 * When the orchestrator LLM calls `dispatch_goal({ goalIDs, ... })`, the
 * tool pushes the IDs onto this queue and aborts the agent. The task loop
 * then pulls the queue and hands the IDs to `pool.submit(...)`, so the
 * LLM's decision is authoritative — no more "loop auto-submits every
 * dispatchable goal" fallback.
 *
 * Per-task isolation: keyed by task ID so multiple concurrent task loops
 * do not cross-talk. The queue is cleared on pull (one-shot), on task
 * completion/cancellation, and on loop abort.
 *
 * Intentionally NOT persisted. This is in-process scheduler intent, not
 * durable state. On process restart the orchestrator is re-triggered and
 * decides dispatch again from the describe-layer snapshot.
 */

const queues = new Map<string, string[]>()

/** Enqueue goal IDs for the next `pool.submit(...)` on this task. */
export function pushDispatch(taskID: string, goalIDs: string[]): void {
  if (goalIDs.length === 0) return
  const existing = queues.get(taskID) ?? []
  queues.set(taskID, [...existing, ...goalIDs])
}

/** Pull AND clear the pending dispatch for this task. Returns [] when empty. */
export function pullDispatch(taskID: string): string[] {
  const list = queues.get(taskID) ?? []
  queues.delete(taskID)
  return list
}

/** Clear the queue without reading — used on task terminal transitions. */
export function clearDispatch(taskID: string): void {
  queues.delete(taskID)
}

/** Number of IDs pending dispatch for this task (for logs/diagnostics). */
export function peekDispatchCount(taskID: string): number {
  return queues.get(taskID)?.length ?? 0
}
