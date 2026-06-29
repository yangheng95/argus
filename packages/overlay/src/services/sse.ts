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
import { recomputeBadgeFromTasks, formatErrorDetails } from "./notify"
import { getHostTransport, type StreamHandle } from "./host-transport"
import {
  recordConversationRecoveryAborted,
  recordConversationRecoveryFailed,
  recordConversationRecoveryStarted,
  recordConversationRecoverySucceeded,
} from "./refresh-diagnostics"
import { settingsStore } from "../store/settings"
import { createVisibilityInterval, type VisibilityInterval } from "../utils/visibility-interval"
import {
  conversationSourceDirectory,
  mergeLatestConversationTail,
  registerConversationSourceDirectory,
} from "./conversation"
import { resetSelectedLiveCursor, selectedLiveReplayQuery } from "./selected-stream-cursor"
import { AppLog } from "../utils/log"
import {
  pauseSelectedTaskSseActivity,
  recordSelectedTaskSseEventActivity,
  selectedTaskSseLifecycleStatus,
  taskRuntimeActivityKey,
} from "./task-runtime-activity"

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
  directory: string
  after: number
  currentTaskID: () => string
  resumeAfter: () => number
  restart: (source: BoardSource, after: number, options?: SseStartOptions) => void
  scheduleRetry: (fn: () => void, ms: number) => void
  retryDelayMs: number
  replayLive?: boolean
  beforeRestart?: (taskID: string, sequence: number) => void | Promise<void>
  afterRestart?: (taskID: string, sequence: number) => void | Promise<void>
}

export interface SseStartOptions {
  replayLive?: boolean
  directory?: string
}

function ssePayloadSample(data: string): string {
  return String(data || "").slice(0, 500)
}

const SSE_DISPATCH_EVENT_SAMPLE_LIMIT = 12_000
const SSE_DISPATCH_ERROR_DETAIL_LIMIT = 4_000
const SSE_DISPATCH_PAYLOAD_KEY_LIMIT = 80

