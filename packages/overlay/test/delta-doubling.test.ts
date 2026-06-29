import { beforeEach, expect, test } from "bun:test"
import { clearEventQueue, enqueueEvent, messageStore, setMessages } from "../src/store/messages"

beforeEach(() => {
  clearEventQueue()
  setMessages([])
})

test("messageStore no longer accepts live text delta ingestion", () => {
  expect(() =>
    enqueueEvent({
      type: "message.part.delta",
      payload: {
        messageID: "m1",
        sessionID: "sess-1",
        partID: "p1",
        field: "text",
        delta: "chunk",
      },
    }),
  ).toThrow("messageStore live ingestion is retired for message.part.delta")
  expect(messageStore.messages).toEqual([])
  expect(messageStore.messagesBySession).toEqual({})
})

test("messageStore no longer accepts live part updates", () => {
  expect(() =>
    enqueueEvent({
      type: "message.part.updated",
      payload: {
        part: {
          id: "p1",
          messageID: "m1",
          sessionID: "sess-1",
          type: "text",
          text: "body",
        },
      },
    }),
  ).toThrow("messageStore live ingestion is retired for message.part.updated")
  expect(messageStore.messages).toEqual([])
  expect(messageStore.messagesBySession).toEqual({})
})
