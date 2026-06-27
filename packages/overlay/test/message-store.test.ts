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

function orderKey(domain: "message" | "part", time: number, id: string): string {
  const rank = domain === "message" ? 30 : 31
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

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

  const messages = mergeLoadedConversationMessages(
    [],
    [
      {
        info: {
          id: "msg-explicit",
          sessionID: "session-explicit",
          role: "assistant",
          orderKey: orderKey("message", 10, "msg-explicit"),
        },
        parts: [
          {
            ...part,
            messageID: "msg-explicit",
            sessionID: "session-explicit",
            orderKey: orderKey("part", 11, "part-explicit"),
          },
        ],
      },
    ],
  )

  expect(messages).toHaveLength(1)
  expect(messages[0].info.id).toBe("msg-explicit")
  expect(messages[0].parts[0].id).toBe("part-explicit")
  const deduped = mergeLoadedConversationMessages(messages, messages)
  expect(deduped).toHaveLength(1)
})

test("loaded messages without explicit ids fail instead of generating loaded-msg ids", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          sessionID: "session-generated",
          role: "assistant",
          orderKey: orderKey("message", 10, "msg-generated"),
          time: { created: 10, updated: 10 },
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message id missing")
})

test("loaded messages without role fail instead of defaulting to assistant", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-missing-role",
          sessionID: "session-missing-role",
          orderKey: orderKey("message", 10, "msg-missing-role"),
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-role role missing")
})

test("loaded messages without orderKey fail instead of sorting by local fields", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-missing-order",
          sessionID: "session-missing-order",
          role: "assistant",
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-order missing orderKey")
})

test("loaded parts without explicit ids fail instead of generating loaded-part ids", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-part-missing-id",
          sessionID: "session-part-missing-id",
          role: "assistant",
          orderKey: orderKey("message", 10, "msg-part-missing-id"),
        },
        parts: [
          {
            messageID: "msg-part-missing-id",
            sessionID: "session-part-missing-id",
            type: "text",
            text: "body",
            orderKey: orderKey("part", 11, "part-generated"),
          },
        ],
      },
    ]),
  ).toThrow("loaded conversation message msg-part-missing-id part[0] id missing")
})

test("loaded parts without type fail instead of hydrating invalid Part records", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-part-missing-type",
          sessionID: "session-part-missing-type",
          role: "assistant",
          orderKey: orderKey("message", 10, "msg-part-missing-type"),
        },
        parts: [
          {
            id: "part-missing-type",
            messageID: "msg-part-missing-type",
            sessionID: "session-part-missing-type",
            text: "body",
            orderKey: orderKey("part", 11, "part-missing-type"),
          },
        ],
      },
    ]),
  ).toThrow("loaded conversation part part-missing-type type missing")
})

test("loaded parts without orderKey fail before hydrate projection", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-part-missing-order",
          sessionID: "session-part-missing-order",
          role: "assistant",
          orderKey: orderKey("message", 10, "msg-part-missing-order"),
        },
        parts: [
          {
            id: "part-missing-order",
            messageID: "msg-part-missing-order",
            sessionID: "session-part-missing-order",
            type: "text",
            text: "body",
          },
        ],
      },
    ]),
  ).toThrow("loaded conversation part part-missing-order missing orderKey")
})
