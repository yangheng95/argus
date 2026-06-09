// Regression test for the token-doubling bug:
// applyMessageEvent wrote text deltas through a functional updater mirrored
// across store.messages and store.messagesBySession. Because those arrays
// hold the SAME Message refs, the second setStore ran the updater on the
// already-appended value — doubling every streamed token ("TheThe userThe user user wants wants").

import { beforeEach, expect, test } from "bun:test"
import { clearEventQueue, enqueueEvent, messageStore, setMessages } from "../src/store/messages"

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

test("text deltas are not doubled across mirrored message store paths", async () => {
  // Create a message + part, then stream 4 deltas. Final text should be the
  // concatenation exactly — not each token repeated.
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "m1",
        sessionID: "sess-1",
        role: "assistant",
        time: { created: 1 },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "p1",
        messageID: "m1",
        sessionID: "sess-1",
        type: "text",
        text: "",
      },
    },
  })

  // Four streamed deltas
  const deltas = ["Hello", " ", "world", "!"]
  for (const delta of deltas) {
    enqueueEvent({
      type: "message.part.delta",
      payload: {
        messageID: "m1",
        sessionID: "sess-1",
        partID: "p1",
        field: "text",
        delta,
      },
    })
  }
  await Bun.sleep(80)

  const msg = messageStore.messages[0]
  const part = msg.parts[0] as any
  expect(part.text).toBe("Hello world!")

  // Also verify the per-session bucket has the same final text (they share refs)
  const bucket = (messageStore as any).messagesBySession?.["sess-1"]
  if (bucket) {
    expect((bucket[0].parts[0] as any).text).toBe("Hello world!")
  }
})

test("new parts from message.part.updated are not pushed twice", async () => {
  // Regression for the "parts-array shared across messages/messagesBySession"
  // double-push bug: produce(push) running twice against the same underlying
  // array caused each newly added tool/text part to appear twice.
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "m3",
        sessionID: "sess-3",
        role: "assistant",
        time: { created: 1 },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "part-a",
        messageID: "m3",
        sessionID: "sess-3",
        type: "text",
        text: "first",
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "part-b",
        messageID: "m3",
        sessionID: "sess-3",
        type: "tool",
        tool: "glob",
        state: { status: "completed" },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "part-c",
        messageID: "m3",
        sessionID: "sess-3",
        type: "text",
        text: "third",
      },
    },
  })
  await Bun.sleep(80)

  const msg = messageStore.messages[0]
  expect(msg.parts.length).toBe(3)
  const partIDs = msg.parts.map((p: any) => p.id)
  expect(partIDs).toEqual(["part-a", "part-b", "part-c"])

  const bucket = (messageStore as any).messagesBySession?.["sess-3"]
  if (bucket) {
    const bucketPartIDs = bucket[0].parts.map((p: any) => p.id)
    expect(bucketPartIDs).toEqual(["part-a", "part-b", "part-c"])
  }
})

test("text-delta-induced placeholder parts are not pushed twice", async () => {
  // Regression for the "text delta creates a new text part" push path, same
  // shared-array gotcha as above.
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "m4",
        sessionID: "sess-4",
        role: "assistant",
        time: { created: 1 },
      },
    },
  })
  // No part.updated first — a delta arriving before any part triggers the
  // placeholder-creation push.
  enqueueEvent({
    type: "message.part.delta",
    payload: {
      messageID: "m4",
      sessionID: "sess-4",
      partID: "new-part",
      field: "text",
      delta: "chunk",
    },
  })
  await Bun.sleep(80)

  const msg = messageStore.messages[0]
  // Exactly ONE placeholder, not two.
  expect(msg.parts.length).toBe(1)
  expect((msg.parts[0] as any).id).toBe("new-part")
  expect((msg.parts[0] as any).text).toBe("chunk")
})

test("tool raw field deltas are not doubled either", async () => {
  enqueueEvent({
    type: "message.updated",
    payload: {
      info: {
        id: "m2",
        sessionID: "sess-2",
        role: "assistant",
        time: { created: 1 },
      },
    },
  })
  enqueueEvent({
    type: "message.part.updated",
    payload: {
      part: {
        id: "tp1",
        messageID: "m2",
        sessionID: "sess-2",
        type: "tool",
        tool: "bash",
        state: { status: "running", input: {}, raw: "" },
      },
    },
  })

  const chunks = ["line1\n", "line2\n", "line3\n"]
  for (const delta of chunks) {
    enqueueEvent({
      type: "message.part.delta",
      payload: {
        messageID: "m2",
        sessionID: "sess-2",
        partID: "tp1",
        field: "raw",
        delta,
      },
    })
  }
  await Bun.sleep(80)

  const msg = messageStore.messages[0]
  const part = msg.parts[0] as any
  expect(part.state?.raw).toBe("line1\nline2\nline3\n")
})
