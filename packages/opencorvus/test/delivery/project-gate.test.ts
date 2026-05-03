import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import { runtimeInteractionViolations } from "../../src/delivery/checks/runtime-evidence"
import {
  countPriorRepeatedDeliveryFailureSignals,
  repeatedDeliveryFailureSignatures,
  validateDeliveryEvidenceManifest,
  type DeliveryEvidenceManifest,
} from "../../src/delivery/manifest"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery project evidence gate", () => {
  test("fails delivery when explicitly configured lint script fails even if build and test pass", async () => {
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
        metadata: { checks: { lint: ["bun run lint"] } },
      }),
    })

    expect(manifest.requiredChecks.map((item) => item.name)).toEqual(["build", "test", "lint"])
    expect(manifest.checkResults.find((item) => item.name === "build")?.status).toBe("passed")
    expect(manifest.checkResults.find((item) => item.name === "test")?.status).toBe("passed")
    expect(manifest.checkResults.find((item) => item.name === "lint")?.status).toBe("failed")
    expect(manifest.checkResults.find((item) => item.name === "lint")?.failureSignature?.checkId).toBe("lint#1")
    expect(manifest.finalGate.status).toBe("failed")
    // Required checks (build/test/lint) are blocking primary gates under the
    // "功能完成度 + e2e测试结果" rule. The OLD model had lint in auxiliary;
    // we now treat any required-check failure as a primary blocker.
    expect(manifest.functionalAssessment).toMatchObject({
      status: "incomplete",
      primaryFailureIds: ["lint#1"],
    })
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toEqual([])
    expect(manifest.finalGate.summary).toContain("Functional completion failed")
    expect(manifest.finalGate.summary).toContain("primary blocker")
  })

  test("skips discovered lint by default because typecheck and tests are the delivery signal", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
      test: "bun -e \"console.log('test ok')\"",
      lint: "bun -e \"process.exit(1)\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_default_skip_lint",
        runID: "run_default_skip_lint",
        deliveryID: "dlv_default_skip_lint",
        changedFiles: ["src/app.ts"],
      }),
    })

    expect(manifest.requiredChecks.map((item) => item.name)).toEqual(["build", "test"])
    expect(manifest.checkResults.map((item) => item.name)).toEqual(["build", "test"])
    expect(manifest.finalGate.failedCheckIds).toEqual([])
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
        metadata: { checks: { lint: ["bun run lint"] } },
      }),
    })

    const lint = manifest.checkResults.find((item) => item.name === "lint")
    expect(lint?.status).toBe("failed")
    expect(lint?.failureReason).toContain("Forbidden shell success coercion")
    expect(manifest.finalGate.status).toBe("failed")
  })

  test("runs required checks from a source snapshot that excludes opencorvus internal worktrees", async () => {
    const dir = await packageFixture({
      lint: "node scripts/check-lint-scope.mjs",
    })
    await fs.mkdir(path.join(dir, ".opencorvus", "worktrees", "goal-demo", ".next"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".opencorvus", "worktrees", "goal-demo", ".next", "generated-bad.js"),
      "throw new Error('generated worktree output must not be linted')\n",
    )
    await fs.mkdir(path.join(dir, "scripts"), { recursive: true })
    await fs.writeFile(path.join(dir, "scripts", "check-lint-scope.mjs"), `
import { existsSync } from "node:fs"
import { cwd } from "node:process"

if (existsSync(".opencorvus/worktrees/goal-demo/.next/generated-bad.js")) {
  console.error("lint saw opencorvus internal worktree output")
  process.exit(1)
}
console.log("lint scope ok", cwd())
`)

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_isolated_check",
        runID: "run_isolated_check",
        deliveryID: "dlv_isolated_check",
        changedFiles: ["src/app.ts"],
        metadata: { checks: { lint: ["bun run lint"] } },
      }),
    })

    const lint = manifest.checkResults.find((item) => item.name === "lint")
    expect(lint?.status).toBe("passed")
    expect(lint?.executionCwd).toContain(`${path.join(".opencorvus", "delivery-check-workspaces")}`)
    expect(lint?.executionCwd).not.toBe(dir)
    expect(lint?.outputExcerpt).toContain("lint scope ok")
    expect(manifest.finalGate.failedCheckIds).toEqual([])
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
    expect(manifest.functionalAssessment).toMatchObject({
      status: "incomplete",
      primaryFailureIds: [
        "goal:gol_missing_acceptance",
        "requirement:REQ-1",
      ],
    })
    expect(manifest.finalGate.summary).toContain("Functional completion failed")
  })

  test("skips auxiliary programmatic checks when functional completion already failed", async () => {
    const dir = await packageFixture({
      lint: "bun -e \"process.exit(1)\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_completion_first",
        runID: "run_completion_first",
        deliveryID: "dlv_completion_first",
        changedFiles: ["src/app.ts"],
        metadata: { checks: { lint: ["bun run lint"] } },
        goals: [{
          id: "gol_missing_acceptance",
          title: "Missing acceptance specs",
          priority: "blocking",
          requirement_ids: [],
          acceptance_spec_count: 0,
        }],
      }),
    })

    expect(manifest.requiredChecks.map((item) => item.id)).toEqual(["lint#1"])
    expect(manifest.checkResults).toMatchObject([{
      id: "lint#1",
      status: "skipped",
      outputExcerpt: "Skipped because delivery completion evidence failed before auxiliary programmatic checks.",
    }])
    expect(manifest.finalGate.failedCoverageIds).toEqual(["goal:gol_missing_acceptance"])
    expect(manifest.finalGate.failedCheckIds).toEqual([])
    expect(manifest.functionalAssessment).toMatchObject({
      status: "incomplete",
      primaryFailureIds: ["goal:gol_missing_acceptance"],
      auxiliaryFailureIds: [],
    })
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

  test("detects repeated manifest failure signature sets across history window", () => {
    const olderMatch = manifestWithFailures({
      id: "artifact_older_match",
      normalizedError: "same old failure",
      failedCoverageIds: ["goal:gol_a"],
    })
    const adjacentDifferent = manifestWithFailures({
      id: "artifact_adjacent_different",
      normalizedError: "different adjacent failure",
      failedCoverageIds: ["goal:gol_b"],
    })
    const current = manifestWithFailures({
      id: "artifact_current_history",
      normalizedError: "same old failure",
      failedCoverageIds: ["goal:gol_a"],
    })

    expect(repeatedDeliveryFailureSignatures({
      current,
      history: [adjacentDifferent, olderMatch],
    })).toEqual({
      repeated: true,
      signatures: [
        "check:lint#1:digest-a:same old failure",
        "coverage:goal:gol_a",
      ],
    })
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

  test("attaches surface manifest and uses it for frontend runtime classification", async () => {
    const dir = await packageFixture(
      { build: "bun -e \"process.exit(1)\"" },
      {
        dependencies: { react: "latest" },
        files: {
          "src/App.tsx": "export function App() { return <main /> }\n",
        },
      },
    )

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_surface_runtime",
        runID: "run_surface_runtime",
        deliveryID: "dlv_surface_runtime",
        changedFiles: ["src/App.tsx"],
      }),
    })

    expect(manifest.surfaceManifest?.surfaces).toEqual(["frontend", "visual_runtime"])
    expect(manifest.runtimeFlows).toMatchObject([{
      id: "runtime:web:.",
      name: "Web Runtime Render",
      status: "failed",
    }])
    expect(manifest.runtimeFlows[0]?.evidence[0]).toContain("no_live_preview")
    expect(manifest.finalGate.failedRuntimeFlowIds).toEqual(["runtime:web:."])
  })

  test("runs security data review for security-sensitive files and blocks concrete flaws", async () => {
    const dir = await packageFixture(
      {},
      {
        files: {
          "src/auth/session.ts": "const JWT_SECRET = '12345678901234567890'\n",
        },
      },
    )

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_security_gate",
        runID: "run_security_gate",
        deliveryID: "dlv_security_gate",
        changedFiles: ["src/auth/session.ts"],
      }),
    })

    expect(manifest.surfaceManifest?.surfaces).toContain("security_data")
    expect(manifest.specialistReviews?.map((item) => item.reviewer)).toContain("security_data")
    expect(manifest.specialistReviews?.find((item) => item.reviewer === "security_data")?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "security",
      claim: expect.stringContaining("hardcoded secret-like value"),
    })
    // Specialist reviews are advisory under the "其余全部作为警告" rule —
    // they surface as auxiliary findings on the agent prompt but do NOT
    // flip the final gate. The agent decides whether to act on them.
    expect(manifest.finalGate.failedReviewIds).toContain("specialist:security_data")
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toContain("specialist:security_data")
    expect(manifest.functionalAssessment?.primaryFailureIds).not.toContain("specialist:security_data")
    expect(manifest.finalGate.status).toBe("passed")
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
    // Integrity review is advisory: failure shows on failedReviewIds but
    // does not block the gate.
    expect(manifest.finalGate.failedReviewIds).toEqual(["review:integrity"])
    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toContain("review:integrity")
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

