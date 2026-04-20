import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineExecutorSessionTable,
  EngineGoalRunTable,
  EngineGoalTable,
  EngineRunTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { recoverProjectExecution } from "../../src/engine/recovery"
import { findExecutorSession, findGoal, findGoalRun, findRun, findTask } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let activeTaskID = ""
let queuedTaskID = ""
let runID = ""
let goalID = ""
let goalRunID = ""
let executorSessionID = ""
let workspaceDir = ""

function seedProject() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      vcs: "git",
      name: "Recovery Test",
      sandboxes: [],
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

function seedActiveExecution() {
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(EngineTaskTable).values({
      id: activeTaskID,
      project_id: projectID,
      source: "test",
      title: "active task",
      request: "recover this task",
      status: "active",
      active_run_id: runID,
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineGoalTable).values({
      id: goalID,
      task_id: activeTaskID,
      title: "goal",
      slug: "goal",
      objective: "do work",
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
      retry_count: 0,
      workspace_dir: workspaceDir,
      workspace_branch: "opencorvus/recovery-test",
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineRunTable).values({
      id: runID,
      task_id: activeTaskID,
      executor: "opencode",
      status: "running",
      phase: "execute",
      retry_count: 0,
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineGoalRunTable).values({
      id: goalRunID,
      task_id: activeTaskID,
      goal_id: goalID,
      coordinator_run_id: runID,
      executor: "opencode",
      status: "running",
      retry_count: 0,
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineExecutorSessionTable).values({
      id: executorSessionID,
      task_id: activeTaskID,
      run_id: runID,
      goal_run_id: goalRunID,
      provider: "opencode",
      protocol: "test",
      protocol_version: "1",
      transport: "inproc",
      status: "active",
      refs: {},
      capabilities: {},
      settings: {},
      lease_owner: "test",
      lease_until: now + 60_000,
      time_started: now,
      time_created: now,
      time_updated: now,
    }).run()
  })
}

function seedQueuedTask() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: queuedTaskID,
      project_id: projectID,
      source: "test",
      title: "queued task",
      request: "run queued work",
      status: "queued",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  projectID = `project_recovery_${Date.now()}`
  activeTaskID = `task_active_${Date.now()}`
  queuedTaskID = `task_queued_${Date.now()}`
  runID = `run_${Date.now()}`
  goalID = `goal_${Date.now()}`
  goalRunID = `goal_run_${Date.now()}`
  executorSessionID = `executor_session_${Date.now()}`
  workspaceDir = `C:/tmp/recovery-workspace-${Date.now()}`
})

afterEach(async () => {
  await resetDatabase()
})

describe("engine recovery", () => {
  test("aborts stale executor state before resuming the active task loop", async () => {
    seedProject()
    seedActiveExecution()
    const resumed: string[] = []

    const result = await recoverProjectExecution({
      projectID,
      isTaskLoopActive: () => false,
      startTaskLoop: async (taskID) => {
        resumed.push(taskID)
      },
    })

    expect(result).toMatchObject({
      abortedSessions: 1,
      abortedGoalRuns: 1,
      abortedRuns: 1,
      resumedTaskID: activeTaskID,
    })
    expect(resumed).toEqual([activeTaskID])
    expect(findExecutorSession(executorSessionID)?.status).toBe("aborted")
    expect(findGoalRun(goalRunID)?.status).toBe("aborted")
    expect(findGoalRun(goalRunID)?.error).toContain("Process restart")
    expect(findGoal(goalID)?.workspace_dir).toBe(workspaceDir)
    expect(findGoal(goalID)?.workspace_branch).toBe("opencorvus/recovery-test")
    expect(findRun(runID)?.status).toBe("aborted")
    expect(findTask(activeTaskID)?.status).toBe("active")
  })

  test("starts the queued backlog only when the project has no active task", async () => {
    seedProject()
    seedQueuedTask()
    const started: string[] = []

    const result = await recoverProjectExecution({
      projectID,
      isTaskLoopActive: () => false,
      startTaskLoop: async (taskID) => {
        started.push(taskID)
      },
    })

    expect(result).toMatchObject({
      abortedSessions: 0,
      abortedGoalRuns: 0,
      abortedRuns: 0,
      resumedTaskID: queuedTaskID,
    })
    expect(started).toEqual([queuedTaskID])
    const queued = Database.use((db) =>
      db.select({ status: EngineTaskTable.status })
        .from(EngineTaskTable)
        .where(eq(EngineTaskTable.id, queuedTaskID))
        .get(),
    )
    expect(queued?.status).toBe("queued")
  })
})
