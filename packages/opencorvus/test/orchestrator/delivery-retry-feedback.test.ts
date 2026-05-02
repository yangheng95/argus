import { describe, expect, test } from "bun:test"
import { composeDeliveryRetryFeedback } from "../../src/orchestrator/delivery-retry-feedback"

describe("delivery retry feedback", () => {
  test("includes host manifest gate details in per-goal retry feedback", () => {
    const text = composeDeliveryRetryFeedback({
      iteration: 2,
      verdict: "rejected",
      summary: "Delivery is blocked by deterministic host gates.",
      manifestFailureDetails: [
        "[review] specialist:client_contract Specialist Review: client_contract status=failed: blocking:evidence_quality: missing client evidence",
        "[runtime] runtime:web:. Web Runtime Render status=failed: render_failed: ETIMEDOUT",
      ],
      ownDetails: [{
        category: "runtime",
        error: "calculator render failed before puppeteer could inspect the DOM",
        suggestion: "Fix the render launch failure before changing calculator UI.",
      }],
    })

    expect(text).toContain("Host manifest gate failures:")
    expect(text).toContain("specialist:client_contract")
    expect(text).toContain("render_failed: ETIMEDOUT")
    expect(text).toContain("[runtime] calculator render failed")
  })
})
