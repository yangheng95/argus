import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator cancel ordering for late child results", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("terminal child result after task cancellation is recorded but does not wake orchestrator", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const taskID = `tsk_cancel_late_child_${now.toString(16)}`
        const runID = `run_cancel_late_child_${now.toString(16)}`

        seedTaskRun(taskID, runID, now)
        seedGoalRun(taskID, runID, `grun_cancel_late_child_${now}`, "completed", now + 1)
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              error: "user cancelled",
              metadata: { cancelled: true },
              time_completed: now + 2,
              time_updated: now + 2,
            } as any)
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const goalRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(eq(EngineArtifactTable.goal_run_id, `grun_cancel_late_child_${now}`))
            .all(),
        )
        expect(goalRows).toHaveLength(1)
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })
})

function seedTaskRun(taskID: string, runID: string, now: number) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "Cancel late child",
        request: "Cancel after child started",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: "running",
          phase: "dispatch",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function seedGoalRun(taskID: string, runID: string, goalRunID: string, status: string, now: number) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `${goalRunID}_${now}`,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: `goal-run-${status}`,
        payload: {
          goal_id: `goal_${goalRunID}`,
          session_id: null,
          status,
          retry_count: 0,
          blocking_reason: null,
          error: null,
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
          merge_ref: null,
          metadata: null,
          time_started: now,
          time_completed: now,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run(),
  )
}
