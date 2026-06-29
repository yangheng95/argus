import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
import {
  stampTestBoard,
  stampTestEvent,
  stampTestTranscript,
  stampTestViewMessages,
  stampTestViewSessions,
  testEventOrderKey,
  testMessageOrderKey,
  testPartOrderKey,
  testSessionOrderKey,
} from "./fixtures/timeline-order"

const { boardStore, setBoardStore } = await import("../src/store/board")
const { cardTreeStore, pruneCardsAfterCursor } = await import("../src/store/card-tree")
const { recoverSelectedTaskAfterRewindClear, recoverSelectedTaskConversation } = await import(
  "../src/services/selected-task-recovery"
)
const { routeSSEEvent, handleEventStreamEvent, __resetEventTimersForTest } = await import("../src/services/events")
const { isSelectedTaskSSEConnected, startSSE, stopSSE } = await import("../src/services/sse")
const { __setHostTransportForTest } = await import("../src/services/host-transport")
const { resetWriter } = await import("../src/services/tree-writer")
const { markSelectedMessageWatermark, resetSelectedLiveCursor } = await import("../src/services/selected-stream-cursor")
const { registerConversationSourceDirectory } = await import("../src/services/conversation")
const { conversationAgentStore, resetConversationAgentView } = await import("../src/store/conversation-agents")
const { setLocaleData } = await import("../src/utils/i18n")
const { AppLog } = await import("../src/utils/log")
const { clearNotifications, notificationStore } = await import("../src/services/notify")
const { __resetConversationRecoveryDiagnosticsSinkForTest, __setConversationRecoveryDiagnosticsSinkForTest } =
  await import("../src/services/refresh-diagnostics")

