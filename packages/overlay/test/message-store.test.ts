import { beforeEach, expect, test } from "bun:test"
import {
  clearEventQueue,
  enqueueEvent,
  mergeLoadedConversationMessages,
  messageStore,
  setMessages,
} from "../src/store/messages"

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => {
    cb()
    return 0
  }
}

beforeEach(() => {
  clearEventQueue()
  setMessages([])
})

test("message updates keep the earliest created time and stable ordering", async () => {
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "msg-1",
        sessionID: "session-1",
        role: "assistant",
        time: { created: 10, updated: 10 },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "first",
      },
    },
  })
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "msg-2",
        sessionID: "session-1",
        role: "assistant",
        time: { created: 20, updated: 20 },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "part-2",
        messageID: "msg-2",
        sessionID: "session-1",
        type: "text",
        text: "second",
      },
    },
  })
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "msg-1",
        sessionID: "session-1",
        role: "assistant",
        time: { created: 30, updated: 30 },
      },
    },
  })

  await Bun.sleep(80)

  expect(messageStore.messages.map((item) => item.info.id)).toEqual(["msg-1", "msg-2"])
  expect(messageStore.messages).toContainEqual(
    expect.objectContaining({
      info: expect.objectContaining({
        id: "msg-1",
        time: expect.objectContaining({
          created: 10,
          updated: 30,
        }),
      }),
    }),
  )
})

test("loaded messages with explicit ids do not compute content signatures", () => {
  const part: any = {
    id: "part-explicit",
    type: "text",
    text: "body",
  }
  Object.defineProperty(part, "state", {
    enumerable: false,
    get() {
      throw new Error("explicit-id messages must not read signature-only body fields")
    },
  })

  const messages = mergeLoadedConversationMessages([], [
    {
      info: {
        id: "msg-explicit",
        sessionID: "session-explicit",
        role: "assistant",
      },
      parts: [part],
    },
  ])

  expect(messages).toHaveLength(1)
  expect(messages[0].info.id).toBe("msg-explicit")
  expect(messages[0].parts[0].id).toBe("part-explicit")
})

test("loaded messages without explicit ids still use deterministic content signatures", () => {
  const message = {
    info: {
      sessionID: "session-generated",
      role: "assistant",
      time: { created: 10, updated: 10 },
    },
    parts: [
      {
        id: "part-generated",
        type: "text",
        text: "body",
      },
    ],
  }

  const first = mergeLoadedConversationMessages([], [message])
  const second = mergeLoadedConversationMessages([], [message])
  const deduped = mergeLoadedConversationMessages([message], [message])

  expect(first[0].info.id.startsWith("loaded-msg:")).toBe(true)
  expect(second[0].info.id).toBe(first[0].info.id)
  expect(deduped).toHaveLength(1)
})
