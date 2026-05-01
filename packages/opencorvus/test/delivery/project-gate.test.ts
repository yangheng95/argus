import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { buildDeliveryEvidenceManifest } from "../../src/delivery/checks/project-gate"
import {
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
      changedFiles: ["src/app.ts"],
      finalGate: {
        status: "passed",
        summary: "stale caller verdict",
        failedCheckIds: [],
      },
      timeCreated: Date.now(),
    }

    expect(validateDeliveryEvidenceManifest(manifest)).toEqual({
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s).",
      failedCheckIds: ["lint#1"],
    })
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