setLocaleData("en-US", JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")))

const TEST_DIRECTORY = "D:/selected-task-recovery"

function registerTaskDirectory(taskID: string): void {
  registerConversationSourceDirectory({ kind: "task", id: taskID }, TEST_DIRECTORY)
}

function fakeTransport(opts: {
  request: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>
  streams?: StreamOpenRequest[]
  handlers?: { current?: StreamHandlers }
  closeCalls?: { count: number }
}): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return opts.request(req) as Promise<TransportResponse<T>> | TransportResponse<T>
    },
    openStream(input: StreamOpenRequest, handlers: StreamHandlers) {
      opts.streams?.push(input)
      if (opts.handlers) opts.handlers.current = handlers
      return {
        close() {
          if (opts.closeCalls) opts.closeCalls.count += 1
          handlers.onClose?.("test-close")
        },
      }
    },
    async native() {
      throw new Error("native not used in selected-task recovery tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
}

function routeStampedSSEEvent(event: any): boolean {
  return routeSSEEvent(stampSelectedEvent(event))
}

function stampSelectedEvent(event: any): any {
  return stampTestEvent(validateEventForTest(event))
}

function validateEventForTest(event: any): any {
  const type = String(event?.type || "event")
  const props = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  const baseOrderKey = typeof event.orderKey === "string" ? event.orderKey : ""
  if (!baseOrderKey) throw new Error(`selected-task fixture event ${type || "<unknown>"} missing orderKey`)
  if (props?.info && typeof props.info === "object") {
    const messageID = String(props.info.id || "")
    const orderKey = typeof props.info.orderKey === "string" ? props.info.orderKey : ""
    if (!orderKey) throw new Error(`selected-task fixture message ${messageID || "<unknown>"} missing orderKey`)
    if (event.orderKey !== orderKey) throw new Error(`selected-task fixture message ${messageID} envelope orderKey drift`)
    return {
      ...event,
      orderKey,
      properties: {
        ...props,
        info: props.info,
      },
    }
  }
  if (props?.part && typeof props.part === "object") {
    const part = props.part
    const messageID = String(part.messageID || "")
    const partID = String(part.id || "")
    const orderKey = String(props.orderKey || "")
    const partOrderKey = typeof part.orderKey === "string" ? part.orderKey : ""
    if (!orderKey) throw new Error(`selected-task fixture part owner ${messageID || "<unknown>"} missing orderKey`)
    if (!partOrderKey) throw new Error(`selected-task fixture part ${partID || "<unknown>"} missing orderKey`)
    if (event.orderKey !== orderKey) {
      throw new Error(`selected-task fixture part ${partID || "<unknown>"} envelope orderKey drift`)
    }
    return {
      ...event,
      orderKey,
      properties: {
        ...props,
        orderKey,
        part,
      },
    }
  }
  if (props?.task && typeof props.task === "object") {
    const taskID = String(props.task.id || props.taskID || event.taskID || "")
    const taskOrderKey = typeof props.task.orderKey === "string" ? props.task.orderKey : ""
    if (!taskOrderKey) throw new Error(`selected-task fixture task ${taskID || "<unknown>"} missing orderKey`)
    return {
      ...event,
      orderKey: baseOrderKey,
      properties: {
        ...props,
        task: props.task,
      },
    }
  }
  if (type === "session.status" || type === "session.error" || type === "session.idle") {
    const sessionID = String(props?.sessionID || event.sessionID || "")
    const orderKey = typeof event.orderKey === "string" ? event.orderKey : ""
    const payloadOrderKey = typeof props?.orderKey === "string" ? props.orderKey : ""
    if (!orderKey || !payloadOrderKey) {
      throw new Error(`selected-task fixture ${type} ${sessionID || "<unknown>"} missing orderKey`)
    }
    if (orderKey !== payloadOrderKey) {
      throw new Error(`selected-task fixture ${type} ${sessionID || "<unknown>"} orderKey drift`)
    }
    return {
      ...event,
      orderKey,
      properties: props,
    }
  }
  return event
}

function validateTranscriptMessageForTest(message: any): any {
  const info = message?.info || {}
  const messageID = String(info.id || "")
  if (!info.orderKey) throw new Error(`selected-task fixture transcript message ${messageID || "<unknown>"} missing orderKey`)
  return {
    ...message,
    info,
    parts: Array.isArray(message?.parts)
      ? message.parts.map((part: any) => {
          const partID = String(part.id || "")
          if (!part.orderKey) throw new Error(`selected-task fixture transcript part ${partID || "<unknown>"} missing orderKey`)
          return {
            ...part,
          }
        })
      : message?.parts,
  }
}

function validateConversationViewForTest(view: any): any {
  const messages = Array.isArray(view?.messages)
    ? view.messages.map((message: any) => ({
        ...message,
        orderKey: message.orderKey,
      }))
    : []
  const sessions = Array.isArray(view?.sessions)
    ? view.sessions.map((session: any) => {
        return {
          ...session,
          orderKey: session.orderKey,
        }
      })
    : []
  return { ...view, messages, sessions }
}

function conversationPayload(taskID: string, transcript: any[] = [], view = { sessions: [] as any[] }) {
  const viewRecord = validateConversationViewForTest(view as any)
  const sessions = stampTestViewSessions(Array.isArray(viewRecord.sessions) ? viewRecord.sessions : [])
  const messages = stampTestViewMessages(Array.isArray(viewRecord.messages) ? viewRecord.messages : [])
  const validatedTranscript = transcript.map((message) => validateTranscriptMessageForTest(message))
  const agentView = {
    topLevelSessionIDs: Array.isArray(viewRecord.topLevelSessionIDs) ? viewRecord.topLevelSessionIDs : [],
    sessions,
    messages,
  }
  return {
    lastSequence: 5,
    board: stampTestBoard({
      snapshotVersion: `board:${taskID}`,
      task: {
        id: taskID,
        directory: TEST_DIRECTORY,
        sessionID: `ses_${taskID}`,
        status: "active",
        request: "tail repair",
        time: { created: 1_776_000_400_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    }),
    transcript: stampTestTranscript(validatedTranscript),
    timeline: [],
    events: [],
    eventReplay: { cursor: 5, latestSequence: 5, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: {
      ...viewRecord,
      sessions,
      messages,
    },
    agentView,
  }
}

async function waitForRequestCount(requests: unknown[], count: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (requests.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function resetSelectedTaskRecoveryTestState(): void {
  __resetEventTimersForTest()
  stopSSE()
  __setHostTransportForTest(undefined)
  __resetConversationRecoveryDiagnosticsSinkForTest()
  AppLog.clear()
  clearNotifications()
  resetWriter()
  resetConversationAgentView()
  resetSelectedLiveCursor()
  setBoardStore("selectedSource", null)
  setBoardStore("taskSequence", 0)
  setBoardStore("board", null)
}

beforeEach(resetSelectedTaskRecoveryTestState)
afterEach(resetSelectedTaskRecoveryTestState)

test("selected-task recovery resumes with the consumed live cursor", async () => {
  const streams: StreamOpenRequest[] = []
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live" })
  setBoardStore("taskSequence", 12)
  setBoardStore("board", {
    snapshotVersion: "board:live",
    task: {
      id: "tsk_live",
      sessionID: "ses_live",
      status: "active",
      request: "live",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  })
  expect(
    routeStampedSSEEvent({
      type: "session.status",
      task_id: "tsk_live",
      emittedAt: 1_776_000_199_000,
      orderKey: testSessionOrderKey("ses_live", 1_776_000_199_000),
      properties: {
        taskID: "tsk_live",
        sessionID: "ses_live",
        orderKey: testSessionOrderKey("ses_live", 1_776_000_199_000),
        channel: "assistant",
        resolvedRole: "assistant",
        status: { type: "streaming" },
      },
    }),
  ).toBe(true)

  expect(
    routeStampedSSEEvent({
      type: "message.updated",
      task_id: "tsk_live",
      sequence: 0,
      live_sequence: 7,
      live_epoch: 1776,
      orderKey: testMessageOrderKey("msg_live", 1_776_000_200_000),
      properties: {
        info: {
          id: "msg_live",
          sessionID: "ses_live",
          role: "assistant",
          resolvedRole: "assistant",
          channel: "assistant",
          agent: "assistant",
          time: { created: 1_776_000_200_000 },
          orderKey: testMessageOrderKey("msg_live", 1_776_000_200_000),
        },
      },
    }),
  ).toBe(true)
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_live"])
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("assistant:session:ses_live:message:msg_live")

  registerTaskDirectory("tsk_live")
  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live")).resolves.toBe(12)

  expect(streams).toEqual([
    {
      path: "task/tsk_live/events",
      query: { directory: TEST_DIRECTORY, after: "12", after_live: "7", after_live_epoch: "1776" },
    },
  ])
})

test("selected task run.output consumes protocol output without synthesizing a message card", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_executor" })
  setBoardStore("taskSequence", 12)
  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_live_executor",
      sequence: 13,
      emittedAt: 1_776_000_299_000,
      orderKey: testSessionOrderKey("ses_executor_live", 1_776_000_299_000),
      properties: {
        taskID: "tsk_live_executor",
        sessionID: "ses_executor_live",
        orderKey: testSessionOrderKey("ses_executor_live", 1_776_000_299_000),
        channel: "executor",
        resolvedRole: "executor",
        status: { type: "streaming" },
      },
    }),
  ).toBe(true)

  expect(
    routeStampedSSEEvent({
      type: "run.output",
      taskID: "tsk_live_executor",
      event_id: "evt_executor_output",
      sequence: 14,
      timestamp: 1_776_000_300_000,
      orderKey: testEventOrderKey("run.output", 1_776_000_300_000, 14),
      summary: "executor output",
      properties: {
        taskID: "tsk_live_executor",
        runID: "run_executor",
        sessionID: "ses_executor_live",
        text: "Executor streamed output.",
      },
    }),
  ).toBe(true)

  const cardID = "executor:session:ses_executor_live:message:executor:msg:run_executor"
  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_executor_live"])
  expect(conversationAgentStore.records[0]?.stage).toBe("executor")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(boardStore.taskSequence).toBe(14)
})

test("selected task run.progress consumes protocol progress without synthesizing a message card", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_tool" })
  setBoardStore("taskSequence", 20)
  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_live_tool",
      sequence: 21,
      emittedAt: 1_776_000_399_000,
      orderKey: testSessionOrderKey("ses_tool_live", 1_776_000_399_000),
      properties: {
        taskID: "tsk_live_tool",
        sessionID: "ses_tool_live",
        orderKey: testSessionOrderKey("ses_tool_live", 1_776_000_399_000),
        channel: "executor",
        resolvedRole: "executor",
        status: { type: "streaming" },
      },
    }),
  ).toBe(true)

  expect(
    routeStampedSSEEvent({
      type: "run.progress",
      taskID: "tsk_live_tool",
      event_id: "evt_tool_call",
      sequence: 22,
      timestamp: 1_776_000_400_000,
      orderKey: testEventOrderKey("run.progress", 1_776_000_400_000, 22),
      summary: "Read file",
      properties: {
        type: "tool_call",
        taskID: "tsk_live_tool",
        runID: "run_tool",
        sessionID: "ses_tool_live",
        sourceID: "call_read",
        name: "read",
        input: { path: "README.md" },
      },
    }),
  ).toBe(true)

  const cardID = "executor:session:ses_tool_live:message:executor:msg:run_tool"
  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_tool_live"])
  expect(conversationAgentStore.records[0]?.stage).toBe("executor")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(boardStore.taskSequence).toBe(22)
})

