import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runBackendApiReview, runClientContractReview } from "../../src/acceptance/specialists/backend-client"
import type { AcceptanceSurfaceManifest } from "../../src/acceptance/surface-detector"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("acceptance backend API and client contract specialist reviews", () => {
  test("backend review is absent when backend surface is not selected", async () => {
    const review = await runBackendApiReview({
      taskID: "tsk_backend_absent",
      runID: "run_backend_absent",
      acceptanceID: "dlv_backend_absent",
      projectRoot: process.cwd(),
      surfaceManifest: manifest([]),
    })

    expect(review).toBeUndefined()
  })

  test("backend review requires route evidence for selected backend surfaces", async () => {
    const review = await runBackendApiReview({
      taskID: "tsk_backend_missing",
      runID: "run_backend_missing",
      acceptanceID: "dlv_backend_missing",
      projectRoot: process.cwd(),
      surfaceManifest: manifest(["backend_api"], { backendEvidence: false }),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: expect.stringContaining("without route file or route literal evidence"),
    })
  })

  test("backend review passes with structural route evidence", async () => {
    const review = await runBackendApiReview({
      taskID: "tsk_backend_pass",
      runID: "run_backend_pass",
      acceptanceID: "dlv_backend_pass",
      projectRoot: process.cwd(),
      surfaceManifest: manifest(["backend_api"]),
    })

    expect(review?.findings).toEqual([])
    expect(review?.evidenceRefs).toContain("route:src/routes/users.ts")
  })

  test("client contract review does not block when selected without concrete client evidence", async () => {
    const review = await runClientContractReview({
      taskID: "tsk_client_missing",
      runID: "run_client_missing",
      acceptanceID: "dlv_client_missing",
      projectRoot: process.cwd(),
      surfaceManifest: manifest(["client_contract"], { clientEvidence: false }),
    })

    expect(review?.findings).toEqual([])
    expect(review?.summary).toContain("skipped blocking checks")
  })

  test("client contract review flags route/client endpoint drift", async () => {
    const dir = await packageFixture({
      "src/routes/users.ts": "app.get('/api/users', handler)\n",
      "src/lib/api/client.ts": "export const load = () => fetch('/api/projects')\n",
    })
    const review = await runClientContractReview({
      taskID: "tsk_client_contract",
      runID: "run_client_contract",
      acceptanceID: "dlv_client_contract",
      projectRoot: dir,
      surfaceManifest: manifest(["backend_api", "client_contract"]),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "contract",
      claim: expect.stringContaining("no matching backend route"),
    })
  })
})

function manifest(
  surfaces: Array<"backend_api" | "client_contract">,
  options: { backendEvidence?: boolean; clientEvidence?: boolean } = {},
): AcceptanceSurfaceManifest {
  const evidence: AcceptanceSurfaceManifest["evidence"] = []
  if (surfaces.includes("backend_api") && (options.backendEvidence ?? true)) {
    evidence.push({
      surface: "backend_api",
      reason: "API route files detected",
      refs: [{ kind: "route", ref: "src/routes/users.ts" }],
    })
  }
  if (surfaces.includes("client_contract") && (options.clientEvidence ?? true)) {
    evidence.push({
      surface: "client_contract",
      reason: "client/API contract files detected",
      refs: [{ kind: "file", ref: "src/lib/api/client.ts" }],
    })
  }
  return {
    id: "artifact_surface_backend_client",
    taskId: "tsk_backend_client",
    acceptanceId: "dlv_backend_client",
    projectRoot: process.cwd(),
    surfaces,
    evidence,
    timeCreated: 1,
  }
}

async function packageFixture(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-backend-client-review-"))
  tempDirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}
