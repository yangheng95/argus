import { afterEach, expect, spyOn, test } from "bun:test"
import { DeliveryAgent } from "../../src/delivery/agent"
import { DeliveryService } from "../../src/delivery/service"
import * as ProjectGate from "../../src/delivery/checks/project-gate"
import type { DeliveryEvidenceManifest } from "../../src/delivery/manifest"
import { affectedGoalIDs, type DeliveryVerdictType } from "../../src/delivery/verdict"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("DeliveryService still runs DeliveryAgent when manifest gate failed", async () => {
  await using tmp = await tmpdir({ git: true })
  const verify = spyOn(DeliveryAgent, "verify").mockResolvedValue(agentRejected())
  spyOn(ProjectGate, "buildDeliveryEvidenceManifest").mockResolvedValue(failedManifest())

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const verdict = await DeliveryService.verify({
        task: {
          id: "tsk_service",
          title: "Fix build",
          request: "Make the integrated app build.",
        },
        goals: [{
          id: "gol_ui",
          title: "UI shell",
          description: "Implement UI shell.",
          criteria: "Build passes.",
          priority: "blocking",
          acceptance_spec_count: 1,
          runtime_scenario_count: 0,
          check_selector: [],
          requirement_ids: [],
          depends_on: [],
          imports: [],
          exports: [],
          owned_paths: ["src/App.tsx"],
        }],
        delivery: {
          summary: "Merged UI changes.",
          changedFiles: ["src/App.tsx"],
        },
      })

      expect(verdict.verdict).toBe("rejected")
      expect(affectedGoalIDs(verdict)).toEqual(["gol_ui"])
    },
  })

  expect(verify).toHaveBeenCalledTimes(1)
  const deliveryInput = verify.mock.calls[0]?.[0].delivery
  expect(deliveryInput.manifestGate?.status).toBe("failed")
  expect(deliveryInput.manifestFailureDetails?.[0]?.id).toBe("check:build")
})

function agentRejected(): DeliveryVerdictType {
  return {
    verdict: "rejected",
    summary: "Agent attributed the failed build to the UI shell.",
    startup_verification: { attempted: true, success: false, output: "build failed" },
    frontend_check: { attempted: false },
    deferred_checks: [],
    tool_call_evidence: [{ tool: "read_file", passed: true, detail: "inspected src/App.tsx" }],
    rejection_details: [{
      goal_id: "gol_ui",
      category: "build",
      error: "UI shell imports a missing module",
      suggestion: "Fix the UI import.",
    }],
  }
}

function failedManifest(): DeliveryEvidenceManifest {
  return {
    id: "artifact_manifest_service",
    iteration: 0,
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
      outputExcerpt: "Cannot find module './missing'",
      failureReason: "Cannot find module './missing'",
      startedAt: 1,
      completedAt: 2,
    }],
    goalCoverage: [],
    requirementCoverage: [],
    runtimeFlows: [],
    reviewEvidence: [],
    changedFiles: ["src/App.tsx"],
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s), 0 coverage item(s), 0 runtime flow(s), and 0 review item(s).",
      failedCheckIds: ["check:build"],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
    timeCreated: 1,
  }
}