test("selected task part-first message attaches the materialized card to an execution rail record", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_part_first" })
  setBoardStore("taskSequence", 30)
  setBoardStore("board", {
    snapshotVersion: "board:part-first",
    task: {
      id: "tsk_part_first",
      sessionID: "ses_root",
      status: "active",
      request: "part first",
      time: { created: 1_776_000_490_000 },
      attachments: [],
    },
  })
  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_part_first",
      sequence: 31,
      emittedAt: 1_776_000_499_000,
      orderKey: testSessionOrderKey("ses_part_first", 1_776_000_499_000),
      properties: {
        taskID: "tsk_part_first",
        sessionID: "ses_part_first",
        orderKey: testSessionOrderKey("ses_part_first", 1_776_000_499_000),
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "ses_root",
        status: { type: "streaming" },
      },
    }),
  ).toBe(true)

  expect(
    routeStampedSSEEvent({
      type: "message.part.updated",
      taskID: "tsk_part_first",
      sequence: 32,
      emittedAt: 1_776_000_500_000,
      orderKey: testMessageOrderKey("msg_before_message", 1_776_000_499_000),
      properties: {
        taskID: "tsk_part_first",
        orderKey: testMessageOrderKey("msg_before_message", 1_776_000_499_000),
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "ses_root",
        part: {
          id: "part_before_message",
          messageID: "msg_before_message",
          sessionID: "ses_part_first",
          orderKey: testPartOrderKey("part_before_message", 1_776_000_500_000),
          type: "text",
          text: "Part arrived before message metadata.",
        },
      },
    }),
  ).toBe(true)

  const cardID = "build:session:ses_part_first:message:msg_before_message"
  expect(cardTreeStore.cards[cardID]).toBeDefined()
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_part_first"])
  expect(conversationAgentStore.records[0]?.stage).toBe("build")
  expect(conversationAgentStore.records[0]?.status).toBe("running")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe(cardID)

  expect(
    routeStampedSSEEvent({
      type: "message.updated",
      taskID: "tsk_part_first",
      sequence: 33,
      orderKey: testMessageOrderKey("msg_before_message", 1_776_000_499_000),
      properties: {
        info: {
          id: "msg_before_message",
          sessionID: "ses_part_first",
          role: "assistant",
          resolvedRole: "build",
          channel: "build",
          agent: "build",
          parentSessionID: "ses_root",
          time: { created: 1_776_000_499_000, completed: 1_776_000_501_000 },
          orderKey: testMessageOrderKey("msg_before_message", 1_776_000_499_000),
        },
      },
    }),
  ).toBe(true)

  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_part_first"])
  expect(conversationAgentStore.records[0]?.status).toBe("running")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe(cardID)

  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_part_first",
      sequence: 34,
      emittedAt: 1_776_000_502_000,
      orderKey: testSessionOrderKey("ses_part_first", 1_776_000_502_000),
      properties: {
        taskID: "tsk_part_first",
        sessionID: "ses_part_first",
        orderKey: testSessionOrderKey("ses_part_first", 1_776_000_502_000),
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "ses_root",
        status: { type: "terminal", reason: "completed" },
      },
    }),
  ).toBe(true)

  expect(conversationAgentStore.records[0]?.status).toBe("completed")
  expect(conversationAgentStore.records[0]?.completedAt).toBe(1_776_000_502_000)
})

