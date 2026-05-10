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
        goal_id: "gol_calc",
        check_id: "runtime:web:.",
        suggestion: "Fix the render launch failure before changing calculator UI.",
      }],
      rawFeedbackPacket: {
        verdict_artifact_id: "artifact_verdict",
        manifest: {
          finalGate: {
            failedRuntimeFlowIds: ["runtime:web:."],
          },
        },
      },
    })

    expect(text).toContain("Host manifest gate failures:")
    expect(text).toContain("specialist:client_contract")
    expect(text).toContain("render_failed: ETIMEDOUT")
    expect(text).toContain("[runtime] calculator render failed")
    expect(text).toContain("check_id: runtime:web:.")
    expect(text).toContain("Canonical delivery feedback packet")
    expect(text).toContain("\"verdict_artifact_id\": \"artifact_verdict\"")
    expect(text).toContain("\"failedRuntimeFlowIds\"")
  })

  test("keeps task-scope rejection actionable for integrated-tree rework", () => {
    const text = composeDeliveryRetryFeedback({
      iteration: 3,
      verdict: "rejected",
      summary: "Task-scope host gate failure.",
      manifestFailureDetails: [
        "[runtime] runtime:web:. Web Runtime Render status=failed: dom_too_thin: nodes=43 threshold=60",
      ],
      ownDetails: [],
      scope: "integrated_tree",
      rawFeedbackPacket: {
        verdict: {
          rejection_details: [],
        },
        manifest: {
          runtimeFlows: [{ id: "runtime:web:.", dom: { textLength: 100, nodeCount: 43 } }],
        },
      },
    })

    expect(text).toContain("Issues the integrated-tree rework must address:")
    expect(text).toContain("task-scope integrated-tree blocker")
    expect(text).toContain("dom_too_thin")
    expect(text).toContain("\"nodeCount\": 43")
  })
})
