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
// the business reconnect policy: reopen from the last consumed persisted
// sequence without full-hydrating the already mounted conversation.

import { clearEventQueue, messageStore, setSseConnected } from "../store/messages"
import { boardStore, loadTasks, activeTaskID, type BoardSource } from "../store/board"
import { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } from "./events"
import { recomputeBadgeFromTasks, notifyError, formatErrorDetails } from "./notify"
import { getHostTransport, type StreamHandle } from "./host-transport"
import {
  recordConversationRecoveryAborted,
  recordConversationRecoveryFailed,
  recordConversationRecoveryStarted,
  recordConversationRecoverySucceeded,
} from "./refresh-diagnostics"
import { settingsStore } from "../store/settings"
import { createVisibilityInterval, type VisibilityInterval } from "../utils/visibility-interval"
import { mergeLatestConversationTail } from "./conversation"
import { resetSelectedLiveCursor, selectedLiveReplayQuery } from "./selected-stream-cursor"

let sseHandle: StreamHandle | null = null
let sseRetryTimer: any = null
let sseWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let sseTaskID = ""
let sseSource: BoardSource | null = null

// audit-2026-04-29 W2-V10 — reconnect tick extracted so the regression
// test can exercise restart failures and task-switch races directly, without
// standing up the real HostTransport + 3 s timers. Production path: onClose
// sets a 3 s timer that calls this with the live deps below.
export interface SseReconnectDeps {
  taskID: string
  after: number
  currentTaskID: () => string
  resumeAfter: () => number
  restart: (source: BoardSource, after: number, options?: SseStartOptions) => void
  scheduleRetry: (fn: () => void, ms: number) => void
  retryDelayMs: number
  replayLive?: boolean
  afterRestart?: (taskID: string, sequence: number) => void
}

export interface SseStartOptions {
  replayLive?: boolean
}

export async function performSseReconnect(deps: SseReconnectDeps): Promise<void> {
  if (deps.currentTaskID() !== deps.taskID) return
  const startedAt = Date.now()
  recordConversationRecoveryStarted({
    channel: "sse-reconnect",
    reason: "sse stream reconnect",
    taskID: deps.taskID,
    source: "sse-reconnect",
  })
  const nextSequence = Math.max(0, Math.floor(Number(deps.resumeAfter()) || 0))
  if (deps.currentTaskID() !== deps.taskID) {
    recordConversationRecoveryAborted({
      channel: "sse-reconnect",
      reason: "sse stream reconnect",
      taskID: deps.taskID,
      source: "sse-reconnect",
      durationMs: Date.now() - startedAt,
      error: "task changed before restart",
    })
    return
  }
  try {
    deps.restart(
      { kind: "task", id: deps.taskID },
      nextSequence,
      deps.replayLive === false ? { replayLive: false } : undefined,
    )
    deps.afterRestart?.(deps.taskID, nextSequence)
  } catch (err) {
    recordConversationRecoveryFailed({
      channel: "sse-reconnect",
      reason: "sse stream reconnect",
      taskID: deps.taskID,
      source: "sse-reconnect",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err || ""),
    })
    console.error("[sse] reconnect restart failed for task", deps.taskID, err)
    // Persistent toast (id'd per task) keeps the operator aware that the
    // live stream is currently broken even after we schedule a retry.
    // Re-firing with the same id collapses repeated retries into one row.
    notifyError({
      id: `sse:reconnect-failed:${deps.taskID}`,
      title: "Live stream disconnected",
      message: `Failed to reopen the SSE stream for task ${deps.taskID}. Retrying in ${Math.round(deps.retryDelayMs / 1000)}s.`,
      details: formatErrorDetails(err),
      taskID: deps.taskID,
    })
    if (deps.currentTaskID() !== deps.taskID) return
    deps.scheduleRetry(() => {
      if (deps.currentTaskID() !== deps.taskID) return
      void performSseReconnect(deps)
    }, deps.retryDelayMs)
    return
  }
  recordConversationRecoverySucceeded({
    channel: "sse-reconnect",
    reason: "sse stream reconnect",
    taskID: deps.taskID,
    source: "sse-reconnect",
    durationMs: Date.now() - startedAt,
    resumeSequence: nextSequence,
  })
}

const RECONNECT_DELAY_MS = 3000
export const SELECTED_TASK_STREAM_STALL_MS = 35_000

function clearSelectedStreamWatchdog(): void {
  if (!sseWatchdogTimer) return
  clearTimeout(sseWatchdogTimer)
  sseWatchdogTimer = null
}

export function isSelectedTaskSSEConnected(taskID: string): boolean {
  return !!taskID && sseTaskID === taskID && sseHandle !== null && messageStore.sseConnected
}

