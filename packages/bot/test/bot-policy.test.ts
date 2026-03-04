import { describe, expect, test } from "bun:test"
import { permissionReply, queueLimit } from "../src/bot-policy"

describe("bot policy", () => {
  test("queueLimit parses valid env and falls back on invalid", () => {
    expect(queueLimit({ OPENCORVUS_BOT_SESSION_QUEUE_LIMIT: "12" })).toBe(12)
    expect(queueLimit({ OPENCORVUS_BOT_SESSION_QUEUE_LIMIT: "0" })).toBe(20)
    expect(queueLimit({ OPENCORVUS_BOT_SESSION_QUEUE_LIMIT: "abc" })).toBe(20)
  })

  test("permissionReply defaults to always and accepts known replies", () => {
    expect(permissionReply({})).toBe("always")
    expect(permissionReply({ OPENCORVUS_BOT_PERMISSION_ASK_REPLY: "always" })).toBe("always")
    expect(permissionReply({ OPENCORVUS_BOT_PERMISSION_ASK_REPLY: "once" })).toBe("once")
    expect(permissionReply({ OPENCORVUS_PERMISSION_ASK_REPLY: "reject" })).toBe("reject")
    expect(
      permissionReply({
        OPENCORVUS_PERMISSION_ASK_REPLY: "reject",
        OPENCORVUS_BOT_PERMISSION_ASK_REPLY: "once",
      }),
    ).toBe("once")
    expect(permissionReply({ OPENCORVUS_BOT_PERMISSION_ASK_REPLY: "bad" })).toBe("always")
  })
})
