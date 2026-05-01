import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import { runtimeInteractionViolations } from "../../src/delivery/checks/runtime-evidence"
import {
  repeatedDeliveryFailureSignatures,
  validateDeliveryEvidenceManifest,
  type DeliveryEvidenceManifest,
} from "../../src/delivery/manifest"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery project evidence gate", () => {
  test("fails delivery when discovered lint script fails even if build and test pass", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
      test: "bun -e \"console.log('test ok')\"",
      lint: "bun -e \"process.exit(1)\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_gate",
        runID: "run_gate",
        deliveryID: "dlv_gate",
        changedFiles: ["src/app.ts"],
      }),
    })

    expect(manifest.requiredChecks.map((item) => item.name)).toEqual(["build", "test", "lint"])
    expect(manifest.checkResults.find((item) => item.name === "build")?.status).toBe("passed")
    expect(manifest.checkResults.find((item) => item.name === "test")?.status).toBe("passed")
    expect(manifest.checkResults.find((item) => item.name === "lint")?.status).toBe("failed")
    expect(manifest.checkResults.find((item) => item.name === "lint")?.failureSignature?.checkId).toBe("lint#1")
    expect(manifest.finalGate.status).toBe("failed")
  })

  test("rejects package scripts that coerce shell failure into success", async () => {
    const dir = await packageFixture({
      lint: "bun -e \"process.exit(1)\" || exit 0",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_forbidden",
        runID: "run_forbidden",
        deliveryID: "dlv_forbidden",
        changedFiles: ["src/app.ts"],
      }),
    })

    const lint = manifest.checkResults.find((item) => item.name === "lint")
    expect(lint?.status).toBe("failed")
    expect(lint?.failureReason).toContain("Forbidden shell success coercion")
    expect(manifest.finalGate.status).toBe("failed")
  })

  test("validator rejects missing required check results", () => {
    const manifest: DeliveryEvidenceManifest = {
      id: "artifact_manifest",
      taskId: "tsk_missing",
      runId: "run_missing",
      deliveryId: "dlv_missing",
      iteration: 0,
      requiredChecks: [{
        id: "lint#1",
        name: "lint",
        family: "lint",
        command: "bun run lint",
        cwd: "/tmp/project",
        commandDigest: "digest-a",
      }],
      checkResults: [],
      goalCoverage: [],
      requirementCoverage: [],
      runtimeFlows: [],
      reviewEvidence: [],
      changedFiles: ["src/app.ts"],
      finalGate: {
        status: "passed",
        summary: "stale caller verdict",
        failedCheckIds: [],
        failedCoverageIds: [],
        failedRuntimeFlowIds: [],
        failedReviewIds: [],
      },
      timeCreated: Date.now(),
    }

    expect(validateDeliveryEvidenceManifest(manifest)).toEqual({
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s).",
      failedCheckIds: ["lint#1"],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    })
  })

  test("fails blocking goals that have no structured acceptance specs", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_coverage",
        runID: "run_coverage",
        deliveryID: "dlv_coverage",
        changedFiles: ["src/app.ts"],
        goals: [{
          id: "gol_missing_acceptance",
          title: "Missing acceptance specs",
          priority: "blocking",
          requirement_ids: ["REQ-1"],
          acceptance_spec_count: 0,
        }],
      }),
    })

    expect(manifest.goalCoverage).toEqual([{
      goalId: "gol_missing_acceptance",
      title: "Missing acceptance specs",
      priority: "blocking",
      status: "uncovered",
      acceptanceSpecCount: 0,
      evidence: ["blocking goal has no structured acceptance_specs"],
    }])
    expect(manifest.requirementCoverage[0]?.status).toBe("uncovered")
    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedCoverageIds).toEqual([
      "goal:gol_missing_acceptance",
      "requirement:REQ-1",
    ])
  })

  test("detects repeated manifest failure signature sets", () => {
    const previous = manifestWithFailures({
      id: "artifact_previous",
      normalizedError: "exit_code=<number>",
      failedCoverageIds: ["goal:gol_a"],
    })
    const current = manifestWithFailures({
      id: "artifact_current",
      normalizedError: "exit_code=<number>",
      failedCoverageIds: ["goal:gol_a"],
    })

    expect(repeatedDeliveryFailureSignatures({ current, previous })).toEqual({
      repeated: true,
      signatures: [
        "check:lint#1:digest-a:exit_code=<number>",
        "coverage:goal:gol_a",
      ],
    })
  })

  test("does not classify a new failure signature as repeated", () => {
    const previous = manifestWithFailures({
      id: "artifact_previous",
      normalizedError: "exit_code=<number>",
      failedCoverageIds: ["goal:gol_a"],
    })
    const current = manifestWithFailures({
      id: "artifact_current",
      normalizedError: "different failure",
      failedCoverageIds: ["goal:gol_a"],
    })

    expect(repeatedDeliveryFailureSignatures({ current, previous }).repeated).toBe(false)
  })

  test("does not create runtime flows for non-frontend package metadata", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_no_runtime",
        runID: "run_no_runtime",
        deliveryID: "dlv_no_runtime",
        changedFiles: ["src/app.ts"],
      }),
    })

    expect(manifest.runtimeFlows).toEqual([])
    expect(manifest.finalGate.failedRuntimeFlowIds).toEqual([])
  })

  test("fails non-trivial goal graph when integrity review evidence is missing", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        runID: "run_review",
        deliveryID: "dlv_review",
        specSnapshotID: "spec_review",
        changedFiles: ["src/app.ts"],
        goals: [
          goalInput("gol_one"),
          goalInput("gol_two"),
          goalInput("gol_three"),
        ],
      }),
    })

    expect(manifest.reviewEvidence).toEqual([{
      id: "review:integrity",
      name: "Integrity Review",
      status: "failed",
      evidence: ["non-trivial goal graph requires integrity review, but task or spec snapshot identity is missing"],
      specSnapshotId: "spec_review",
    }])
    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedReviewIds).toEqual(["review:integrity"])
  })

  test("requires observable browser interaction for structured runtime scenarios", () => {
    expect(runtimeInteractionViolations(undefined).map((item) => item.kind)).toEqual([
      "interaction_required_but_missing",
    ])
    expect(runtimeInteractionViolations({
      visibleControlCount: 2,
      textInputCount: 1,
      fileInputCount: 0,
      attemptedInteractionCount: 2,
      textChanged: false,
      htmlChanged: false,
      errorCount: 0,
      errors: [],
    }).map((item) => item.kind)).toEqual(["interaction_probe_failed"])
    expect(runtimeInteractionViolations({
      visibleControlCount: 2,
      textInputCount: 1,
      fileInputCount: 0,
      attemptedInteractionCount: 2,
      textChanged: true,
      htmlChanged: false,
      errorCount: 0,
      errors: [],
    })).toEqual([])
  })
})

