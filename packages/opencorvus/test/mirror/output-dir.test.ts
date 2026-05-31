import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

import { EngineTaskTable } from "../../src/engine/engine.sql"
import { resolveMirrorOutputDir } from "../../src/mirror/tools/output-dir"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

function seedTask(input: { projectID: string; taskID: string; sessionID: string }) {
  const now = Date.now()
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: input.taskID,
      project_id: input.projectID,
      session_id: input.sessionID,
      source: "test",
      title: "mirror output dir",
      request: "resolve task-scoped mirror output",
      priority: "normal",
      budget: { max_executor_groups: 1 },
      time_created: now,
      time_updated: now,
      time_started: now,
    }).run(),
  )
}

describe("mirror output directory", () => {
  test("default resolves to task-scoped frontend-design mirror", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "mirror output dir" })
        const taskID = `tsk_mirror_output_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        const outputDir = await resolveMirrorOutputDir({ sessionID: session.id })
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        expect(outputDir).toBe(paths.mirrorAbsolute)

        await fs.writeFile(path.join(outputDir, "reference.txt"), "reference", "utf8")
        expect(await Filesystem.readText(path.join(tmp.path, "mirror", "reference.txt"))).toBe("reference")

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
        const outputDir = await resolveMirrorOutputDir({ override: "custom-mirror" })
        expect(outputDir).toBe(path.join(tmp.path, "custom-mirror"))
        expect(await Filesystem.exists(outputDir)).toBe(true)
      },
    })
  })

  test("task session override must stay under mirror view", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "mirror output dir guard" })
        const taskID = `tsk_mirror_guard_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        await expect(
          resolveMirrorOutputDir({ override: "src/components", sessionID: session.id }),
        ).rejects.toThrow("task sessions may only write mirror artifacts")

        expect(await Filesystem.exists(path.join(tmp.path, "src"))).toBe(false)
      },
    })
  })

  test("task session override maps mirror view to canonical runtime", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "mirror output dir view" })
        const taskID = `tsk_mirror_view_${Date.now().toString(36)}`
        seedTask({ projectID: Instance.project.id, taskID, sessionID: session.id })

        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        const outputDir = await resolveMirrorOutputDir({ override: "mirror", sessionID: session.id })
        expect(outputDir).toBe(paths.mirrorAbsolute)

        const nested = await resolveMirrorOutputDir({ override: "mirror/nested", sessionID: session.id })
        expect(nested).toBe(path.join(paths.mirrorAbsolute, "nested"))
        expect(await Filesystem.exists(nested)).toBe(true)

        await fs.writeFile(path.join(nested, "reference.txt"), "reference", "utf8")
        expect(await Filesystem.readText(path.join(tmp.path, "mirror", "nested", "reference.txt"))).toBe("reference")

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
        await expect(resolveMirrorOutputDir()).rejects.toThrow("sessionID")
      },
    })
  })
})
