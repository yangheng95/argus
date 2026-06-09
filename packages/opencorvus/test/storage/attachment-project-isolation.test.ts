import { describe, expect, test } from "bun:test"
import path from "node:path"

import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { EngineService } from "../../src/task-api"
import { tmpdir } from "../fixture/fixture"

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

function seedTask(input: { id: string; projectID: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.id,
        project_id: input.projectID,
        source: "test",
        title: "attachment project isolation",
        request: "verify project-scoped attachments",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

describe("Attachment project isolation", () => {
  test("task artifact registration rejects attachment refs from another project", async () => {
    await using projectA = await tmpdir()
    await using projectB = await tmpdir()
    const projectAID = `proj_attach_a_${Date.now()}`
    const projectBID = `proj_attach_b_${Date.now()}`
    const taskID = `tsk_attach_${Date.now()}`
    seedProject({ id: projectAID, worktree: projectA.path })
    seedProject({ id: projectBID, worktree: projectB.path })
    seedTask({ id: taskID, projectID: projectAID })

    const ref = await AttachmentStore.write(projectBID, Buffer.from("png-bytes"), "image/png", "foreign.png")

    await expect(
      EngineService.appendTaskSystemArtifact(taskID, {
        ...ref,
        intent: "visual_reference",
        source: "test",
      }),
    ).rejects.toThrow(`expected task project ${projectAID}`)
  })

  test("build staging rejects attachment refs from another project", async () => {
    await using projectA = await tmpdir()
    await using projectB = await tmpdir()
    await using worktree = await tmpdir()
    const projectAID = `proj_stage_a_${Date.now()}`
    const projectBID = `proj_stage_b_${Date.now()}`
    seedProject({ id: projectAID, worktree: projectA.path })
    seedProject({ id: projectBID, worktree: projectB.path })

    const ref = await AttachmentStore.write(projectBID, Buffer.from("png-bytes"), "image/png", "foreign.png")

    await expect(AttachmentStore.stageToWorktree(projectAID, [ref], worktree.path)).rejects.toThrow(
      `belongs to project ${projectBID}`,
    )
    const staged = path.join(worktree.path, AttachmentStore.STAGED_REFERENCES_SUBDIR, "foreign.png")
    expect(await Bun.file(staged).exists()).toBe(false)
  })
})
