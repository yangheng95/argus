import { describe, expect, it } from "bun:test"
import { overlayDiagnostic, parseOverlayReply, resolveOverlayCoord } from "@/tool/overlay-client"
import { overlayProtocol } from "@/tool/overlay-protocol"

describe("overlay client parser", () => {
  it("parses confirm reply payload", () => {
    const line = JSON.stringify({ type: overlayProtocol.messages.confirmReply, id: "confirm_1", answer: "confirm" })
    const result = parseOverlayReply(line)
    expect(result).toEqual({ id: "confirm_1", answer: "confirm" })
  })

  it("ignores invalid payload", () => {
    const line = JSON.stringify({ type: overlayProtocol.messages.hint, id: "confirm_1", answer: "confirm" })
    const result = parseOverlayReply(line)
    expect(result).toBeUndefined()
  })

  it("exposes diagnostic snapshot", () => {
    const diag = overlayDiagnostic()
    expect(typeof diag.path).toBe("string")
    expect(diag.path.length).toBeGreaterThan(0)
    expect(typeof diag.available).toBe("boolean")
    expect(typeof diag.failures).toBe("number")
    expect(typeof diag.consecutiveFailures).toBe("number")
    if (diag.nextRetryAt !== undefined) expect(typeof diag.nextRetryAt).toBe("number")
    if (diag.circuitOpenUntil !== undefined) expect(typeof diag.circuitOpenUntil).toBe("number")
  })

  it("keeps zero and negative coordinates", () => {
    expect(resolveOverlayCoord(0, 240)).toBe(0)
    expect(resolveOverlayCoord(-320, 240)).toBe(-320)
  })

  it("falls back only when coordinate is missing or invalid", () => {
    expect(resolveOverlayCoord(undefined, 240)).toBe(240)
    expect(resolveOverlayCoord(Number.NaN, 240)).toBe(240)
  })
})
