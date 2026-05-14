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

import { clearEventQueue, setSseConnected } from "../store/messages"
import { boardStore, loadTasks } from "../store/board"
import { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } from "./events"
import { hydrateTaskConversation } from "./conversation"
import { getHostTransport, type StreamHandle } from "./host-transport"
import { settingsStore } from "../store/settings"

let sseHandle: StreamHandle | null = null
let sseRetryTimer: any = null

// audit-2026-04-29 W2-V10 — reconnect tick extracted so the regression
// test can exercise the (a) hydrate-throw path and (b) post-await
// task-switch race directly, without standing up the real
// HostTransport + 3 s timers. Production path: onClose sets a
// 3 s timer that calls this with the live deps below.
export interface SseReconnectDeps {
  taskID: string
  after: number
  currentTaskID: () => string
  hydrate: (taskID: string) => Promise<number>
  restart: (taskID: string, after: number) => void
  scheduleRetry: (fn: () => void, ms: number) => void
  retryDelayMs: number
}

export async function performSseReconnect(deps: SseReconnectDeps): Promise<void> {
  if (deps.currentTaskID() !== deps.taskID) return
  let nextSequence: number
  try {
    nextSequence = await deps.hydrate(deps.taskID)
  } catch (err) {
    console.error("[sse] reconnect hydrate failed for task", deps.taskID, err)
    if (deps.currentTaskID() !== deps.taskID) return
    deps.scheduleRetry(() => {
      if (deps.currentTaskID() !== deps.taskID) return
      void performSseReconnect(deps)
    }, deps.retryDelayMs)
    return
  }
  // Post-await re-check: user may have task-switched while hydrate
  // was in flight. Restarting the OLD task's SSE would stomp the
  // NEW task's handle (startSSE calls stopSSE first), silently
  // killing the user-visible stream.
  if (deps.currentTaskID() !== deps.taskID) return
  deps.restart(deps.taskID, nextSequence)
}

const RECONNECT_DELAY_MS = 3000

export function startSSE(taskID: string, after = 0) {
  stopSSE()
  setSseConnected(false)

  // Initial task restore now hydrates board + messages + persisted task events
  // through /task/:id/conversation before opening SSE. That means this stream
  // can safely resume from the last persisted protocol_event sequence instead
  // of replaying from zero on every reconnect.
  const transport = getHostTransport()
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
        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          return
        }
        if (event.type === "task.heartbeat" || event.type === "task.connected") return
        try {
          const handled = routeSSEEvent(event)
          if (!handled) {
            handleEventStreamEvent(event)
          }
        } catch (err) {
          console.error("[sse] dispatch error for event", event?.type, err, event)
        }
      },
      onError: () => {
        // SSE (Server-Sent Events) errors can happen after the browser
        // transport has already dropped live-only message deltas. Close the
        // handle so onClose runs the business reconnect policy: hydrate the
        // conversation snapshot, then resume from the latest persisted
        // sequence. Relying on native EventSource auto-reconnect skips that
        // recovery step and leaves the visible conversation stale.
        if (handle !== sseHandle) return
        setSseConnected(false)
        handle.close()
      },
      onClose: (_reason) => {
        // Permanent close: re-hydrate then re-open from the hydrated
        // sequence so we avoid a full replay after crashes. See
        // performSseReconnect (audit W2-V10) for the full retry +
        // task-switch race contract.
        if (handle !== sseHandle) return
        setSseConnected(false)
        sseHandle = null
        if (sseRetryTimer) clearTimeout(sseRetryTimer)
        sseRetryTimer = setTimeout(() => {
          sseRetryTimer = null
          void performSseReconnect({
            taskID,
            after,
            currentTaskID: () => boardStore.selectedTaskID,
            hydrate: hydrateTaskConversation,
            restart: startSSE,
            scheduleRetry: (fn, ms) => {
              sseRetryTimer = setTimeout(() => {
                sseRetryTimer = null
                fn()
              }, ms)
            },
            retryDelayMs: RECONNECT_DELAY_MS,
          })
        }, RECONNECT_DELAY_MS)
      },
    },
  )
  sseHandle = handle
}

export function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer)
    sseRetryTimer = null
  }
  const handle = sseHandle
  sseHandle = null
  if (handle) handle.close()
  setSseConnected(false)
  clearEventQueue()
}

// ── Global task-list change stream ──
// One long-lived stream connected to GET /task/events. On every persisted
// task aggregate event the server emits a tiny {type, taskID, sequence}
// notification; we translate that into a debounced loadTasks(). This
// closes the gap where status changes on non-selected tasks (or new
// tasks created by other clients) would otherwise only arrive via
// manual refresh.

let taskListHandle: StreamHandle | null = null
let taskListRetryTimer: any = null
let taskListRefreshTimer: ReturnType<typeof setInterval> | null = null

export const TASK_LIST_REFRESH_INTERVAL_MS = 30_000

function startTaskListRefreshTimer() {
  stopTaskListRefreshTimer()
  taskListRefreshTimer = setInterval(() => {
    void loadTasks().catch((err) => {
      console.error("[task-list-sse] periodic task refresh failed", err)
    })
  }, TASK_LIST_REFRESH_INTERVAL_MS)
}

function stopTaskListRefreshTimer() {
  if (!taskListRefreshTimer) return
  clearInterval(taskListRefreshTimer)
  taskListRefreshTimer = null
}

export function startTaskListSSE() {
  stopTaskListSSE()
  startTaskListRefreshTimer()
  if (!settingsStore.directory.trim()) return
  const transport = getHostTransport()
  const handle = transport.openStream(
    { path: "task/events" },
    {
      onEvent: (data) => {
        // Same split as startSSE above: parse errors silent, dispatch
        // errors surfaced.
        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          return
        }
        if (event.type === "task-list.heartbeat" || event.type === "task-list.connected") return
        try {
          // Task-list stream emits only `{type, taskID, sequence}` — not
          // the full task-scope event shape. Route to the notification
          // handler, NOT handleEventStreamEvent (which feeds tree-writer
          // and would throw on every missing payload).
          handleTaskListNotification(event)
        } catch (err) {
          console.error("[task-list-sse] dispatch error for event", event?.type, err, event)
        }
      },
      onClose: (_reason) => {
        if (handle !== taskListHandle) return
        taskListHandle = null
        if (taskListRetryTimer) clearTimeout(taskListRetryTimer)
        taskListRetryTimer = setTimeout(() => {
          taskListRetryTimer = null
          startTaskListSSE()
        }, 3000)
      },
      onError: () => {
        // Keep the global task-list stream on the same business reconnect
        // contract as the selected-task stream. If the transport surfaces an
        // error without a close, the sidebar refresh stream would otherwise
        // stay pinned to a dead handle and non-selected task changes would
        // only appear after a manual reload.
        if (handle !== taskListHandle) return
        handle.close()
      },
    },
  )
  taskListHandle = handle
}

export function stopTaskListSSE() {
  stopTaskListRefreshTimer()
  if (taskListRetryTimer) {
    clearTimeout(taskListRetryTimer)
    taskListRetryTimer = null
  }
  const handle = taskListHandle
  taskListHandle = null
  if (handle) handle.close()
}
