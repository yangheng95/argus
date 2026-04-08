// ── Board Store ──
// Solid reactive store for board + task list data.
// Replaces direct reads of state.board / state.tasks.

import { createStore } from "solid-js/store";
import { apiHeaders, apiJson, apiUrl } from "../services/api";
import { t } from "../utils/i18n";

// ── Store ──

export const [boardStore, setBoardStore] = createStore({
  board: null as any,
  tasks: [] as any[],
  selectedTaskID: "" as string,
  taskSequence: 0 as number,
  loading: false,
 // ── Task list internals (mirrors state.pendingTasks / state.tasksSeq) ──
  /** Tasks that have been created locally but not yet confirmed by the server */
  pendingTasks: [] as any[],
  /** Monotonic counter incremented on each tasks-list refresh */
  tasksSeq: 0,
 // ── Board sync internals (mirrors state.boardEtag / state.boardQueued / etc.) ──
  /** ETag of the last board response, used for conditional fetches */
  boardEtag: "" as string,
  /** Whether a board reload is currently queued (debounce guard) */
  boardQueued: false,
  /** Retry attempt counter for board fetch failures */
  boardRetryCount: 0,
  /** Whether an in-flight board sync is pending */
  boardSyncPending: false,
  /** Unix-ms timestamp of the last successful board update */
  boardUpdatedAt: 0,
  /** Snapshot version string returned by the server with the board payload */
  snapshotVersion: "" as string,
 // ── VCS state (mirrors state.path / state.vcs) ──
  /** Git path info object for the active working directory */
  path: null as any,
  /** Git / VCS status object for the active task */
  vcs: null as any,
 // ── File changes (mirrors state.changes) ──
  /** File change entries for the current task's working tree */
  changes: [] as any[],
 // ── Streaming previews ──
  /** Streaming preview text for the plan section */
  planPreview: "" as string,
  /** Streaming preview text for the spec section */
  specPreview: "" as string,
});

// ── Loaders ──

export interface LoadBoardOptions {
  sync?: boolean;
}

// Module-level runtime state (replaces .state proxy fields).
let _boardRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _boardLoading: Promise<void> | null = null;
let _boardQueued = false;

function boardSnapshot(board: any): string {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}

function clearBoardRetry(): void {
  if (_boardRetryTimer) {
    clearTimeout(_boardRetryTimer);
    _boardRetryTimer = null;
  }
  setBoardRetryCount(0);
}

function retryBoard(sync: boolean): void {
  if (!boardStore.selectedTaskID || _boardRetryTimer) return;
  if (sync) setBoardSyncPending(true);
  const delay = Math.min(1000 * Math.pow(2, Math.min(boardStore.boardRetryCount, 4)), 15000);
  setBoardRetryCount(boardStore.boardRetryCount + 1);
  _boardRetryTimer = setTimeout(() => {
    _boardRetryTimer = null;
    void loadBoard({ sync: boardStore.boardSyncPending });
  }, delay);
}

