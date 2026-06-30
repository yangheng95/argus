import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findGoalLatestWorkspace, findGoalRun, findRun } from "../../src/engine/store"
import { abortLiveExecutionForTask, cleanupGoalWorkspaceForGoal } from "../../src/engine/writer"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { resetDatabase, TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const WRITER_TEST_TIMEOUT_MS = TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS + 15_000

describe("engine writer goal workspace cleanup", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(
    async () => {
      await resetDatabase()
      tmp = await tmpdir({ git: true })
    },
    { timeout: WRITER_TEST_TIMEOUT_MS },
  )

  afterEach(
    async () => {
      await resetDatabase()
      await tmp?.[Symbol.asyncDispose]?.()
    },
    { timeout: WRITER_TEST_TIMEOUT_MS },
  )

  test("cleanupGoalWorkspaceForGoal removes a completed goal worktree and clears workspace fields", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `task_writer_${now}`
        const goalID = `goal_writer_${now}`

        Database.transaction((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Writer Test",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .onConflictDoNothing()
            .run()

          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "writer cleanup task",
              request: "cleanup workspace",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          db.insert(EngineGoalTable)
            .values({
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
            })
            .run()
        })

        const worktree = await Worktree.create({ name: `writer-cleanup-${now.toString(36)}` })
        seedGoalRunAttemptWithWorkspace({
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

  test("cleanupGoalWorkspaceForGoal preserves non-completed goal worktrees", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `task_writer_preserve_${now}`
        const goalID = `goal_writer_preserve_${now}`

        Database.transaction((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Writer Test",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .onConflictDoNothing()
            .run()

          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "writer cleanup preserve task",
              request: "cleanup workspace",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "cleanup preserve goal",
              slug: "cleanup-preserve-goal",
              objective: "verify non-completed cleanup keeps workspace pointer",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: [],
              priority: "blocking",
              source: "test",
              status: "running",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const worktree = await Worktree.create({ name: `writer-preserve-${now.toString(36)}` })
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: worktree.directory,
          workspaceBranch: worktree.branch,
          status: "aborted",
          now,
        })

        const cleaned = await cleanupGoalWorkspaceForGoal(goalID)

        expect(cleaned).toBe(false)
        expect(await Filesystem.exists(worktree.directory)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(worktree.directory)
        expect(findGoalLatestWorkspace(goalID).branch).toBe(worktree.branch)
      },
    })
  })

  test("cleanupGoalWorkspaceForGoal keeps completed workspace fields when physical cleanup is refused", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `task_writer_refuse_${now}`
        const goalID = `goal_writer_refuse_${now}`

        Database.transaction((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Writer Test",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .onConflictDoNothing()
            .run()

          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "writer cleanup refusal task",
              request: "cleanup workspace",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          db.insert(EngineGoalTable)
            .values({
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
              status: "completed",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/not-a-goal-worktree",
          status: "completed",
          now,
        })

        await expect(cleanupGoalWorkspaceForGoal(goalID)).rejects.toThrow("outside goal workspace roots")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        expect(findGoalLatestWorkspace(goalID).branch).toBe("opencorvus/not-a-goal-worktree")
      },
    })
  })

  test("abortLiveExecutionForTask aborts resettable goal runs and live runs", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        const taskID = `tsk_writer_abort_${now}`
        const liveRunID = `run_writer_live_${now}`
        const terminalRunID = `run_writer_done_${now}`
        const queuedGoalID = `gol_writer_queued_${now}`
        const runningGoalID = `gol_writer_running_${now}`
        const completedGoalID = `gol_writer_completed_${now}`
        const goalRunIDPrefix = (now % 0xffffff).toString(16).padStart(6, "0")
        const queuedGoalRunID = `${goalRunIDPrefix}01`
        const runningGoalRunID = `${goalRunIDPrefix}02`
        const completedGoalRunID = `${goalRunIDPrefix}03`

        Database.transaction((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Writer Test",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .onConflictDoNothing()
            .run()

          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "writer abort task",
              request: "abort live run",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          for (const [runID, status] of [
            [liveRunID, "running"],
            [terminalRunID, "completed"],
          ] as const) {
            db.insert(EngineArtifactTable)
              .values({
                id: runID,
                task_id: taskID,
                run_id: runID,
                kind: "run",
                label: `run-${status}`,
                payload: {
                  plan_version_id: null,
                  session_id: null,
                  executor: "opencorvus",
                  status,
                  phase: "execute",
                  blocking_reason: null,
                  error: null,
                  retry_count: 0,
                  executor_ref: null,
                  metadata: null,
                  time_started: status === "running" ? now : now - 10,
                  time_completed: status === "completed" ? now : null,
                },
                time_created: now,
                time_updated: now,
              })
              .run()
          }

          for (const [goalID, status] of [
            [queuedGoalID, "queued"],
            [runningGoalID, "running"],
            [completedGoalID, "completed"],
          ] as const) {
            db.insert(EngineGoalTable)
              .values({
                id: goalID,
                task_id: taskID,
                title: `writer ${status} goal`,
                slug: `writer-${status}-goal`,
                objective: `writer ${status} goal`,
                acceptance_specs: [],
                owned_paths: [],
                depends_on: [],
                exports: [],
                imports: [],
                kind: "feature",
                requirement_ids: [],
                priority: "blocking",
                source: "test",
                status: "pending",
                order_index: 0,
                time_created: now,
                time_updated: now,
              })
              .run()
          }
        })

        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID: queuedGoalID,
          runID: liveRunID,
          artifactID: queuedGoalRunID,
          workspaceDir: null,
          workspaceBranch: null,
          status: "queued",
          now,
        })
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID: runningGoalID,
          runID: liveRunID,
          artifactID: runningGoalRunID,
          workspaceDir: null,
          workspaceBranch: null,
          status: "running",
          now,
        })
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID: completedGoalID,
          runID: liveRunID,
          artifactID: completedGoalRunID,
          workspaceDir: null,
          workspaceBranch: null,
          status: "completed",
          now,
        })

        const result = await abortLiveExecutionForTask({
          taskID,
          reason: "operator abort",
        })

        expect(result.runs).toBe(1)
        expect(result.goalRuns).toBe(2)
        expect(findRun(liveRunID)?.status).toBe("aborted")
        expect(findRun(terminalRunID)?.status).toBe("completed")
        expect(findGoalRun(queuedGoalRunID)?.status).toBe("aborted")
        expect(findGoalRun(runningGoalRunID)?.status).toBe("aborted")
        expect(findGoalRun(completedGoalRunID)?.status).toBe("completed")
      },
    })
  })
})