async function packageFixture(
  scripts: Record<string, string>,
  options?: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    files?: Record<string, string>
  },
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-delivery-gate-"))
  tempDirs.push(dir)
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.writeFile(path.join(dir, "src", "app.ts"), "export const ok = true\n")
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    type: "module",
    packageManager: "bun@1.3.12",
    scripts,
    dependencies: options?.dependencies ?? {},
    devDependencies: options?.devDependencies ?? {},
  }, null, 2))
  for (const [file, text] of Object.entries(options?.files ?? {})) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
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

describe("delivery repeated failure tracking", () => {
  test("countPriorRepeatedDeliveryFailureSignals counts only matching keys", () => {
    expect(countPriorRepeatedDeliveryFailureSignals([])).toBe(0)
    expect(countPriorRepeatedDeliveryFailureSignals([
      { key: "delivery_repeated_failure_signature_1" },
      { key: "delivery_other" },
      { key: "delivery_repeated_failure_signature_2" },
      { key: "delivery_budget_exhausted_3" },
    ])).toBe(2)
  })

  test("delivery refusal guards remain non-terminal strategy feedback", async () => {
    const orchestratorTools = await fs.readFile(
      path.join(import.meta.dir, "../../src/orchestrator/tools.ts"),
      "utf8",
    )

    expect(orchestratorTools).toContain("delivery_repeated_failure_signature_")
    expect(orchestratorTools).toContain("delivery_budget_exhausted_")
    expect(orchestratorTools).not.toContain("delivery_loop_hard_fail")
    expect(orchestratorTools).not.toContain("delivery_repeated_loop_hard_escalation")
    expect(orchestratorTools).not.toContain("Task hard-failed")
    expect(orchestratorTools).not.toContain("shouldHardFailRepeatedDelivery")
    expect(orchestratorTools).not.toContain("countPriorRepeatedDeliveryFailureEscalates")
    expect(orchestratorTools).not.toContain("requestStopAfterCurrentStep(\"delivery_repeated_failure_signature\")")
    expect(orchestratorTools).not.toContain("requestStopAfterCurrentStep(\"delivery_budget_exhausted\")")
    expect(orchestratorTools).not.toContain("call fail_task with a final summary")
    expect(orchestratorTools).not.toContain("status: \"failed\", error: hardFailReason")
  })
})

function goalInput(id: string) {
  return {
    id,
    title: id,
    priority: "blocking" as const,
    requirement_ids: [id.replace("gol", "REQ")],
    acceptance_spec_count: 1,
  }
}
