// ── Board Store ──
// Solid reactive store for board + task list data.
// Replaces direct reads of state.board / state.tasks.

import { createStore } from "solid-js/store";
import { batch } from "solid-js";
import { apiHeaders, apiJson, apiUrl } from "../services/api";
import { t } from "../utils/i18n";

// ── Store ──

export const [boardStore, setBoardStore] = createStore({
  board: null as any,
  tasks: [] as any[],
  selectedTaskID: "" as string,
  taskSequence: 0 as number,
  loading: false,
  /** Monotonic counter incremented on each selectTask() call. Used to detect
   *  superseded loads when the user rapidly switches tasks: async phases
   *  capture the epoch at entry and bail out when boardStore.selectEpoch has
   *  advanced past it. */
  selectEpoch: 0 as number,
  /** True between selectTask() entry and its async load chain completing
   *  (applyDirectory + loadBoard + syncTask + startSSE). Drives the top-of-
   *  pane progress bar so cross-project task switches feel non-blocking. */
  taskSwitching: false,
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
  /** Last error from loadTasks(); non-empty means the list is stale and UI
   *  must surface the error instead of rendering an empty list. Cleared on
   *  the next successful reload. */
  tasksError: "" as string,
  /** Flips true after the first successful loadTasks() round-trip
   *  completes, regardless of whether the list ended up empty. The
   *  TaskList component reads this to distinguish "still fetching"
   *  (skeleton rows) from "fetched but project really has zero tasks"
   *  (empty-hint copy). Stays true for the lifetime of the overlay
   *  unless tasksError is set. */
  tasksLoaded: false as boolean,
});

// ── Loaders ──

export interface LoadBoardOptions {
  sync?: boolean;
}

// Module-level runtime state (replaces .state proxy fields).
let _boardRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _boardLoading: Promise<void> | null = null;
let _boardQueued = false;

// Invariant handler: fires when the current `selectedTaskID` no longer refers
// to any task in the merged (tasks + pendingTasks) list. Registered by
// services/task.ts so that board.ts doesn't need to import selectTask (which
// would create a cycle). If not registered, the invariant silently degrades —
// that's a setup bug the app owner is expected to catch in init.
let _orphanedSelectionHandler: (() => void) | null = null;
// Board-derived overlays (goal step cards, interaction cards, request bubble)
// are projected by services/tree-writer.ts. Register a callback here so the
// projection runs exactly once after each applied board delta instead of
// relying on a shallow reactive read of `boardStore.board`.
let _boardProjectionHandler: (() => void) | null = null;

export function setOrphanedSelectionHandler(
  handler: (() => void) | null,
): void {
  _orphanedSelectionHandler = handler;
}

export function setBoardProjectionHandler(
  handler: (() => void) | null,
): void {
  _boardProjectionHandler = handler;
}

function notifyBoardProjection(): void {
  _boardProjectionHandler?.();
}

function selectionIsOrphaned(tasks: any[], pending: any[]): boolean {
  const id = boardStore.selectedTaskID;
  if (!id) return false;
  // Stable-state guard: during selectTask()'s async phase a concurrent
  // loadTasks() response may not yet include the freshly-created task, and
  // firing the handler then would incorrectly reset a selection that is in
  // the process of being loaded. Once taskSwitching has settled, the
  // tasks/pending lists are the source of truth for whether the selection
  // still exists; requiring a loaded board snapshot lets an invalid task ID
  // survive forever after a failed task switch or cross-project mismatch.
  if (boardStore.taskSwitching) return false;
  const inTasks = Array.isArray(tasks)
    && tasks.some((item: any) => item?.task?.id === id);
  if (inTasks) return false;
  const inPending = Array.isArray(pending)
    && pending.some((item: any) => item?.task?.id === id || item?.id === id);
  return !inPending;
}

function boardSnapshot(board: any): string {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}

// ── Fine-grained board update ──
//
// The server returns the entire board object on every refresh; replacing
// `boardStore.board` wholesale (`setBoardStore("board", data)`) bypasses
// SolidJS's fine-grained reactivity contract — every memo that reads any
// `boardStore.board.*` field gets invalidated, even when only one field
// (e.g. `goalWorkflows[i].steps[j].status`) actually changed.
//
// `applyBoardDelta` performs a per-field shallow JSON diff and only writes
// back the keys whose serialised value differs. Downstream memos that read
// only unchanged fields (interactions, task, etc.) stop firing on dense
// `workflow.*` SSE bursts that mutate just one corner of the tree.
//
// JSON.stringify is acceptable because typical board fields are small (KB
// scale) and the diff cost is amortised against the recompute work it avoids
// — downstream memos cost tens of ms vs sub-ms per-field stringify.

function fieldChanged(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  if (a === undefined || b === undefined) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}

