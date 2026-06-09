import { expect, test } from "bun:test"
import {
  __displayableConversationTranscriptForTest,
  __conversationHistoryBeforeForTest,
  __conversationHistoryWindowForTest,
} from "../../src/server/routes/orchestrator"

function message(id: string, sessionID: string, created: number) {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      channel: "assistant",
      time: { created },
    },
    parts: [],
  }
}

test("conversation tail window uses a stable message-id cursor for same-timestamp history", () => {
  const transcript = [message("msg_a", "ses_a", 100), message("msg_b", "ses_b", 100), message("msg_c", "ses_c", 200)]

  const tail = __conversationHistoryWindowForTest(transcript, [], { tailLimit: 2 })

  expect(tail.transcript.map((item) => item.info.id)).toEqual(["msg_b", "msg_c"])
  expect(tail.history).toEqual({
    oldestTimestamp: 100,
    oldestMessageID: "msg_b",
    hasMore: true,
    limit: 2,
  })

  const older = __conversationHistoryBeforeForTest(transcript, [], {
    before: tail.history.oldestTimestamp!,
    beforeID: tail.history.oldestMessageID!,
    limit: 2,
  })

  expect(older.transcript.map((item) => item.info.id)).toEqual(["msg_a"])
  expect(older.history.hasMore).toBe(false)
})

test("conversation history page keeps timeline events throughout the requested timestamp window", () => {
  const transcript = [message("msg_old", "ses_old", 100), message("msg_boundary", "ses_boundary", 300)]
  const timeline = [
    { id: "tl_old", timestamp: 120 },
    { id: "tl_gap", timestamp: 250 },
    { id: "tl_newer", timestamp: 320 },
  ]

  const page = __conversationHistoryBeforeForTest(transcript, timeline, {
    before: 300,
    beforeID: "msg_boundary",
    limit: 1,
  })

  expect(page.transcript.map((item) => item.info.id)).toEqual(["msg_old"])
  expect(page.timeline.map((item) => item.id)).toEqual(["tl_old", "tl_gap"])
})

test("conversation tail window keeps the requested message-count cap", () => {
  const transcript = [
    message("msg_a1", "ses_a", 100),
    message("msg_b1", "ses_b", 110),
    message("msg_a2", "ses_a", 120),
    message("msg_c1", "ses_c", 130),
  ]

  const page = __conversationHistoryWindowForTest(transcript, [], { tailLimit: 2 })

  expect(page.transcript.map((item) => item.info.id)).toEqual(["msg_a2", "msg_c1"])
  expect(page.history.hasMore).toBe(true)
})

test("conversation hydrate filters non-display transcript messages before windowing", () => {
  const transcript = [
    message("msg_empty", "ses_build", 100),
    { ...message("msg_step", "ses_build", 110), parts: [{ type: "step-start" }] },
    { ...message("msg_text", "ses_build", 120), parts: [{ type: "text", text: "real build output" }] },
    { ...message("msg_tool", "ses_build", 130), parts: [{ type: "tool", tool: "bash" }] },
  ]

  const filtered = __displayableConversationTranscriptForTest(transcript)

  expect(filtered.map((item) => item.info.id)).toEqual(["msg_text", "msg_tool"])
})
