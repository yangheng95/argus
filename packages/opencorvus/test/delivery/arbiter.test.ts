import { describe, expect, test } from "bun:test"
import { arbitrateDeliveryGate, arbitrateDeliveryVerdict } from "../../src/delivery/arbiter"
import { formatDeliveryManifestFailureDetails, type DeliveryEvidenceManifest } from "../../src/delivery/manifest"
import { createDeliverySpecialistReview } from "../../src/delivery/specialist-review"
import { affectedGoalIDs, type DeliveryVerdictType } from "../../src/delivery/verdict"

describe("delivery arbiter", () => {
  test("arbitrates manifest gate failures from evidence inputs", () => {
    const verdict = arbitrateDeliveryGate({
      checks: {
        status: "passed",
        summary: "Delivery evidence gate passed 0 required check(s).",
        failedCheckIds: [],
        failedCoverageIds: [],
        failedRuntimeFlowIds: [],
        failedReviewIds: [],
      },
      failedCoverageIds: ["goal:gol_one"],
      failedRuntimeFlowIds: ["runtime:web:."],
      failedReviewIds: ["specialist:visual_runtime"],
    })

    expect(verdict).toMatchObject({
      status: "failed",
      failedCoverageIds: ["goal:gol_one"],
      failedRuntimeFlowIds: ["runtime:web:."],
      failedReviewIds: ["specialist:visual_runtime"],
    })
    expect(verdict.summary).toContain("1 coverage item(s)")
    expect(verdict.summary).toContain("1 runtime flow(s)")
    expect(verdict.summary).toContain("1 review item(s)")
  })

  test("maps blocking specialist findings to suggested owner goals", () => {
    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithSpecialistFinding(),
      goalIds: ["gol_auth", "gol_ui"],
    })

    expect(decision?.source).toBe("manifest")
    expect(decision?.verdict.verdict).toBe("rejected")
    expect(decision?.verdict.rejection_details).toEqual([{
      goal_id: "gol_auth",
      category: "quality",
      error: "specialist:security_data failed: blocking:security: auth bypass in middleware",
      suggestion: "Fix the Specialist Review: security_data failure and rerun specialist_review.",
    }])
  })

  test("keeps project check failures task-scoped instead of fanning out to every goal", () => {
    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui", "gol_data"],
    })

    expect(decision?.source).toBe("manifest")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual([{
      category: "build",
      error: "check:build failed: tsc exited with code 1",
      suggestion: "Fix the Build failure and rerun bun run build.",
    }])
    expect(affectedGoalIDs(decision.verdict)).toEqual([])
  })

  test("manifest rejection reports every failure family with functional blockers first", () => {
    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithMixedFunctionalAndAuxiliaryFailures(),
      goalIds: ["gol_ui"],
    })

    expect(decision?.source).toBe("manifest")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.summary).toContain("Functional completion failed")
    const errors = decision.verdict.rejection_details.map((item) => item.error)
    expect(errors.some((item) => item.includes("goal:gol_ui failed"))).toBe(true)
    expect(errors.some((item) => item.includes("runtime:web:. failed"))).toBe(true)
    expect(errors.some((item) => item.includes("specialist:frontend failed"))).toBe(true)
    expect(errors.some((item) => item.includes("check:build failed"))).toBe(true)
    expect(errors.at(-1)).toContain("check:build failed")
    const formatted = formatDeliveryManifestFailureDetails(manifestWithMixedFunctionalAndAuxiliaryFailures())
    expect(formatted[0]).toContain("[coverage] goal:gol_ui")
    expect(formatted.at(-1)).toContain("[check] check:build")
  })

  test("keeps broad specialist requirement mappings task-scoped without suggested owner", () => {
    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithBroadSpecialistFinding(),
      goalIds: ["gol_auth", "gol_ui"],
    })

    expect(decision?.source).toBe("manifest")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual([{
      category: "quality",
      error: "specialist:test_integration failed: blocking:test_quality: Required test command failed",
      suggestion: "Fix the Specialist Review: test_integration failure and rerun specialist_review.",
    }])
    expect(affectedGoalIDs(decision.verdict)).toEqual([])
  })

  test("keeps delivery agent rejection text when manifest gate also fails", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent inspected the failure and found the build script imports a missing module.",
      startup_verification: { attempted: true, success: false, output: "build failed" },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected src/main.ts" }],
      rejection_details: [{
        category: "build",
        error: "src/main.ts imports ./missing which does not exist",
        suggestion: "Restore the missing module or correct the import.",
      }],
    }

    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui", "gol_data"],
      llmVerdict: rejected,
    })

    expect(decision?.source).toBe("manifest")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.summary).toContain("Agent inspected the failure")
    expect(decision.verdict.summary).toContain("Host gate:")
    expect(decision.verdict.rejection_details.some((item) => item.error.includes("./missing"))).toBe(true)
    expect(decision.verdict.rejection_details.some((item) => item.error.includes("tsc exited"))).toBe(true)
  })

  test("formats manifest failures with enough detail for orchestrator routing", () => {
    expect(formatDeliveryManifestFailureDetails(manifestWithFailedBuildCheck())).toEqual([
      "[check] check:build Build status=failed exit=1 command=bun run build: tsc exited with code 1",
    ])
  })

  test("final arbiter appends manifest review evidence without changing accepted verdict artifact shape", () => {
    const accepted: DeliveryVerdictType = {
      verdict: "accepted",
      summary: "accepted by reviewer",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build passed" }],
    }

    const decision = arbitrateDeliveryVerdict({
      manifest: passedManifest(),
      goalIds: ["gol_one"],
      llmVerdict: accepted,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("accepted")
    expect("delivery_arbiter_verdict" in (decision?.verdict ?? {})).toBe(false)
    expect(decision?.verdict.deferred_checks).toEqual([
      {
        name: "review:integrity",
        result: "skipped",
        evidence: "goal graph does not require integrity review",
      },
    ])
  })

  test("visual hard-gate failures are converted by the arbiter", () => {
    const accepted: DeliveryVerdictType = {
      verdict: "accepted",
      summary: "accepted by reviewer",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: true, renders_correctly: true },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "screenshot", passed: true, detail: "runtime screenshot" }],
    }

    const decision = arbitrateDeliveryVerdict({
      manifest: baseManifest(),
      goalIds: ["gol_ui"],
      llmVerdict: accepted,
      visualMetric: {
        passed: false,
        score: 0.24,
        gates: [{
          name: "ssim",
          passed: false,
          threshold: 0.9,
          value: 0.24,
          note: "layout mismatch",
        }],
        renderedPath: "rendered.png",
        referencePath: "reference.png",
        capturedAt: 1,
      },
    })

    expect(decision?.source).toBe("visual_hard_gate")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual([{
      category: "visual",
      error: "ssim: layout mismatch",
      suggestion: "Rendered layout or visual structure diverges from the reference; realign the primary regions.",
    }])
    expect(affectedGoalIDs(decision.verdict)).toEqual([])
  })
})