test("selected task session.status creates an execution rail record without a blank card", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_status" })
  setBoardStore("taskSequence", 40)
  setBoardStore("board", {
    snapshotVersion: "board:status",
    task: {
      id: "tsk_status",
      sessionID: "ses_root",
      status: "active",
      request: "status",
      time: { created: 1_776_000_590_000 },
      attachments: [],
    },
  })

  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_status",
      sequence: 41,
      emittedAt: 1_776_000_600_000,
      orderKey: testSessionOrderKey("ses_status_only", 1_776_000_600_000),
      properties: {
        taskID: "tsk_status",
        sessionID: "ses_status_only",
        orderKey: testSessionOrderKey("ses_status_only", 1_776_000_600_000),
        channel: "frontend-research",
        resolvedRole: "frontend-research",
        parentSessionID: "ses_root",
        status: { type: "streaming" },
      },
    }),
  ).toBe(true)
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_status_only"])
  expect(conversationAgentStore.records[0]?.stage).toBe("frontend-research")
  expect(conversationAgentStore.records[0]?.status).toBe("running")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(cardTreeStore.cards["frontend-research:session:ses_status_only"]).toBeUndefined()

  expect(
    routeStampedSSEEvent({
      type: "message.updated",
      taskID: "tsk_status",
      sequence: 42,
      orderKey: testMessageOrderKey("msg_status", 1_776_000_601_000),
      properties: {
        info: {
          id: "msg_status",
          sessionID: "ses_status_only",
          role: "assistant",
          resolvedRole: "frontend-research",
          channel: "frontend-research",
          agent: "frontend-research",
          parentSessionID: "ses_root",
          time: { created: 1_776_000_601_000 },
          orderKey: testMessageOrderKey("msg_status", 1_776_000_601_000),
        },
      },
    }),
  ).toBe(true)
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_status_only"])
  expect(conversationAgentStore.records[0]?.status).toBe("running")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe(
    "frontend-research:session:ses_status_only:message:msg_status",
  )

  expect(
    routeStampedSSEEvent({
      type: "session.status",
      taskID: "tsk_status",
      sequence: 43,
      emittedAt: 1_776_000_602_000,
      orderKey: testSessionOrderKey("ses_status_only", 1_776_000_602_000),
      properties: {
        taskID: "tsk_status",
        sessionID: "ses_status_only",
        orderKey: testSessionOrderKey("ses_status_only", 1_776_000_602_000),
        channel: "frontend-research",
        resolvedRole: "frontend-research",
        parentSessionID: "ses_root",
        status: { type: "terminal", reason: "error", message: "failed" },
      },
    }),
  ).toBe(true)

  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_status_only"])
  expect(conversationAgentStore.records[0]?.status).toBe("error")
  expect(conversationAgentStore.records[0]?.completedAt).toBe(1_776_000_602_000)
})

