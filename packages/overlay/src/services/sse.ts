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
import { routeSSEEvent, handleEventStreamEvent } from "./events";

let sseSource: EventSource | null = null;
let sseRetryTimer: any = null;

export function startSSE(taskID: string) {
  stopSSE();
  setSseConnected(false);

  const after = Number(boardStore.taskSequence || 0);
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
    try {
      const event = JSON.parse(e.data);
      if (
        event.type === "task.heartbeat" ||
        event.type === "task.connected"
      )
        return;
      const handled = routeSSEEvent(event);
      if (!handled) {
        handleEventStreamEvent(event);
      }
    } catch {
      // malformed JSON — skip
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
