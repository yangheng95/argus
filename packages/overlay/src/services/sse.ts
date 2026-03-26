// ── SSE Connection Manager ──
// Manages the Server-Sent Events connection for real-time task updates.
// Events are dispatched through routeSSEEvent() first (message/agent/executor).
// Unhandled events are forwarded to handleEventStreamEvent for board/task
// lifecycle processing.

import { apiUrl, apiHeaders } from "./api";
import { clearEventQueue, syncTask, setSseConnected } from "../store/messages";
import { boardStore, loadBoard } from "../store/board";
import { routeSSEEvent, handleEventStreamEvent } from "./events";

let sseController: AbortController | null = null;
let sseRetryTimer: any = null;

export function startSSE(taskID: string) {
  stopSSE();
  const controller = new AbortController();
  sseController = controller;
  setSseConnected(false);

  (async () => {
    try {
      const after = Number(boardStore.taskSequence || 0);
      const path = after > 0
        ? `task/${encodeURIComponent(taskID)}/events?after=${after}`
        : `task/${encodeURIComponent(taskID)}/events`;
      const res = await fetch(apiUrl(path), {
        headers: apiHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      setSseConnected(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (
              event.type === "task.heartbeat" ||
              event.type === "task.connected"
            )
              continue;
            const handled = routeSSEEvent(event);
            if (!handled) {
 // Forward unhandled events (board/task lifecycle) to handleEventStreamEvent.
              handleEventStreamEvent(event);
            }
          } catch {
 // malformed JSON — skip
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.warn("SSE disconnected", e.message);
    }
    setSseConnected(false);
 // Reconnect after 3s with a full transcript reload
    if (sseRetryTimer) clearTimeout(sseRetryTimer);
    sseRetryTimer = setTimeout(async () => {
      sseRetryTimer = null;
      if (boardStore.selectedTaskID !== taskID) return;
      await syncTask(taskID);
      await loadBoard();
      startSSE(taskID);
    }, 3000);
  })();
}

export function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (sseController) {
    sseController.abort();
  }
  sseController = null;
  setSseConnected(false);
  clearEventQueue();
}
