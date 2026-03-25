// ── SSE Connection Manager ──
// Extracted from legacy app.js — manages Server-Sent Events connection
// for real-time task updates.
//
// All incoming events are dispatched through routeSSEEvent() first.
// If routeSSEEvent() returns false (unknown event type), the event is
// forwarded to window.__legacyHandleNonMessageEvent for backward-compatible
// processing by app.js.  This keeps the Solid path self-contained while
// preserving full compatibility during the incremental migration.

import { apiUrl, apiHeaders } from "./api";
import { clearEventQueue, syncTask, setSseConnected } from "../store/messages";
import { routeSSEEvent } from "./events";

let sseController: AbortController | null = null;
let sseRetryTimer: any = null;

export function startSSE(taskID: string) {
  stopSSE();
  const controller = new AbortController();
  sseController = controller;
  setSseConnected(false);

  (async () => {
    try {
      const res = await fetch(apiUrl(`task/${taskID}/events`), {
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
              // Forward unknown events to legacy handler for backward
              // compatibility during the incremental app.js migration.
              (window as any).__legacyHandleNonMessageEvent?.(event);
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
      await syncTask(taskID);
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
    sseController = null;
  }
  setSseConnected(false);
  clearEventQueue();
}
