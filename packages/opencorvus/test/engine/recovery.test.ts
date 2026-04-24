import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineExecutorSessionTable,
  EngineGoalRunTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRunTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import {
  cleanupOrphanExecutionArtifacts,
  isRunOrphan,
  observeOrphanRuns,
  recoverProjectExecution,
} from "../../src/engine/recovery"
import { findExecutorSession, findGoal, findGoalRun, findRun, findTask } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let activeTaskID = ""
let queuedTaskID = ""
let queuedRunID = ""
let queuedPlanID = ""
let queuedGoalID = ""
let queuedNodeID = ""
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
  Database.transaction((db) => {
    db.insert(EngineTaskTable).values({
      id: queuedTaskID,
      project_id: projectID,
      source: "test",
      title: "queued task",
      request: "run queued work",
      status: "queued",
      active_run_id: queuedRunID,
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EnginePlanVersionTable).values({
      id: queuedPlanID,
      task_id: queuedTaskID,
      version: 1,
      status: "active",
      summary: "Queued recovery plan",
      prompt: "Queued recovery prompt",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineGoalTable).values({
      id: queuedGoalID,
      task_id: queuedTaskID,
      plan_version_id: queuedPlanID,
      title: "queued goal",
      slug: "queued-goal",
      objective: "resume queued goal dispatch after recovery",
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
      retry_count: 0,
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EnginePlanNodeTable).values({
      id: queuedNodeID,
      task_id: queuedTaskID,
      plan_version_id: queuedPlanID,
      kind: "goal",
      goal_id: queuedGoalID,
      title: "queued goal",
      brief: "resume queued goal after recovery",
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineRunTable).values({
      id: queuedRunID,
      task_id: queuedTaskID,
      plan_version_id: queuedPlanID,
      executor: "opencode",
      status: "queued",
      phase: "execute",
      retry_count: 0,
      time_created: now,
      time_updated: now,
    }).run()
  })
}

beforeEach(async () => {
  await resetDatabase()
  projectID = `project_recovery_${Date.now()}`
  activeTaskID = `task_active_${Date.now()}`
  queuedTaskID = `task_queued_${Date.now()}`
  queuedRunID = `run_queued_${Date.now()}`
  queuedPlanID = `plan_queued_${Date.now()}`
  queuedGoalID = `goal_queued_${Date.now()}`
  queuedNodeID = `node_queued_${Date.now()}`
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
  test("phase-4 default: recovery is observe-only; orphan runs are left intact, active task resumes anyway", async () => {
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

    // No abort brake — orphan live rows survive; the orchestrator sees
    // them via `run_orphan` in the describe projection on its next wake.
    expect(result.abortedSessions).toBe(0)
    expect(result.abortedGoalRuns).toBe(0)
    expect(result.abortedRuns).toBe(0)
    expect(result.resumedTaskID).toBe(activeTaskID)
    expect(resumed).toEqual([activeTaskID])

    // Live rows persisted untouched.
    expect(findExecutorSession(executorSessionID)?.status).toBe("active")
    expect(findGoalRun(goalRunID)?.status).toBe("running")
    expect(findRun(runID)?.status).toBe("running")
    expect(findGoal(goalID)?.workspace_dir).toBe(workspaceDir)
    expect(findGoal(goalID)?.workspace_branch).toBe("opencorvus/recovery-test")
    expect(findTask(activeTaskID)?.status).toBe("active")
  })

  test("legacy opt-in: cleanupOrphanExecutionArtifacts({enableAbortBrake:true}) still aborts, for regression fixtures", async () => {
    seedProject()
    seedActiveExecution()

    const result = await cleanupOrphanExecutionArtifacts({
      projectID,
      enableAbortBrake: true,
    })

    expect(result.abortedSessions).toBe(1)
    expect(result.abortedGoalRuns).toBe(1)
    expect(result.abortedRuns).toBe(1)
    expect(findExecutorSession(executorSessionID)?.status).toBe("aborted")
    expect(findGoalRun(goalRunID)?.status).toBe("aborted")
    expect(findRun(runID)?.status).toBe("aborted")
  })

  test("observeOrphanRuns returns live runs without live goal_runs and does NOT mutate them", async () => {
    seedProject()
    seedActiveExecution()

    const orphansBefore = observeOrphanRuns(projectID)
    // The run is live (status=running) and HAS a live goal_run, so it's NOT
    // orphan while the goal_run row is live.
    expect(orphansBefore.map((r) => r.id)).not.toContain(runID)

    // Simulate the goal_run crossing to terminal (process restart
    // scenario). The run then has no live goal_run attached.
    Database.use((db) =>
      db
        .update(EngineGoalRunTable)
        .set({ status: "failed" })
        .where(eq(EngineGoalRunTable.id, goalRunID))
        .run(),
    )

    const orphansAfter = observeOrphanRuns(projectID)
    expect(orphansAfter.map((r) => r.id)).toContain(runID)
    // Fact-only: the run itself is still "running" — observe is a read, not a write.
    expect(findRun(runID)?.status).toBe("running")
    expect(isRunOrphan(projectID, runID)).toBe(true)
  })

  test("cleanupOrphanExecutionArtifacts with enableAbortBrake=false leaves DB untouched", async () => {
    seedProject()
    seedActiveExecution()

    const result = await cleanupOrphanExecutionArtifacts({
      projectID,
      enableAbortBrake: false,
    })

    // Fact-only: abort brake disabled means DB state does not change.
    expect(result.abortedSessions).toBe(0)
    expect(result.abortedGoalRuns).toBe(0)
    expect(result.abortedRuns).toBe(0)
    expect(findRun(runID)?.status).toBe("running")
    expect(findGoalRun(goalRunID)?.status).toBe("running")
    expect(findExecutorSession(executorSessionID)?.status).toBe("active")
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
