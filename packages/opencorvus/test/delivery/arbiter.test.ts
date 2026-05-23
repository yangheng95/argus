import { describe, expect, test } from "bun:test"
import { arbitrateDeliveryGate } from "../../src/delivery/arbiter"
import { Event as EngineEvent } from "../../src/engine/model"

describe("legacy delivery evidence arbiter", () => {
  test("delivery evidence event accepts readiness failure details", () => {
    const parsed = EngineEvent.DeliveryEvidenceUpdated.properties.safeParse({
      taskID: "tsk_ready",
      deliveryID: "dlv_ready",
      manifestID: "art_ready",
      iteration: 1,
      status: "failed",
      summary: "Runtime readiness failed.",
      failedCheckCount: 0,
      failedReviewCount: 0,
      failureDetails: [
        {
          kind: "readiness",
          id: "runtime-readiness:package-json",
          name: "package.json",
          status: "failed",
          evidence: "package.json missing",
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test("review stream event schemas accept only the integrity live-card contract", () => {
    expect(EngineEvent.ReviewStreamStarted.properties.parse({
      taskID: "tsk_review",
      reviewID: "integrity:ses_review",
      phase: "integrity",
      sessionID: "ses_review",
    }).reviewID).toBe("integrity:ses_review")

    expect(EngineEvent.ReviewStreamProgress.properties.parse({
      taskID: "tsk_review",
      reviewID: "integrity:ses_review",
      phase: "integrity",
      currentStep: "runtime",
      attempt: 1,
      elapsedMs: 123,
      summary: "Runtime evidence",
    }).currentStep).toBe("runtime")

    expect(EngineEvent.ReviewStreamChunk.properties.parse({
      taskID: "tsk_review",
      reviewID: "integrity:ses_review",
      phase: "integrity",
      kind: "reasoning",
      delta: "thinking",
      attempt: 1,
    }).phase).toBe("integrity")

    expect("IntegrityReviewStarted" in EngineEvent).toBe(false)
    expect("IntegrityReviewProgress" in EngineEvent).toBe(false)
    expect("IntegrityReviewChunk" in EngineEvent).toBe(false)
    expect("DeliveryReviewCompleted" in EngineEvent).toBe(false)
    expect("DeliveryGateRejected" in EngineEvent).toBe(false)
  })

  test("arbitrates manifest evidence failures without creating a workflow gate", () => {
    const verdict = arbitrateDeliveryGate({
      checks: {
        status: "passed",
        summary: "Evidence passed 0 required check(s).",
        failedCheckIds: [],
        failedCoverageIds: [],
        failedReviewIds: [],
      },
      failedCoverageIds: ["goal:gol_one"],
      failedReviewIds: ["specialist:security_data"],
      functionalAssessment: {
        status: "incomplete",
        summary: "Functional completion evidence failed.",
        primaryFailureIds: ["goal:gol_one"],
        auxiliaryFailureIds: ["specialist:security_data"],
      },
    })

    expect(verdict.status).toBe("failed")
    expect(verdict.functionalAssessment.primaryFailureIds).toEqual(["goal:gol_one"])
    expect(verdict.summary).toContain("Functional completion evidence failed.")
  })
})
