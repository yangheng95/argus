// ── SSE Event Router & Board/Task Lifecycle ──
// Central dispatch for all incoming SSE events.
// Executor events (run.progress/run.output) are converted to standard
// message events and routed to cardTreeStore — no separate executorStore.

import { boardStore, scheduleBoard, loadTasks, setTaskSequence, activeTaskID } from "../store/board"
import { configRefreshIncludesSettingsData, loadConfigInfo, loadSettingsInfo } from "./init"
import { markSessionConfigStale } from "./config"
import { applyEvent as applyTreeWriterEvent, hasProjectedPart } from "./tree-writer"
import { routeNotification } from "./notify"
import { isBoardInvalidatingEventType, isRouterConsumedNoopEventType } from "./event-policy"
import { markSelectedLiveEventConsumed } from "./selected-stream-cursor"

// Forward SSE events to the tree-writer. The conversation view reads
// `cardTreeStore`; message events stay out of the transcript mirror on the
// visible hot path.
function writeToTree(event: any): void {
  applyTreeWriterEvent(event)
}

function isMessageStreamEvent(type: string): boolean {
  return (
    type === "message.updated" ||
    type === "message.part.updated" ||
    type === "message.part.delta" ||
    type === "message.removed" ||
    type === "message.part.removed"
  )
}

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function currentTaskSessionID(): string {
  const boardSession = boardStore.board?.task?.sessionID
  if (typeof boardSession === "string" && boardSession) return boardSession
  const taskID = activeTaskID()
  if (!taskID) return ""
  const entry = boardStore.tasks.find((item: any) => item?.task?.id === taskID)
  return typeof entry?.task?.sessionID === "string" ? entry.task.sessionID : ""
}

function messageEventSessionID(event: any): string {
  const properties = record(event?.properties) ? event.properties : record(event?.payload) ? event.payload : {}
  if (typeof properties?.info?.sessionID === "string") return properties.info.sessionID
  if (typeof properties?.part?.sessionID === "string") return properties.part.sessionID
  return typeof properties?.sessionID === "string" ? properties.sessionID : ""
}

function shouldRecoverForMessageEvent(event: any): boolean {
  const type = String(event?.type || "").trim()
  if (!isMessageStreamEvent(type)) return false
  if (!activeTaskID()) return false
  if (currentTaskSessionID()) return false
  return !!messageEventSessionID(event)
}

function shouldRecoverSelectedTaskSequenceGap(event: any): boolean {
  const taskID = eventTaskID(event)
  if (!taskID || taskID !== activeTaskID()) return false
  const sequence = eventSequence(event)
  if (sequence <= 0) return false
  const current = boardStore.taskSequence
  return current > 0 && sequence > current + 1
}

function advanceHandledSelectedTaskSequence(event: any): void {
  const taskID = eventTaskID(event)
  if (!taskID || taskID !== activeTaskID()) return
  const sequence = eventSequence(event)
  if (sequence <= 0) return
  const current = boardStore.taskSequence
  // Gap detection runs before a handled event reaches this helper. If we
  // still see a jump here, do not paper over it by moving the cursor.
  if (current > 0 && sequence > current + 1) return
  if (sequence <= current) return
  setTaskSequence(sequence)
}

function markHandledSelectedLiveEvent(event: any): void {
  const taskID = eventTaskID(event)
  if (taskID && taskID !== activeTaskID()) return
  markSelectedLiveEventConsumed(event)
}

function isMessageWriterPrerequisiteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return (
    message.startsWith("message.part.delta: unknown session ") ||
    message.startsWith("message.part.delta: unknown part ") ||
    message.startsWith("message.removed: unknown session ") ||
    message.startsWith("message.removed: unknown message ") ||
    message.startsWith("message.part.removed: unknown session ") ||
    message.startsWith("message.part.removed: unknown part ")
  )
}

function scheduleSelectedTaskRecovery(reason: string, taskID = activeTaskID()): void {
  const selectedTaskID = String(taskID || "")
  if (!selectedTaskID) return
  void import("./selected-task-recovery")
    .then(({ recoverSelectedTaskConversation }) => recoverSelectedTaskConversation(reason, selectedTaskID))
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("[sse] selected-task recovery failed", reason, selectedTaskID, error)
    })
}