export async function loadBoard(options: LoadBoardOptions = {}): Promise<void> {
  const taskID = boardStore.selectedTaskID;
  if (!taskID) {
    setBoardStore("board", null);
    setSnapshotVersion("");
    return;
  }
  if (options.sync) setBoardSyncPending(true);
  if (_boardLoading) {
    _boardQueued = true;
    if (options.sync) setBoardSyncPending(true);
    return _boardLoading;
  }
  const sync = options.sync === true || boardStore.boardSyncPending;
  if (sync) setBoardSyncPending(true);
  const loading = (async () => {
    let failed = false;
    try {
      const headers = apiHeaders();
      if (boardStore.boardEtag) headers["If-None-Match"] = boardStore.boardEtag;
      const res = await fetch(apiUrl(`task/${encodeURIComponent(taskID)}/board?sync=${sync ? "1" : "0"}`), {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (taskID !== boardStore.selectedTaskID) return;
      setBoardSyncPending(false);
      if (res.status === 304) {
        clearBoardRetry();
        setBoardUpdatedAt(Date.now());
        return;
      }
      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
      const etag = res.headers.get("etag");
      if (etag) setBoardEtag(etag);
      const data = await res.json();
      const lastSequence = Number(data?.lastSequence || 0);
      // Monotonic guard: discard stale responses whose sequence is lower
      // than what we already have. This prevents flickering when a slower
      // response arrives after a newer one.
      if (
        Number.isFinite(lastSequence) && lastSequence > 0 &&
        boardStore.taskSequence > 0 &&
        lastSequence < boardStore.taskSequence
      ) {
        clearBoardRetry();
        return;
      }
      setBoardStore("board", data ?? null);
      setSnapshotVersion(boardSnapshot(data));
      if (Number.isFinite(lastSequence) && lastSequence > 0) {
        setTaskSequence(lastSequence);
      }
      clearBoardRetry();
      setBoardUpdatedAt(Date.now());
      // Agent cards are derived reactively from boardStore — no manual rebuild needed.
    } catch (e) {
      failed = true;
      console.error("loadBoard failed", e);
      if (taskID === boardStore.selectedTaskID) retryBoard(sync);
    } finally {
      _boardLoading = null;
      setBoardStore("loading", false);
      if (_boardQueued || boardStore.boardQueued) {
        _boardQueued = false;
        setBoardQueued(false);
        if (!failed && !_boardRetryTimer) {
          queueMicrotask(() => {
            void loadBoard({ sync: boardStore.boardSyncPending });
          });
        }
      }
    }
  })();
  _boardLoading = loading;
  setBoardStore("loading", true);
  return loading;
}

export async function loadTasks(): Promise<void> {
  try {
    const data = await apiJson("tasks");
    const tasks = sortedTasks(data);
    const seen = new Set(
      tasks
        .map((item: any) => item?.task?.requestID)
        .filter(Boolean),
    );
    setBoardStore({
      tasks,
      pendingTasks: boardStore.pendingTasks.filter(
        (item: any) => !seen.has(item?.requestID),
      ),
    });
  } catch (e) {
    console.error("loadTasks failed", e);
  }
}

// ── Task lifecycle ──

/**
 * Clear all task-scoped board state on task switch.
 * Symmetric with clearMessages() / clearAgentEvents() in messages.ts.
 * Cancels pending retry timers and resets all per-task sync machinery so that
 * the next loadBoard() call starts from a clean slate.
 */
export function clearBoard(): void {
  clearBoardRetry();
  if (boardLoadTimer) {
    clearTimeout(boardLoadTimer);
    boardLoadTimer = null;
  }
  boardLoadDeadline = 0;
  _boardQueued = false;
  setBoardStore({
    board: null,
    taskSequence: 0,
    boardEtag: "",
    boardSyncPending: false,
    boardQueued: false,
    boardUpdatedAt: 0,
    snapshotVersion: "",
    path: null,
    vcs: null,
    changes: [],
  });
}

// ── Direct setters (used by / SSE handlers) ──

export function setBoardData(data: any): void {
  setBoardStore("board", data ?? null);
}

export function setTasksData(tasks: any[]): void {
  setBoardStore("tasks", Array.isArray(tasks) ? tasks : []);
}

// ── Scheduled board reload ──

let boardLoadTimer: any = null;
let boardLoadDeadline = 0;
const BOARD_MAX_DELAY_MS = 2000;

/**
 * Schedule a board reload after an optional delay.
 *
 * Debounce + max-delay: each call delays by `delay`, but the reload fires
 * at most BOARD_MAX_DELAY_MS after the FIRST call in a burst. This prevents
 * starvation when events arrive continuously at intervals < delay (e.g.
 * rapid progress SSE events resetting the 500ms timer forever).
 *
 * @param delay Delay in milliseconds before calling loadBoard. Defaults to 0.
 */
export function scheduleBoard(delay = 0): void {
  setBoardSyncPending(true);
  clearBoardRetry();
  const now = Date.now();
  // First scheduling in a burst: set deadline
  if (!boardLoadTimer || boardLoadDeadline === 0) {
    boardLoadDeadline = now + BOARD_MAX_DELAY_MS;
  }
  if (boardLoadTimer) {
    clearTimeout(boardLoadTimer);
    boardLoadTimer = null;
  }
  // Effective delay is min(requested, remaining-until-deadline).
  // When remaining is negative (deadline passed), fire immediately.
  const remaining = Math.max(0, boardLoadDeadline - now);
  const effectiveDelay = Math.min(delay, remaining);
  boardLoadTimer = setTimeout(() => {
    boardLoadTimer = null;
    boardLoadDeadline = 0;
    void loadBoard({ sync: true });
  }, effectiveDelay);
}

// ── Derived accessors ──

/** Returns the root task sessionID (mirrors app.js rootTaskSessionID). */
export function rootTaskSessionID(): string {
  const sessionID = boardStore.board?.task?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}



/** Returns the active working directory from the current board task. */
export function activeDirectory(): string {
  return boardStore.board?.task?.directory ?? "";
}

// ── VCS setters ──

export function setPath(path: any): void {
  setBoardStore("path", path ?? null);
}

export function setVcs(vcs: any): void {
  setBoardStore("vcs", vcs ?? null);
}

// ── Changes setter ──

export function setChanges(changes: any[]): void {
  setBoardStore("changes", Array.isArray(changes) ? changes : []);
}

// ── Board sync state setters ──

export function setBoardEtag(etag: string): void {
  setBoardStore("boardEtag", typeof etag === "string" ? etag : "");
}

export function setBoardQueued(queued: boolean): void {
  setBoardStore("boardQueued", queued);
}

export function setBoardRetryCount(count: number): void {
  setBoardStore("boardRetryCount", typeof count === "number" ? count : 0);
}

export function setBoardSyncPending(pending: boolean): void {
  setBoardStore("boardSyncPending", pending);
}

export function setBoardUpdatedAt(ms: number): void {
  setBoardStore("boardUpdatedAt", typeof ms === "number" ? ms : 0);
}

export function setSnapshotVersion(version: string): void {
  setBoardStore("snapshotVersion", typeof version === "string" ? version : "");
}

export function setTaskSequence(sequence: number): void {
  setBoardStore("taskSequence", typeof sequence === "number" ? sequence : 0);
}

// ── Pending tasks setters ──

export function setPendingTasks(tasks: any[]): void {
  setBoardStore("pendingTasks", Array.isArray(tasks) ? tasks : []);
}

export function bumpTasksSeq(): void {
  setBoardStore("tasksSeq", (n) => n + 1);
}

// ── Criteria DOM helpers ──
// (lines 7070–7089). These operate on DOM elements rendered by
// criteria list; they are placed here because they relate to board/task
// evaluation state.

/**
 * Read the enabled/checked state of a criteria list item element.
 * Returns true when the inner checkbox is checked.
 */
export function isCriteriaEnabled(item: Element | null): boolean {
  const input = item?.querySelector<HTMLInputElement>('input[type="checkbox"][data-check]');
  return !!input?.checked;
}

/**
 * Update the visual status indicator and result text inside a criteria list
 * item element.
 */
export function setCriteriaResult(item: Element | null, status: string): void {
  const statusDot = item?.querySelector<HTMLElement>(".criteria-status");
  const text = item?.querySelector<HTMLElement>(".criteria-result");
  if (!statusDot || !text) return;
  statusDot.dataset.result = status;
 // Direct i18n lookup — replaces .
  const key = `criteria.result.${status}`;
  const label = t(key);
  text.textContent = label !== key ? label : status;
}

// ── Task list derived utilities ──

/**
 * Sort a raw tasks payload by updated_at / task.time.updated descending.
 */
export function sortedTasks(data: { tasks?: any[] } | null | undefined): any[] {
  return [...(Array.isArray(data?.tasks) ? data!.tasks : [])].sort(
    (a, b) =>
      (b.updated_at || b.task?.time?.updated || 0) -
      (a.updated_at || a.task?.time?.updated || 0),
  );
}

/**
 * Returns the last-updated timestamp for a task list item.
 */
export function taskUpdated(item: any): number {
  return item?.updated_at || item?.task?.time?.updated || item?.task?.time?.created || 0;
}

/**
 * Find a task item in boardStore.tasks by task ID.
 */
export function taskByID(taskID: string | null | undefined): any | null {
  if (!taskID) return null;
  return boardStore.tasks.find((item: any) => item?.task?.id === taskID) ?? null;
}

/**
 * Find a task item by its requestID within a given list (defaults to boardStore.tasks).
 */
export function taskByRequestID(
  requestID: string | null | undefined,
  list: any[] = boardStore.tasks,
): any | null {
  if (!requestID || !Array.isArray(list)) return null;
  return list.find((item: any) => item?.task?.requestID === requestID) ?? null;
}

/**
 * Returns the merged visible task list: pending (not yet confirmed) tasks
 * prepended to the confirmed task list, sorted by last-updated descending.
 */
export function visibleTasks(): any[] {
  const seen = new Set(
    boardStore.tasks
      .map((item: any) => item?.task?.requestID || item?.task?.id)
      .filter(Boolean),
  );
  return [
    ...boardStore.pendingTasks.filter(
      (item: any) => !seen.has(item?.requestID || item?.task?.id),
    ),
    ...boardStore.tasks,
  ].sort((a, b) => taskUpdated(b) - taskUpdated(a));
}

// ── Task state classifiers ──

const INTERRUPTABLE_STATUSES = new Set(["queued", "active"]);

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Returns true when the currently selected task can be interrupted (stopped).
 * Derived from the task status in the board — single source of truth for
 * the stop button's availability.
 */
export function isTaskInterruptable(): boolean {
  const status = boardStore.board?.task?.status;
  return !!status && INTERRUPTABLE_STATUSES.has(status);
}

/**
 * Returns true when the currently selected task is in a terminal state.
 */
export function isTaskTerminal(): boolean {
  const status = boardStore.board?.task?.status;
  return !!status && TERMINAL_STATUSES.has(status);
}
