import { describe, expect, test } from "bun:test"
import { arbitrateDeliveryGate, arbitrateDeliveryVerdict } from "../../src/delivery/arbiter"
import {
  formatDeliveryManifestFailureDetails,
  repeatedDeliveryFailureSignatures,
  type DeliveryEvidenceManifest,
} from "../../src/delivery/manifest"
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

  test("manifest gate failure does not synthesize a rejection when LLM accepted", () => {
    // Per the "只看功能完成度和e2e测试结果，其余全部作为警告" rule, the
    // arbiter never overrides an LLM-accepted verdict with a host-driven
    // rejection. The manifest evidence is appended as advisory warnings on
    // the verdict so the orchestrator and downstream UI can surface it,
    // but the agent's accept stands. Without an LLM verdict the arbiter
    // returns undefined (caller is expected to wait for the agent).
    const accepted: DeliveryVerdictType = {
      verdict: "accepted",
      summary: "accepted by reviewer",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build passed" }],
    }

    expect(arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui"],
    })).toBeUndefined()

    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui"],
      llmVerdict: accepted,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("accepted")
    expect(decision?.verdict.summary).toContain("Advisory host gates:")
    expect(decision?.verdict.deferred_checks.some((item) => item.name === "check:build")).toBe(true)
  })

  test("preserves delivery agent goal attribution when manifest gate fails", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent traced the build failure to the UI goal package wiring.",
      startup_verification: { attempted: true, success: false, output: "build failed" },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected package.json" }],
      rejection_details: [{
        goal_id: "gol_ui",
        category: "build",
        error: "package.json script references a missing UI entry module",
        suggestion: "Restore the UI entry module or correct the package script.",
      }],
    }

    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui"],
      llmVerdict: rejected,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(affectedGoalIDs(decision.verdict)).toEqual(["gol_ui"])
    expect(decision.verdict.rejection_details).toEqual(rejected.rejection_details)
    expect(decision.verdict.deferred_checks.some((item) => item.name === "check:build")).toBe(true)
    expect(decision.verdict.summary).toContain("Advisory host gates:")
  })

  test("keeps task-scope agent rejection task-scoped when manifest gate fails", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent found the merged project has no runnable build output.",
      startup_verification: { attempted: true, success: false, output: "build failed" },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "run_command", passed: false, detail: "bun run build failed" }],
      rejection_details: [{
        category: "build",
        error: "merged worktree build fails before a responsible goal can be isolated",
        suggestion: "Inspect the integrated build output and adjust the plan or task-level wiring.",
      }],
    }

    const decision = arbitrateDeliveryVerdict({
      manifest: manifestWithFailedBuildCheck(),
      goalIds: ["gol_auth", "gol_ui", "gol_data"],
      llmVerdict: rejected,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual(rejected.rejection_details)
    expect(affectedGoalIDs(decision.verdict)).toEqual([])
  })

  test("manifest failure formatting reports primary blockers before advisory items", () => {
    // Primary = check + coverage (功能完成度 + e2e). Auxiliary = runtime + review.
    const formatted = formatDeliveryManifestFailureDetails(manifestWithMixedFunctionalAndAuxiliaryFailures())
    const checkIdx = formatted.findIndex((item) => item.includes("[check] check:build"))
    const coverageIdx = formatted.findIndex((item) => item.includes("[coverage] goal:gol_ui"))
    const runtimeIdx = formatted.findIndex((item) => item.includes("[runtime] runtime:web:."))
    const reviewIdx = formatted.findIndex((item) => item.includes("[review] specialist:frontend"))
    expect(checkIdx).toBeGreaterThanOrEqual(0)
    expect(coverageIdx).toBeGreaterThanOrEqual(0)
    expect(runtimeIdx).toBeGreaterThanOrEqual(0)
    expect(reviewIdx).toBeGreaterThanOrEqual(0)
    expect(checkIdx).toBeLessThan(runtimeIdx)
    expect(checkIdx).toBeLessThan(reviewIdx)
    expect(coverageIdx).toBeLessThan(runtimeIdx)
    expect(coverageIdx).toBeLessThan(reviewIdx)
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

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.summary).toContain("Agent inspected the failure")
    expect(decision.verdict.summary).toContain("Advisory host gates:")
    expect(decision.verdict.rejection_details.some((item) => item.error.includes("./missing"))).toBe(true)
    expect(decision.verdict.rejection_details.some((item) => item.error.includes("tsc exited"))).toBe(false)
    expect(decision.verdict.deferred_checks.some((item) => item.evidence.includes("tsc exited"))).toBe(true)
  })

  test("formats manifest failures with enough detail for orchestrator routing", () => {
    expect(formatDeliveryManifestFailureDetails(manifestWithFailedBuildCheck())).toEqual([
      "[check] check:build Build status=failed exit=1 command=bun run build: tsc exited with code 1",
    ])
  })

  test("detects repeated specialist failure signatures", () => {
    const current = manifestWithSpecialistClientContractFailure(20)
    const previous = manifestWithSpecialistClientContractFailure(10)

    const result = repeatedDeliveryFailureSignatures({
      current,
      history: [previous],
    })

    expect(result.repeated).toBe(true)
    expect(result.signatures).toContain(
      "specialist:client_contract:evidence_quality:Client contract surface was selected without client file or endpoint evidence.",
    )
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

  test("runtime evidence failure is advisory and never overrides an LLM accept", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent traced the empty DOM to the UI goal hydration code.",
      startup_verification: { attempted: true, success: false, output: "DOM did not hydrate" },
      frontend_check: { attempted: true, renders_correctly: false, issues: ["empty root"] },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected src/App.tsx" }],
      rejection_details: [{
        goal_id: "gol_ui",
        category: "runtime",
        error: "UI root never hydrates in the integrated runtime",
        suggestion: "Fix the UI entrypoint hydration path.",
      }],
    }
    const accepted: DeliveryVerdictType = {
      verdict: "accepted",
      summary: "accepted by reviewer",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build passed" }],
    }
    const runtimeReport = {
      passed: false,
      violations: [{ kind: "empty_root_shell" as const, detail: "root contains no hydrated children" }],
      evidence: {
        projectDir: ".",
        previewUrl: "http://127.0.0.1:4173/",
        renderedPngPath: "rendered.png",
        dom: {
          textLength: 0,
          nodeCount: 1,
          hasBodyChildren: true,
          isEmptyRootShell: true,
        },
      },
    }

    // Runtime probe failures are advisory: the LLM accept stands, but the
    // failure shows up in deferred_checks + tool_call_evidence so callers
    // can surface it as a warning.
    const acceptedDecision = arbitrateDeliveryVerdict({
      manifest: baseManifest(),
      goalIds: ["gol_ui"],
      llmVerdict: accepted,
      runtimeReport,
    })
    expect(acceptedDecision?.source).toBe("llm")
    expect(acceptedDecision?.verdict.verdict).toBe("accepted")
    expect(acceptedDecision?.verdict.summary).toContain("Advisory host gates:")
    expect(acceptedDecision?.verdict.deferred_checks.some((item) => item.name === "runtime_evidence")).toBe(true)
    expect(acceptedDecision?.verdict.tool_call_evidence.some((item) => item.tool === "runtime_evidence")).toBe(true)

    const decision = arbitrateDeliveryVerdict({
      manifest: baseManifest(),
      goalIds: ["gol_ui"],
      llmVerdict: rejected,
      runtimeReport,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual(rejected.rejection_details)
    expect(decision.verdict.deferred_checks.some((item) => item.name === "runtime_evidence")).toBe(true)
    expect(decision.verdict.tool_call_evidence.some((item) => item.tool === "runtime_evidence")).toBe(true)
  })

  test("visual metric failure is advisory and never overrides an LLM accept", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent attributed the visual mismatch to the UI shell layout.",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: true, renders_correctly: false, issues: ["layout mismatch"] },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "screenshot", passed: true, detail: "runtime screenshot" }],
      rejection_details: [{
        goal_id: "gol_ui",
        category: "visual",
        error: "UI shell layout does not match the reference screenshot",
        suggestion: "Realign the primary layout regions to the reference.",
      }],
    }
    const accepted: DeliveryVerdictType = {
      verdict: "accepted",
      summary: "accepted by reviewer",
      startup_verification: { attempted: true, success: true },
      frontend_check: { attempted: true, renders_correctly: true },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "screenshot", passed: true, detail: "runtime screenshot" }],
    }
    const visualMetric = {
      passed: false,
      score: 0.24,
      gates: [{
        name: "ssim" as const,
        passed: false,
        threshold: 0.9,
        value: 0.24,
        note: "layout mismatch",
      }],
      renderedPath: "rendered.png",
      referencePath: "reference.png",
      capturedAt: 1,
    }

    // SSIM-based visual diff is advisory: the LLM accept stands, but the
    // metric is appended as deferred_checks evidence so callers can warn.
    const acceptedDecision = arbitrateDeliveryVerdict({
      manifest: baseManifest(),
      goalIds: ["gol_ui"],
      llmVerdict: accepted,
      visualMetric,
    })
    expect(acceptedDecision?.source).toBe("llm")
    expect(acceptedDecision?.verdict.verdict).toBe("accepted")
    expect(acceptedDecision?.verdict.summary).toContain("Advisory host gates:")
    expect(acceptedDecision?.verdict.deferred_checks.some((item) => item.name === "visual_metric")).toBe(true)

    const decision = arbitrateDeliveryVerdict({
      manifest: baseManifest(),
      goalIds: ["gol_ui"],
      llmVerdict: rejected,
      visualMetric,
    })

    expect(decision?.source).toBe("llm")
    expect(decision?.verdict.verdict).toBe("rejected")
    if (decision?.verdict.verdict !== "rejected") throw new Error("expected rejected verdict")
    expect(decision.verdict.rejection_details).toEqual(rejected.rejection_details)
    expect(decision.verdict.deferred_checks.some((item) => item.name === "visual_metric")).toBe(true)
    expect(decision.verdict.tool_call_evidence.some((item) => item.tool === "visual_metric")).toBe(true)
    expect(affectedGoalIDs(decision.verdict)).toEqual(["gol_ui"])
  })
})

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
      evidence: ["no_live_preview: no live frontend preview URL resolved"],
    }],
    reviewEvidence: [{
      id: "specialist:frontend",
      name: "Specialist Review: frontend",
      status: "failed",
      evidence: ["blocking:runtime: Frontend runtime flow failed"],
    }],
    functionalAssessment: {
      status: "incomplete",
      primaryFailureIds: ["check:build", "goal:gol_ui"],
      auxiliaryFailureIds: ["runtime:web:.", "specialist:frontend"],
      summary: "Functional completion failed with 2 primary blocker(s) and 2 auxiliary advisory issue(s).",
    },
    finalGate: {
      status: "failed",
      summary: "Functional completion failed with 2 primary blocker(s) and 2 auxiliary advisory issue(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: ["goal:gol_ui"],
      failedRuntimeFlowIds: ["runtime:web:."],
      failedReviewIds: ["specialist:frontend"],
      functionalAssessment: {
        status: "incomplete",
        primaryFailureIds: ["check:build", "goal:gol_ui"],
        auxiliaryFailureIds: ["runtime:web:.", "specialist:frontend"],
        summary: "Functional completion failed with 2 primary blocker(s) and 2 auxiliary advisory issue(s).",
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

function manifestWithSpecialistClientContractFailure(timeCreated: number): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    timeCreated,
    reviewEvidence: [{
      id: "specialist:client_contract",
      name: "Specialist Review: client_contract",
      status: "failed",
      evidence: ["blocking:evidence_quality: Client contract surface was selected without client file or endpoint evidence."],
    }],
    specialistReviews: [{
      id: `artifact_client_contract_${timeCreated}`,
      taskId: "tsk_arbiter",
      runId: "run_arbiter",
      deliveryId: "dlv_arbiter",
      reviewer: "client_contract",
      executionStatus: "completed",
      summary: "Client contract review found 1 issue(s).",
      findings: [{
        proposedSeverity: "blocking",
        category: "evidence_quality",
        claim: "Client contract surface was selected without client file or endpoint evidence.",
        evidence: [{
          kind: "log",
          ref: "artifact_surface",
          excerpt: "client_contract selected but client inventory is empty",
        }],
        affectedRequirementIDs: [],
      }],
      evidenceRefs: ["surface:artifact_surface"],
      reviewedSurfaces: ["client_contract"],
      timeCreated,
    }],
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate failed 0 required check(s), 0 coverage item(s), 0 runtime flow(s), and 1 review item(s).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: ["specialist:client_contract"],
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
