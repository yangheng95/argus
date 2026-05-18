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

// Fresh-eyes decoupling contract — see
// specs/delivery-fresh-eyes-decoupling-2026-05-18.md. The verdict arbiter no
// longer mutates / overrides the agent verdict. `composeDeliveryDecision` is a
// pure projector: host gate fail → host-synthesized rejected `final` (agent
// never the final author); host gate pass → agent verdict verbatim.

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

  // ── composeDeliveryDecision: host gate FAILED → agent never the final ────

  test("host gate failure synthesizes the final rejected verdict without an agent", () => {
    const decision = composeDeliveryDecision({
      hostGate: failedHostGate(manifestWithFailedBuildCheck()),
    })

    expect(decision.source).toBe("host_gate")
    expect(decision.rawAgentVerdict).toBeUndefined()
    expect(decision.final.verdict).toBe("rejected")
    if (decision.final.verdict !== "rejected") throw new Error("expected rejected")
    expect(decision.final.summary).toContain("Delivery rejected by required host gates")
    // §2.2: non-empty rejection_details, schema-enum category (never "manifest").
    expect(decision.final.rejection_details.length).toBeGreaterThan(0)
    for (const d of decision.final.rejection_details) {
      expect(["build", "test", "lint", "runtime", "quality", "startup", "visual"]).toContain(d.category)
      expect(d.error.length).toBeGreaterThanOrEqual(8)
    }
    // §2.2: tool_call_evidence carries the host evidence rows.
    expect(decision.final.tool_call_evidence.some((e) => e.tool === "DeliveryEvidenceManifest")).toBe(true)
    // deferred_checks projected from the manifest (advisory build check present).
    expect(decision.final.deferred_checks.some((c) => c.name === "check:build")).toBe(true)
  })

  test("host gate failure keeps a post-repair agent verdict as evidence only, never as final", () => {
    const agentAccepted: DeliveryVerdictType = acceptedVerdict()
    const decision = composeDeliveryDecision({
      hostGate: failedHostGate(manifestWithFailedBuildCheck()),
      agentVerdict: agentAccepted,
    })

    expect(decision.source).toBe("host_gate")
    expect(decision.final.verdict).toBe("rejected")
    // The agent's accepted verdict must NOT become the business `final`.
    expect(decision.final).not.toBe(agentAccepted)
    // It is retained verbatim as raw evidence.
    expect(decision.rawAgentVerdict).toBe(agentAccepted)
  })

  test("runtime gate failure is now a hard host gate (category=runtime), not advisory", () => {
    const decision = composeDeliveryDecision({
      hostGate: {
        passed: false,
        manifest: baseManifest(),
        failures: [
          { kind: "runtime", id: "runtime-evidence", summary: "Runtime probe failed: empty root", evidence: ["root contains no hydrated children"] },
        ],
      },
    })
    expect(decision.source).toBe("host_gate")
    if (decision.final.verdict !== "rejected") throw new Error("expected rejected")
    expect(decision.final.rejection_details.some((d) => d.category === "runtime")).toBe(true)
  })

  test("visual gate failure is now a hard host gate (category=visual), not advisory", () => {
    const decision = composeDeliveryDecision({
      hostGate: {
        passed: false,
        manifest: baseManifest(),
        failures: [
          { kind: "visual", id: "visual-metric", summary: "SSIM 0.24 < 0.9", evidence: ["layout mismatch"] },
        ],
      },
    })
    expect(decision.source).toBe("host_gate")
    if (decision.final.verdict !== "rejected") throw new Error("expected rejected")
    expect(decision.final.rejection_details.some((d) => d.category === "visual")).toBe(true)
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
      /host gate passed but no agent verdict/,
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

    test("contract audit failure → host gate fail → host_gate final rejection", () => {
      const decision = composeDeliveryDecision({
        hostGate: failedHostGate(manifestWithFailedContractAuditReview()),
      })
      expect(decision.source).toBe("host_gate")
      expect(decision.final.verdict).toBe("rejected")
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
    const current = manifestWithSpecialistClientContractFailure(20)
    const previous = manifestWithSpecialistClientContractFailure(10)
    const result = repeatedDeliveryFailureSignatures({ current, history: [previous] })
    expect(result.repeated).toBe(true)
    expect(result.signatures).toContain(
      "specialist:client_contract:evidence_quality:Client contract surface was selected without client file or endpoint evidence.",
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

function manifestWithSpecialistClientContractFailure(timeCreated: number): DeliveryEvidenceManifest {
  return {
    ...baseManifest(),
    timeCreated,
    reviewEvidence: [
      {
        id: "specialist:client_contract",
        name: "Specialist Review: client_contract",
        status: "failed",
        evidence: [
          "blocking:evidence_quality: Client contract surface was selected without client file or endpoint evidence.",
        ],
      },
    ],
    specialistReviews: [
      {
        id: `artifact_client_contract_${timeCreated}`,
        taskId: "tsk_arbiter",
        runId: "run_arbiter",
        deliveryId: "dlv_arbiter",
        reviewer: "client_contract",
        executionStatus: "completed",
        summary: "Client contract review found 1 issue(s).",
        findings: [
          {
            proposedSeverity: "blocking",
            category: "evidence_quality",
            claim: "Client contract surface was selected without client file or endpoint evidence.",
            evidence: [
              { kind: "log", ref: "artifact_surface", excerpt: "client_contract selected but client inventory is empty" },
            ],
            affectedRequirementIDs: [],
          },
        ],
        evidenceRefs: ["surface:artifact_surface"],
        reviewedSurfaces: ["client_contract"],
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
      failedReviewIds: ["specialist:client_contract"],
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
