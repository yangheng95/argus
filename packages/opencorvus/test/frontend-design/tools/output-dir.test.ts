import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

import { EngineTaskTable } from "../../../src/engine/engine.sql"
import { resolveWebpageEvidenceOutputDir } from "../../../src/frontend-design/tools/output-dir"
import { Instance } from "../../../src/project/instance"
import { ProjectRuntimePaths } from "../../../src/project/runtime-paths"
import { Session } from "../../../src/session"
import { Database } from "../../../src/storage/db"
import { Filesystem } from "../../../src/util/filesystem"
import { tmpdir } from "../../fixture/fixture"

function seedTask(input: { projectID: string; taskID: string; sessionID: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        session_id: input.sessionID,
        source: "test",
        title: "webpage evidence output dir",
        request: "resolve task-scoped webpage evidence output",
        priority: "normal",
        budget: { max_executor_groups: 1 },
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

describe("webpage evidence output directory", () => {
  test("default resolves to task-scoped frontend-design webpage evidence", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "webpage evidence output dir" })
        const taskID = `tsk_webpage_evidence_output_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        const outputDir = await resolveWebpageEvidenceOutputDir({ sessionID: session.id })
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        expect(outputDir).toBe(paths.webpageEvidenceAbsolute)

        await fs.writeFile(path.join(outputDir, "reference.txt"), "reference", "utf8")
        expect(await Filesystem.exists(path.join(tmp.path, "webpage-evidence", "reference.txt"))).toBe(false)
        expect(await Filesystem.readText(path.join(paths.webpageEvidenceAbsolute, "reference.txt"))).toBe("reference")

        const status = await $`git status --porcelain=v1`.cwd(tmp.path).quiet()
        expect(status.stdout.toString().trim()).toBe("")
      },
    })
  })

  test("override remains an explicit single source", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = await resolveWebpageEvidenceOutputDir({ override: "custom-webpage-evidence" })
        expect(outputDir).toBe(path.join(tmp.path, "custom-webpage-evidence"))
        expect(await Filesystem.exists(outputDir)).toBe(true)
      },
    })
  })

  test("task session override must stay under webpage evidence view", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "webpage evidence output dir guard" })
        const taskID = `tsk_webpage_evidence_guard_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        await expect(
          resolveWebpageEvidenceOutputDir({ override: "src/components", sessionID: session.id }),
        ).rejects.toThrow("task sessions may only write webpage evidence artifacts")

        expect(await Filesystem.exists(path.join(tmp.path, "src"))).toBe(false)
      },
    })
  })

  test("task session override rejects retired mirror alias", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "webpage evidence output dir view" })
        const taskID = `tsk_webpage_evidence_view_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        await expect(resolveWebpageEvidenceOutputDir({ override: "mirror", sessionID: session.id })).rejects.toThrow(
          "task sessions may only write webpage evidence artifacts",
        )
        await expect(
          resolveWebpageEvidenceOutputDir({ override: "mirror/nested", sessionID: session.id }),
        ).rejects.toThrow("task sessions may only write webpage evidence artifacts")
        expect(await Filesystem.exists(path.join(tmp.path, "mirror"))).toBe(false)

        const status = await $`git status --porcelain=v1`.cwd(tmp.path).quiet()
        expect(status.stdout.toString().trim()).toBe("")
      },
    })
  })

  test("default fails without a session anchor", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(resolveWebpageEvidenceOutputDir()).rejects.toThrow("sessionID")
      },
    })
  })
})
