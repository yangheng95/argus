import { afterEach, expect, test } from "bun:test"
import {
  createCodingAssistantSession,
  deleteCodingAssistantSession,
  renameCodingAssistantSession,
  selectCodingAssistantSession,
  stopCodingAssistantSession,
} from "../src/services/coding-assistant"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
import { setBoardStore } from "../src/store/board"
import { setCodingAssistantStore } from "../src/store/coding-assistant"
import { resetWriter } from "../src/services/tree-writer"
import { stopSSE } from "../src/services/sse"

const ROW_DIRECTORY = "D:/coding-assistant/row"
const SETTINGS_DIRECTORY = "D:/coding-assistant/settings"

function sessionBody(title = "Assistant") {
  return {
    session: {
      id: "ses_assistant",
      kind: "coding-assistant",
      title,
      directory: ROW_DIRECTORY,
      time: { created: 1, updated: 2 },
    },
  }
}

function conversationBody() {
  return {
    board: {
      kind: "session",
      sessionID: "ses_assistant",
      title: "Assistant",
      directory: ROW_DIRECTORY,
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { sessions: [] },
    agentView: { sessions: [] },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    messageWatermark: 0,
  }
}

function fakeTransport(requests: TransportRequest[], streams: StreamOpenRequest[] = []): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      if (req.path === "coding/session") {
        return { status: 200, ok: true, headers: {}, body: sessionBody() as T }
      }
      if (req.path === "coding/session/ses_assistant" && req.method === "GET") {
        return { status: 200, ok: true, headers: {}, body: sessionBody() as T }
      }
      if (req.path === "coding/session/ses_assistant" && req.method === "PATCH") {
        return { status: 200, ok: true, headers: {}, body: sessionBody("Renamed") as T }
      }
      if (req.path === "coding/session/ses_assistant/abort" && req.method === "POST") {
        return { status: 200, ok: true, headers: {}, body: true as T }
      }
      if (req.path === "coding/session/ses_assistant" && req.method === "DELETE") {
        return { status: 200, ok: true, headers: {}, body: true as T }
      }
      if (req.path === "session/ses_assistant/conversation") {
        return { status: 200, ok: true, headers: {}, body: conversationBody() as T }
      }
      throw new Error(`unexpected request ${req.method} ${req.path}`)
    },
    openStream(input: StreamOpenRequest, _handlers: StreamHandlers) {
      streams.push(input)
      return {
        close() {},
      }
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

afterEach(() => {
  stopSSE()
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  resetWriter()
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
  setCodingAssistantStore({
    sessions: [],
    selectedSessionID: "",
    loading: false,
    loadingMore: false,
    error: "",
    searchQuery: "",
    nextCursor: null,
    actionBusyID: "",
  })
})

test("selectCodingAssistantSession claims, hydrates, and streams with the row directory", async () => {
  const requests: TransportRequest[] = []
  const streams: StreamOpenRequest[] = []
  configure({ directory: SETTINGS_DIRECTORY })
  __setHostTransportForTest(fakeTransport(requests, streams))

  await selectCodingAssistantSession({ sessionID: "ses_assistant", directory: ROW_DIRECTORY })

  expect(requests.map((request) => request.path)).toEqual([
    "coding/session/ses_assistant",
    "session/ses_assistant/conversation",
  ])
  expect(requests.map((request) => request.query?.directory)).toEqual([ROW_DIRECTORY, ROW_DIRECTORY])
  expect(streams).toEqual([{ path: "session/ses_assistant/events", query: { directory: ROW_DIRECTORY } }])
})

test("coding assistant row actions send the row directory explicitly", async () => {
  const requests: TransportRequest[] = []
  configure({ directory: SETTINGS_DIRECTORY })
  __setHostTransportForTest(fakeTransport(requests))

  await renameCodingAssistantSession({ sessionID: "ses_assistant", directory: ROW_DIRECTORY }, " Renamed ")
  await stopCodingAssistantSession({ sessionID: "ses_assistant", directory: ROW_DIRECTORY })
  await deleteCodingAssistantSession({ sessionID: "ses_assistant", directory: ROW_DIRECTORY })

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "PATCH coding/session/ses_assistant",
    "POST coding/session/ses_assistant/abort",
    "DELETE coding/session/ses_assistant",
  ])
  expect(requests.map((request) => request.query?.directory)).toEqual([ROW_DIRECTORY, ROW_DIRECTORY, ROW_DIRECTORY])
})

test("coding assistant row actions reject missing directories before transport", async () => {
  const requests: TransportRequest[] = []
  __setHostTransportForTest(fakeTransport(requests))

  await expect(selectCodingAssistantSession({ sessionID: "ses_assistant", directory: "" })).rejects.toThrow(
    "session directory is required",
  )
  await expect(
    renameCodingAssistantSession({ sessionID: "ses_assistant", directory: "" }, "Renamed"),
  ).rejects.toThrow("directory")
  await expect(stopCodingAssistantSession({ sessionID: "ses_assistant", directory: "" })).rejects.toThrow("directory")
  await expect(deleteCodingAssistantSession({ sessionID: "ses_assistant", directory: "" })).rejects.toThrow(
    "directory",
  )
  expect(requests).toEqual([])
})

test("createCodingAssistantSession reuses the created row directory for selection", async () => {
  const requests: TransportRequest[] = []
  const streams: StreamOpenRequest[] = []
  __setHostTransportForTest(fakeTransport(requests, streams))

  await createCodingAssistantSession({ directory: ROW_DIRECTORY })

  expect(requests.map((request) => request.path)).toEqual([
    "coding/session",
    "coding/session/ses_assistant",
    "session/ses_assistant/conversation",
  ])
  expect(requests.map((request) => request.query?.directory)).toEqual([ROW_DIRECTORY, ROW_DIRECTORY, ROW_DIRECTORY])
  expect(streams[0]?.query?.directory).toBe(ROW_DIRECTORY)
})
