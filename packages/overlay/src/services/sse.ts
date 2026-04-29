// ── SSE Connection Manager ──
// Manages the Server-Sent Events connection for real-time task updates.
// Events are dispatched through routeSSEEvent() first (message/agent/executor).
// Unhandled events are forwarded to handleEventStreamEvent for board/task
// lifecycle processing.
//
// Streams flow through `HostTransport.openStream` (services/host-transport.ts)
// so the same business logic runs identically under the Tauri overlay
// window and the VS Code webview. The transport owns transient
// reconnect behaviour (browser-native EventSource auto-reconnect under
// Tauri; the postMessage bridge under VS Code in M4); this module owns
// the *business* reconnect policy — re-hydrate conversation, then
// resume from the last persisted sequence (plan §5.5).

import { clearEventQueue, setSseConnected } from "../store/messages";
import { boardStore } from "../store/board";
import { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } from "./events";
import { hydrateTaskConversation } from "./conversation";
import { getHostTransport, type StreamHandle } from "./host-transport";

let sseHandle: StreamHandle | null = null;
let sseRetryTimer: any = null;

export function startSSE(taskID: string, after = 0) {
  stopSSE();
  setSseConnected(false);

  // Initial task restore now hydrates board + messages + persisted task events
  // through /task/:id/conversation before opening SSE. That means this stream
  // can safely resume from the last persisted protocol_event sequence instead
  // of replaying from zero on every reconnect.
  const transport = getHostTransport();
  const handle = transport.openStream(
    {
      path: `task/${encodeURIComponent(taskID)}/events`,
      query: after > 0 ? { after: String(after) } : undefined,
    },
    {
      onOpen: () => setSseConnected(true),
      onEvent: (data) => {
        // Per 07-panel-reactivity.md constraint 1 and root CLAUDE.md rule 1:
        // tree-writer's `let it crash` is meaningless if onEvent silently
        // swallows the throw. Split: JSON.parse error → benign skip;
        // dispatch error → console.error so the operator can find why
        // the conversation panel is empty.
        let event: any;
        try {
          event = JSON.parse(data);
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
      },
      onError: () => {
        // Transient disconnect: transport's underlying EventSource is
        // already trying to reconnect (Tauri host) or the bridge is
        // negotiating a new SSE upstream (vscode host in M4). Surface
        // disconnected state immediately; onOpen will restore it.
        if (handle === sseHandle) setSseConnected(false);
      },
      onClose: (_reason) => {
        // Permanent close: re-hydrate then re-open from the hydrated
        // sequence so we avoid a full replay after crashes.
        if (handle !== sseHandle) return;
        setSseConnected(false);
        sseHandle = null;
        if (sseRetryTimer) clearTimeout(sseRetryTimer);
        sseRetryTimer = setTimeout(async () => {
          sseRetryTimer = null;
          if (boardStore.selectedTaskID !== taskID) return;
          const nextSequence = await hydrateTaskConversation(taskID);
          startSSE(taskID, nextSequence);
        }, 3000);
      },
    },
  );
  sseHandle = handle;
}

export function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (sseHandle) {
    sseHandle.close();
  }
  sseHandle = null;
  setSseConnected(false);
  clearEventQueue();
}

// ── Global task-list change stream ──
// One long-lived stream connected to GET /task/events. On every persisted
// task aggregate event the server emits a tiny {type, taskID, sequence}
// notification; we translate that into a debounced loadTasks(). This
// closes the gap where status changes on non-selected tasks (or new
// tasks created by other clients) would otherwise only arrive via
// manual refresh.

let taskListHandle: StreamHandle | null = null;
let taskListRetryTimer: any = null;

export function startTaskListSSE() {
  stopTaskListSSE();
  const transport = getHostTransport();
  const handle = transport.openStream(
    { path: "task/events" },
    {
      onEvent: (data) => {
        // Same split as startSSE above: parse errors silent, dispatch
        // errors surfaced.
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        if (event.type === "task-list.heartbeat" || event.type === "task-list.connected") return;
        try {
          // Task-list stream emits only `{type, taskID, sequence}` — not
          // the full task-scope event shape. Route to the notification
          // handler, NOT handleEventStreamEvent (which feeds tree-writer
          // and would throw on every missing payload).
          handleTaskListNotification(event);
        } catch (err) {
          console.error("[task-list-sse] dispatch error for event", event?.type, err, event);
        }
      },
      onClose: (_reason) => {
        if (handle !== taskListHandle) return;
        taskListHandle = null;
        if (taskListRetryTimer) clearTimeout(taskListRetryTimer);
        taskListRetryTimer = setTimeout(() => {
          taskListRetryTimer = null;
          startTaskListSSE();
        }, 3000);
      },
    },
  );
  taskListHandle = handle;
}

export function stopTaskListSSE() {
  if (taskListRetryTimer) {
    clearTimeout(taskListRetryTimer);
    taskListRetryTimer = null;
  }
  if (taskListHandle) {
    taskListHandle.close();
  }
  taskListHandle = null;
}
