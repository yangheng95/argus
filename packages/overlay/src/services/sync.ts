// ── Sync Service ──
// Coordinates loading board, tasks, and transcript in one shot.

import { loadBoard, loadTasks, setBoardStore, boardStore, setBoardRetryCount, setBoardSyncPending } from "../store/board";
import { syncTask } from "../store/messages";
import { stopSSE } from "./sse";

/**
 * Sync board data, task list, and (optionally) a specific task's transcript.
 * @param taskID If provided, also loads the transcript for this task and
 * updates selectedTaskID in the board store.
 */
export async function syncBoardAndTasks(taskID?: string): Promise<void> {
  await Promise.all([loadBoard(), loadTasks()]);
  if (taskID) {
    setBoardStore("selectedTaskID", taskID);
    await syncTask(taskID);
  }
}

// ── Board Retry Utilities ──
// boardSnapshot ported

let _boardRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancel any pending board retry timer and reset the retry counter.
 */
export function clearBoardRetry(): void {
  if (_boardRetryTimer !== null) {
    clearTimeout(_boardRetryTimer);
    _boardRetryTimer = null;
  }
  setBoardRetryCount(0);
}

/**
 * Schedule a board reload with exponential backoff (capped at 15 s).
 * A no-op when no task is selected or a retry is already queued.
 * When `sync` is true the reload will request a server-side sync.
 */
export function retryBoard(sync?: boolean): void {
  if (!boardStore.selectedTaskID || _boardRetryTimer !== null) return;
  if (sync) setBoardSyncPending(true);
  const delay = Math.min(1000 * Math.pow(2, Math.min(boardStore.boardRetryCount, 4)), 15000);
  setBoardRetryCount(boardStore.boardRetryCount + 1);
  _boardRetryTimer = setTimeout(() => {
    _boardRetryTimer = null;
    loadBoard().catch(console.error);
  }, delay);
}

/**
 * Extract the snapshotVersion string from a board response object.
 * Returns an empty string when absent.
 */
export function boardSnapshot(board: any): string {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}

// ── stopTimers ──
// Stop all background timers and SSE connection.
// -side timers (elapsedTimer, tasksKick) remain.

export function stopTimers(): void {
  clearBoardRetry();
  stopSSE();
}
