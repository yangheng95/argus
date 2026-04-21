// ── SSE Connection Manager ──
// Manages the Server-Sent Events connection for real-time task updates.
// Events are dispatched through routeSSEEvent() first (message/agent/executor).
// Unhandled events are forwarded to handleEventStreamEvent for board/task
// lifecycle processing.
//
// Uses the native EventSource API instead of fetch() + ReadableStream.
// WebView2 (Tauri overlay) may buffer ReadableStream chunks from fetch(),
// causing SSE events to be delayed until the connection closes or the buffer
// fills up. EventSource handles SSE natively at the browser engine level
// and delivers events immediately regardless of runtime.

import { apiUrl } from "./api";
import { clearEventQueue, syncTask, setSseConnected } from "../store/messages";
import { boardStore, loadBoard } from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } from "./events";

let sseSource: EventSource | null = null;
let sseRetryTimer: any = null;

export function startSSE(taskID: string) {
  stopSSE();
  setSseConnected(false);

  // `after` decides how far back the server replays. loadBoard() sets
  // boardStore.taskSequence to the board endpoint's lastSequence, which
  // was intended as "I already have state up to here, only send me
  // deltas." But cardTreeStore is populated exclusively by writeToTree
  // from SSE events — loadBoard doesn't touch it. So if we use
  // taskSequence naïvely, a fresh task-switch (resetWriter() cleared the
  // card tree) receives ZERO replayed events and the conversation panel
  // shows only the goal cards that loadBoard drew directly, losing the
  // entire assistant / tool / message history.
  //
  // Guard: when the card tree is empty (reset-after-switch, post-reload,
  // any resetWriter path), force after=0 so the server replays the full
  // per-task event log into writeToTree. writeToTree is idempotent by
  // event id, so re-applying events that loadBoard already reflected
  // is safe.
  const hasExistingCards = cardTreeStore.order.length > 0;
  const after = hasExistingCards ? Number(boardStore.taskSequence || 0) : 0;
  const path = after > 0
    ? `task/${encodeURIComponent(taskID)}/events?after=${after}`
    : `task/${encodeURIComponent(taskID)}/events`;
  const url = apiUrl(path);

  const source = new EventSource(url);
  sseSource = source;

  source.onopen = () => {
    setSseConnected(true);
  };

  source.onmessage = (e) => {
    // Per 07-panel-reactivity.md constraint 1 and root CLAUDE.md rule 1:
    // tree-writer's `let it crash` is meaningless if sse.ts's onmessage
    // silently swallows the throw. Split the try/catch:
    //   (a) JSON.parse error → benign (malformed chunk), just skip
    //   (b) router / dispatch error → surface via console.error (crash visibly)
    //
    // Without (b), every `throw new Error("tree-writer: unhandled event type …")`
    // disappeared and the operator had no way to know why the conversation
    // panel was empty.
    let event: any;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    if (event.type === "task.heartbeat" || event.type === "task.connected") return;
    try {
      const handled = routeSSEEvent(event);
      if (!handled) {
        handleEventStreamEvent(event);
      }
    } catch (err) {
      console.error("[sse] dispatch error for event", event?.type, err, event);
    }
  };

  source.onerror = () => {
    // EventSource auto-reconnects on transient errors (readyState = CONNECTING).
    // We only trigger manual recovery when the connection is permanently closed,
    // or when the EventSource has been replaced (stopSSE was called).
    if (source !== sseSource) return; // replaced by a newer connection
    if (source.readyState === EventSource.CLOSED) {
      setSseConnected(false);
      sseSource = null;
      // Reconnect after 3s with a full transcript reload
      if (sseRetryTimer) clearTimeout(sseRetryTimer);
      sseRetryTimer = setTimeout(async () => {
        sseRetryTimer = null;
        if (boardStore.selectedTaskID !== taskID) return;
        await syncTask(taskID);
        await loadBoard();
        startSSE(taskID);
      }, 3000);
    } else {
      // Transient error — EventSource will auto-reconnect.
      // Mark disconnected temporarily; onopen will restore it.
      setSseConnected(false);
    }
  };
}

export function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (sseSource) {
    sseSource.close();
  }
  sseSource = null;
  setSseConnected(false);
  clearEventQueue();
}

// ── Global task-list change stream ──
// One long-lived EventSource connected to GET /task/events.
// On every persisted task aggregate event, the server emits a tiny
// {type, taskID, sequence} notification; we translate that into a
// debounced loadTasks(). This closes the gap where status changes on
// non-selected tasks (or new tasks created by other clients) would
// otherwise only arrive via manual refresh.

let taskListSource: EventSource | null = null;
let taskListRetryTimer: any = null;

export function startTaskListSSE() {
  stopTaskListSSE();
  const url = apiUrl("task/events");
  const source = new EventSource(url);
  taskListSource = source;
  source.onmessage = (e) => {
    // Same split as startSSE above: parse errors silent, dispatch errors surfaced.
    let event: any;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    if (event.type === "task-list.heartbeat" || event.type === "task-list.connected") return;
    try {
      // Task-list stream emits only `{type, taskID, sequence}` — not the
      // full task-scope event shape. Route to the notification handler,
      // NOT handleEventStreamEvent (which feeds tree-writer and would
      // throw on every missing payload).
      handleTaskListNotification(event);
    } catch (err) {
      console.error("[task-list-sse] dispatch error for event", event?.type, err, event);
    }
  };
  source.onerror = () => {
    if (source !== taskListSource) return;
    if (source.readyState === EventSource.CLOSED) {
      taskListSource = null;
      if (taskListRetryTimer) clearTimeout(taskListRetryTimer);
      taskListRetryTimer = setTimeout(() => {
        taskListRetryTimer = null;
        startTaskListSSE();
      }, 3000);
    }
  };
}

export function stopTaskListSSE() {
  if (taskListRetryTimer) {
    clearTimeout(taskListRetryTimer);
    taskListRetryTimer = null;
  }
  if (taskListSource) {
    taskListSource.close();
  }
  taskListSource = null;
}
