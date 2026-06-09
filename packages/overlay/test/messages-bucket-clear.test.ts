// Regression for the `setStore("messagesBySession", obj)` merge-not-replace
// trap: when `setMessages([])` is called, all per-session buckets must be
// dropped. The naive assignment in the old impl merged instead of replacing,
// so buckets from a previous task leaked into the next.

import { test, expect } from "bun:test"
import { enqueueEvent, messageStore, setMessages, clearEventQueue } from "../src/store/messages"

test("setMessages([]) clears messagesBySession", async () => {
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: { id: "m-bucket-clear", sessionID: "sess-to-be-cleared", role: "assistant", time: { created: 1 } },
    },
  })
  await Bun.sleep(80)
  expect(Object.keys(messageStore.messagesBySession)).toContain("sess-to-be-cleared")

  setMessages([])
  clearEventQueue()
  expect(Object.keys(messageStore.messagesBySession)).toEqual([])
})
