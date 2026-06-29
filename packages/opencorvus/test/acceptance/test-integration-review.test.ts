import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildAcceptanceEvidenceManifest } from "../../src/acceptance/checks/project-assessment"
import { runTestIntegrationReview } from "../../src/acceptance/specialists/test-integration"
import { Instance } from "../../src/project/instance"
import type { AcceptanceSurfaceManifest } from "../../src/acceptance/surface-detector"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("acceptance test integration specialist review", () => {
  test("rejects no-op test scripts as fake green evidence", async () => {
    const dir = await packageFixture({
      scripts: { test: "echo ok" },
      files: { "src/app.ts": "export const ok = true\n" },
    })

    const review = await Instance.provide({
      directory: dir,
      fn: () => runReview(dir, [blockingGoal("gol_fake_tests", "REQ-tests")]),
    })

    expect(review?.reviewer).toBe("test_integration")
    expect(review?.findings[0]?.claim).toContain("no-op success signal")
  })

  test("rejects empty test files even when the test command is green", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun -e \"console.log('ok')\"" },
      files: {
        "tests/app.test.ts": "\n// placeholder\n",
      },
    })

    const review = await Instance.provide({
      directory: dir,
      fn: () => runReview(dir, [blockingGoal("gol_empty_tests", "REQ-tests")]),
    })

    const claims = review?.findings.map((finding) => finding.claim).join("\n")
    expect(claims).toContain("no-op success signal")
    expect(claims).toContain("is empty")
  })

  test("rejects snapshot-only test shells", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun test" },
      files: {
        "tests/view.test.ts": [
          "import { expect, test } from 'bun:test'",
          "test('REQ-view layout', () => {",
          "  expect(render()).toMatchSnapshot()",
          "})",
          "",
        ].join("\n"),
      },
    })

    const review = await Instance.provide({
      directory: dir,
      fn: () => runReview(dir, [blockingGoal("gol_snapshot_tests", "REQ-view")]),
    })

    const claims = review?.findings.map((finding) => finding.claim).join("\n")
    expect(claims).toContain("only checks snapshots")
  })

  test("passes meaningful tests that cite covered requirements", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun test" },
      files: {
        "src/app.ts": "export const ok = true\n",
        "tests/chat.test.ts": [
          "import { expect, test } from 'bun:test'",
          "test('REQ-chat sends a message', () => {",
          "  expect('sent').toBe('sent')",
          "})",
          "",
        ].join("\n"),
      },
    })

    const review = await Instance.provide({
      directory: dir,
      fn: () => runReview(dir, [blockingGoal("gol_meaningful_tests", "REQ-chat")]),
    })

    expect(review?.findings).toEqual([])
  })

  test("default acceptance evidence omits the expensive test integration specialist", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun test" },
      files: {
        "src/app.ts": "export const ok = true\n",
        "tests/chat.test.ts": [
          "import { expect, test } from 'bun:test'",
          "test('REQ-chat persists history', () => expect(1).toBe(1))",
          "",
        ].join("\n"),
      },
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () =>
        buildAcceptanceEvidenceManifest({
          taskID: "tsk_default_omits_test_review",
          runID: "run_default_omits_test_review",
          acceptanceID: "dlv_default_omits_test_review",
          changedFiles: ["src/app.ts"],
          goals: [blockingGoal("gol_test_review", "REQ-chat")],
        }),
    })

    expect(manifest.specialistReviews?.map((item) => item.reviewer) ?? []).not.toContain("test_integration")
    expect(manifest.reviewEvidence.map((item) => item.id)).not.toContain("specialist:test_integration")
  })
})

async function packageFixture(input: { scripts: Record<string, string>; files: Record<string, string> }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-test-integration-review-"))
  tempDirs.push(dir)
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        packageManager: "bun@1.3.13",
        scripts: input.scripts,
      },
      null,
      2,
    ),
  )
  for (const [file, text] of Object.entries(input.files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}

function blockingGoal(id: string, requirementID: string) {
  return {
    id,
    title: id,
    priority: "blocking" as const,
    requirement_ids: [requirementID],
    acceptance_spec_count: 1,
  }
}

function testSurfaceManifest(projectRoot: string): AcceptanceSurfaceManifest {
  return {
    id: "artifact_test_integration_surface",
    projectRoot,
    surfaces: ["test_integration"],
    evidence: [
      {
        surface: "test_integration",
        reason: "test specialist unit test",
        refs: [{ kind: "command", ref: "package.json#scripts.test" }],
      },
    ],
    timeCreated: Date.now(),
  }
}

async function runReview(projectRoot: string, goals: Array<ReturnType<typeof blockingGoal>>) {
  return await runTestIntegrationReview({
    taskID: "tsk_test_review",
    runID: "run_test_review",
    acceptanceID: "dlv_test_review",
    projectRoot,
    surfaceManifest: testSurfaceManifest(projectRoot),
    requiredChecks: [],
    checkResults: [],
    goals,
  })
}