function boundedString(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`
}

function jsonSample(value: unknown, limit: number): string {
  try {
    return boundedString(JSON.stringify(value, null, 2), limit)
  } catch {
    return boundedString(String(value), limit)
  }
}

function boundedErrorDetails(error: unknown): string {
  return boundedString(formatErrorDetails(error), SSE_DISPATCH_ERROR_DETAIL_LIMIT)
}

function payloadKeyDiagnostic(properties: Record<string, any>): Record<string, unknown> {
  const keys = Object.keys(properties).sort()
  return {
    keys: keys.slice(0, SSE_DISPATCH_PAYLOAD_KEY_LIMIT),
    total: keys.length,
    truncated: Math.max(0, keys.length - SSE_DISPATCH_PAYLOAD_KEY_LIMIT),
  }
}

function eventProperties(event: any): Record<string, any> {
  const properties = event?.properties
  if (properties && typeof properties === "object" && !Array.isArray(properties)) return properties
  const payload = event?.payload
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload
  return {}
}

function selectedTaskRuntimeKey(taskID: string): string {
  const boardTask = boardStore.board?.task
  if (!taskID || boardTask?.id !== taskID) return ""
  return taskRuntimeActivityKey({ taskID, createdAt: Number(boardTask?.time?.created) })
}

function recordSelectedTaskSseUpdate(event: any, taskID: string): void {
  const task = boardStore.board?.task
  const lifecycleStatus = selectedTaskSseLifecycleStatus(event)
  recordSelectedTaskSseEventActivity({
    event,
    task,
    taskID,
    active: task?.status === "active" || lifecycleStatus === "active",
  })
  const key = selectedTaskRuntimeKey(taskID)
  if (lifecycleStatus && lifecycleStatus !== "active") {
    pauseSelectedTaskSseActivity(key)
  }
}

function pauseSelectedTaskSseStreamActivity(taskID: string): void {
  const key = selectedTaskRuntimeKey(taskID)
  if (!key) return
  pauseSelectedTaskSseActivity(key)
}

function dispatchEventDiagnostic(event: any): Record<string, unknown> {
  const properties = eventProperties(event)
  const info = properties.info && typeof properties.info === "object" ? properties.info : undefined
  const part = properties.part && typeof properties.part === "object" ? properties.part : undefined
  return {
    eventID: event?.event_id || event?.eventID || "",
    taskID: event?.task_id || event?.taskID || properties.taskID || properties.task_id || "",
    type: event?.type || "",
    orderKey: event?.orderKey || properties.orderKey || "",
    messageID: info?.id || part?.messageID || properties.messageID || "",
    sessionID: info?.sessionID || part?.sessionID || properties.sessionID || "",
    partID: part?.id || properties.partID || "",
    sequence: event?.sequence ?? "",
    liveSequence: event?.live_sequence ?? "",
    liveEpoch: event?.live_epoch ?? "",
    emittedAt: event?.emittedAt || event?.emitted_at || "",
    timestamp: event?.timestamp || "",
    payloadKeys: payloadKeyDiagnostic(properties),
    eventSample: jsonSample(event, SSE_DISPATCH_EVENT_SAMPLE_LIMIT),
  }
}

function dispatchNotificationDetails(errorDetails: string, event: any): string {
  return boundedString(
    `${errorDetails}\n\nevent diagnostic:\n${jsonSample(dispatchEventDiagnostic(event), SSE_DISPATCH_EVENT_SAMPLE_LIMIT)}`,
    SSE_DISPATCH_EVENT_SAMPLE_LIMIT + SSE_DISPATCH_ERROR_DETAIL_LIMIT,
  )
}

function logMalformedSsePayload(input: {
  stream: "selected-task" | "task-list"
  data: string
  error: unknown
  taskID?: string
  directory?: string
}): void {
  const where = input.stream === "selected-task" ? `task ${input.taskID || "<unknown>"}` : "task list"
  AppLog.error("sse", `malformed ${input.stream} SSE payload`, {
    stream: input.stream,
    taskID: input.taskID,
    directory: input.directory,
    error: boundedErrorDetails(input.error),
    payloadSample: ssePayloadSample(input.data),
    notificationID: `sse:parse-error:${input.stream}:${input.taskID || input.directory || "global"}`,
    notificationTitle: "Malformed live event",
    notificationMessage: `OpenCorvus received a malformed SSE payload for ${where}.`,
    notificationDetails: boundedString(
      `${boundedErrorDetails(input.error)}\n\npayload sample:\n${ssePayloadSample(input.data)}`,
      SSE_DISPATCH_ERROR_DETAIL_LIMIT + 600,
    ),
  })
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
    const directory = deps.directory.trim()
    if (!directory) throw new Error("SSE reconnect requires a project directory")
    await deps.beforeRestart?.(deps.taskID, nextSequence)
    if (deps.currentTaskID() !== deps.taskID) {
      throw new DOMException("task changed before restart", "AbortError")
    }
    deps.restart(
      { kind: "task", id: deps.taskID },
      nextSequence,
      deps.replayLive === false ? { replayLive: false, directory } : { directory },
    )
    await deps.afterRestart?.(deps.taskID, nextSequence)
  } catch (err) {
    recordConversationRecoveryFailed({
      channel: "sse-reconnect",
      reason: "sse stream reconnect",
      taskID: deps.taskID,
      source: "sse-reconnect",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err || ""),
    })
    // Persistent toast (id'd per task) keeps the operator aware that the
    // live stream is currently broken even after we schedule a retry.
    // Re-firing with the same id collapses repeated retries into one row.
    AppLog.error("sse", `reconnect restart failed for task ${deps.taskID}`, {
      taskID: deps.taskID,
      retryDelayMs: deps.retryDelayMs,
      error: formatErrorDetails(err),
      notificationID: `sse:reconnect-failed:${deps.taskID}`,
      notificationTitle: "Live stream disconnected",
      notificationMessage: `Failed to reopen the SSE stream for task ${deps.taskID}. Retrying in ${Math.round(deps.retryDelayMs / 1000)}s.`,
      notificationDetails: formatErrorDetails(err),
    })
    if (deps.currentTaskID() !== deps.taskID) return
    deps.scheduleRetry(() => {
      if (deps.currentTaskID() !== deps.taskID) return
      observeSseReconnect("scheduled-retry", performSseReconnect(deps))
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

function observeSseReconnect(owner: string, promise: Promise<void>): void {
  void promise.catch((error) => {
    AppLog.error("sse", `unhandled reconnect owner failure: ${owner}`, {
      error: formatErrorDetails(error),
      notificationID: `sse:reconnect-owner:${owner}`,
      notificationTitle: "Live stream reconnect failed",
      notificationMessage: error instanceof Error ? error.message : String(error),
      notificationDetails: formatErrorDetails(error),
    })
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
  const directory = options.directory?.trim()
    ? registerConversationSourceDirectory(source, options.directory)
    : conversationSourceDirectory(source)

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
    pauseSelectedTaskSseStreamActivity(taskID)
    setSseConnected(false)
    sseHandle = null
    sseTaskID = ""
    sseSource = null
    if (source.kind !== "task") return
    if (sseRetryTimer) clearTimeout(sseRetryTimer)
    sseRetryTimer = setTimeout(() => {
      sseRetryTimer = null
      observeSseReconnect(
        "stream-close",
        performSseReconnect({
          taskID: source.id,
          directory,
          after,
          currentTaskID: () => activeTaskID(),
          resumeAfter: () => boardStore.taskSequence,
          restart: startSSE,
          replayLive: liveReplayExpiredClose ? false : replayLive,
          beforeRestart: liveReplayExpiredClose
            ? (restartedTaskID) => mergeLatestConversationTail(restartedTaskID, { directory })
            : undefined,
          scheduleRetry: (fn, ms) => {
            sseRetryTimer = setTimeout(() => {
              sseRetryTimer = null
              fn()
            }, ms)
          },
          retryDelayMs: RECONNECT_DELAY_MS,
        }),
      )
    }, RECONNECT_DELAY_MS)
  }
  const handle = transport.openStream(
    {
      path: `${source.kind}/${encodeURIComponent(source.id)}/events`,
      query: {
        directory,
        ...(source.kind === "task" && after > 0 ? { after: String(after) } : {}),
        ...(source.kind === "task" ? selectedLiveReplayQuery({ include: replayLive }) : {}),
      },
    },
    {
      onOpen: () => {
        if (handle !== sseHandle) return
        setSseConnected(true)
        armWatchdog(handle)
      },
      onEvent: (data) => {
        if (handle !== sseHandle) return
        armWatchdog(handle)
        // Per 07-panel-reactivity.md constraint 1 and root CLAUDE.md rule 1:
        // tree-writer's `let it crash` is meaningless if onEvent silently
        // swallows malformed input or dispatch failures. Both paths surface
        // through AppLog so the operator can diagnose an empty panel.
        let event: any
        try {
          event = JSON.parse(data)
        } catch (error) {
          logMalformedSsePayload({ stream: "selected-task", taskID, directory, data, error })
          return
        }
        if (event.type === "task.heartbeat" || event.type === "task.connected") return
        if (event.type === "session.heartbeat" || event.type === "session.connected") return
        recordSelectedTaskSseUpdate(event, taskID)
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
          const diagnostic = dispatchEventDiagnostic(event)
          const errorDetails = boundedErrorDetails(err)
          AppLog.error("sse", `dispatch error for event ${event?.type || "<unknown>"}`, {
            taskID,
            eventType: event?.type || "<unknown>",
            error: errorDetails,
            event: diagnostic,
            notificationID: `sse:dispatch-error:${taskID}`,
            notificationTitle: "Conversation event failed to render",
            notificationMessage: `Event type ${event?.type || "<unknown>"} threw while updating the conversation panel.`,
            notificationDetails: dispatchNotificationDetails(errorDetails, event),
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
  const taskID = sseTaskID
  pauseSelectedTaskSseStreamActivity(taskID)
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

function taskListDirectory(): string {
  return (settingsStore.directory || "").trim()
}

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
  const directory = taskListDirectory()
  if (!directory) return
  const transport = getHostTransport()
  const handle = transport.openStream(
    { path: "task/events", query: { directory } },
    {
      onOpen: () => {
        recomputeBadgeFromTasks()
      },
      onEvent: (data) => {
        // Same split as startSSE above: parse errors and dispatch errors
        // are both surfaced.
        let event: any
        try {
          event = JSON.parse(data)
        } catch (error) {
          logMalformedSsePayload({ stream: "task-list", directory, data, error })
          return
        }
        if (event.type === "task-list.heartbeat" || event.type === "task-list.connected") return
        try {
          // Task-list stream emits only `{type, taskID, sequence, notify?}` — not
          // the full task-scope event shape. Route to the notification
          // handler, NOT handleEventStreamEvent (which feeds tree-writer
          // and would throw on every missing payload).
          handleTaskListNotification(event, { directory })
        } catch (err) {
          const diagnostic = dispatchEventDiagnostic(event)
          const errorDetails = boundedErrorDetails(err)
          AppLog.error("sse", `task-list dispatch error for event ${event?.type || "<unknown>"}`, {
            eventType: event?.type || "<unknown>",
            error: errorDetails,
            event: diagnostic,
            notificationID: "task-list-sse:dispatch-error",
            notificationTitle: "Task list event failed to render",
            notificationMessage: `Event type ${event?.type || "<unknown>"} threw while updating the task list.`,
            notificationDetails: dispatchNotificationDetails(errorDetails, event),
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
