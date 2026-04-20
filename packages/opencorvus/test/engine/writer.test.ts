import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { updateGoalWorkspace } from "../../src/engine/persist"
import { findGoal } from "../../src/engine/store"
import { cleanupGoalWorkspaceForGoal } from "../../src/engine/writer"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("engine writer goal workspace cleanup", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("cleanupGoalWorkspaceForGoal removes the worktree and clears goal workspace fields", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `task_writer_${now}`
        const goalID = `goal_writer_${now}`

        Database.transaction((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: tmp.path,
            vcs: "git",
            name: "Writer Test",
            sandboxes: [],
            time_created: now,
            time_updated: now,
          }).onConflictDoNothing().run()

          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            source: "test",
            title: "writer cleanup task",
            request: "cleanup workspace",
            status: "active",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run()

          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "cleanup goal",
            slug: "cleanup-goal",
            objective: "verify terminal cleanup",
            acceptance_specs: [],
            owned_paths: [],
            depends_on: [],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
            source: "test",
            status: "failed",
            retry_count: 0,
            order_index: 0,
            time_created: now,
            time_updated: now,
          }).run()
        })

        const worktree = await Worktree.create({ name: `writer-cleanup-${now.toString(36)}` })
        updateGoalWorkspace({
          goalID,
          workspaceDir: worktree.directory,
          workspaceBranch: worktree.branch,
        })

        expect(findGoal(goalID)?.workspace_dir).toBe(worktree.directory)
        expect(await Filesystem.exists(worktree.directory)).toBe(true)

        const cleaned = await cleanupGoalWorkspaceForGoal(goalID)

        expect(cleaned).toBe(true)
        expect(await Filesystem.exists(worktree.directory)).toBe(false)
        expect(findGoal(goalID)?.workspace_dir).toBeNull()
        expect(findGoal(goalID)?.workspace_branch).toBeNull()
      },
    })
  })
})
