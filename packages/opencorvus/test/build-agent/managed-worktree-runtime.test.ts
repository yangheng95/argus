import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { BuildAgent } from "../../src/build/agent"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
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
  test("fails before model work when the managed runtime evidence view is invalid", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const suffix = Date.now().toString(36)
        const taskID = `tsk_build_runtime_${suffix}`
        const sessionID = `ses_build_runtime_${suffix}`
        seedTask({ projectID: Instance.project.id, taskID })
        const task = findTask(taskID)
        expect(task).toBeTruthy()

        const info = await Worktree.create({
          name: `build-runtime-${suffix}`,
          taskID,
          sessionID,
        })
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        const runtimeTaskParent = path.dirname(path.join(info.directory, paths.relativeDir))
        await fs.rm(runtimeTaskParent, { recursive: true, force: true })
        await fs.mkdir(path.dirname(runtimeTaskParent), { recursive: true })
        await fs.writeFile(runtimeTaskParent, "not a directory", "utf8")

        await expect(
          BuildAgent.run({
            task: task!,
            target: {
              kind: "request",
              text: "This request must not reach model execution.",
            },
            managedWorktree: {
              directory: info.directory,
              branch: info.branch,
              baseRef: null,
            },
          }),
        ).rejects.toThrow("failed to materialize task runtime artifacts")
      },
    })
  }, 30_000)
})
