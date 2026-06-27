import { beforeEach, describe, expect, mock, test } from "bun:test"

const apiHandlers = new Map<string, () => unknown | Promise<unknown>>()
const apiCalls: string[] = []
let legacySectionPhaseCalls = 0

function orderKey(domain: "message" | "part", time: number, id: string): string {
  const rank = domain === "message" ? 30 : 31
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

mock.module("../src/services/api", () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: async (path: string) => {
    throw new Error(`unexpected apiRequest path: ${path}`)
  },
  apiJson: async (path: string) => {
    apiCalls.push(path)
    const handler = apiHandlers.get(path)
    if (!handler) throw new Error(`unexpected apiJson path: ${path}`)
    return await handler()
  },
  configure: () => undefined,
}))

mock.module("../src/utils/section", () => ({
  clearSectionPhases: () => undefined,
  syncSectionPhases: () => {
    legacySectionPhaseCalls += 1
    throw new Error("loadConversation must not call the legacy DOM section phase writer")
  },
}))

const messages = await import("../src/store/messages")
const board = await import("../src/store/board")

beforeEach(() => {
  apiHandlers.clear()
  apiCalls.length = 0
  legacySectionPhaseCalls = 0
  messages.clearMessages()
  board.setBoardStore("selectedSource", null)
  board.setBoardStore("board", null)
  board.setBoardStore("changes", [])
})

describe("loadConversation section phase ownership", () => {
  test("loadConversation does not call the legacy DOM section phase writer", async () => {
    board.setBoardStore("selectedSource", { kind: "task", id: "tsk_phase_owner" })
    board.setBoardStore("board", {
      task: { id: "tsk_phase_owner", status: "active" },
      run: { phase: "plan" },
      spec: { content: "requirements" },
      plan: { content: "plan" },
      goalWorkflows: [],
    })
    apiHandlers.set("task/tsk_phase_owner/transcript", () => [
      {
        info: {
          id: "msg_phase_owner",
          role: "assistant",
          sessionID: "ses_phase_owner",
          orderKey: orderKey("message", 1, "msg_phase_owner"),
          time: { created: 1 },
        },
        parts: [
          {
            id: "part_phase_owner",
            type: "text",
            text: "loaded transcript",
            messageID: "msg_phase_owner",
            sessionID: "ses_phase_owner",
            orderKey: orderKey("part", 2, "part_phase_owner"),
          },
        ],
      },
    ])

    await messages.loadConversation()

    expect(legacySectionPhaseCalls).toBe(0)
    expect(messages.messageStore.messages.map((message) => message.info.id)).toEqual(["msg_phase_owner"])
    expect(apiCalls).toEqual(["task/tsk_phase_owner/transcript"])
  })
})