test("selected-task recovery advances the live cursor for non-message selected events", async () => {
  const streams: StreamOpenRequest[] = []
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_non_message" })
  setBoardStore("taskSequence", 12)

  expect(
    routeStampedSSEEvent({
      type: "session.updated",
      task_id: "tsk_live_non_message",
      sequence: 0,
      live_sequence: 8,
      live_epoch: 1777,
      orderKey: testEventOrderKey("session.updated", 1_776_000_603_000, 0),
      properties: { sessionID: "ses_live_non_message" },
    }),
  ).toBe(true)

  registerTaskDirectory("tsk_live_non_message")
  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_non_message")).resolves.toBe(12)

  expect(streams).toEqual([
    {
      path: "task/tsk_live_non_message/events",
      query: { directory: TEST_DIRECTORY, after: "12", after_live: "8", after_live_epoch: "1777" },
    },
  ])
})

test("selected-task recovery advances the live cursor for board-invalidating selected events", async () => {
  const streams: StreamOpenRequest[] = []
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_board" })
  setBoardStore("taskSequence", 12)

  const event = {
    type: "task.updated",
    task_id: "tsk_live_board",
    sequence: 13,
    timestamp: 1_776_000_700_000,
    orderKey: testEventOrderKey("task.updated", 1_776_000_700_000, 13),
    live_sequence: 9,
    live_epoch: 1778,
    properties: { taskID: "tsk_live_board" },
  }
  expect(routeStampedSSEEvent(event)).toBe(false)
  handleEventStreamEvent(stampSelectedEvent(event))

  registerTaskDirectory("tsk_live_board")
  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_board")).resolves.toBe(13)

  expect(streams).toEqual([
    {
      path: "task/tsk_live_board/events",
      query: { directory: TEST_DIRECTORY, after: "13", after_live: "9", after_live_epoch: "1778" },
    },
  ])
})

test("selected-task recovery restarts the stream from the current sequence without hydrating", async () => {
  const streams: StreamOpenRequest[] = []
  const closeCalls = { count: 0 }
  const diagnostics: any[] = []
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record)
  })
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_atomic" })
  setBoardStore("taskSequence", 9)

  startSSE({ kind: "task", id: "tsk_atomic" }, 3, { directory: TEST_DIRECTORY })
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { directory: TEST_DIRECTORY, after: "3", after_live: "0" } },
  ])
  const treeEpoch = cardTreeStore.treeEpoch

  registerTaskDirectory("tsk_atomic")
  await expect(recoverSelectedTaskConversation("test atomic recovery", "tsk_atomic")).resolves.toBe(9)

  expect(closeCalls.count).toBe(1)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { directory: TEST_DIRECTORY, after: "3", after_live: "0" } },
    { path: "task/tsk_atomic/events", query: { directory: TEST_DIRECTORY, after: "9", after_live: "0" } },
  ])
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "selected-task-recovery",
      reason: "test atomic recovery",
      taskID: "tsk_atomic",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.succeeded",
      channel: "selected-task-recovery",
      reason: "test atomic recovery",
      taskID: "tsk_atomic",
      source: "selected-task-recovery",
      resumeSequence: 9,
    }),
  ])
})

test("rewind clear recovery hydrates the authoritative conversation before restarting the stream", async () => {
  const streams: StreamOpenRequest[] = []
  const requests: string[] = []
  const closeCalls = { count: 0 }
  const diagnostics: any[] = []
  const transcript = [
    {
      info: {
        id: "msg_tail_restored",
        sessionID: "ses_tail_restored",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "orchestrator",
        time: { created: 1_779_000_100_000 },
        orderKey: testMessageOrderKey("msg_tail_restored", 1_779_000_100_000),
      },
      parts: [
        {
          id: "part_tail_restored",
          sessionID: "ses_tail_restored",
          messageID: "msg_tail_restored",
          orderKey: testPartOrderKey("part_tail_restored", 1_779_000_100_000),
          type: "text",
          text: "RW tail restored after clear.",
        },
      ],
    },
  ]
  const view = {
    sessions: [
      {
        sessionID: "ses_tail_restored",
        stage: "orchestrator",
        messageIDs: ["msg_tail_restored"],
        firstMessageTime: 1_779_000_100_000,
        lastMessageTime: 1_779_000_100_000,
        orderKey: testSessionOrderKey("ses_tail_restored", 1_779_000_100_000),
        placement: "top_level",
      },
    ],
    messages: [
      {
        sessionID: "ses_tail_restored",
        stage: "orchestrator",
        messageID: "msg_tail_restored",
        time: 1_779_000_100_000,
        orderKey: testMessageOrderKey("msg_tail_restored", 1_779_000_100_000),
        placement: "top_level",
      },
    ],
  }

  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record)
  })
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        requests.push(req.path)
        expect(req.query?.tail_limit).toBe("80")
        return {
          status: 200,
          ok: true,
          headers: {},
          body: conversationPayload("tsk_rewind_clear", transcript, view),
        }
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_rewind_clear" })
  setBoardStore("taskSequence", 2)
  startSSE({ kind: "task", id: "tsk_rewind_clear" }, 2, { directory: TEST_DIRECTORY })
  pruneCardsAfterCursor(1_779_000_050_000)
  expect(cardTreeStore.rewindCursor).toBe(1_779_000_050_000)

  registerTaskDirectory("tsk_rewind_clear")
  await expect(recoverSelectedTaskAfterRewindClear("task rewind cleared", "tsk_rewind_clear")).resolves.toBe(5)

  const restored = Object.values(cardTreeStore.cards).find((card: any) =>
    card?.parts?.some((part: any) => String(part.text || "").includes("RW tail restored after clear.")),
  )
  expect(requests).toEqual(["task/tsk_rewind_clear/conversation"])
  expect(closeCalls.count).toBe(1)
  expect(streams).toEqual([
    { path: "task/tsk_rewind_clear/events", query: { directory: TEST_DIRECTORY, after: "2", after_live: "0" } },
    { path: "task/tsk_rewind_clear/events", query: { directory: TEST_DIRECTORY, after: "5", after_live: "0" } },
  ])
  expect(cardTreeStore.rewindCursor).toBe(null)
  expect(restored).toBeDefined()
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "rewind-clear",
      reason: "task rewind cleared",
      taskID: "tsk_rewind_clear",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.succeeded",
      channel: "rewind-clear",
      reason: "task rewind cleared",
      taskID: "tsk_rewind_clear",
      source: "selected-task-recovery",
      resumeSequence: 5,
    }),
  ])
})