async function packageFixture(scripts: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-delivery-gate-"))
  tempDirs.push(dir)
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.writeFile(path.join(dir, "src", "app.ts"), "export const ok = true\n")
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    type: "module",
    scripts,
  }, null, 2))
  return dir
}

function manifestWithFailures(input: {
  id: string
  normalizedError: string
  failedCoverageIds: string[]
}): DeliveryEvidenceManifest {
  return {
    id: input.id,
    taskId: "tsk_repeat",
    runId: "run_repeat",
    deliveryId: `dlv_${input.id}`,
    iteration: 0,
    requiredChecks: [{
      id: "lint#1",
      name: "lint",
      family: "lint",
      command: "bun run lint",
      cwd: "/tmp/project",
      commandDigest: "digest-a",
    }],
    checkResults: [{
      id: "lint#1",
      name: "lint",
      family: "lint",
      command: "bun run lint",
      cwd: "/tmp/project",
      commandDigest: "digest-a",
      status: "failed",
      exitCode: 1,
      outputExcerpt: input.normalizedError,
      startedAt: 1,
      completedAt: 2,
      failureReason: "exit_code=1",
      failureSignature: {
        checkId: "lint#1",
        commandDigest: "digest-a",
        normalizedError: input.normalizedError,
        affectedFiles: [],
      },
    }],
    goalCoverage: [],
    requirementCoverage: [],
    runtimeFlows: [],
    reviewEvidence: [],
    changedFiles: ["src/app.ts"],
    finalGate: {
      status: "failed",
      summary: "failed",
      failedCheckIds: ["lint#1"],
      failedCoverageIds: input.failedCoverageIds,
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
    timeCreated: Date.now(),
  }
}

function goalInput(id: string) {
  return {
    id,
    title: id,
    priority: "blocking" as const,
    requirement_ids: [id.replace("gol", "REQ")],
    acceptance_spec_count: 1,
  }
}