function scheduleRewindClearRecovery(reason: string, taskID = activeTaskID()): void {
  const selectedTaskID = String(taskID || "")
  if (!selectedTaskID) return
  void import("./selected-task-recovery")
    .then(({ recoverSelectedTaskAfterRewindClear }) => recoverSelectedTaskAfterRewindClear(reason, selectedTaskID))
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("[sse] rewind clear recovery failed", reason, selectedTaskID, error)
    })
}

/** Parse tool input from various executor formats. */
function parseToolInput(raw: any): Record<string, any> {
  if (record(raw)) return raw
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw)
    } catch {
      return { raw }
    }
  }
  return {}
}

/** Derive a stable message ID for grouping executor events by goal/session. */
function executorMessageID(properties: any): string {
  const payload = record(properties.payload) ? properties.payload : {}
  const goalRunID = properties.goalRunID || properties.goal_run_id || payload.goalRunID || payload.goal_run_id || ""
  const execSessionID =
    properties.executorSessionID ||
    properties.executor_session_id ||
    payload.executorSessionID ||
    payload.executor_session_id ||
    ""
  const runID = properties.runID || payload.runID || ""
  const scope = goalRunID || execSessionID || runID || "default"
  return `executor:msg:${scope}`
}

/** Derive a stable part ID from a tool call's ID. */
function executorPartID(properties: any, eventID: string): string {
  const callID = properties.sourceID || properties.id || properties.payload?.id || eventID
  return `executor:part:${callID}`
}

/** Derive the executor session ID for message info. */
function executorSessionID(properties: any): string {
  const payload = record(properties.payload) ? properties.payload : {}
  return (
    properties.sessionID ||
    properties.session_id ||
    payload.sessionID ||
    payload.session_id ||
    properties.goalSessionID ||
    properties.goal_session_id ||
    payload.goalSessionID ||
    payload.goal_session_id ||
    properties.goalRunSessionID ||
    properties.goal_run_session_id ||
    payload.goalRunSessionID ||
    payload.goal_run_session_id ||
    properties.executorSessionID ||
    properties.executor_session_id ||
    payload.executorSessionID ||
    payload.executor_session_id ||
    properties.goalRunID ||
    properties.goal_run_id ||
    payload.goalRunID ||
    payload.goal_run_id ||
    properties.runID ||
    payload.runID ||
    ""
  )
}

// ── Executor event → message event conversion ──