function manifestWithSpecialistFinding(): DeliveryEvidenceManifest {
  const specialist = createDeliverySpecialistReview({
    taskId: "tsk_arbiter",
    runId: "run_arbiter",
    deliveryId: "dlv_arbiter",
    reviewer: "security_data",
    executionStatus: "completed",
    summary: "Security/data review found 1 issue.",
    findings: [{
      proposedSeverity: "blocking",
      category: "security",
      claim: "auth bypass in middleware",
      evidence: [{ kind: "file", ref: "src/auth/middleware.ts" }],
      affectedRequirementIDs: ["REQ-AUTH"],
      suggestedOwnerGoalID: "gol_auth",
    }],
    evidenceRefs: ["file:src/auth/middleware.ts"],
    reviewedSurfaces: ["security_data"],
  })
  return {
    ...baseManifest(),
    reviewEvidence: [{
      id: "specialist:security_data",
      name: "Specialist Review: security_data",
      status: "failed",
      artifactId: specialist.id,
      evidence: ["blocking:security: auth bypass in middleware"],
    }],
    specialistReviews: [specialist],
    requirementCoverage: [{
      requirementId: "REQ-AUTH",
      status: "covered",
      goalIds: ["gol_auth"],
      evidence: ["mapped"],
    }],
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate failed 0 required check(s), 0 coverage item(s), 0 runtime flow(s), and 1 review item(s).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: ["specialist:security_data"],
    },
  }
}