// ── Boundary invariants ──
//
// The board snapshot from the server must satisfy a small set of structural
// invariants so that downstream view code can trust its inputs without
// defensive `?? Date.now()` / `?? 0` fallbacks. Any violation is a real bug
// (server payload corruption or schema drift) that must surface, not be
// papered over here. We throw — `loadBoard`'s catch will retry with backoff
// and console.error makes the corruption visible.
function assertBoardInvariants(data: any): void {
  if (data == null) return;
  if (typeof data !== "object") {
    throw new Error(`board payload must be object, got ${typeof data}`);
  }
  const task = (data as any).task;
  if (task) {
    const created = task?.time?.created;
    if (!Number.isFinite(created) || created <= 0) {
      throw new Error(
        `board.task.time.created invalid: ${JSON.stringify(task?.time)}`,
      );
    }
  }
  const interactions = (data as any).interactions;
  if (Array.isArray(interactions)) {
    for (const it of interactions) {
      const created = it?.time?.created;
      if (!Number.isFinite(created) || created <= 0) {
        throw new Error(
          `board.interactions[id=${it?.id}].time.created invalid: ${JSON.stringify(it?.time)}`,
        );
      }
      if (it?.status === "answered" || it?.status === "rejected") {
        const resolved = it?.time?.resolved;
        if (!Number.isFinite(resolved) || resolved <= 0) {
          throw new Error(
            `board.interactions[id=${it?.id}] resolved/rejected without valid time.resolved: ${JSON.stringify(it?.time)}`,
          );
        }
      }
    }
  }
}

function applyBoardDelta(data: any): void {
  if (data == null || typeof data !== "object") {
    if (boardStore.board !== null) {
      setBoardStore("board", null);
      notifyBoardProjection();
    }
    return;
  }
  const old = boardStore.board;
  if (!old || typeof old !== "object") {
    setBoardStore("board", data);
    notifyBoardProjection();
    return;
  }
  // Update keys present in the new payload, only when their content changed.
  const seenKeys = new Set<string>();
  let changed = false;
  for (const key of Object.keys(data)) {
    seenKeys.add(key);
    if (fieldChanged((old as any)[key], data[key])) {
      setBoardStore("board", key as any, data[key]);
      changed = true;
    }
  }
  // Drop keys the server no longer reports — set to undefined so reactive
  // readers see the field disappear instead of holding a stale value.
  for (const key of Object.keys(old)) {
    if (seenKeys.has(key)) continue;
    setBoardStore("board", key as any, undefined);
    changed = true;
  }
  if (changed) notifyBoardProjection();
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
      assertBoardInvariants(data);
      applyBoardDelta(data);
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

/**
 * Canonical writer for `boardStore.tasks`. All paths that replace the task
 * list MUST go through here so that the "`selectedTaskID` always refers to an
 * existing task" invariant is enforced. After the list is applied, if the
 * current selection no longer exists (in tasks or pendingTasks), the
 * registered orphan handler is invoked to reset the selection — this is the
 * single choke point that keeps the conversation panel consistent with the
 * task list (e.g. after a task is deleted by another client or the last task
 * is removed locally).
 *
 * `nextPending` lets callers that already know the new pending list pass it
 * in atomically — the orphan check then considers the post-update state.
 * Omit to keep the current `pendingTasks`.
 */
export function applyTasks(
  tasks: any[],
  nextPending?: any[],
): void {
  const list = Array.isArray(tasks) ? tasks : [];
  const pending = Array.isArray(nextPending) ? nextPending : boardStore.pendingTasks;
  // batch coalesces both setBoardStore writes when both fire — without it,
  // every consumer of either `tasks` or `pendingTasks` reruns twice on
  // applyTasks(list, pending) (the common path in loadTasks).
  batch(() => {
    setBoardStore("tasks", list);
    if (Array.isArray(nextPending)) setBoardStore("pendingTasks", pending);
  });
  if (selectionIsOrphaned(list, pending) && _orphanedSelectionHandler) {
    _orphanedSelectionHandler();
  }
}

export async function loadTasks(): Promise<void> {
  // Let-it-crash: any fetch/parse error lands in boardStore.tasksError so the
  // UI surfaces the failure explicitly. The previous silent catch left the UI
  // stuck on an empty list with no indication that the backend was unreachable.
  try {
    const data = await apiJson("global/tasks");
    const tasks = sortedTasks(data);
    const seen = new Set(
      tasks
        .map((item: any) => item?.task?.requestID)
        .filter(Boolean),
    );
    const nextPending = boardStore.pendingTasks.filter(
      (item: any) => !seen.has(item?.requestID),
    );
    applyTasks(tasks, nextPending);
    setBoardStore("tasksError", "");
    setBoardStore("tasksLoaded", true);
  } catch (e) {
    setBoardStore("tasksError", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ── Task lifecycle ──

/**
 * Clear all task-scoped board state on task switch.
 * Symmetric with clearMessages() in messages.ts.
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
  notifyBoardProjection();
}

// ── Direct setters (used by / SSE handlers) ──

export function setBoardData(data: any): void {
  assertBoardInvariants(data);
  applyBoardDelta(data);
}

export function setTasksData(tasks: any[]): void {
  applyTasks(tasks);
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



/** Returns the **selected task's** frozen working directory (the directory
 *  the task was created in, carried on `board.task.directory`).
 *
 *  NOTE: this is NOT the user's current cwd. That lives in
 *  `settingsStore.directory` and is exposed by `services/workspace.ts`'s
 *  own `activeDirectory()`. The two used to share a name, which silently
 *  routed UI that meant "current cwd" (e.g. the Init Git button) to the
 *  frozen task directory instead — leading to visible stale state after
 *  the user switched workspaces. Callers should pick the semantic they
 *  actually want. */
export function selectedTaskDirectory(): string {
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
