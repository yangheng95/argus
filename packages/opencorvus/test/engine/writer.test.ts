import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findGoalLatestWorkspace } from "../../src/engine/store"
import { cleanupGoalWorkspaceForGoal } from "../../src/engine/writer"

// Phase G (2026-05-05) — workspace pointers ride the per-attempt artifact
// payload; updateGoalWorkspace refuses to be used as a no-tip backdoor.
// Test fixtures seed the initial attempt artifact directly.
function seedAttemptWithWorkspace(input: {
  taskID: string
  goalID: string
  workspaceDir: string
  workspaceBranch: string
  status: "queued" | "running" | "completed" | "failed" | "aborted"
  now: number
}) {
  const id = `grun_seed_${input.goalID}`
  const terminal = input.status === "completed" || input.status === "failed" || input.status === "aborted"
  Database.use((db) =>
    db.insert(EngineArtifactTable).values({
      id,
      task_id: input.taskID,
      run_id: null,
      goal_run_id: id,
      kind: "goal_run_attempt",
      label: `attempt-${input.status}`,
      payload: {
        goal_id: input.goalID,
        plan_node_id: null,
        session_id: null,
        status: input.status,
        retry_count: 0,
        blocking_reason: null,
        error: null,
        workspace_dir: input.workspaceDir,
        workspace_branch: input.workspaceBranch,
        workspace_base_ref: null,
        base_ref: null,
        merge_ref: null,
        supersede_of: null,
        superseded_reason: null,
        superseded_at: null,
        metadata: null,
        time_started: terminal ? input.now : null,
        time_completed: terminal ? input.now : null,
      },
      time_created: input.now,
      time_updated: input.now,
    }).run(),
  )
}
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

  test("cleanupGoalWorkspaceForGoal removes a completed goal worktree and clears workspace fields", async () => {
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
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
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
            status: "completed",
            order_index: 0,
            time_created: now,
            time_updated: now,
          }).run()
        })

        const worktree = await Worktree.create({ name: `writer-cleanup-${now.toString(36)}` })
        seedAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: worktree.directory,
          workspaceBranch: worktree.branch,
          status: "completed",
          now,
        })

        expect(findGoalLatestWorkspace(goalID).directory).toBe(worktree.directory)
        expect(await Filesystem.exists(worktree.directory)).toBe(true)

        const cleaned = await cleanupGoalWorkspaceForGoal(goalID)

        expect(cleaned).toBe(true)
        expect(await Filesystem.exists(worktree.directory)).toBe(false)
        expect(findGoalLatestWorkspace(goalID).directory).toBeNull()
        expect(findGoalLatestWorkspace(goalID).branch).toBeNull()
      },
    })
  })

  test("cleanupGoalWorkspaceForGoal keeps workspace fields when physical cleanup is refused", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `task_writer_refuse_${now}`
        const goalID = `goal_writer_refuse_${now}`

        Database.transaction((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: tmp.path,
            name: "Writer Test",
            sandboxes: [],
            time_created: now,
            time_updated: now,
          }).onConflictDoNothing().run()

          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            source: "test",
            title: "writer cleanup refusal task",
            request: "cleanup workspace",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run()

          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "cleanup refusal goal",
            slug: "cleanup-refusal-goal",
            objective: "verify failed cleanup keeps workspace pointer",
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
            order_index: 0,
            time_created: now,
            time_updated: now,
          }).run()
        })

        seedAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/not-a-goal-worktree",
          status: "failed",
          now,
        })

        await expect(cleanupGoalWorkspaceForGoal(goalID)).rejects.toThrow("outside goal workspace roots")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        expect(findGoalLatestWorkspace(goalID).branch).toBe("opencorvus/not-a-goal-worktree")
      },
    })
  })
})
