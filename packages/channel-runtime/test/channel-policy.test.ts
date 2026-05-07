import { describe, expect, test } from "bun:test"
import { queueLimit } from "../src/channel-policy"

describe("channel policy", () => {
  test("queueLimit parses valid env and falls back on invalid", () => {
    expect(queueLimit({ OPENCORVUS_CHANNEL_SESSION_QUEUE_LIMIT: "12" })).toBe(12)
    expect(queueLimit({ OPENCORVUS_CHANNEL_SESSION_QUEUE_LIMIT: "0" })).toBe(20)
    expect(queueLimit({ OPENCORVUS_CHANNEL_SESSION_QUEUE_LIMIT: "abc" })).toBe(20)
  })
})
