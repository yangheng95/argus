import { describe, expect, test } from "bun:test"
import { SubAgentProtocol } from "../../src/agent/sub-agent-protocol"

describe("SubAgentProtocol.trimText", () => {
  test("returns input unchanged when under cap", () => {
    expect(SubAgentProtocol.trimText("short", "ptr", 100)).toBe("short")
  })

  test("produces output that respects cap even at tight budgets", () => {
    const long = "x".repeat(5000)
    const out = SubAgentProtocol.trimText(long, "ptr://loc", 500)
    expect(out.length).toBeLessThanOrEqual(500)
    expect(out).toContain("truncated")
    expect(out).toContain("ptr://loc")
  })
})

describe("SubAgentProtocol.yieldResult", () => {
  test("caps headline — no transcript-through-headline bypass", () => {
    const out = SubAgentProtocol.yieldResult({
      headline: "X".repeat(10_000),
      pointer: "read_context",
    })
    // Headline alone cannot blow through the safe body cap.
    expect(out.length).toBeLessThanOrEqual(SubAgentProtocol.SAFE_BODY_CAP + 100)
    expect(out).toContain("truncated")
  })

  test("total output stays within the safe body cap for oversized fields", () => {
    const out = SubAgentProtocol.yieldResult({
      headline: "big",
      summary: "Z".repeat(20_000),
      fields: [
        ["a", "A".repeat(5_000)],
        ["b", "B".repeat(5_000)],
        ["c", "C".repeat(5_000)],
      ],
      pointer: "artifact:x",
    })
    expect(out.length).toBeLessThanOrEqual(SubAgentProtocol.HARD_CHAR_CAP)
  })

  test("field-omission notice appears when budget exhausted mid-loop", () => {
    const out = SubAgentProtocol.yieldResult({
      headline: "h",
      summary: "Z".repeat(19_000),
      fields: [
        ["x", "detail"],
        ["y", "detail"],
      ],
      pointer: "artifact:y",
    })
    // At least one field should be suppressed with a skip marker.
    expect(out).toMatch(/more fields omitted|truncated/)
  })
})
