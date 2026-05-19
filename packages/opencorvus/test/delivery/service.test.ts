import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { DeliveryAgent } from "../../src/delivery/agent"
import { DeliveryService } from "../../src/delivery/service"
import * as ProjectGate from "../../src/delivery/checks/project-gate"
import type { DeliveryEvidenceManifest } from "../../src/delivery/manifest"
import { type DeliveryVerdictType } from "../../src/delivery/verdict"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Host evidence deblocking — specs/delivery-host-gate-deblocking-2026-05-19.md.
// The DeliveryAgent is the only final verdict author. Host evidence remains
// available on the decision but must not short-circuit or synthesize final.

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

test("manifest gate failure still runs DeliveryAgent and keeps the agent final", async () => {
  await using tmp = await tmpdir({ git: true })
  const rejected = agentRejected()
  const verify = spyOn(DeliveryAgent, "verify").mockResolvedValue(rejected)
  spyOn(ProjectGate, "buildDeliveryEvidenceManifest").mockResolvedValue(failedManifest())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const decision = await DeliveryService.verify({
        task: { id: "tsk_service", title: "Fix build", request: "Make the integrated app build." },
        goals: [goal()],
        delivery: { summary: "Merged UI changes.", changedFiles: ["src/App.tsx"] },
      })

      expect(decision.source).toBe("llm")
      expect(decision.final.verdict).toBe("rejected")
      expect(decision.final).toBe(rejected)
      expect(decision.rawAgentVerdict).toBe(rejected)
      expect(decision.hostGate.passed).toBe(false)
      expect(decision.hostGate.failures[0]?.kind).toBe("manifest")
    },
  })

  expect(verify).toHaveBeenCalledTimes(1)
})

test("gate pass → agent accepts → post-repair gate still passes → accepted final (llm)", async () => {
  await using tmp = await tmpdir({ git: true })
  const verify = spyOn(DeliveryAgent, "verify").mockResolvedValue(agentAcceptedAfterRepair())
  const manifest = spyOn(ProjectGate, "buildDeliveryEvidenceManifest")
    .mockResolvedValueOnce(passedManifest())
    .mockResolvedValueOnce(passedManifest())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const decision = await DeliveryService.verify({
        task: { id: "tsk_service_repair", title: "Fix build", request: "Make the integrated app build." },
        goals: [goal()],
        delivery: { summary: "Merged UI changes.", changedFiles: ["src/App.tsx"] },
      })

      expect(decision.source).toBe("llm")
      expect(decision.final.verdict).toBe("accepted")
      // Host gate passed → final is the agent verdict verbatim, kept as raw too.
      expect(decision.rawAgentVerdict?.verdict).toBe("accepted")
      expect(decision.final).toBe(decision.rawAgentVerdict)
    },
  })

  expect(verify).toHaveBeenCalledTimes(1)
  // The agent's delivery input must NOT carry host failure conclusions (blind).
  const deliveryInput = verify.mock.calls[0]?.[0].delivery as Record<string, unknown>
  expect(deliveryInput.manifestGate).toBeUndefined()
  expect(deliveryInput.hostGateFailures).toBeUndefined()
  expect(deliveryInput.runtimeEvidenceFailures).toBeUndefined()
  expect(deliveryInput.visualMetricFailures).toBeUndefined()
  expect(manifest).toHaveBeenCalledTimes(2)
})

test("gate pass → agent accepts → post-repair gate FAILS → accepted final with failed host evidence", async () => {
  await using tmp = await tmpdir({ git: true })
  const accepted = agentAcceptedAfterRepair()
  const verify = spyOn(DeliveryAgent, "verify").mockResolvedValue(accepted)
  const manifest = spyOn(ProjectGate, "buildDeliveryEvidenceManifest")
    .mockResolvedValueOnce(passedManifest())
    .mockResolvedValueOnce(failedManifest())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const decision = await DeliveryService.verify({
        task: { id: "tsk_service_regress", title: "Fix build", request: "Make the integrated app build." },
        goals: [goal()],
        delivery: { summary: "Merged UI changes.", changedFiles: ["src/App.tsx"] },
      })

      expect(decision.source).toBe("llm")
      expect(decision.final.verdict).toBe("accepted")
      expect(decision.hostGate.passed).toBe(false)
      expect(decision.rawAgentVerdict).toBe(accepted)
      expect(decision.final).toBe(accepted)
    },
  })

  expect(verify).toHaveBeenCalledTimes(1)
  expect(manifest).toHaveBeenCalledTimes(2)
})

function agentRejected(): DeliveryVerdictType {
  return {
    verdict: "rejected",
    summary: "Agent attributed the failed build to the UI shell.",
    startup_verification: { attempted: true, success: false, output: "build failed" },
    frontend_check: { attempted: false },
    deferred_checks: [],
    tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected src/App.tsx" }],
    rejection_details: [
      {
        goal_id: "gol_ui",
        category: "build",
        error: "UI shell imports a missing module",
        suggestion: "Fix the UI import.",
      },
    ],
  }
}

function agentAcceptedAfterRepair(): DeliveryVerdictType {
  return {
    verdict: "accepted",
    summary: "Delivery fixed the import typo and verified the build.",
    deferred_checks: [],
    tool_call_evidence: [
      { tool: "edit_file", passed: true, detail: "fixed src/App.tsx import path" },
      { tool: "run_command", passed: true, detail: "bun run build passed after repair" },
    ],
  }
}

function goal() {
  return {
    id: "gol_ui",
    title: "UI shell",
    description: "Implement UI shell.",
    criteria: "Build passes.",
    priority: "blocking" as const,
    acceptance_spec_count: 1,
    acceptance_scenarios: [],
    check_selector: [],
    requirement_ids: [],
    depends_on: [],
    imports: [],
    exports: [],
    owned_paths: ["src/App.tsx"],
  }
}

function failedManifest(): DeliveryEvidenceManifest {
  return {
    id: "artifact_manifest_service",
    iteration: 0,
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
        outputExcerpt: "Cannot find module './missing'",
        failureReason: "Cannot find module './missing'",
        startedAt: 1,
        completedAt: 2,
      },
    ],
    goalCoverage: [],
    requirementCoverage: [],
    runtimeFlows: [],
    reviewEvidence: [],
    changedFiles: ["src/App.tsx"],
    finalGate: {
      status: "failed",
      summary:
        "Delivery evidence gate failed 1 required check(s), 0 coverage item(s), 0 runtime flow(s), and 0 review item(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
    timeCreated: 1,
  }
}

function passedManifest(): DeliveryEvidenceManifest {
  return {
    ...failedManifest(),
    id: "artifact_manifest_service_passed",
    checkResults: [
      {
        id: "check:build",
        name: "build",
        label: "Build",
        family: "build",
        command: "bun run build",
        commandDigest: "digest:build",
        status: "passed",
        exitCode: 0,
        executionCwd: ".",
        outputExcerpt: "build passed",
        startedAt: 3,
        completedAt: 4,
      },
    ],
    finalGate: {
      status: "passed",
      summary: "Functional completion passed (acceptance-spec coverage satisfied).",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
  }
}
