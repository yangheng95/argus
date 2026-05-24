import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProjectTable } from "../../src/project/project.sql"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import {
  ensureProjectReadyForRuntime,
  runtimeReadinessInstallCommand,
} from "../../src/delivery/checks/runtime-readiness"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { Database } from "../../src/storage/db"
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
  test("runtime readiness requires packageManager when package.json declares scripts", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        scripts: { build: "bun -e \"console.log('build')\"" },
      },
      files: { "bun.lock": "# test lockfile\n" },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: dir })

    expect(readiness.status).toBe("failed")
    expect(readiness.failedReadinessIds).toEqual(["runtime-readiness:package-manager"])
    expect(readiness.checks.find((item) => item.id === "runtime-readiness:package-manager")?.evidence[0]).toContain(
      "package.json must declare packageManager",
    )
  })

  test("runtime readiness rejects invalid packageManager values", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "deno@2.0.0",
        scripts: { build: "deno task build" },
      },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: dir })

    expect(readiness.status).toBe("failed")
    expect(readiness.failedReadinessIds).toEqual(["runtime-readiness:package-manager"])
  })

  test("runtime readiness requires the matching lockfile", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "npm@10.9.0",
        scripts: { build: "vite build" },
      },
      files: { "bun.lock": "# wrong lockfile\n" },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: dir })

    expect(readiness.status).toBe("failed")
    expect(readiness.failedReadinessIds).toEqual(["runtime-readiness:lockfile"])
    expect(readiness.checks.find((item) => item.id === "runtime-readiness:lockfile")?.evidence).toEqual([
      "missing_lockfile=package-lock.json",
      "lockfile_owner=.",
      "conflicting_lockfiles=bun.lock",
    ])
  })

  test("runtime readiness rejects conflicting lockfiles", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "pnpm@9.0.0",
        scripts: { build: "vite build" },
      },
      files: {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "package-lock.json": "{}\n",
      },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: dir })

    expect(readiness.status).toBe("failed")
    expect(readiness.failedReadinessIds).toEqual(["runtime-readiness:lockfile"])
    expect(readiness.checks.find((item) => item.id === "runtime-readiness:lockfile")?.evidence).toContain(
      "conflicting_lockfiles=package-lock.json",
    )
  })

  test("runtime readiness selects frozen install commands", () => {
    expect(runtimeReadinessInstallCommand("npm").command).toBe("npm ci")
    expect(runtimeReadinessInstallCommand("bun").command).toBe("bun install --frozen-lockfile")
    expect(runtimeReadinessInstallCommand("pnpm").command).toBe("pnpm install --frozen-lockfile")
    expect(runtimeReadinessInstallCommand("yarn").command).toBe("yarn install --immutable")
  })

  test("runtime readiness passes when package manager and lockfile agree", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: { build: "bun -e \"console.log('build')\"" },
      },
      files: { "bun.lock": "# test lockfile\n" },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: dir })

    expect(readiness.status).toBe("passed")
    expect(readiness.packageManagerName).toBe("bun")
    expect(readiness.failedReadinessIds).toEqual([])
  })

  test("runtime readiness accepts workspace root lockfile for a package project root", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "pnpm@10.32.1",
        workspaces: ["src/web"],
      },
      files: {
        "pnpm-workspace.yaml": "packages:\n  - src/web\n",
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "src/web/package.json": JSON.stringify({
          type: "module",
          packageManager: "pnpm@10.32.1",
          scripts: { build: "vite build" },
        }),
      },
    })

    const readiness = await ensureProjectReadyForRuntime({ projectRoot: path.join(dir, "src", "web") })

    expect(readiness.status).toBe("passed")
    expect(readiness.packageManagerName).toBe("pnpm")
    expect(readiness.failedReadinessIds).toEqual([])
    expect(readiness.checks.find((item) => item.id === "runtime-readiness:lockfile")?.evidence).toEqual([
      "lockfile=pnpm-lock.yaml",
      "lockfile_owner=../..",
    ])
  })

  test("runtime readiness failures are primary delivery blockers", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        scripts: { build: "bun -e \"console.log('build')\"" },
      },
      files: { "src/app.ts": "export const ok = true\n" },
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID: "tsk_readiness_primary",
          runID: "run_readiness_primary",
          deliveryID: "dlv_readiness_primary",
          changedFiles: ["src/app.ts"],
        }),
    })

    expect(manifest.runtimeReadiness?.failedReadinessIds).toEqual(["runtime-readiness:package-manager"])
    expect(manifest.finalGate.failedReadinessIds).toEqual(["runtime-readiness:package-manager"])
    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.functionalAssessment).toMatchObject({
      status: "incomplete",
      primaryFailureIds: ["runtime-readiness:package-manager"],
      auxiliaryFailureIds: [],
    })
  })

  test("functional assessment keeps readiness primary and required checks auxiliary", async () => {
    const dir = await runtimePackageFixture({
      packageJson: {
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: {
          build: "bun -e \"console.log('build')\"",
          test: 'bun -e "process.exit(1)"',
          typecheck: 'bun -e "process.exit(1)"',
        },
      },
      files: {
        "bun.lock": "# test lockfile\n",
        "src/app.ts": "export const ok = true\n",
      },
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID: "tsk_readiness_required_aux",
          runID: "run_readiness_required_aux",
          deliveryID: "dlv_readiness_required_aux",
          changedFiles: ["src/app.ts"],
        }),
    })

    expect(manifest.requiredChecks.map((item) => item.name)).toEqual(["build", "test", "typecheck"])
    expect(manifest.finalGate.failedReadinessIds).toEqual([])
    expect(manifest.finalGate.failedCheckIds).toEqual(["test#1", "typecheck#1"])
    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.functionalAssessment?.primaryFailureIds).toEqual([])
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toEqual(["test#1", "typecheck#1"])
  })

  test("fails delivery when explicitly configured lint script fails even if build and test pass", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
      test: "bun -e \"console.log('test ok')\"",
      lint: 'bun -e "process.exit(1)"',
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
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
    // Lint (and other required programmatic checks) is advisory under the
    // current model. The lint failure surfaces in failedCheckIds and
    // auxiliaryFailureIds so the LLM agent can weigh it, but the gate
    // status itself is `passed`.
    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.functionalAssessment).toMatchObject({
      status: "complete",
      primaryFailureIds: [],
    })
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toContain("lint#1")
    expect(manifest.finalGate.failedCheckIds).toContain("lint#1")
  })

  test("skips discovered lint by default because typecheck and tests are the delivery signal", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
      test: "bun -e \"console.log('test ok')\"",
      lint: 'bun -e "process.exit(1)"',
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
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
      lint: 'bun -e "process.exit(1)" || exit 0',
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
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
    // Forbidden shell coercion is detected and surfaced as a failed check, but
    // lint itself is advisory. Coverage / integrity stay clean here, so the
    // gate is `passed` while failedCheckIds carries the diagnostic.
    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.finalGate.failedCheckIds).toContain("lint#1")
  })

  test("runs required checks from a source snapshot that excludes opencorvus internal worktrees", async () => {
    const taskID = "tsk_isolated_check"
    const dir = await packageFixture({
      lint: "node scripts/check-lint-scope.mjs",
    })
    await fs.mkdir(path.join(dir, ".opencorvus", "runtime", "worktrees", "goal-demo", ".next"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".opencorvus", "runtime", "worktrees", "goal-demo", ".next", "generated-bad.js"),
      "throw new Error('generated worktree output must not be linted')\n",
    )
    await fs.mkdir(path.join(dir, "scripts"), { recursive: true })
    await fs.writeFile(
      path.join(dir, "scripts", "check-lint-scope.mjs"),
      `
import { existsSync } from "node:fs"
import { cwd } from "node:process"

if (existsSync(".opencorvus/runtime/worktrees/goal-demo/.next/generated-bad.js")) {
  console.error("lint saw opencorvus internal worktree output")
  process.exit(1)
}
console.log("lint scope ok", cwd())
`,
    )

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID,
          runID: "run_isolated_check",
          deliveryID: "dlv_isolated_check",
          changedFiles: ["src/app.ts"],
          metadata: { checks: { lint: ["bun run lint"] } },
        }),
    })

    const lint = manifest.checkResults.find((item) => item.name === "lint")
    expect(lint?.status).toBe("passed")
    expect(lint?.executionCwd).toContain(ProjectRuntimePaths.deliveryPaths(dir, taskID).checkWorkspaces)
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
      requiredChecks: [
        {
          id: "lint#1",
          name: "lint",
          family: "lint",
          command: "bun run lint",
          cwd: "/tmp/project",
          commandDigest: "digest-a",
        },
      ],
      checkResults: [],
      goalCoverage: [],
      requirementCoverage: [],
      reviewEvidence: [],
      changedFiles: ["src/app.ts"],
      finalGate: {
        status: "passed",
        summary: "stale caller verdict",
        failedCheckIds: [],
        failedCoverageIds: [],
        failedReviewIds: [],
      },
      timeCreated: Date.now(),
    }

    expect(validateDeliveryEvidenceManifest(manifest)).toEqual({
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s).",
      failedReadinessIds: [],
      failedCheckIds: ["lint#1"],
      failedCoverageIds: [],
      failedReviewIds: [],
    })
  })

  test("fails blocking goals that have no structured acceptance specs", async () => {
    const dir = await packageFixture({
      build: "bun -e \"console.log('build ok')\"",
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID: "tsk_coverage",
          runID: "run_coverage",
          deliveryID: "dlv_coverage",
          specSnapshotID: "spec_coverage",
          changedFiles: ["src/app.ts"],
          goals: [
            {
              id: "gol_missing_acceptance",
              title: "Missing acceptance specs",
              priority: "blocking",
              requirement_ids: ["REQ-1"],
              acceptance_spec_count: 0,
            },
          ],
        }),
    })

    expect(manifest.goalCoverage).toEqual([
      {
        goalId: "gol_missing_acceptance",
        title: "Missing acceptance specs",
        priority: "blocking",
        status: "uncovered",
        acceptanceSpecCount: 0,
        evidence: ["blocking goal has no structured acceptance_specs"],
      },
    ])
    expect(manifest.requirementCoverage[0]?.status).toBe("uncovered")
    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedCoverageIds).toEqual(["goal:gol_missing_acceptance", "requirement:REQ-1"])
    expect(manifest.functionalAssessment).toMatchObject({
      status: "incomplete",
      primaryFailureIds: ["goal:gol_missing_acceptance", "requirement:REQ-1"],
    })
    expect(manifest.finalGate.summary).toContain("Functional completion failed")
  })

  test("skips auxiliary programmatic checks when functional completion already failed", async () => {
    const dir = await packageFixture({
      lint: 'bun -e "process.exit(1)"',
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID: "tsk_completion_first",
          runID: "run_completion_first",
          deliveryID: "dlv_completion_first",
          specSnapshotID: "spec_completion_first",
          changedFiles: ["src/app.ts"],
          metadata: { checks: { lint: ["bun run lint"] } },
          goals: [
            {
              id: "gol_missing_acceptance",
              title: "Missing acceptance specs",
              priority: "blocking",
              requirement_ids: [],
              acceptance_spec_count: 0,
            },
          ],
        }),
    })

    expect(manifest.requiredChecks.map((item) => item.id)).toEqual(["lint#1"])
    expect(manifest.checkResults).toMatchObject([
      {
        id: "lint#1",
        status: "skipped",
        outputExcerpt:
          "Skipped because delivery completion or runtime readiness evidence failed before auxiliary programmatic checks.",
      },
    ])
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
      signatures: ["check:lint#1:digest-a:exit_code=<number>", "coverage:goal:gol_a"],
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

    expect(
      repeatedDeliveryFailureSignatures({
        current,
        history: [adjacentDifferent, olderMatch],
      }),
    ).toEqual({
      repeated: true,
      signatures: ["check:lint#1:digest-a:same old failure", "coverage:goal:gol_a"],
    })
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
      fn: () =>
        buildDeliveryEvidenceManifest({
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
    expect(manifest.finalGate.failedReviewIds).toContain("specialist:security_data")
    // Specialist reviews are advisory under the current model. The evidence
    // status stays `passed`; the security_data finding surfaces in
    // failedReviewIds + auxiliaryFailureIds for acceptance review to weigh.
    expect(manifest.functionalAssessment?.primaryFailureIds).not.toContain("specialist:security_data")
    expect(manifest.functionalAssessment?.auxiliaryFailureIds).toContain("specialist:security_data")
    expect(manifest.finalGate.status).toBe("passed")
  })

  test("does not consume integrity attempts as delivery review evidence", async () => {
    const dir = await packageFixture({})

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => {
        recordIntegrity("tsk_integrity_corrections", "spec_integrity_corrections", {
          verdict: "concerns",
          issuesCount: 4,
          correctionsCount: 1,
          missingCount: 0,
        })
        return buildDeliveryEvidenceManifest({
          taskID: "tsk_integrity_corrections",
          runID: "run_integrity_corrections",
          deliveryID: "dlv_integrity_corrections",
          specSnapshotID: "spec_integrity_corrections",
          changedFiles: ["src/app.ts"],
          goals: [goalInput("gol_one"), goalInput("gol_two"), goalInput("gol_three")],
        })
      },
    })

    expect(manifest.reviewEvidence.find((item) => item.id === "review:integrity")).toBeUndefined()
    expect(manifest.finalGate.failedReviewIds).not.toContain("review:integrity")
    expect(manifest.functionalAssessment?.primaryFailureIds).not.toContain("review:integrity")
    expect(manifest.finalGate.status).toBe("passed")
  })

  test("fails delivery when declared changed files are absent from workspace export diff", async () => {
    const dir = await packageFixture({})
    await $`git init`.cwd(dir).quiet()
    await $`git add src/app.ts package.json`.cwd(dir).quiet()
    await $`git -c user.name=test -c user.email=test@example.com commit -m init`.cwd(dir).quiet()
    const baseline = (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildDeliveryEvidenceManifest({
          taskID: "tsk_workspace_export",
          runID: "run_workspace_export",
          deliveryID: "dlv_workspace_export",
          changedFiles: ["src/app.ts"],
          metadata: { git: { baseline: { commit: baseline } } },
        }),
    })

    // workspace_export is an artifact-shape review (not architect-level);
    // it stays advisory. The diagnostic still appears in failedReviewIds so
    // the LLM agent can read it, but the gate is `passed`.
    expect(manifest.finalGate.status).toBe("passed")
    expect(manifest.finalGate.failedReviewIds).toContain("review:workspace_export")
    expect(
      manifest.reviewEvidence.find((item) => item.id === "review:workspace_export")?.evidence.join("\n"),
    ).toContain("missing_declared_files=src/app.ts")
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
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        packageManager: "bun@1.3.13",
        scripts,
        dependencies: options?.dependencies ?? {},
        devDependencies: options?.devDependencies ?? {},
      },
      null,
      2,
    ),
  )
  await fs.writeFile(path.join(dir, "bun.lock"), "# test lockfile\n")
  if (Object.keys(options?.dependencies ?? {}).length > 0 || Object.keys(options?.devDependencies ?? {}).length > 0) {
    await fs.mkdir(path.join(dir, "node_modules"), { recursive: true })
  }
  for (const [file, text] of Object.entries(options?.files ?? {})) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}