function convertExecutorEventToMessages(event: any, properties: any): any[] {
  const kind = executorEventKind(properties.type)
  const timestamp = Number(event.timestamp || Date.now())
  const msgID = executorMessageID(properties)
  const sessionID = executorSessionID(properties)
  // Propagate the backend-stamped goalID so tree-writer can nest these
  // synthesized executor messages under their goal card. Without this,
  // external-executor tool_call/tool_result events produce sessions with
  // no goalID and the whole round floats to the top level instead of the
  // goal group.
  const goalID =
    typeof properties.goalID === "string" && properties.goalID
      ? properties.goalID
      : typeof event?.goalID === "string" && event.goalID
        ? event.goalID
        : ""

  // Ensure the message exists with executor agent identity
  const messageEvent = {
    type: "message.updated",
    properties: {
      info: {
        id: msgID,
        sessionID,
        role: "assistant",
        resolvedRole: "executor",
        channel: "executor",
        agent: "executor",
        time: { created: timestamp },
        ...(goalID ? { goalID } : {}),
      },
    },
  }
  const ensureEvents = (partID: string, partEvent: any): any[] =>
    hasProjectedPart(sessionID, partID) ? [] : [messageEvent, partEvent]

  if (kind === "tool_call") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool"
    const input = parseToolInput(
      properties.input ?? properties.arguments ?? properties.args ?? properties.payload?.input,
    )
    const partID = executorPartID(properties, event.event_id)
    const partEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          messageID: msgID,
          sessionID,
          type: "tool",
          tool: name,
          resolvedRole: "executor",
          channel: "executor",
          callID: properties.sourceID || properties.id || properties.payload?.id || partID,
          state: {
            status: "running",
            input,
            title: event.summary || name,
            metadata: {},
            time: { start: timestamp },
          },
        },
      },
    }
    return [messageEvent, partEvent]
  }

  if (kind === "tool_delta") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool"
    const partID = executorPartID(properties, event.event_id)
    const delta =
      typeof properties.delta === "string"
        ? properties.delta
        : typeof properties.payload?.delta === "string"
          ? properties.payload.delta
          : ""
    if (!delta) return []
    const partEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          messageID: msgID,
          sessionID,
          type: "tool",
          tool: name,
          resolvedRole: "executor",
          channel: "executor",
          callID: properties.sourceID || properties.id || properties.payload?.id || partID,
          state: {
            status: "running",
            input: {},
            title: event.summary || name,
            metadata: {},
            time: { start: timestamp },
          },
        },
      },
    }
    return [
      ...ensureEvents(partID, partEvent),
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "raw",
          delta,
        },
      },
    ]
  }

  if (kind === "tool_result") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool"
    const input = parseToolInput(properties.input ?? properties.arguments ?? properties.payload?.input ?? {})
    const output =
      typeof properties.output === "string"
        ? properties.output
        : typeof properties.payload?.output === "string"
          ? properties.payload.output
          : event.summary || ""
    const partID = executorPartID(properties, event.event_id)
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "tool",
            tool: name,
            resolvedRole: "executor",
            channel: "executor",
            callID: properties.sourceID || properties.id || properties.payload?.id || partID,
            state: {
              status: "completed",
              input,
              output,
              title: event.summary || name,
              metadata: {},
              time: { start: timestamp, end: timestamp },
            },
          },
        },
      },
    ]
  }

  if (kind === "message_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || ""
    if (!text) return []
    const partID = `executor:text:${sessionID}`
    const partEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          messageID: msgID,
          sessionID,
          type: "text",
          resolvedRole: "executor",
          channel: "executor",
          text: "",
        },
      },
    }
    return [
      ...ensureEvents(partID, partEvent),
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text,
        },
      },
    ]
  }

  if (kind === "reasoning_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || ""
    if (!text) return []
    const partID = `executor:reasoning:${sessionID}`
    const partEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          messageID: msgID,
          sessionID,
          type: "reasoning",
          resolvedRole: "executor",
          channel: "executor",
          text: "",
        },
      },
    }
    // First event creates the part as "reasoning" type (not "text"), then delta appends.
    // message.part.updated ensures the part exists with correct type before any delta.
    return [
      ...ensureEvents(partID, partEvent),
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text,
        },
      },
    ]
  }

  if (kind === "error") {
    const text = event.summary || properties.message || "Error"
    const partID = `executor:error:${event.event_id || timestamp}`
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: `Error: ${text}`,
          },
        },
      },
    ]
  }

  // Other event types: create a text part with the summary
  if (event.summary) {
    const partID = `executor:status:${event.event_id || timestamp}`
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: event.summary,
          },
        },
      },
    ]
  }

  return []
}

function shouldConvertRunProgress(properties: Record<string, any>): boolean {
  const progressType = String(properties.type || "")
  if (progressType === "protocol.raw" || progressType === "executor.status" || progressType === "executor.progress") {
    return false
  }
  if (
    progressType === "message.part.updated" ||
    progressType === "message.part.delta" ||
    progressType === "message.updated"
  ) {
    return false
  }
  return true
}

export function replayTaskEventToTree(event: any): void {
  const type: string = event?.type || ""
  const properties = record(event?.properties) ? event.properties : record(event?.payload) ? event.payload : {}

  writeToTree(event)

  if (type === "run.progress") {
    if (!shouldConvertRunProgress(properties)) return
    const messages = convertExecutorEventToMessages(event, properties)
    for (const msg of messages) {
      writeToTree(msg)
    }
    return
  }

  if (type === "run.output") {
    const messages = convertExecutorEventToMessages(
      {
        ...event,
        summary: typeof properties.text === "string" ? properties.text : event?.summary || "",
      },
      {
        ...properties,
        type: "text_delta",
        text: typeof properties.text === "string" ? properties.text : event?.summary || "",
      },
    )
    for (const msg of messages) {
      writeToTree(msg)
    }
  }
}

