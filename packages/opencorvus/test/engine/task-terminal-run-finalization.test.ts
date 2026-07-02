import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findRun, findTask } from "../../src/engine/store"
import { terminalTask, updateRun, updateTask } from "../../src/engine/state"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

function seedRunningTaskRun(input?: { taskCompleted?: number; runStatus?: "queued" | "running"; runStarted?: number | null }) {
  const now = Date.now()
  const taskID = `tsk_terminal_run_${now}_${Math.random().toString(36).slice(2)}`
  const runID = `run_terminal_${now}_${Math.random().toString(36).slice(2)}`
  const projectID = `project_terminal_${now}_${Math.random().toString(36).slice(2)}`
  const runStatus = input?.runStatus ?? "running"
  const runStarted = input?.runStarted === undefined ? now : input.runStarted
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "terminal run test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "terminal task run convergence",
        request: "close the active run when the task reaches terminal facts",
        priority: "normal",
        time_started: now,
        time_completed: input?.taskCompleted ?? null,
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: `run-${runStatus}`,
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: runStatus,
          phase: "deliver",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: runStarted,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  return { taskID, runID, now }
}

describe("terminal task writes finalize live runs", () => {
  test("ordinary task updates reject terminal status intents", async () => {
    const { taskID } = seedRunningTaskRun()

    await expect(
      updateTask(findTask(taskID)!, { status: "failed", error: "hidden failure" } as any, "hidden failure"),
    ).rejects.toThrow("updateTask cannot write terminal task lifecycle")

    expect(findTask(taskID)?.time_completed).toBeNull()
  })

  test("completed task closes the live run as completed", async () => {
    const { taskID, runID, now } = seedRunningTaskRun()
    const completed = now + 10

    await terminalTask(findTask(taskID)!, { status: "completed", time_completed: completed }, "Task completed")

    const run = findRun(runID)
    expect(run?.status).toBe("completed")
    expect(run?.error).toBeNull()
    expect(run?.blocking_reason).toBeNull()
    expect(run?.time_completed).toBe(completed)
  })

  test("failed task closes the live run as failed", async () => {
    const { taskID, runID, now } = seedRunningTaskRun()
    const completed = now + 20

    await terminalTask(
      findTask(taskID)!,
      { status: "failed", error: "acceptance publish failed", time_completed: completed },
      "acceptance publish failed",
    )

    const run = findRun(runID)
    expect(run?.status).toBe("failed")
    expect(run?.error).toBe("acceptance publish failed")
    expect(run?.blocking_reason).toBeNull()
    expect(run?.time_completed).toBe(completed)
  })

  test("cancelled task closes the live run as aborted", async () => {
    const { taskID, runID, now } = seedRunningTaskRun()
    const completed = now + 30

    await terminalTask(
      findTask(taskID)!,
      { status: "cancelled", error: "task cancelled", time_completed: completed },
      "Task cancelled",
    )

    const run = findRun(runID)
    expect(run?.status).toBe("aborted")
    expect(run?.error).toBe("task cancelled")
    expect(run?.blocking_reason).toBeNull()
    expect(run?.time_completed).toBe(completed)
  })

  test("replayed terminal task write converges a stale live run", async () => {
    const completed = Date.now() - 500
    const { taskID, runID } = seedRunningTaskRun({ taskCompleted: completed })

    await terminalTask(findTask(taskID)!, { status: "completed", time_completed: completed }, "Task completed")

    const run = findRun(runID)
    expect(run?.status).toBe("completed")
    expect(run?.time_completed).toBe(completed)
  })

  test("stale terminal task write cannot rewrite existing terminal facts", async () => {
    const { taskID, now } = seedRunningTaskRun()
    const staleRunningRow = findTask(taskID)!
    const failedAt = now + 100

    await terminalTask(
      staleRunningRow,
      { status: "failed", error: "first terminal failure", time_completed: failedAt },
      "first terminal failure",
    )
    await terminalTask(
      staleRunningRow,
      { status: "completed", time_completed: now + 200 },
      "late stale completion",
    )

    const afterLateWrite = findTask(taskID)!
    expect(deriveTaskStatus(afterLateWrite)).toBe("failed")
    expect(afterLateWrite.time_completed).toBe(failedAt)
    expect(afterLateWrite.error).toBe("first terminal failure")
  })

  test("failed and aborted run statuses complete without implying start", async () => {
    for (const status of ["failed", "aborted"] as const) {
      const { runID } = seedRunningTaskRun({ runStatus: "queued", runStarted: null })
      const run = findRun(runID)!

      const updated = await updateRun(run, { status }, `run ${status}`)

      expect(updated.status).toBe(status)
      expect(updated.time_started).toBeNull()
      expect(updated.time_completed).toBeNumber()
    }
  })
})
