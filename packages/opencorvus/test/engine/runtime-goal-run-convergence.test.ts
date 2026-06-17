import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "../../src/engine/engine.sql"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { findRun, findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { dispatchTaskLoop } from "../../src/engine/queue"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
} from "../../src/engine/tool-ownership"
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

  test("all terminal goal runs wake the orchestrator without completing the task", async () => {
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
        expect(run?.status).toBe("running")
        expect(run?.blocking_reason).toBeNull()
        expect(run?.error).toBeNull()
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
        })
        expect(runTaskLoop.mock.calls[0]?.[0].event).toBeUndefined()
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

  test("live goal runs still project interaction blockers on the parent run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_live_interaction_${Date.now()}`
        const runID = `run_goal_live_interaction_${Date.now()}`
        const interactionID = `int_goal_live_interaction_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_live_interaction", "running", now + 1)
        Database.use((db) =>
          db
            .insert(EngineInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              session_id: null,
              external_id: `ext_goal_live_interaction_${now}`,
              request_type: "permission",
              status: "pending",
              title: "Need permission",
              body: "Need permission",
              payload: {},
              time_created: now + 2,
              time_updated: now + 2,
            } as any)
            .run(),
        )

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const blockedRun = findRun(runID)
        expect(blockedRun?.status).toBe("blocked")
        expect(blockedRun?.blocking_reason).toBe("permission")
        expect(runTaskLoop).not.toHaveBeenCalled()

        Database.use((db) =>
          db
            .update(EngineInteractionRequestTable)
            .set({ status: "answered", response: { reply: "once" }, time_resolved: now + 3, time_updated: now + 3 })
            .where(eq(EngineInteractionRequestTable.id, interactionID))
            .run(),
        )

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const resumedRun = findRun(runID)
        expect(resumedRun?.status).toBe("running")
        expect(resumedRun?.blocking_reason).toBeNull()
        expect(runTaskLoop).not.toHaveBeenCalled()
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

        seedGoalRun(taskID, runID, "grun_batch_two", "completed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
        })
        expect(runTaskLoop.mock.calls[1]?.[0].event).toBeUndefined()
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

  test("terminal goal batch notification is visible in task description", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_batch_describe_${Date.now()}`
        const runID = `run_goal_batch_describe_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_batch_visible_one", "completed", now + 1)
        seedGoalRun(taskID, runID, "grun_batch_visible_two", "failed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const notifications = goalBatchNotificationsForTask(taskID)
        expect(notifications).toHaveLength(1)

        const desc = await describeTask(taskID)
        expect(desc.recent_terminal_goal_batches).toHaveLength(1)
        expect(desc.recent_terminal_goal_batches![0]).toMatchObject({
          run_id: runID,
          goal_runs: [
            { id: "grun_batch_visible_one", status: "completed" },
            { id: "grun_batch_visible_two", status: "failed" },
          ],
        })

        const md = renderTaskDescription(desc)
        expect(md).toContain("Terminal goal batch wake facts")
        expect(md).toContain(`run=${runID}`)
        expect(md).toContain("grun_batch_visible_one:completed")
        expect(md).toContain("grun_batch_visible_two:failed")
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

  test("terminal batch notification is recorded only after a wake starts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })
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

        await dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: `ses_orchestrator_${now}`,
          orchestratorMessageID: `msg_orchestrator_${now}`,
          toolCallID: `cal_integrity_${now}`,
          toolPartID: `prt_integrity_${now}`,
          childSessionID: `ses_integrity_${now}`,
          toolName: "integrity",
          scope: "task",
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalBatchNotificationsForTask(taskID)).toHaveLength(0)

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 3,
        })
        release!()
        await holdLoop
        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
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
) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
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
      } as any)
      .run()
    db.insert(EngineArtifactTable)
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
      .run()
  })
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