// ── Main router ──

const BOARD_EVENT_DEBOUNCE = 500
const CONFIG_EVENT_DEBOUNCE = 50

let tasksKickTimer: ReturnType<typeof setTimeout> | null = null
let configKickTimer: ReturnType<typeof setTimeout> | null = null

export function __resetEventTimersForTest(): void {
  if (tasksKickTimer) {
    clearTimeout(tasksKickTimer)
    tasksKickTimer = null
  }
  if (configKickTimer) {
    clearTimeout(configKickTimer)
    configKickTimer = null
  }
}

function scheduleConfigReload(): void {
  if (configKickTimer) clearTimeout(configKickTimer)
  configKickTimer = setTimeout(() => {
    configKickTimer = null
    const refresh = configRefreshIncludesSettingsData() ? loadSettingsInfo() : loadConfigInfo()
    void refresh.catch((err: unknown) => {
      console.error("[sse] config.changed refresh failed", err)
    })
  }, CONFIG_EVENT_DEBOUNCE)
}

/**
 * Route a parsed SSE event to the appropriate Solid store or action.
 * @returns true if the event was consumed; false if it should be forwarded to
 * handleEventStreamEvent for board/task lifecycle processing.
 */
export function routeSSEEvent(event: any): boolean {
  const type: string = event.type || ""
  if (shouldRecoverSelectedTaskSequenceGap(event)) {
    const taskID = eventTaskID(event)
    scheduleSelectedTaskRecovery("selected task sequence gap", taskID)
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE)
    return true
  }

  // ── Message stream events → batched queue ──
  if (isMessageStreamEvent(type)) {
    if (shouldRecoverForMessageEvent(event)) {
      scheduleSelectedTaskRecovery(`message writer prerequisites missing: ${type}`)
      return true
    }
    // Write only after the prerequisite check. If the message graph cannot
    // attach this event, selected-task recovery reopens the live stream with
    // the current persisted/live cursors; it must not clear cardTreeStore.
    try {
      writeToTree(event)
    } catch (error) {
      if (!isMessageWriterPrerequisiteError(error)) throw error
      scheduleSelectedTaskRecovery(`message writer prerequisites missing: ${type}`)
      return true
    }
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  if (type === "session.updated") {
    const properties = record(event?.properties) ? event.properties : record(event?.payload) ? event.payload : {}
    const sessionID = String(properties?.info?.id || properties?.sessionID || properties?.session_id || "")
    if (sessionID) markSessionConfigStale(sessionID)
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  if (type === "task.live_replay_expired") {
    markHandledSelectedLiveEvent(event)
    return true
  }

  if (type === "task.messages.changed") {
    const taskID = eventTaskID(event) || activeTaskID() || ""
    if (taskID && taskID === activeTaskID()) {
      void import("./conversation")
        .then(({ scheduleLatestConversationTailMerge }) => scheduleLatestConversationTailMerge(taskID))
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          console.error("[sse] task.messages.changed scheduling failed", error)
        })
    }
    markHandledSelectedLiveEvent(event)
    return true
  }

  // Project the event into cardTreeStore before router-specific side effects so
  // a writer crash surfaces with the original event context intact.
  writeToTree(event)

  // Replay buffer expiry is loud. Do not full-refresh the loaded transcript:
  // that clears cardTreeStore and causes the observed scroll jump.
  if (type === "task.replay_expired") {
    const taskID: string = activeTaskID() || ""
    if (taskID) scheduleSelectedTaskRecovery("task.replay_expired", taskID)
    markHandledSelectedLiveEvent(event)
    return true
  }

  // ── Task rewound → incremental prune of the card tree ──
  // Backend emitted Event.TaskRewound after a rewindTask call. We prune
  // the tail of the timeline locally (card-tree store) without a full
  // refresh — the full-refresh path was the "user message → overlay
  // 卡顿" symptom, and the server has already filtered its describe
  // outputs to `time_created <= cursorTime`.
  if (type === "task.rewound") {
    const properties = record(event?.properties) ? event.properties : {}
    const evtTaskID: string | undefined = typeof properties.taskID === "string" ? properties.taskID : undefined
    const cursorTime: number | undefined = typeof properties.cursorTime === "number" ? properties.cursorTime : undefined
    const resetWorktree = properties.resetWorktree === true
    if (!evtTaskID || cursorTime === undefined) return true
    // Only prune when the event concerns the currently-selected task —
    // other tasks' card trees are not loaded in this overlay instance.
    if (evtTaskID === activeTaskID() && cursorTime > 0) {
      // Idempotent — duplicate task.rewound events keep the same cursor.
      void (async () => {
        const { pruneCardsAfterCursor } = await import("../store/card-tree")
        pruneCardsAfterCursor(cursorTime)
        if (resetWorktree) scheduleBoard(0)
      })()
      advanceHandledSelectedTaskSequence(event)
    } else if (evtTaskID === activeTaskID() && cursorTime === 0) {
      scheduleRewindClearRecovery("task rewind cleared", evtTaskID)
    }
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  const properties = record(event?.properties) ? event.properties : record(event?.payload) ? event.payload : {}

  // ── Executor progress / output events → convert to standard messages ──
  if (type === "run.progress") {
    if (!shouldConvertRunProgress(properties)) {
      scheduleBoard(BOARD_EVENT_DEBOUNCE)
      advanceHandledSelectedTaskSequence(event)
      markHandledSelectedLiveEvent(event)
      return true
    }

    // Convert executor events (Codex/Claude-Code CodingEventInfo) to standard messages
    const messages = convertExecutorEventToMessages(event, properties)
    for (const msg of messages) {
      writeToTree(msg)
    }
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  if (type === "run.output") {
    // Text output from executor — convert to message delta
    const messages = convertExecutorEventToMessages(event, {
      ...properties,
      type: "text_delta",
      text: typeof properties.text === "string" ? properties.text : event.summary || "",
    })
    for (const msg of messages) {
      writeToTree(msg)
    }
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  // ── Config changed → refresh appStore.config ──
  if (type === "config.changed") {
    markSessionConfigStale()
    scheduleConfigReload()
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  // Explicitly consumed protocol events that do not project into either
  // messageStore or cardTreeStore. tree-writer whitelists them as no-ops so
  // they remain auditable and don't surface as unknown-event crashes.
  if (isRouterConsumedNoopEventType(type)) {
    advanceHandledSelectedTaskSequence(event)
    markHandledSelectedLiveEvent(event)
    return true
  }

  // ── Board-invalidating events → forwarded to handleEventStreamEvent
  if (isBoardInvalidatingEventType(type)) return false

  return false
}

// ── executorEventKind ──

function executorEventKind(progressType: string | undefined): string {
  const t = String(progressType || "")
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, "_")
  if (!t) return "event"
  if (t === "message_delta" || t === "text_delta") return "message_delta"
  if (t === "reasoning_delta") return t
  if (t === "tool_call" || t === "tool_delta" || t === "tool_result") return t
  if (t.includes("tool")) return t.includes("result") ? "tool_result" : "tool_call"
  if (t.includes("reason")) return "reasoning_delta"
  if (t.includes("error")) return "error"
  if (t.includes("done") || t.includes("completed")) return "done"
  if (t.includes("approval") || t === "permission.asked") return "approval_request"
  if (t.includes("command")) return "command"
  return "event"
}

// ── Board / Task Lifecycle Event Handling ──

function normalizedEventType(event: any): string {
  const raw = String(event?.type || "").trim()
  return raw
}

function eventTaskID(event: any): string {
  return String(
    event?.taskID ||
      event?.task_id ||
      event?.properties?.taskID ||
      event?.properties?.task_id ||
      event?.payload?.taskID ||
      event?.payload?.task_id ||
      "",
  )
}

function eventSequence(event: any): number {
  const value = Number(event?.sequence)
  return Number.isFinite(value) ? value : 0
}

function boardInvalidatingEvent(type: string): boolean {
  return isBoardInvalidatingEventType(type)
}

function shouldRefreshSelectedBoard(type: string): boolean {
  if (type.startsWith("message.")) return false
  if (type === "run.progress" || type === "run.output") return false
  if (type === "session.status") return false
  return boardInvalidatingEvent(type) || type === "task.message"
}

function scheduleTasksCompat(delay = 0): void {
  if (tasksKickTimer) clearTimeout(tasksKickTimer)
  tasksKickTimer = setTimeout(() => {
    tasksKickTimer = null
    void loadTasks()
  }, delay)
}

export function handleEventStreamEvent(event: any): void {
  const type = normalizedEventType(event)
  // tree-writer projection has already happened upstream in
  // `routeSSEEvent` (unconditional `writeToTree(event)` before its
  // early returns). This function now only owns the board / task-sequence
  // refresh path; tree projection is single-sourced through routeSSEEvent.
  if (type.startsWith("message.")) {
    if (shouldRecoverForMessageEvent({ ...event, type })) {
      scheduleSelectedTaskRecovery(`message writer prerequisites missing: ${type}`)
      return
    }
    return
  }
  if (type === "task.replay_expired") {
    if (activeTaskID()) {
      scheduleSelectedTaskRecovery("task.replay_expired", activeTaskID())
    }
    return
  }
  const taskID = eventTaskID(event)
  const sequence = eventSequence(event)
  if (taskID && taskID === activeTaskID() && sequence > 0) {
    const current = boardStore.taskSequence
    if (current > 0 && sequence <= current) return
    if (current > 0 && sequence > current + 1) {
      scheduleSelectedTaskRecovery("selected task sequence gap", taskID)
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE)
      // Do not advance taskSequence across a gap. The selected conversation
      // stream missed persisted events; only full selected-task recovery can
      // rebuild cardTreeStore and compute the next safe resume cursor.
      return
    }
    setTaskSequence(sequence)
  }
  if (boardInvalidatingEvent(type)) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE)
  }
  if (taskID && taskID === activeTaskID() && shouldRefreshSelectedBoard(type)) {
    scheduleBoard(BOARD_EVENT_DEBOUNCE)
  }
  markHandledSelectedLiveEvent(event)
}