function manifestWithMixedFunctionalAndAuxiliaryFailures(): DeliveryEvidenceManifest {
  return {
    ...manifestWithFailedBuildCheck(),
    goalCoverage: [{
      goalId: "gol_ui",
      title: "UI flow",
      priority: "blocking",
      status: "uncovered",
      acceptanceSpecCount: 0,
      evidence: ["blocking goal has no functional evidence"],
    }],
    runtimeFlows: [{
      id: "runtime:web:.",
      name: "Web Runtime Render",
      status: "failed",
      evidence: ["no_build_artifact: no index.html found"],
    }],
    reviewEvidence: [{
      id: "specialist:frontend",
      name: "Specialist Review: frontend",
      status: "failed",
      evidence: ["blocking:runtime: Frontend runtime flow failed"],
    }],
    functionalAssessment: {
      status: "incomplete",
      primaryFailureIds: ["goal:gol_ui", "runtime:web:.", "specialist:frontend"],
      auxiliaryFailureIds: ["check:build"],
      summary: "Functional completion failed with 3 primary blocker(s) and 1 auxiliary blocker(s).",
    },
    finalGate: {
      status: "failed",
      summary: "Functional completion failed with 3 primary blocker(s) and 1 auxiliary blocker(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: ["goal:gol_ui"],
      failedRuntimeFlowIds: ["runtime:web:."],
      failedReviewIds: ["specialist:frontend"],
      functionalAssessment: {
        status: "incomplete",
        primaryFailureIds: ["goal:gol_ui", "runtime:web:.", "specialist:frontend"],
        auxiliaryFailureIds: ["check:build"],
        summary: "Functional completion failed with 3 primary blocker(s) and 1 auxiliary blocker(s).",
      },
    },
  }
}

function manifestWithBroadSpecialistFinding(): DeliveryEvidenceManifest {
  const specialist = createDeliverySpecialistReview({
    taskId: "tsk_arbiter",
    runId: "run_arbiter",
    deliveryId: "dlv_arbiter",
    reviewer: "test_integration",
    executionStatus: "completed",
    summary: "Test integration review found 1 issue.",
    findings: [{
      proposedSeverity: "blocking",
      category: "test_quality",
      claim: "Required test command failed",
      evidence: [{ kind: "command", ref: "bun test" }],
      affectedRequirementIDs: ["REQ-AUTH", "REQ-UI"],
    }],
    evidenceRefs: ["command:bun test"],
    reviewedSurfaces: ["test_integration"],
  })
  return {
    ...baseManifest(),
    reviewEvidence: [{
      id: "specialist:test_integration",
      name: "Specialist Review: test_integration",
      status: "failed",
      artifactId: specialist.id,
      evidence: ["blocking:test_quality: Required test command failed"],
    }],
    specialistReviews: [specialist],
    requirementCoverage: [
      { requirementId: "REQ-AUTH", status: "covered", goalIds: ["gol_auth"], evidence: ["mapped"] },
      { requirementId: "REQ-UI", status: "covered", goalIds: ["gol_ui"], evidence: ["mapped"] },
    ],
    functionalAssessment: {
      status: "complete",
      primaryFailureIds: [],
      auxiliaryFailureIds: ["specialist:test_integration"],
      summary: "Functional completion passed, but 1 auxiliary quality gate(s) failed.",
    },
    finalGate: {
      status: "failed",
      summary: "Functional completion passed, but 1 auxiliary quality gate(s) failed.",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: ["specialist:test_integration"],
      functionalAssessment: {
        status: "complete",
        primaryFailureIds: [],
        auxiliaryFailureIds: ["specialist:test_integration"],
        summary: "Functional completion passed, but 1 auxiliary quality gate(s) failed.",
      },
    },
  }
}

function passedManifest(): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    reviewEvidence: [{
      id: "review:integrity",
      name: "Integrity Review",
      status: "skipped",
      evidence: ["goal graph does not require integrity review"],
    }],
  }
}

function manifestWithFailedBuildCheck(): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    requiredChecks: [{
      id: "check:build",
      name: "build",
      label: "Build",
      family: "build",
      command: "bun run build",
      commandDigest: "digest:build",
    }],
    checkResults: [{
      id: "check:build",
      name: "build",
      label: "Build",
      family: "build",
      command: "bun run build",
      commandDigest: "digest:build",
      status: "failed",
      exitCode: 1,
      executionCwd: ".",
      outputExcerpt: "tsc exited with code 1",
      failureReason: "tsc exited with code 1",
      startedAt: 1,
      completedAt: 2,
    }],
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s), 0 coverage item(s), 0 runtime flow(s), and 0 review item(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
  }
}

function baseManifest(): DeliveryEvidenceManifest {
  return {
    id: "artifact_manifest_arbiter",
    taskId: "tsk_arbiter",
    runId: "run_arbiter",
    deliveryId: "dlv_arbiter",
    iteration: 0,
    requiredChecks: [],
    checkResults: [],
    goalCoverage: [],
    requirementCoverage: [],
    runtimeFlows: [],
    reviewEvidence: [],
    changedFiles: ["src/app.ts"],
    finalGate: {
      status: "passed",
      summary: "Delivery evidence gate passed 0 required check(s).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
    timeCreated: 1,
  }
}
