import { beforeEach, expect, test } from "bun:test"
import {
  clearEventQueue,
  enqueueEvent,
  ingestPersistedMessage,
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

test("legacy messageStore live event ingestion is retired", () => {
  expect(() =>
    enqueueEvent({
      type: "message.updated",
      payload: {
        info: {
          id: "msg-1",
          sessionID: "session-1",
          role: "assistant",
          channel: "assistant",
          resolvedRole: "assistant",
          time: { created: 10, updated: 10 },
        },
      },
    }),
  ).toThrow("messageStore live ingestion is retired for message.updated")
  expect(messageStore.messages).toEqual([])
})

test("legacy persisted messageStore ingestion is retired", () => {
  expect(() =>
    ingestPersistedMessage({
      info: {
        id: "msg-1",
        sessionID: "session-1",
        role: "assistant",
        channel: "assistant",
        resolvedRole: "assistant",
        orderKey: orderKey("message", 10, "msg-1"),
        time: { created: 10 },
      },
      parts: [
        {
          id: "part-1",
          messageID: "msg-1",
          sessionID: "session-1",
          type: "text",
          text: "first",
          orderKey: orderKey("part", 11, "part-1"),
        },
      ],
    }),
  ).toThrow("messageStore live ingestion is retired for persisted.message")
  expect(messageStore.messages).toEqual([])
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
          channel: "assistant",
          resolvedRole: "assistant",
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
          channel: "assistant",
          resolvedRole: "assistant",
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
          channel: "assistant",
          resolvedRole: "assistant",
          orderKey: orderKey("message", 10, "msg-missing-role"),
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-role role missing")
})

test("loaded messages without channel fail instead of deriving from role", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-missing-channel",
          sessionID: "session-missing-channel",
          role: "assistant",
          resolvedRole: "assistant",
          orderKey: orderKey("message", 10, "msg-missing-channel"),
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-channel channel missing")
})

test("loaded messages without resolvedRole fail instead of deriving from role", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-missing-resolved-role",
          sessionID: "session-missing-resolved-role",
          role: "assistant",
          channel: "assistant",
          orderKey: orderKey("message", 10, "msg-missing-resolved-role"),
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-resolved-role resolvedRole missing")
})

test("loaded messages without orderKey fail instead of sorting by local fields", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-missing-order",
          sessionID: "session-missing-order",
          role: "assistant",
          channel: "assistant",
          resolvedRole: "assistant",
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-missing-order missing orderKey")
})

test("setMessages rejects incomplete visible messages instead of accepting legacy shapes", () => {
  expect(() =>
    setMessages([
      {
        info: {
          id: "msg-legacy-shape",
          sessionID: "session-legacy-shape",
          role: "assistant",
          time: { created: 10 },
        },
        parts: [],
      },
    ]),
  ).toThrow("loaded conversation message msg-legacy-shape channel missing")
  expect(messageStore.messages).toEqual([])
})

test("setMessages sorts by message orderKey instead of local timestamps", () => {
  setMessages([
    {
      info: {
        id: "msg-second",
        sessionID: "session-order",
        role: "assistant",
        channel: "assistant",
        resolvedRole: "assistant",
        orderKey: orderKey("message", 20, "msg-second"),
        time: { created: 1 },
      },
      parts: [
        {
          id: "part-second",
          messageID: "msg-second",
          sessionID: "session-order",
          type: "text",
          text: "second",
          orderKey: orderKey("part", 21, "part-second"),
        },
      ],
    },
    {
      info: {
        id: "msg-first",
        sessionID: "session-order",
        role: "assistant",
        channel: "assistant",
        resolvedRole: "assistant",
        orderKey: orderKey("message", 10, "msg-first"),
        time: { created: 99 },
      },
      parts: [
        {
          id: "part-first",
          messageID: "msg-first",
          sessionID: "session-order",
          type: "text",
          text: "first",
          orderKey: orderKey("part", 11, "part-first"),
        },
      ],
    },
  ])

  expect(messageStore.messages.map((message) => message.info.id)).toEqual(["msg-first", "msg-second"])
  expect(messageStore.messagesBySession["session-order"].map((message) => message.info.id)).toEqual([
    "msg-first",
    "msg-second",
  ])
})

test("loaded parts without explicit ids fail instead of generating loaded-part ids", () => {
  expect(() =>
    mergeLoadedConversationMessages([], [
      {
        info: {
          id: "msg-part-missing-id",
          sessionID: "session-part-missing-id",
          role: "assistant",
          channel: "assistant",
          resolvedRole: "assistant",
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
          channel: "assistant",
          resolvedRole: "assistant",
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
          channel: "assistant",
          resolvedRole: "assistant",
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