async function runtimePackageFixture(input: { packageJson: Record<string, unknown>; files?: Record<string, string> }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-runtime-readiness-"))
  tempDirs.push(dir)
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(input.packageJson, null, 2))
  for (const [file, text] of Object.entries(input.files ?? {})) {
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
    requiredChecks: [
      {
        id: "lint#1",
        name: "lint",
        family: "lint",
        command: "bun run lint",
        cwd: "/tmp/project",
        commandDigest: "digest-a",
      },
    ],
    checkResults: [
      {
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
      },
    ],
    goalCoverage: [],
    requirementCoverage: [],
    reviewEvidence: [],
    changedFiles: ["src/app.ts"],
    finalGate: {
      status: "failed",
      summary: "failed",
      failedCheckIds: ["lint#1"],
      failedCoverageIds: input.failedCoverageIds,
      failedReviewIds: [],
    },
    timeCreated: Date.now(),
  }
}

describe("delivery repeated failure tracking", () => {
  test("countPriorRepeatedDeliveryFailureSignals counts only matching keys", () => {
    expect(countPriorRepeatedDeliveryFailureSignals([])).toBe(0)
    expect(
      countPriorRepeatedDeliveryFailureSignals([
        { key: "delivery_repeated_failure_signature_1" },
        { key: "delivery_other" },
        { key: "delivery_repeated_failure_signature_2" },
        { key: "delivery_other_budget_signal_3" },
      ]),
    ).toBe(2)
  })

  test("delivery repeated failure blocks blind task-level rebuild guidance", async () => {
    const orchestratorTools = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(orchestratorTools).toContain("delivery_repeated_failure_signature_")
    expect(orchestratorTools).toContain("must not call another task-level direct build for the same signature")
    expect(orchestratorTools).toContain("no automatic task-level rework is queued")
    expect(orchestratorTools).not.toContain(["delivery", "budget", "exhausted_"].join("_"))
    expect(orchestratorTools).not.toContain("delivery_loop_hard_fail")
    expect(orchestratorTools).not.toContain("delivery_repeated_loop_hard_escalation")
    expect(orchestratorTools).not.toContain("Task hard-failed")
    expect(orchestratorTools).not.toContain("shouldHardFailRepeatedDelivery")
    expect(orchestratorTools).not.toContain("countPriorRepeatedDeliveryFailureEscalates")
    expect(orchestratorTools).not.toContain('requestStopAfterCurrentStep("delivery_repeated_failure_signature")')
    expect(orchestratorTools).not.toContain('requestStopAfterCurrentStep("delivery_threw")')
    expect(orchestratorTools).not.toContain("forced plan restart")
    expect(orchestratorTools).not.toContain("Task was automatically restarted from plan")
    expect(orchestratorTools).not.toContain('status: "failed", error: hardFailReason')
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

function recordIntegrity(
  taskID: string,
  specSnapshotID: string,
  input: {
    verdict: "pass" | "concerns" | "needs_correction" | "fail"
    issuesCount: number
    correctionsCount: number
    missingCount: number
    /** Defaults to post_build so the existing tests, which simulate a fully
     *  reviewed build, satisfy the delivery freshness gate. Pre-build cases
     *  pass "pre_build" explicitly to assert the gate rejects them. */
    phase?: "pre_build" | "post_build"
    /** Override the artifact's time_created so freshness-gate tests can
     *  position the attempt before a later goal_run_attempt artifact. */
    now?: number
  },
) {
  const now = input.now ?? Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: `project_${taskID}`,
        worktree: Instance.directory,
        name: `Project ${taskID}`,
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .onConflictDoNothing()
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: `project_${taskID}`,
        source: "test",
        title: `Task ${taskID}`,
        request: "Test delivery manifest",
        kind: "workflow",
        priority: "normal",
        status: "active",
        attachments: [],
        system_artifacts: [],
        design_specs: [],
        metadata: {},
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .onConflictDoNothing()
      .run()
  })
  recordIntegrityAttempt({
    taskID,
    sessionID: `ses_${specSnapshotID}`,
    lineage: {
      taskID,
      activeSpecSnapshotID: specSnapshotID,
      inheritedSpecSnapshotIDs: [],
      reason: "active_only",
    },
    verdict: input.verdict,
    phase: input.phase ?? "post_build",
    perDimension: [
      { id: "requirement_fidelity", verdict: input.verdict },
      { id: "technical_feasibility", verdict: "pass" },
      { id: "hallucination", verdict: "pass" },
      { id: "solution_quality", verdict: "pass" },
    ],
    issuesCount: input.issuesCount,
    correctionsCount: input.correctionsCount,
    missingCount: input.missingCount,
    now,
  })
}
