import { describe, expect, test } from "bun:test"
import { DeliveryVerdict } from "../../src/delivery/verdict"

describe("delivery verdict schema", () => {
  test("materializes deferred check defaults during parse", () => {
    const verdict = DeliveryVerdict.parse({
      verdict: "rejected",
      summary: "Delivery is missing required behavior.",
      tool_call_evidence: [{
        tool: "read_file",
        passed: true,
        detail: "inspected delivery evidence",
      }],
      rejection_details: [{
        category: "quality",
        error: "Required behavior is not implemented in the delivered artifact.",
      }],
    })

    expect(verdict.deferred_checks).toEqual([])
  })

  test("rejects null deferred checks instead of treating them as empty", () => {
    expect(() => DeliveryVerdict.parse({
      verdict: "rejected",
      summary: "Delivery is missing required behavior.",
      deferred_checks: null,
      tool_call_evidence: [{
        tool: "read_file",
        passed: true,
        detail: "inspected delivery evidence",
      }],
      rejection_details: [{
        category: "quality",
        error: "Required behavior is not implemented in the delivered artifact.",
      }],
    })).toThrow()
  })
})
