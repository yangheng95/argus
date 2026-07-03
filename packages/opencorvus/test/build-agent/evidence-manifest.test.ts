import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"

import { composeBuildInputEvidenceManifest } from "../../src/build/evidence-manifest"
import type { BuildEvidencePack } from "../../src/build/evidence-pack"
import { ProjectTable } from "../../src/project/project.sql"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

function unique(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function seedProject(input: { id: string; worktree: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: input.id,
        worktree: input.worktree,
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run(),
  )
}

describe("Build input evidence manifest", () => {
  test("records canonical attachment metadata for validated evidence", async () => {
    await using project = await tmpdir()
    const projectID = unique("proj_build_manifest")
    const taskID = unique("tsk_build_manifest")
    seedProject({ id: projectID, worktree: project.path })

    const ref = await AttachmentStore.write(projectID, Buffer.from("target-image"), "image/png", "target.png")
    const pack: BuildEvidencePack = {
      targetReferences: [
        {
          url: ref.url,
          mime: ref.mime,
          sha: ref.sha,
          size: ref.size,
          filename: ref.filename,
          intent: "visual_reference",
          source: "test",
          scope: { kind: "task", taskID },
        },
      ],
    }

    const manifest = await composeBuildInputEvidenceManifest({
      projectID,
      taskID,
      goalID: "goal_1",
      sessionID: "session_1",
      evidencePack: pack,
      now: 123,
    })

    expect(manifest).toEqual({
      version: 1,
      project_id: projectID,
      task_id: taskID,
      goal_id: "goal_1",
      session_id: "session_1",
      entries: [
        {
          role: "target_reference",
          project_id: projectID,
          sha: ref.sha,
          mime: ref.mime,
          size: ref.size,
          filename: ref.filename,
          source: "test",
          intent: "visual_reference",
          source_task_id: taskID,
          legacy_attachment_url: ref.url,
          sha_verified_at: 123,
        },
      ],
    })
  })

  test("rejects evidence owned by another project before staging or provider replay", async () => {
    await using projectA = await tmpdir()
    await using projectB = await tmpdir()
    const projectAID = unique("proj_manifest_a")
    const projectBID = unique("proj_manifest_b")
    seedProject({ id: projectAID, worktree: projectA.path })
    seedProject({ id: projectBID, worktree: projectB.path })

    const ref = await AttachmentStore.write(projectBID, Buffer.from("foreign"), "image/png", "foreign.png")

    await expect(
      composeBuildInputEvidenceManifest({
        projectID: projectAID,
        taskID: unique("tsk_manifest_foreign"),
        evidencePack: {
          targetReferences: [{ ...ref, intent: "visual_reference", source: "test" }],
        },
      }),
    ).rejects.toThrow(`belongs to project ${projectBID}, expected task project ${projectAID}`)
  })

  test("rejects missing attachment bytes before provider replay", async () => {
    await using project = await tmpdir()
    const projectID = unique("proj_manifest_missing")
    const taskID = unique("tsk_manifest_missing")
    seedProject({ id: projectID, worktree: project.path })

    const ref = await AttachmentStore.write(projectID, Buffer.from("missing"), "image/png", "missing.png")
    const located = AttachmentStore.nameFromUrl(ref.url)
    expect(located).toBeDefined()
    const abs = AttachmentStore.resolveAbsolute(located!.projectID, located!.name)
    expect(abs).toBeDefined()
    await fs.unlink(abs!)

    await expect(
      composeBuildInputEvidenceManifest({
        projectID,
        taskID,
        evidencePack: {
          targetReferences: [{ ...ref, intent: "visual_reference", source: "test" }],
        },
      }),
    ).rejects.toThrow("bytes are unreadable")
  })

  test("rejects caller sha drift before contract creation", async () => {
    await using project = await tmpdir()
    const projectID = unique("proj_manifest_sha")
    const taskID = unique("tsk_manifest_sha")
    seedProject({ id: projectID, worktree: project.path })

    const ref = await AttachmentStore.write(projectID, Buffer.from("canonical"), "image/png", "canonical.png")

    await expect(
      composeBuildInputEvidenceManifest({
        projectID,
        taskID,
        evidencePack: {
          targetReferences: [
            {
              ...ref,
              sha: "0".repeat(64),
              intent: "visual_reference",
              source: "test",
            },
          ],
        },
      }),
    ).rejects.toThrow("sha does not match canonical AttachmentStore metadata")
  })

  test("records canonical filename when caller display filename drifts", async () => {
    await using project = await tmpdir()
    const projectID = unique("proj_manifest_filename")
    const taskID = unique("tsk_manifest_filename")
    seedProject({ id: projectID, worktree: project.path })

    const ref = await AttachmentStore.write(projectID, Buffer.from("canonical"), "image/png", "canonical.png")

    const manifest = await composeBuildInputEvidenceManifest({
      projectID,
      taskID,
      evidencePack: {
        targetReferences: [
          {
            ...ref,
            filename: "region-label-not-storage-filename.png",
            intent: "visual_reference",
            source: "test",
          },
        ],
      },
    })

    expect(manifest.entries[0]?.filename).toBe("canonical.png")
  })
})