test("rewind clear recovery failures surface through AppLog and notifications", async () => {
  const streams: StreamOpenRequest[] = []
  const diagnostics: any[] = []
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record)
  })
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        expect(req.path).toBe("task/tsk_rewind_clear_fail/conversation")
        return {
          status: 500,
          ok: false,
          headers: {},
          body: { error: "hydrate failed after rewind clear" },
        }
      },
    }),
  )

  setBoardStore("selectedSource", { kind: "task", id: "tsk_rewind_clear_fail" })
  setBoardStore("taskSequence", 8)
  startSSE({ kind: "task", id: "tsk_rewind_clear_fail" }, 8, { directory: TEST_DIRECTORY })
  pruneCardsAfterCursor(1_779_000_050_000)
  registerTaskDirectory("tsk_rewind_clear_fail")

  await expect(recoverSelectedTaskAfterRewindClear("task rewind cleared", "tsk_rewind_clear_fail")).rejects.toThrow(
    /hydrate failed after rewind clear|API 500/,
  )

  expect(streams).toEqual([
    {
      path: "task/tsk_rewind_clear_fail/events",
      query: { directory: TEST_DIRECTORY, after: "8", after_live: "0" },
    },
  ])
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "rewind-clear",
      reason: "task rewind cleared",
      taskID: "tsk_rewind_clear_fail",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.failed",
      channel: "rewind-clear",
      reason: "task rewind cleared",
      taskID: "tsk_rewind_clear_fail",
      source: "selected-task-recovery",
    }),
  ])
  expect(AppLog.entries).toContainEqual(
    expect.objectContaining({
      level: "error",
      service: "conversation",
      message: "rewind-clear recovery failed for tsk_rewind_clear_fail",
    }),
  )
  expect(notificationStore.items).toContainEqual(
    expect.objectContaining({
      id: "conversation:rewind-clear-recovery-failed:tsk_rewind_clear_fail",
      tone: "error",
      title: "Conversation rewind recovery failed",
    }),
  )
})

test("rewind clear recovery is not superseded by selected sequence-gap recovery", async () => {
  const streams: StreamOpenRequest[] = []
  const requests: string[] = []
  const closeCalls = { count: 0 }
  let releaseHydrate!: (response: TransportResponse<unknown>) => void
  const hydrate = new Promise<TransportResponse<unknown>>((resolve) => {
    releaseHydrate = resolve
  })

  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        requests.push(req.path)
        expect(req.query?.tail_limit).toBe("80")
        return hydrate
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_rewind_clear_gap" })
  setBoardStore("taskSequence", 2)
  startSSE({ kind: "task", id: "tsk_rewind_clear_gap" }, 2, { directory: TEST_DIRECTORY })
  pruneCardsAfterCursor(1_779_000_050_000)
  expect(cardTreeStore.rewindCursor).toBe(1_779_000_050_000)

  registerTaskDirectory("tsk_rewind_clear_gap")
  const clear = recoverSelectedTaskAfterRewindClear("task rewind cleared", "tsk_rewind_clear_gap")
  await waitForRequestCount(requests, 1)

  const gap = recoverSelectedTaskConversation("selected task sequence gap", "tsk_rewind_clear_gap")
  await Promise.resolve()
  await Promise.resolve()

  expect(requests).toEqual(["task/tsk_rewind_clear_gap/conversation"])
  expect(streams).toEqual([
    { path: "task/tsk_rewind_clear_gap/events", query: { directory: TEST_DIRECTORY, after: "2", after_live: "0" } },
  ])
  expect(closeCalls.count).toBe(0)

  releaseHydrate({
    status: 200,
    ok: true,
    headers: {},
    body: conversationPayload("tsk_rewind_clear_gap"),
  })

  await expect(clear).resolves.toBe(5)
  await expect(gap).resolves.toBe(5)
  expect(cardTreeStore.rewindCursor).toBe(null)
  expect(closeCalls.count).toBe(1)
  expect(streams).toEqual([
    {
      path: "task/tsk_rewind_clear_gap/events",
      query: { directory: TEST_DIRECTORY, after: "2", after_live: "0" },
    },
    {
      path: "task/tsk_rewind_clear_gap/events",
      query: { directory: TEST_DIRECTORY, after: "5", after_live: "0" },
    },
  ])
})

