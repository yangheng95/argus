import { describe, expect, test } from "bun:test"
import { AcceptanceVerdict } from "../../src/acceptance/verdict"

describe("acceptance verdict schema", () => {
  test("materializes deferred check defaults during parse", () => {
    const verdict = AcceptanceVerdict.parse({
      verdict: "rejected",
      summary: "Acceptance is missing required behavior.",
      tool_call_evidence: [
        {
          tool: "read_file",
          passed: true,
          detail: "inspected acceptance evidence",
        },
      ],
      rejection_details: [
        {
          category: "quality",
          error: "Required behavior is not implemented in the delivered artifact.",
        },
      ],
    })

    expect(verdict.deferred_checks).toEqual([])
  })

  test("rejects null deferred checks instead of treating them as empty", () => {
    expect(() =>
      AcceptanceVerdict.parse({
        verdict: "rejected",
        summary: "Acceptance is missing required behavior.",
        deferred_checks: null,
        tool_call_evidence: [
          {
            tool: "read_file",
            passed: true,
            detail: "inspected acceptance evidence",
          },
        ],
        rejection_details: [
          {
            category: "quality",
            error: "Required behavior is not implemented in the delivered artifact.",
          },
        ],
      }),
    ).toThrow()
  })
})