/**
 * Handler for the GLOBAL task-list SSE stream (`GET /task/events`).
 *
 * Server contract (see server/routes/orchestrator.ts): this stream emits a
 * pure change-notification shape — `{type, taskID, sequence, notify?}` —
 * with NO payload / properties. It is meant to tell the sidebar "some task
 * changed, refetch the list"; it is NOT the per-task message stream.
 *
 * The previous implementation routed these notifications through
 * `handleEventStreamEvent`, which feeds events into `writeToTree` →
 * tree-writer. tree-writer correctly throws for missing partID/info/part,
 * producing one throw per stream notification. Under active benchmarks
 * the task-list stream emits `message.part.delta` at full SSE cadence,
 * which flooded the console and made the browser miss render deadlines
 * (observed as `Overlay did not render streamed task output within 120s`
 * in the overlay-web-benchmark).
 *
 * Route them correctly here instead:
 *   - `message.*` notifications → only mean "that task changed"; update
 *     sidebar task freshness without reloading the selected board.
 *   - task lifecycle events → same refresh path.
 *   - sequence tracking mirrors handleEventStreamEvent's rules.
 *
 * tree-writer is reserved for task-scope events that carry full payload
 * (delivered via `routeSSEEvent` on the per-task stream).
 */
export function handleTaskListNotification(event: any): void {
  const type = normalizedEventType(event)
  routeNotification({ ...event, type })
  if (type === "task.replay_expired") {
    if (activeTaskID()) {
      scheduleSelectedTaskRecovery("task.replay_expired", activeTaskID())
    }
    return
  }
  const taskID = eventTaskID(event)
  const sequence = eventSequence(event)
  if (taskID && taskID === activeTaskID() && sequence > 0) {
    const current = boardStore.taskSequence
    if (current > 0 && sequence > current + 1) {
      scheduleSelectedTaskRecovery("task-list selected task sequence gap", taskID)
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE)
      return
    }
  }
  if (taskID) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE)
  }
  if (taskID && taskID === activeTaskID() && shouldRefreshSelectedBoard(type)) {
    scheduleBoard(BOARD_EVENT_DEBOUNCE)
  }
}
