import { describe, expect, it } from "bun:test"
import { parseOverlayReply } from "@/tool/overlay-client"

describe("overlay client parser", () => {
  it("parses confirm reply payload", () => {
    const line = JSON.stringify({ type: "confirm-reply", id: "confirm_1", answer: "confirm" })
    const result = parseOverlayReply(line)
    expect(result).toEqual({ id: "confirm_1", answer: "confirm" })
  })

  it("ignores invalid payload", () => {
    const line = JSON.stringify({ type: "hint", id: "confirm_1", answer: "confirm" })
    const result = parseOverlayReply(line)
    expect(result).toBeUndefined()
  })
})
