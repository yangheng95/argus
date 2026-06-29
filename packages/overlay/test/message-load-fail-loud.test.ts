import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Message } from "../src/store/messages"

const apiHandlers = new Map<string, () => unknown | Promise<unknown>>()
const apiCalls: string[] = []

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

const messages = await import("../src/store/messages")
const board = await import("../src/store/board")

function seedMessage(id = "msg_existing"): Message {
  return {
    info: {
      id,
      role: "assistant",
      sessionID: "ses_existing",
      channel: "assistant",
      resolvedRole: "assistant",
      orderKey: orderKey("message", 1, id),
      time: { created: 1 },
    },
    parts: [
      {
        id: `${id}_part`,
        type: "text",
        text: "existing transcript",
        messageID: id,
        sessionID: "ses_existing",
        orderKey: orderKey("part", 2, `${id}_part`),
      },
    ],
  }
}

beforeEach(() => {
  apiHandlers.clear()
  apiCalls.length = 0
  messages.clearMessages()
  board.setBoardStore("selectedSource", null)
})

describe("legacy message transcript loaders fail loudly", () => {
  test("syncTask rejects transcript fetch failures without replacing existing messages with an empty list", async () => {
    const existing = seedMessage()
    messages.setMessages([existing])
    apiHandlers.set("task/tsk_fail/transcript", () => {
      throw new Error("transcript unavailable")
    })

    await expect(messages.syncTask("tsk_fail")).rejects.toThrow("transcript unavailable")

    expect(messages.messageStore.messages.map((message) => message.info.id)).toEqual(["msg_existing"])
    expect(apiCalls).toContain("task/tsk_fail/transcript")
    expect(apiCalls).not.toContain("control/timeline?taskID=tsk_fail")
  })

  test("loadConversation rejects transcript fetch failures without clearing the current conversation", async () => {
    const existing = seedMessage()
    messages.setMessages([existing])
    board.setBoardStore("selectedSource", { kind: "task", id: "tsk_selected" })
    apiHandlers.set("task/tsk_selected/transcript", () => {
      throw new Error("selected transcript unavailable")
    })

    await expect(messages.loadConversation()).rejects.toThrow("selected transcript unavailable")

    expect(messages.messageStore.messages.map((message) => message.info.id)).toEqual(["msg_existing"])
    expect(apiCalls).toEqual(["task/tsk_selected/transcript"])
  })
})