test("selected-task recovery refuses replay-expired full refresh and leaves the live tree mounted", async () => {
  const streams: StreamOpenRequest[] = []
  const closeCalls = { count: 0 }
  const diagnostics: any[] = []
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record)
  })

  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`replay-expired recovery must not hydrate ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_expired" })
  setBoardStore("taskSequence", 5)

  startSSE({ kind: "task", id: "tsk_expired" }, 5, { directory: TEST_DIRECTORY })
  const treeEpoch = cardTreeStore.treeEpoch

  registerTaskDirectory("tsk_expired")
  await expect(recoverSelectedTaskConversation("task replay expired", "tsk_expired")).rejects.toThrow(
    /refused full conversation refresh/,
  )

  expect(closeCalls.count).toBe(0)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([
    { path: "task/tsk_expired/events", query: { directory: TEST_DIRECTORY, after: "5", after_live: "0" } },
  ])
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "selected-task-recovery",
      reason: "task replay expired",
      taskID: "tsk_expired",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.failed",
      channel: "selected-task-recovery",
      reason: "task replay expired",
      taskID: "tsk_expired",
      source: "selected-task-recovery",
    }),
  ])
})

test("selected-task recovery treats live replay expiry as persistent-sequence reconnect", async () => {
  const streams: StreamOpenRequest[] = []
  const requests: string[] = []
  const closeCalls = { count: 0 }
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        requests.push(req.path)
        return { status: 200, ok: true, headers: {}, body: conversationPayload("tsk_live_expired") }
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_expired" })
  setBoardStore("taskSequence", 5)
  const treeEpoch = cardTreeStore.treeEpoch

  expect(
    routeStampedSSEEvent({
      type: "session.updated",
      task_id: "tsk_live_expired",
      sequence: 0,
      timestamp: 1_779_000_010_000,
      orderKey: testEventOrderKey("session.updated", 1_779_000_010_000, 0),
      live_sequence: 17,
      live_epoch: 1776,
      properties: { sessionID: "ses_live_expired" },
    }),
  ).toBe(true)

  registerTaskDirectory("tsk_live_expired")
  await expect(recoverSelectedTaskConversation("task.live_replay_expired", "tsk_live_expired")).resolves.toBe(5)
  await Promise.resolve()

  expect(closeCalls.count).toBe(0)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([{ path: "task/tsk_live_expired/events", query: { directory: TEST_DIRECTORY, after: "5" } }])
  expect(requests).toEqual(["task/tsk_live_expired/conversation"])
})

test("selected-task live replay expiry fails visibly when tail merge fails", async () => {
  const streams: StreamOpenRequest[] = []
  const diagnostics: any[] = []
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record)
  })
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        if (req.path === "log") return { status: 200, ok: true, headers: {}, body: { ok: true } }
        throw new Error(`tail merge unavailable for ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_live_expired_fail" })
  setBoardStore("taskSequence", 5)

  registerTaskDirectory("tsk_live_expired_fail")
  await expect(recoverSelectedTaskConversation("task.live_replay_expired", "tsk_live_expired_fail")).rejects.toThrow(
    /tail merge unavailable/,
  )

  expect(streams).toEqual([])
  expect(isSelectedTaskSSEConnected("tsk_live_expired_fail")).toBe(false)
  expect(diagnostics.map((entry) => entry.event)).toEqual([
    "conversation-recovery.started",
    "conversation-recovery.failed",
  ])
  expect(
    notificationStore.items.some(
      (item) => item.id === "conversation:selected-task-recovery-failed:tsk_live_expired_fail",
    ),
  ).toBe(true)
  expect(diagnostics).not.toContainEqual(expect.objectContaining({ event: "conversation-recovery.succeeded" }))
})

