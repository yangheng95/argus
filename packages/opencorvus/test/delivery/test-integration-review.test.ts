import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import {
  findDeliverySpecialistReviews,
} from "../../src/delivery/specialist-review"
import { persistDeliveryEvidenceManifest } from "../../src/delivery/manifest"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"

const tempDirs: string[] = []
const projectIds: string[] = []

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectId)).run())
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery test integration specialist review", () => {
  test("rejects no-op test scripts as fake green evidence", async () => {
    const dir = await packageFixture({
      scripts: { test: "echo ok" },
      files: { "src/app.ts": "export const ok = true\n" },
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_fake_tests",
        runID: "run_fake_tests",
        deliveryID: "dlv_fake_tests",
        changedFiles: ["src/app.ts"],
        goals: [blockingGoal("gol_fake_tests", "REQ-tests")],
      }),
    })

    expect(manifest.specialistReviews?.[0]?.reviewer).toBe("test_integration")
    expect(manifest.specialistReviews?.[0]?.findings[0]?.claim).toContain("no-op success signal")
    expect(manifest.finalGate.status).toBe("failed")
    expect(manifest.finalGate.failedReviewIds).toEqual(["specialist:test_integration"])
  })

  test("rejects empty test files even when the test command is green", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun -e \"console.log('ok')\"" },
      files: {
        "tests/app.test.ts": "\n// placeholder\n",
      },
    })

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_empty_tests",
        runID: "run_empty_tests",
        deliveryID: "dlv_empty_tests",
        changedFiles: ["tests/app.test.ts"],
        goals: [blockingGoal("gol_empty_tests", "REQ-tests")],
      }),
    })

    const claims = manifest.specialistReviews?.[0]?.findings.map((finding) => finding.claim).join("\n")
    expect(claims).toContain("no-op success signal")
    expect(claims).toContain("is empty")
    expect(manifest.finalGate.failedReviewIds).toEqual(["specialist:test_integration"])
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

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_snapshot_tests",
        runID: "run_snapshot_tests",
        deliveryID: "dlv_snapshot_tests",
        changedFiles: ["tests/view.test.ts"],
        goals: [blockingGoal("gol_snapshot_tests", "REQ-view")],
      }),
    })

    const claims = manifest.specialistReviews?.[0]?.findings.map((finding) => finding.claim).join("\n")
    expect(claims).toContain("only checks snapshots")
    expect(manifest.finalGate.failedReviewIds).toEqual(["specialist:test_integration"])
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

    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: "tsk_meaningful_tests",
        runID: "run_meaningful_tests",
        deliveryID: "dlv_meaningful_tests",
        changedFiles: ["src/app.ts"],
        goals: [blockingGoal("gol_meaningful_tests", "REQ-chat")],
      }),
    })

    expect(manifest.specialistReviews?.[0]?.findings).toEqual([])
    expect(manifest.reviewEvidence.find((item) => item.id === "specialist:test_integration")?.status).toBe("passed")
    expect(manifest.finalGate.status).toBe("passed")
  })

  test("manifest persistence writes specialist review artifacts", async () => {
    const now = Date.now()
    const projectId = `project_test_review_${now.toString(16)}`
    const taskId = `tsk_test_review_${now.toString(16)}`
    seedTask({ projectId, taskId, now })
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
    const deliveryID = `dlv_test_review_${now.toString(16)}`
    const manifest = await Instance.provide({
      directory: dir,
      fn: () => buildDeliveryEvidenceManifest({
        taskID: taskId,
        runID: `run_test_review_${now.toString(16)}`,
        deliveryID,
        changedFiles: ["src/app.ts"],
        goals: [blockingGoal("gol_test_review", "REQ-chat")],
      }),
    })

    persistDeliveryEvidenceManifest({ manifest })

    const reviews = findDeliverySpecialistReviews({ deliveryID })
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.reviewer).toBe("test_integration")
  })
})

async function packageFixture(input: {
  scripts: Record<string, string>
  files: Record<string, string>
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-test-integration-review-"))
  tempDirs.push(dir)
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    type: "module",
    scripts: input.scripts,
  }, null, 2))
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

function seedTask(input: {
  projectId: string
  taskId: string
  now: number
}) {
  projectIds.push(input.projectId)
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: input.projectId,
      worktree: process.cwd(),
      name: "Test integration review project",
      sandboxes: "[]",
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: input.taskId,
      project_id: input.projectId,
      source: "test",
      title: "Test integration review task",
      request: "Verify test specialist artifact persistence",
      priority: "normal",
      time_created: input.now,
      time_updated: input.now,
    }).run()
  })
}