export function startSSE(source: BoardSource, after = 0, options: SseStartOptions = {}) {
  stopSSE()
  setSseConnected(false)
  sseSource = source
  const taskID = source.kind === "task" ? source.id : ""
  sseTaskID = taskID
  const replayLive = options.replayLive !== false

  // Initial task restore now hydrates board + messages + persisted task events
  // through /task/:id/conversation before opening SSE. That means this stream
  // can safely resume from the last persisted protocol_event sequence instead
  // of replaying from zero on every reconnect.
  const transport = getHostTransport()
  let liveReplayExpiredClose = false
  const armWatchdog = (handle: StreamHandle) => {
    clearSelectedStreamWatchdog()
    sseWatchdogTimer = setTimeout(() => {
      if (handle !== sseHandle) return
      console.warn("[sse] selected task stream stalled; reconnecting", { taskID })
      setSseConnected(false)
      handle.close()
      if (handle === sseHandle) handleClosed("watchdog-stalled")
    }, SELECTED_TASK_STREAM_STALL_MS)
    if (typeof (sseWatchdogTimer as { unref?: () => void }).unref === "function") {
      ;(sseWatchdogTimer as { unref?: () => void }).unref!()
    }
  }
  const handleClosed = (_reason: string) => {
    // Permanent close: re-open from the current selected task sequence.
    // Same-task full hydrate is intentionally forbidden here because it
    // clears cardTreeStore and produces the visible scroll jump.
    if (handle !== sseHandle) return
    clearSelectedStreamWatchdog()
    setSseConnected(false)
    sseHandle = null
    sseTaskID = ""
    sseSource = null
    if (source.kind !== "task") return
    if (sseRetryTimer) clearTimeout(sseRetryTimer)
    sseRetryTimer = setTimeout(() => {
      sseRetryTimer = null
      void performSseReconnect({
        taskID: source.id,
        after,
        currentTaskID: () => activeTaskID(),
        resumeAfter: () => boardStore.taskSequence,
        restart: startSSE,
        replayLive: liveReplayExpiredClose ? false : replayLive,
        afterRestart: liveReplayExpiredClose
          ? (restartedTaskID) => {
              void mergeLatestConversationTail(restartedTaskID).catch((error) => {
                if (error instanceof DOMException && error.name === "AbortError") return
                console.error("[sse] live replay gap tail merge failed", error)
              })
            }
          : undefined,
        scheduleRetry: (fn, ms) => {
          sseRetryTimer = setTimeout(() => {
            sseRetryTimer = null
            fn()
          }, ms)
        },
        retryDelayMs: RECONNECT_DELAY_MS,
      })
    }, RECONNECT_DELAY_MS)
  }
  const handle = transport.openStream(
    {
      path: `${source.kind}/${encodeURIComponent(source.id)}/events`,
      query: {
        ...(source.kind === "task" && after > 0 ? { after: String(after) } : {}),
        ...(source.kind === "task" ? selectedLiveReplayQuery({ include: replayLive }) : {}),
      },
    },
    {
      onOpen: () => {
        setSseConnected(true)
        armWatchdog(handle)
      },
      onEvent: (data) => {
        armWatchdog(handle)
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
        if (event.type === "session.heartbeat" || event.type === "session.connected") return
        if (event.type === "task.live_replay_expired") {
          liveReplayExpiredClose = true
          resetSelectedLiveCursor()
        }
        try {
          const handled = routeSSEEvent(event)
          if (!handled) {
            handleEventStreamEvent(event)
          }
        } catch (err) {
          console.error("[sse] dispatch error for event", event?.type, err, event)
          notifyError({
            id: `sse:dispatch-error:${taskID}`,
            title: "Conversation event failed to render",
            message: `Event type ${event?.type || "<unknown>"} threw while updating the conversation panel.`,
            details: `${formatErrorDetails(err)}\n\nevent payload:\n${(() => {
              try {
                return JSON.stringify(event, null, 2)
              } catch {
                return String(event)
              }
            })()}`,
            taskID,
          })
        }
      },
      onError: () => {
        // SSE (Server-Sent Events) errors can happen after the browser
        // transport has already dropped live-only message deltas. Close the
        // handle so onClose runs the business reconnect policy: reopen from
        // the current persisted sequence without clearing the mounted
        // conversation.
        if (handle !== sseHandle) return
        setSseConnected(false)
        handle.close()
      },
      onClose: (_reason) => {
        handleClosed(_reason)
      },
    },
  )
  sseHandle = handle
  armWatchdog(handle)
}

export function stopSSE() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer)
    sseRetryTimer = null
  }
  clearSelectedStreamWatchdog()
  const handle = sseHandle
  sseHandle = null
  sseTaskID = ""
  sseSource = null
  if (handle) handle.close()
  setSseConnected(false)
  clearEventQueue()
}

// ── Global task-list change stream ──
// One long-lived stream connected to GET /task/events. On every persisted
// task aggregate event the server emits a tiny {type, taskID, sequence,
// notify?} notification; we translate that into a debounced loadTasks(). This
// closes the gap where status changes on non-selected tasks (or new
// tasks created by other clients) would otherwise only arrive via
// manual refresh.

let taskListHandle: StreamHandle | null = null
let taskListRetryTimer: any = null
let taskListRefreshTimer: VisibilityInterval | null = null

export const TASK_LIST_REFRESH_INTERVAL_MS = 30_000

function startTaskListRefreshTimer() {
  stopTaskListRefreshTimer()
  taskListRefreshTimer = createVisibilityInterval(() => {
    void loadTasks().catch((err) => {
      console.error("[task-list-sse] periodic task refresh failed", err)
    })
  }, TASK_LIST_REFRESH_INTERVAL_MS)
  taskListRefreshTimer.start()
}

function stopTaskListRefreshTimer() {
  if (!taskListRefreshTimer) return
  taskListRefreshTimer.dispose()
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
      onOpen: () => {
        recomputeBadgeFromTasks()
      },
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
          // Task-list stream emits only `{type, taskID, sequence, notify?}` — not
          // the full task-scope event shape. Route to the notification
          // handler, NOT handleEventStreamEvent (which feeds tree-writer
          // and would throw on every missing payload).
          handleTaskListNotification(event)
        } catch (err) {
          console.error("[task-list-sse] dispatch error for event", event?.type, err, event)
          notifyError({
            id: "task-list-sse:dispatch-error",
            title: "Task list event failed to render",
            message: `Event type ${event?.type || "<unknown>"} threw while updating the task list.`,
            details: `${formatErrorDetails(err)}\n\nevent payload:\n${(() => {
              try {
                return JSON.stringify(event, null, 2)
              } catch {
                return String(event)
              }
            })()}`,
          })
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
