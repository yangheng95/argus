import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runSecurityDataReview } from "../../src/acceptance/specialists/security-data"
import type { AcceptanceSurfaceManifest } from "../../src/acceptance/surface-detector"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("acceptance security and data specialist review", () => {
  test("security review is absent when security surface is not selected", async () => {
    const review = await runSecurityDataReview({
      taskID: "tsk_security_absent",
      runID: "run_security_absent",
      acceptanceID: "dlv_security_absent",
      projectRoot: process.cwd(),
      surfaceManifest: manifest([]),
    })

    expect(review).toBeUndefined()
  })

  test("security review requires dependency or file evidence", async () => {
    const review = await runSecurityDataReview({
      taskID: "tsk_security_missing",
      runID: "run_security_missing",
      acceptanceID: "dlv_security_missing",
      projectRoot: process.cwd(),
      surfaceManifest: manifest(["security_data"], { fileEvidence: false }),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: expect.stringContaining("without dependency or file evidence"),
    })
  })

  test("security review flags hardcoded secret-like assignments", async () => {
    const dir = await fixture({
      "src/auth/session.ts": "const JWT_SECRET = '12345678901234567890'\n",
    })
    const review = await runSecurityDataReview({
      taskID: "tsk_security_secret",
      runID: "run_security_secret",
      acceptanceID: "dlv_security_secret",
      projectRoot: dir,
      surfaceManifest: manifest(["security_data"]),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "security",
      claim: expect.stringContaining("hardcoded secret-like value"),
      evidence: [{ kind: "file", ref: "src/auth/session.ts", excerpt: "JWT_SECRET = '12345678901234567890'" }],
    })
  })

  test("security review flags unsafe upload paths", async () => {
    const dir = await fixture({
      "src/upload/handler.ts": [
        "import path from 'node:path'",
        "import fs from 'node:fs'",
        "export function save(file: { originalname: string }, root: string) {",
        "  fs.writeFile(path.join(root, file.originalname), '')",
        "}",
      ].join("\n"),
    })
    const review = await runSecurityDataReview({
      taskID: "tsk_security_upload",
      runID: "run_security_upload",
      acceptanceID: "dlv_security_upload",
      projectRoot: dir,
      surfaceManifest: manifest(["security_data"], { file: "src/upload/handler.ts" }),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "security",
      claim: expect.stringContaining("without basename normalization"),
    })
  })

  test("security review flags unconditional destructive data operations", async () => {
    const dir = await fixture({
      "src/db/cleanup.ts": "export async function clean(db: any) { await db.user.deleteMany({}) }\n",
    })
    const review = await runSecurityDataReview({
      taskID: "tsk_security_delete",
      runID: "run_security_delete",
      acceptanceID: "dlv_security_delete",
      projectRoot: dir,
      surfaceManifest: manifest(["security_data"], { file: "src/db/cleanup.ts" }),
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "data_integrity",
      claim: expect.stringContaining("unconditional destructive operation"),
    })
  })

  test("security review passes with concrete sensitive files and no secret findings", async () => {
    const dir = await fixture({
      "src/auth/session.ts": "export const sessionSecret = process.env.JWT_SECRET\n",
    })
    const review = await runSecurityDataReview({
      taskID: "tsk_security_pass",
      runID: "run_security_pass",
      acceptanceID: "dlv_security_pass",
      projectRoot: dir,
      surfaceManifest: manifest(["security_data"]),
    })

    expect(review?.findings).toEqual([])
    expect(review?.evidenceRefs).toContain("file:src/auth/session.ts")
  })
})

function manifest(
  surfaces: Array<"security_data">,
  options: { fileEvidence?: boolean; file?: string } = {},
): AcceptanceSurfaceManifest {
  return {
    id: "artifact_surface_security",
    taskId: "tsk_surface_security",
    acceptanceId: "dlv_surface_security",
    projectRoot: process.cwd(),
    surfaces,
    evidence: surfaces.includes("security_data") && (options.fileEvidence ?? true)
      ? [{
          surface: "security_data",
          reason: "security or data access files detected",
          refs: [{ kind: "file", ref: options.file ?? "src/auth/session.ts" }],
        }]
      : [],
    timeCreated: 1,
  }
}

async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-security-data-review-"))
  tempDirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}
