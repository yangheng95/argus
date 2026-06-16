import { describe, expect, test } from "bun:test"
import path from "path"

import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function seedTask(input: { projectID: string; taskID: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: "build managed worktree runtime",
        request: "verify managed worktree runtime materialization",
        priority: "normal",
        budget: { max_executor_groups: 1 },
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

describe("BuildAgent managed worktree runtime", () => {
  test("managed worktrees do not receive copied runtime evidence views", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_build_runtime_${suffix}`
        const sessionID = `ses_build_runtime_${suffix}`
        seedTask({ projectID: Instance.project.id, taskID })

        const info = await Worktree.create({
          name: `build-runtime-${suffix}`,
          taskID,
          sessionID,
        })
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        expect(path.join(info.directory, paths.relativeDir)).toContain(`${path.sep}.opencorvus${path.sep}r${path.sep}`)
        expect(await Bun.file(path.join(info.directory, paths.relativeDir)).exists()).toBe(false)
      },
    })
  }, 30_000)
})
