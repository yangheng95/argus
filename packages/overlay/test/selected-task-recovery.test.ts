import { afterEach, expect, test } from "bun:test"
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

const { setBoardStore } = await import("../src/store/board")
const { cardTreeStore, pruneCardsAfterCursor } = await import("../src/store/card-tree")
const { recoverSelectedTaskAfterRewindClear, recoverSelectedTaskConversation } = await import(
  "../src/services/selected-task-recovery"
)
const { routeSSEEvent, handleEventStreamEvent, __resetEventTimersForTest } = await import("../src/services/events")
const { startSSE, stopSSE } = await import("../src/services/sse")
const { __setHostTransportForTest } = await import("../src/services/host-transport")
const { resetWriter } = await import("../src/services/tree-writer")
const { markSelectedMessageWatermark, resetSelectedLiveCursor } = await import("../src/services/selected-stream-cursor")
const { setLocaleData } = await import("../src/utils/i18n")
const { __resetConversationRecoveryDiagnosticsSinkForTest, __setConversationRecoveryDiagnosticsSinkForTest } =
  await import("../src/services/refresh-diagnostics")

setLocaleData("en-US", JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")))

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

function conversationPayload(taskID: string, transcript: any[] = [], view = { sessions: [] as any[] }) {
  return {
    lastSequence: 5,
    board: {
      snapshotVersion: `board:${taskID}`,
      task: {
        id: taskID,
        sessionID: `ses_${taskID}`,
        status: "active",
        request: "tail repair",
        time: { created: 1_776_000_400_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    },
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 5, latestSequence: 5, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view,
    agentView: view,
  }
}

afterEach(() => {
  __resetEventTimersForTest()
  stopSSE()
  __setHostTransportForTest(undefined)
  __resetConversationRecoveryDiagnosticsSinkForTest()
  resetWriter()
  resetSelectedLiveCursor()
  setBoardStore("selectedSource", null)
  setBoardStore("taskSequence", 0)
  setBoardStore("board", null)
})

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
    routeSSEEvent({
      type: "message.updated",
      task_id: "tsk_live",
      sequence: 0,
      live_sequence: 7,
      live_epoch: 1776,
      properties: {
        info: {
          id: "msg_live",
          sessionID: "ses_live",
          role: "assistant",
          resolvedRole: "assistant",
          channel: "assistant",
          agent: "assistant",
          time: { created: 1_776_000_200_000 },
        },
      },
    }),
  ).toBe(true)

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live")).resolves.toBe(12)

  expect(streams).toEqual([
    {
      path: "task/tsk_live/events",
      query: { after: "12", after_live: "7", after_live_epoch: "1776" },
    },
  ])
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
    routeSSEEvent({
      type: "session.updated",
      task_id: "tsk_live_non_message",
      sequence: 0,
      live_sequence: 8,
      live_epoch: 1777,
      properties: { sessionID: "ses_live_non_message" },
    }),
  ).toBe(true)

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_non_message")).resolves.toBe(12)

  expect(streams).toEqual([
    {
      path: "task/tsk_live_non_message/events",
      query: { after: "12", after_live: "8", after_live_epoch: "1777" },
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
    live_sequence: 9,
    live_epoch: 1778,
    properties: { taskID: "tsk_live_board" },
  }
  expect(routeSSEEvent(event)).toBe(false)
  handleEventStreamEvent(event)

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_board")).resolves.toBe(13)

  expect(streams).toEqual([
    {
      path: "task/tsk_live_board/events",
      query: { after: "13", after_live: "9", after_live_epoch: "1778" },
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

  startSSE({ kind: "task", id: "tsk_atomic" }, 3)
  expect(streams).toEqual([{ path: "task/tsk_atomic/events", query: { after: "3", after_live: "0" } }])
  const treeEpoch = cardTreeStore.treeEpoch

  await expect(recoverSelectedTaskConversation("test atomic recovery", "tsk_atomic")).resolves.toBe(9)

  expect(closeCalls.count).toBe(1)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { after: "3", after_live: "0" } },
    { path: "task/tsk_atomic/events", query: { after: "9", after_live: "0" } },
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
      },
      parts: [
        {
          id: "part_tail_restored",
          sessionID: "ses_tail_restored",
          messageID: "msg_tail_restored",
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
  startSSE({ kind: "task", id: "tsk_rewind_clear" }, 2)
  pruneCardsAfterCursor(1_779_000_050_000)
  expect(cardTreeStore.rewindCursor).toBe(1_779_000_050_000)

  await expect(recoverSelectedTaskAfterRewindClear("task rewind cleared", "tsk_rewind_clear")).resolves.toBe(5)

  const restored = Object.values(cardTreeStore.cards).find((card: any) =>
    card?.parts?.some((part: any) => String(part.text || "").includes("RW tail restored after clear.")),
  )
  expect(requests).toEqual(["task/tsk_rewind_clear/conversation"])
  expect(closeCalls.count).toBe(1)
  expect(streams).toEqual([
    { path: "task/tsk_rewind_clear/events", query: { after: "2", after_live: "0" } },
    { path: "task/tsk_rewind_clear/events", query: { after: "5", after_live: "0" } },
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

  startSSE({ kind: "task", id: "tsk_expired" }, 5)
  const treeEpoch = cardTreeStore.treeEpoch

  await expect(recoverSelectedTaskConversation("task replay expired", "tsk_expired")).rejects.toThrow(
    /refused full conversation refresh/,
  )

  expect(closeCalls.count).toBe(0)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([{ path: "task/tsk_expired/events", query: { after: "5", after_live: "0" } }])
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
    routeSSEEvent({
      type: "session.updated",
      task_id: "tsk_live_expired",
      sequence: 0,
      live_sequence: 17,
      live_epoch: 1776,
      properties: { sessionID: "ses_live_expired" },
    }),
  ).toBe(true)

  await expect(recoverSelectedTaskConversation("task.live_replay_expired", "tsk_live_expired")).resolves.toBe(5)
  await Promise.resolve()

  expect(closeCalls.count).toBe(0)
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(streams).toEqual([{ path: "task/tsk_live_expired/events", query: { after: "5" } }])
  expect(requests).toEqual(["task/tsk_live_expired/conversation"])
})

test("task.messages.changed triggers non-reset tail merge for DB-backed message writes", async () => {
  const requests: string[] = []
  __setHostTransportForTest(
    fakeTransport({
      request(req) {
        requests.push(req.path)
        expect(req.query?.tail_limit).toBe("32")
        return { status: 200, ok: true, headers: {}, body: conversationPayload("tsk_db_tail") }
      },
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: "tsk_db_tail" })
  const treeEpoch = cardTreeStore.treeEpoch

  expect(
    routeSSEEvent({
      type: "task.messages.changed",
      task_id: "tsk_db_tail",
      sequence: 0,
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
      },
      parts: [
        {
          id: "part_db_tail",
          sessionID: "ses_db_tail",
          messageID: "msg_db_tail",
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
        placement: "top_level",
      },
    ],
  }
  __setHostTransportForTest(
    fakeTransport({
      streams,
      handlers,
      request(req) {
        requests.push(req.path)
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

  startSSE({ kind: "task", id: "tsk_db_tail_stream" }, 12)
  expect(streams).toEqual([
    {
      path: "task/tsk_db_tail_stream/events",
      query: {
        after: "12",
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
      payload: { taskID: "tsk_db_tail_stream", watermark: 1_779_000_000_002 },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const card = cardTreeStore.cards["assistant:session:ses_db_tail:message:msg_db_tail"]
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch)
  expect(cardTreeStore.visibleVersion).toBeGreaterThan(visibleVersion)
  expect(requests).toEqual(["task/tsk_db_tail_stream/conversation"])
  expect(card).toBeDefined()
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

  startSSE({ kind: "task", id: "tsk_new" }, 11)
  await expect(recoverSelectedTaskConversation("stale delayed recovery", "tsk_old")).rejects.toMatchObject({
    name: "AbortError",
  })

  expect(closeCalls.count).toBe(0)
  expect(streams).toEqual([{ path: "task/tsk_new/events", query: { after: "11", after_live: "0" } }])
})