test("task.messages.changed triggers non-reset tail merge for DB-backed message writes", async () => {
  const requests: string[] = []
  __setHostTransportForTest(
    fakeTransport({
      request(req) {
        requests.push(req.path)
        expect(req.query?.directory).toBe(TEST_DIRECTORY)
        expect(req.query?.tail_limit).toBe("32")
        return { status: 200, ok: true, headers: {}, body: conversationPayload("tsk_db_tail") }
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_db_tail" })
  registerTaskDirectory("tsk_db_tail")
  const treeEpoch = cardTreeStore.treeEpoch

  expect(
    routeStampedSSEEvent({
      type: "task.messages.changed",
      task_id: "tsk_db_tail",
      sequence: 0,
      timestamp: 1_779_000_000_000,
      orderKey: testEventOrderKey("task.messages.changed", 1_779_000_000_000, 0),
      payload: { taskID: "tsk_db_tail", watermark: 1_779_000_000_000 },
    }),
  ).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(requests).toEqual(["task/tsk_db_tail/conversation"])
})

test("selected task stream renders DB-backed task.messages.changed tail without resetting tree", async () => {
  const streams: StreamOpenRequest[] = []
  const handlers: { current?: StreamHandlers } = {}
  const requests: string[] = []
  const transcript = [
    {
      info: {
        id: "msg_db_tail",
        sessionID: "ses_db_tail",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_779_000_000_001 },
        orderKey: testMessageOrderKey("msg_db_tail", 1_779_000_000_001),
      },
      parts: [
        {
          id: "part_db_tail",
          sessionID: "ses_db_tail",
          messageID: "msg_db_tail",
          orderKey: testPartOrderKey("part_db_tail", 1_779_000_000_001),
          type: "text",
          text: "DB tail arrived without switching tasks.",
        },
      ],
    },
  ]
  const view = {
    sessions: [
      {
        sessionID: "ses_db_tail",
        stage: "assistant",
        messageIDs: ["msg_db_tail"],
        firstMessageTime: 1_779_000_000_001,
        lastMessageTime: 1_779_000_000_001,
        orderKey: testSessionOrderKey("ses_db_tail", 1_779_000_000_001),
        placement: "top_level",
      },
    ],
    messages: [
      {
        messageID: "msg_db_tail",
        sessionID: "ses_db_tail",
        stage: "assistant",
        time: 1_779_000_000_001,
        orderKey: testMessageOrderKey("msg_db_tail", 1_779_000_000_001),
        placement: "top_level",
      },
    ],
    topLevelSessionIDs: ["ses_db_tail"],
  }
  __setHostTransportForTest(
    fakeTransport({
      streams,
      handlers,
      request(req) {
        requests.push(req.path)
        expect(req.query?.directory).toBe(TEST_DIRECTORY)
        expect(req.query?.tail_limit).toBe("32")
        return { status: 200, ok: true, headers: {}, body: conversationPayload("tsk_db_tail_stream", transcript, view) }
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_db_tail_stream" })
  setBoardStore("taskSequence", 12)
  markSelectedMessageWatermark(1_779_000_000_000)
  const treeEpoch = cardTreeStore.treeEpoch
  const visibleVersion = cardTreeStore.visibleVersion

  startSSE({ kind: "task", id: "tsk_db_tail_stream" }, 12, { directory: TEST_DIRECTORY })
  expect(streams).toEqual([
    {
      path: "task/tsk_db_tail_stream/events",
      query: {
        after: "12",
        directory: TEST_DIRECTORY,
        after_live: "0",
        after_message_watermark: "1779000000000",
      },
    },
  ])

  handlers.current?.onEvent(
    JSON.stringify({
      type: "task.messages.changed",
      task_id: "tsk_db_tail_stream",
      sequence: 0,
      timestamp: 1_779_000_000_002,
      orderKey: testEventOrderKey("task.messages.changed", 1_779_000_000_002, 0),
      payload: { taskID: "tsk_db_tail_stream", watermark: 1_779_000_000_002 },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const card = cardTreeStore.cards["assistant:session:ses_db_tail:message:msg_db_tail"]
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(cardTreeStore.visibleVersion).toBeGreaterThan(visibleVersion)
  expect(requests).toEqual(["task/tsk_db_tail_stream/conversation"])
  expect(card).toBeDefined()
  expect(conversationAgentStore.records.map((record: any) => record.sessionID)).toEqual(["ses_db_tail"])
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("assistant:session:ses_db_tail:message:msg_db_tail")
  expect(
    card?.parts.some(
      (part: any) =>
        part.id === "part_db_tail" && String(part.text || "").includes("DB tail arrived without switching tasks."),
    ),
  ).toBe(true)
})

test("stale scheduled recovery does not stop the newly selected task stream", async () => {
  const streams: StreamOpenRequest[] = []
  const closeCalls = { count: 0 }
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`stale recovery must not request ${req.path}`)
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_new" })

  startSSE({ kind: "task", id: "tsk_new" }, 11, { directory: TEST_DIRECTORY })
  registerTaskDirectory("tsk_old")
  await expect(recoverSelectedTaskConversation("stale delayed recovery", "tsk_old")).rejects.toMatchObject({
    name: "AbortError",
  })

  expect(closeCalls.count).toBe(0)
  expect(streams).toEqual([
    { path: "task/tsk_new/events", query: { directory: TEST_DIRECTORY, after: "11", after_live: "0" } },
  ])
})
