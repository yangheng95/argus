import { describe, expect, test } from "bun:test"
import {
  arbitrateDeliveryGate,
  composeDeliveryDecision,
  type HostGateResult,
} from "../../src/delivery/arbiter"
import {
  formatDeliveryManifestFailureDetails,
  repeatedDeliveryFailureSignatures,
  type DeliveryEvidenceManifest,
} from "../../src/delivery/manifest"
import { affectedGoalIDs, type DeliveryVerdictType } from "../../src/delivery/verdict"
import { Event as EngineEvent } from "../../src/engine/model"

// Host evidence deblocking contract — see
// specs/delivery-host-gate-deblocking-2026-05-19.md. The verdict arbiter never
// mutates / overrides the agent verdict. `composeDeliveryDecision` is a pure
// projector: host evidence is attached separately; final is always the agent
// verdict verbatim.

describe("delivery arbiter", () => {
  test("delivery evidence event accepts readiness failure details", () => {
    const parsed = EngineEvent.DeliveryEvidenceUpdated.properties.safeParse({
      taskID: "tsk_ready",
      deliveryID: "dlv_ready",
      manifestID: "art_ready",
      iteration: 1,
      status: "failed",
      summary: "Runtime readiness failed.",
      failedCheckCount: 0,
      failedRuntimeFlowCount: 0,
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
      functionalAssessment: {
        status: "incomplete",
        summary: "Functional completion failed.",
        primaryFailureIds: ["goal:gol_one"],
        auxiliaryFailureIds: ["runtime:web:.", "specialist:visual_runtime"],
      },
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

  // ── composeDeliveryDecision: host evidence NEVER authors final ───────────

  test("host gate failure without an agent verdict cannot finalize delivery", () => {
    expect(() =>
      composeDeliveryDecision({
        hostGate: failedHostGate(manifestWithFailedBuildCheck()),
      }),
    ).toThrow(/no agent verdict/)
  })

  test("host gate failure returns the agent verdict verbatim", () => {
    const agentAccepted: DeliveryVerdictType = acceptedVerdict()
    const decision = composeDeliveryDecision({
      hostGate: failedHostGate(manifestWithFailedBuildCheck()),
      agentVerdict: agentAccepted,
    })

    expect(decision.source).toBe("llm")
    expect(decision.final).toBe(agentAccepted)
    expect(decision.rawAgentVerdict).toBe(agentAccepted)
    expect(decision.hostGate.passed).toBe(false)
  })

  test("runtime gate failure is evidence only, not a hard final verdict", () => {
    const accepted = acceptedVerdict()
    const decision = composeDeliveryDecision({
      hostGate: {
        passed: false,
        manifest: baseManifest(),
        failures: [
          { kind: "runtime", id: "runtime-evidence", summary: "Runtime probe failed: empty root", evidence: ["root contains no hydrated children"] },
        ],
      },
      agentVerdict: accepted,
    })
    expect(decision.source).toBe("llm")
    expect(decision.final).toBe(accepted)
    expect(decision.hostGate.failures[0]?.kind).toBe("runtime")
  })

  test("visual gate failure is evidence only, not a hard final verdict", () => {
    const accepted = acceptedVerdict()
    const decision = composeDeliveryDecision({
      hostGate: {
        passed: false,
        manifest: baseManifest(),
        failures: [
          { kind: "visual", id: "visual-metric", summary: "SSIM 0.24 < 0.9", evidence: ["layout mismatch"] },
        ],
      },
      agentVerdict: accepted,
    })
    expect(decision.source).toBe("llm")
    expect(decision.final).toBe(accepted)
    expect(decision.hostGate.failures[0]?.kind).toBe("visual")
  })

  // ── composeDeliveryDecision: host gate PASSED → agent verdict verbatim ───

  test("host gate pass returns the agent verdict verbatim with no host injection", () => {
    const accepted = acceptedVerdict()
    const decision = composeDeliveryDecision({
      hostGate: passedHostGate(),
      agentVerdict: accepted,
    })

    expect(decision.source).toBe("llm")
    expect(decision.final).toBe(accepted)
    expect(decision.rawAgentVerdict).toBe(accepted)
    // No host evidence injected into the agent verdict (the prior rule-8/15 defect).
    expect(decision.final.deferred_checks).toEqual([])
    expect(decision.final.tool_call_evidence.some((e) => e.tool === "DeliveryEvidenceManifest")).toBe(false)
  })

  test("host gate pass preserves agent goal attribution unchanged", () => {
    const rejected: DeliveryVerdictType = {
      verdict: "rejected",
      summary: "Agent traced the build failure to the UI goal package wiring.",
      startup_verification: { attempted: true, success: false, output: "build failed" },
      frontend_check: { attempted: false },
      deferred_checks: [],
      tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected package.json" }],
      rejection_details: [
        {
          goal_id: "gol_ui",
          category: "build",
          error: "package.json script references a missing UI entry module",
          suggestion: "Restore the UI entry module or correct the package script.",
        },
      ],
    }
    const decision = composeDeliveryDecision({ hostGate: passedHostGate(), agentVerdict: rejected })

    expect(decision.source).toBe("llm")
    expect(decision.final).toBe(rejected)
    if (decision.final.verdict !== "rejected") throw new Error("expected rejected")
    expect(affectedGoalIDs(decision.final)).toEqual(["gol_ui"])
    expect(decision.final.rejection_details).toEqual(rejected.rejection_details)
  })

  test("host gate pass without an agent verdict is a hard error (cannot finalize blind)", () => {
    expect(() => composeDeliveryDecision({ hostGate: passedHostGate() })).toThrow(
      /no agent verdict/,
    )
  })

  // ── arbitrateDeliveryGate blocking/advisory split (unchanged host data gate) ──

  describe("blocking vs advisory split (CLAUDE.md rule 7 — single semantic source)", () => {
    test("acceptance-spec coverage gap is a primary blocker", () => {
      const verdict = arbitrateDeliveryGate({
        checks: { status: "passed", summary: "", failedCheckIds: [], failedCoverageIds: [], failedRuntimeFlowIds: [], failedReviewIds: [] },
        failedCoverageIds: ["goal:gol_one"],
        failedRuntimeFlowIds: [],
        failedReviewIds: [],
        functionalAssessment: { status: "incomplete", summary: "incomplete", primaryFailureIds: ["goal:gol_one"], auxiliaryFailureIds: [] },
      })
      expect(verdict.status).toBe("failed")
    })

    test("review:contract_audit failure is a primary blocker", () => {
      const verdict = arbitrateDeliveryGate({
        checks: { status: "passed", summary: "", failedCheckIds: [], failedCoverageIds: [], failedRuntimeFlowIds: [], failedReviewIds: [] },
        failedCoverageIds: [],
        failedRuntimeFlowIds: [],
        failedReviewIds: ["review:contract_audit"],
        functionalAssessment: { status: "incomplete", summary: "contract audit failed", primaryFailureIds: ["review:contract_audit"], auxiliaryFailureIds: [] },
      })
      expect(verdict.status).toBe("failed")
    })

    test("build/test/lint and non-contract reviews are advisory only", () => {
      const verdict = arbitrateDeliveryGate({
        checks: { status: "passed", summary: "", failedCheckIds: ["check:build", "check:test"], failedCoverageIds: [], failedRuntimeFlowIds: [], failedReviewIds: [] },
        failedCoverageIds: [],
        failedRuntimeFlowIds: [],
        failedReviewIds: ["review:workspace_export", "specialist:frontend"],
        functionalAssessment: {
          status: "complete",
          summary: "ok",
          primaryFailureIds: [],
          auxiliaryFailureIds: ["check:build", "check:test", "review:workspace_export", "specialist:frontend"],
        },
      })
      expect(verdict.status).toBe("passed")
    })

    test("contract audit failure remains host evidence and does not author final", () => {
      const accepted = acceptedVerdict()
      const decision = composeDeliveryDecision({
        hostGate: failedHostGate(manifestWithFailedContractAuditReview()),
        agentVerdict: accepted,
      })
      expect(decision.source).toBe("llm")
      expect(decision.final).toBe(accepted)
      expect(decision.hostGate.passed).toBe(false)
    })
  })

  test("formats manifest failures with enough detail for orchestrator routing", () => {
    expect(formatDeliveryManifestFailureDetails(manifestWithFailedBuildCheck())).toEqual([
      "[check] check:build Build status=failed exit=1 command=bun run build: tsc exited with code 1",
    ])
  })

  test("manifest failure formatting reports checks and coverage before runtime and review details", () => {
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
    expect(coverageIdx).toBeLessThan(reviewIdx)
  })

  test("detects repeated specialist failure signatures", () => {
    const current = manifestWithSpecialistBackendApiFailure(20)
    const previous = manifestWithSpecialistBackendApiFailure(10)
    const result = repeatedDeliveryFailureSignatures({ current, history: [previous] })
    expect(result.repeated).toBe(true)
    expect(result.signatures).toContain(
      "specialist:backend_api:evidence_quality:Backend API surface was selected without route file or route literal evidence.",
    )
  })
})

function failedHostGate(manifest: DeliveryEvidenceManifest): HostGateResult {
  return {
    passed: false,
    manifest,
    failures: [
      {
        kind: "manifest",
        id: manifest.id,
        summary: manifest.finalGate.summary,
        evidence: formatDeliveryManifestFailureDetails(manifest),
      },
    ],
  }
}

function passedHostGate(): HostGateResult {
  return { passed: true, manifest: baseManifest(), failures: [] }
}

function manifestWithMixedFunctionalAndAuxiliaryFailures(): DeliveryEvidenceManifest {
  return {
    ...manifestWithFailedBuildCheck(),
    goalCoverage: [
      {
        goalId: "gol_ui",
        title: "UI flow",
        priority: "blocking",
        status: "uncovered",
        acceptanceSpecCount: 0,
        evidence: ["blocking goal has no functional evidence"],
      },
    ],
    runtimeFlows: [
      {
        id: "runtime:web:.",
        name: "Web Runtime Render",
        status: "failed",
        evidence: ["no_live_preview: no live frontend preview URL resolved"],
      },
    ],
    reviewEvidence: [
      {
        id: "specialist:frontend",
        name: "Specialist Review: frontend",
        status: "failed",
        evidence: ["blocking:runtime: Frontend runtime flow failed"],
      },
    ],
    functionalAssessment: {
      status: "incomplete",
      primaryFailureIds: ["check:build", "goal:gol_ui"],
      auxiliaryFailureIds: ["runtime:web:.", "specialist:frontend"],
      summary: "Functional completion failed with 4 primary blocker(s).",
    },
    finalGate: {
      status: "failed",
      summary: "Functional completion failed with 4 primary blocker(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: ["goal:gol_ui"],
      failedRuntimeFlowIds: ["runtime:web:."],
      failedReviewIds: ["specialist:frontend"],
      functionalAssessment: {
        status: "incomplete",
        primaryFailureIds: ["check:build", "goal:gol_ui"],
        auxiliaryFailureIds: ["runtime:web:.", "specialist:frontend"],
        summary: "Functional completion failed with 4 primary blocker(s).",
      },
    },
  }
}

function acceptedVerdict(): DeliveryVerdictType {
  return {
    verdict: "accepted",
    summary: "accepted by reviewer",
    startup_verification: { attempted: true, success: true },
    frontend_check: { attempted: false },
    deferred_checks: [],
    tool_call_evidence: [{ tool: "run_command", passed: true, detail: "build passed" }],
  }
}

function manifestWithFailedBuildCheck(): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    requiredChecks: [
      { id: "check:build", name: "build", label: "Build", family: "build", command: "bun run build", commandDigest: "digest:build" },
    ],
    checkResults: [
      {
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
      },
    ],
    finalGate: {
      status: "failed",
      summary:
        "Delivery evidence gate failed 1 required check(s), 0 coverage item(s), 0 runtime flow(s), and 0 review item(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
  }
}

function manifestWithSpecialistBackendApiFailure(timeCreated: number): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    timeCreated,
    reviewEvidence: [
      {
        id: "specialist:backend_api",
        name: "Specialist Review: backend_api",
        status: "failed",
        evidence: [
          "blocking:evidence_quality: Backend API surface was selected without route file or route literal evidence.",
        ],
      },
    ],
    specialistReviews: [
      {
        id: `artifact_backend_api_${timeCreated}`,
        taskId: "tsk_arbiter",
        runId: "run_arbiter",
        deliveryId: "dlv_arbiter",
        reviewer: "backend_api",
        executionStatus: "completed",
        summary: "Backend API review found 1 issue(s).",
        findings: [
          {
            proposedSeverity: "blocking",
            category: "evidence_quality",
            claim: "Backend API surface was selected without route file or route literal evidence.",
            evidence: [
              { kind: "log", ref: "artifact_surface", excerpt: "backend_api selected but route inventory is empty" },
            ],
            affectedRequirementIDs: [],
          },
        ],
        evidenceRefs: ["surface:artifact_surface"],
        reviewedSurfaces: ["backend_api"],
        timeCreated,
      },
    ],
    finalGate: {
      status: "failed",
      summary:
        "Delivery evidence gate failed 0 required check(s), 0 coverage item(s), 0 runtime flow(s), and 1 review item(s).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: ["specialist:backend_api"],
    },
  }
}

function manifestWithFailedContractAuditReview(): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    reviewEvidence: [
      {
        id: "review:contract_audit",
        name: "Contract Audit",
        status: "failed",
        evidence: ["missing export contract", "broken import surface"],
      },
    ],
    functionalAssessment: {
      status: "incomplete",
      primaryFailureIds: ["review:contract_audit"],
      auxiliaryFailureIds: [],
      summary: "Functional completion failed with 1 blocker(s).",
    },
    finalGate: {
      status: "failed",
      summary: "Functional completion failed with 1 blocker(s).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: ["review:contract_audit"],
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
