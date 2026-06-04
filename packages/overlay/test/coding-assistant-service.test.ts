import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import {
  createCodingAssistantSession,
  hydrateCodingAssistantTranscript,
  listCodingAssistantSessions,
  sendCodingAssistantPrompt,
} from "../src/services/coding-assistant"
import {
  applyAssistantSessionEvent,
  normalizeMessage,
  partText,
  type AssistantMessage,
} from "../src/services/coding-assistant-transcript"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

const SAVED_DIRECTORY = "D:/workspace/app"

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      if (req.path === "coding/sessions") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            sessions: [{
              id: "ses_existing",
              title: "Coding assistant",
              directory: SAVED_DIRECTORY,
              kind: "assistant",
            }],
          } as T,
        }
      }
      if (req.path === "coding/session") {
        return {
          status: 201,
          ok: true,
          headers: {},
          body: {
            session: {
              id: "ses_created",
              title: "Coding assistant",
              directory: SAVED_DIRECTORY,
              kind: "assistant",
            },
          } as T,
        }
      }
      if (req.path === "session/ses_existing/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [{
              info: { id: "msg_1", role: "assistant", time: { created: 1 } },
              parts: [{ id: "part_1", messageID: "msg_1", type: "text", text: "hello" }],
            }],
          } as T,
        }
      }
      if (req.path === "session/ses_existing/prompt_async") {
        return { status: 202, ok: true, headers: {}, body: { taskID: "tsk_1" } as T }
      }
      throw new Error(`unexpected path ${req.path}`)
    },
    openStream() {
      throw new Error("openStream not used in coding assistant service tests")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

beforeEach(() => {
  configure({ serverUrl: "http://127.0.0.1:7878", directory: SAVED_DIRECTORY })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

describe("coding assistant service", () => {
  test("lists right-sidebar sessions through project-scoped coding route", async () => {
    let captured: TransportRequest | undefined
    __setHostTransportForTest(fakeTransport((req) => { captured = req }))

    const sessions = await listCodingAssistantSessions(3)

    expect(sessions.map((item) => item.id)).toEqual(["ses_existing"])
    expect(captured?.path).toBe("coding/sessions")
    expect(captured?.query).toMatchObject({ limit: "3", directory: SAVED_DIRECTORY })
  })

  test("creates a right-sidebar session through project-scoped coding route", async () => {
    let captured: TransportRequest | undefined
    __setHostTransportForTest(fakeTransport((req) => { captured = req }))

    const session = await createCodingAssistantSession()

    expect(session.id).toBe("ses_created")
    expect(captured?.path).toBe("coding/session")
    expect(captured?.method).toBe("POST")
    expect(captured?.query).toMatchObject({ directory: SAVED_DIRECTORY })
  })

  test("hydrates transcript and sends prompt through canonical session routes", async () => {
    const captured: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => { captured.push(req) }))

    const transcript = await hydrateCodingAssistantTranscript("ses_existing")
    const queued = await sendCodingAssistantPrompt("ses_existing", "project status")

    expect(transcript[0]?.parts[0]?.text).toBe("hello")
    expect(queued.taskID).toBe("tsk_1")
    expect(captured[0]?.path).toBe("session/ses_existing/conversation")
    expect(captured[0]?.query).toMatchObject({ tail_limit: "80", directory: SAVED_DIRECTORY })
    expect(captured[1]?.path).toBe("session/ses_existing/prompt_async")
    expect(captured[1]?.method).toBe("POST")
    expect(captured[1]?.body).toEqual({
      kind: "json",
      value: {
        parts: [{ type: "text", text: "project status" }],
      },
    })
  })
})

describe("coding assistant transcript reducer", () => {
  test("normalizes messages and appends text deltas", () => {
    const start = normalizeMessage({
      info: { id: "msg_1", role: "assistant", time: { created: 1 } },
      parts: [{ id: "part_1", messageID: "msg_1", type: "text", text: "hel" }],
    })
    expect(start).not.toBeNull()

    const next = applyAssistantSessionEvent([start as AssistantMessage], {
      type: "message.part.delta",
      payload: { messageID: "msg_1", partID: "part_1", field: "text", delta: "lo" },
    })

    expect(next[0]?.parts[0]?.text).toBe("hello")
  })

  test("creates placeholder assistant message when part arrives before message update", () => {
    const next = applyAssistantSessionEvent([], {
      type: "message.part.updated",
      payload: {
        part: { id: "part_1", messageID: "msg_1", type: "tool", tool: "panel", state: { status: "completed" } },
      },
    })

    expect(next[0]?.info).toMatchObject({ id: "msg_1", role: "assistant", agent: "coding" })
    expect(partText(next[0]!.parts[0]!)).toBe("panel · completed")
  })

  test("ignores invalid events without changing the transcript", () => {
    const messages: AssistantMessage[] = [{
      info: { id: "msg_1", role: "assistant", time: { created: 1 } },
      parts: [],
    }]

    expect(applyAssistantSessionEvent(messages, { type: "message.part.delta", payload: { field: "text" } })).toBe(messages)
    expect(applyAssistantSessionEvent(messages, { type: "unknown", payload: {} })).toBe(messages)
  })
})
