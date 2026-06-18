import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "../../src/engine/engine.sql"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { findRun } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Database, and, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("EngineRuntime goal-run convergence", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("all terminal goal runs wake the task loop without rewriting the parent run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_converge_${Date.now()}`
        const runID = `run_goal_converge_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "blocked",
          blocking_reason: "integrity verdict needs_correction",
          error: "Integrity needs correction",
        })
        seedGoalRun(taskID, runID, "grun_completed", "completed", now + 1)
        seedGoalRun(taskID, runID, "grun_failed", "failed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("integrity verdict needs_correction")
        expect(run?.error).toBe("Integrity needs correction")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID })
        expect(runTaskLoop.mock.calls[0]?.[0].event).toBeUndefined()
        const facts = goalBatchNotificationsForTask(taskID)
        expect(facts).toHaveLength(1)
        expect(facts[0]?.label).toBe("goal-batch-wake-dispatched")
        expect((facts[0]?.payload as Record<string, unknown> | null)?.time_dispatched).toBeNumber()
      },
    })
  })

  test("live goal runs do not wake the orchestrator", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_live_${Date.now()}`
        const runID = `run_goal_live_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_live", "running", now + 1)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(findRun(runID)?.status).toBe("running")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("active run with no goal runs wakes the task loop once", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_no_goal_liveness_${Date.now()}`
        const runID = `run_no_goal_liveness_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })

        await EngineRuntime.syncRun(runID, hooks())
        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID })
        expect(runTaskLoop.mock.calls[0]?.[0].event).toBeUndefined()
        const facts = goalBatchNotificationsForTask(taskID)
        expect(facts).toHaveLength(1)
        expect(facts[0]?.label).toBe("no-live-goal-wake-dispatched")
        const payload = facts[0]?.payload as Record<string, unknown> | null
        expect(payload?.fingerprint).toBe("no-goal-runs")
        expect(payload?.goal_runs).toEqual([])
        expect(payload?.time_dispatched).toBeNumber()
      },
    })
  })

  test("syncRun and monitorRuns ignore completed tasks with stale live runs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_completed_stale_live_${Date.now()}`
        const runID = `run_completed_stale_live_${Date.now()}`
        const now = Date.now()
        seedTaskRun(
          taskID,
          runID,
          now,
          {
            status: "running",
            blocking_reason: null,
            error: null,
          },
          { time_completed: now + 1 },
        )

        expect(await EngineRuntime.syncRun(runID, hooks())).toBeFalse()
        const result = await EngineRuntime.monitorRuns(hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.observedRuns).toBe(0)
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(0)
      },
    })
  })

  test("syncRun and monitorRuns ignore historical live runs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_historical_live_${Date.now()}`
        const staleRunID = `run_historical_stale_${Date.now()}`
        const activeRunID = `run_historical_active_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, staleRunID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedRunArtifact(taskID, activeRunID, now + 1, {
          status: "running",
          blocking_reason: null,
          error: null,
        })

        expect(await EngineRuntime.syncRun(staleRunID, hooks())).toBeFalse()
        const result = await EngineRuntime.monitorRuns(hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.observedRuns).toBe(1)
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const facts = goalBatchNotificationsForTask(taskID)
        expect(facts).toHaveLength(1)
        expect(facts[0]?.run_id).toBe(activeRunID)
      },
    })
  })

  test("a later terminal goal batch under the same parent run wakes again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_second_batch_${Date.now()}`
        const runID = `run_goal_second_batch_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_batch_one", "completed", now + 1)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(1)

        seedGoalRun(taskID, runID, "grun_batch_two", "completed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({ taskID })
        expect(runTaskLoop.mock.calls[1]?.[0].event).toBeUndefined()
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(2)
      },
    })
  })

  test("same logical terminal goal batch append does not wake again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_same_batch_${Date.now()}`
        const runID = `run_goal_same_batch_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_one", "completed", now + 1)
        seedGoalRun(taskID, runID, "grun_two", "completed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        seedGoalRun(taskID, runID, "grun_one", "completed", now + 10)
        seedGoalRun(taskID, runID, "grun_two", "completed", now + 11)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(1)
      },
    })
  })

  test("notified terminal batch does not clear orchestrator stream-error blocker", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_stream_error_${Date.now()}`
        const runID = `run_goal_stream_error_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "blocked",
          blocking_reason: "orchestrator_stream_error",
          error: "Error: session prompt loop finished",
        })
        seedGoalRun(taskID, runID, "grun_aborted_one", "aborted", now + 1)
        seedGoalRun(taskID, runID, "grun_aborted_two", "aborted", now + 2)
        seedGoalBatchNotification(
          taskID,
          runID,
          [
            { id: "grun_aborted_one", status: "aborted" },
            { id: "grun_aborted_two", status: "aborted" },
          ],
          now + 3,
        )

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("orchestrator_stream_error")
        expect(run?.error).toBe("Error: session prompt loop finished")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("terminal batch liveness dispatch records a fact after starting a wake", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_live_owner_${Date.now()}`
        const runID = `run_goal_live_owner_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_one", "completed", now + 1)
        seedGoalRun(taskID, runID, "grun_two", "completed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(1)
      },
    })
  })

  test("pending interactions preserve the parent run blocker", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_pending_${Date.now()}`
        const runID = `run_goal_pending_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "blocked",
          blocking_reason: "question",
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_completed", "completed", now + 1)
        Database.use((db) =>
          db
            .insert(EngineInteractionRequestTable)
            .values({
              id: `int_goal_pending_${now}`,
              task_id: taskID,
              run_id: runID,
              session_id: null,
              external_id: `ext_goal_pending_${now}`,
              request_type: "question",
              status: "pending",
              title: "Need answer",
              body: "Need answer",
              payload: {},
              time_created: now,
              time_updated: now,
            } as any)
            .run(),
        )

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("question")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })
})

function seedTaskRun(
  taskID: string,
  runID: string,
  now: number,
  run: { status: string; blocking_reason: string | null; error: string | null },
  task: { time_completed?: number | null } = {},
) {
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "Goal convergence",
        request: "converge goals",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
        time_completed: task.time_completed ?? null,
      } as any)
      .run(),
  )
  seedRunArtifact(taskID, runID, now, run)
}

function seedRunArtifact(
  taskID: string,
  runID: string,
  now: number,
  run: { status: string; blocking_reason: string | null; error: string | null },
) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: `run-${run.status}`,
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: run.status,
          phase: "dispatch",
          blocking_reason: run.blocking_reason,
          error: run.error,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function goalBatchNotificationsForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "goal_batch_notification" as EngineArtifactKind),
        ),
      )
      .all(),
  )
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
          error: status === "failed" ? "failed" : null,
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
          merge_ref: null,
          metadata: null,
          time_started: now,
          time_completed: status === "completed" || status === "failed" || status === "aborted" ? now : null,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run(),
  )
}

function seedGoalBatchNotification(
  taskID: string,
  runID: string,
  goalRuns: Array<{ id: string; status: string }>,
  now: number,
) {
  const fingerprint = goalRuns
    .map((goalRun) => `${goalRun.id}:${goalRun.status}`)
    .sort()
    .join("|")
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `art_goal_batch_notification_${now}`,
        task_id: taskID,
        run_id: runID,
        goal_run_id: null,
        kind: "goal_batch_notification" as EngineArtifactKind,
        label: "goal-batch-wake-dispatched",
        payload: {
          task_id: taskID,
          run_id: runID,
          fingerprint,
          goal_runs: goalRuns.sort((a, b) => a.id.localeCompare(b.id)),
          time_dispatched: now,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run(),
  )
}
