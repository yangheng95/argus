// Regression for the `setStore("messagesBySession", obj)` merge-not-replace
// trap: when `setMessages([])` is called, all per-session buckets must be
// dropped. The naive assignment in the old impl merged instead of replacing,
// so buckets from a previous task leaked into the next.

import { test, expect } from "bun:test"
import { messageStore, setMessages, clearEventQueue } from "../src/store/messages"

function orderKey(domain: "message" | "part", time: number, id: string): string {
  const rank = domain === "message" ? 30 : 31
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

test("setMessages([]) clears messagesBySession", async () => {
  setMessages([
    {
      info: {
        id: "m-bucket-clear",
        sessionID: "sess-to-be-cleared",
        role: "assistant",
        channel: "assistant",
        resolvedRole: "assistant",
        orderKey: orderKey("message", 1, "m-bucket-clear"),
        time: { created: 1 },
      },
      parts: [
        {
          id: "p-bucket-clear",
          messageID: "m-bucket-clear",
          sessionID: "sess-to-be-cleared",
          type: "text",
          text: "body",
          orderKey: orderKey("part", 2, "p-bucket-clear"),
        },
      ],
    },
  ])
  expect(Object.keys(messageStore.messagesBySession)).toContain("sess-to-be-cleared")

  setMessages([])
  clearEventQueue()
  expect(Object.keys(messageStore.messagesBySession)).toEqual([])
})
