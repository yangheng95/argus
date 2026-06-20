import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "../../src/engine/engine.sql"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
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

  test("terminal goal runs wake the task loop without waiting for sibling terminal settlement", async () => {
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
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID })
        expect(runTaskLoop.mock.calls[0]?.[0].event).toBeUndefined()
        const facts = goalRefillNotificationsForTask(taskID)
        expect(facts).toHaveLength(2)
        expect(facts.map((fact) => fact.label)).toEqual(["goal-refill-wake-dispatched", "goal-refill-wake-dispatched"])
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

  test("active run with no goal runs does not create a goal refill wake", async () => {
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

        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(0)
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
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(0)
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
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(0)
      },
    })
  })

  test("a later terminal goal under the same parent run wakes again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_second_refill_${Date.now()}`
        const runID = `run_goal_second_refill_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_refill_one", "completed", now + 1)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(1)

        seedGoalRun(taskID, runID, "grun_refill_two", "completed", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({ taskID })
        expect(runTaskLoop.mock.calls[1]?.[0].event).toBeUndefined()
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(2)
      },
    })
  })

  test("same logical terminal goal append does not wake again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_same_refill_${Date.now()}`
        const runID = `run_goal_same_refill_${Date.now()}`
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
        expect(runTaskLoop).toHaveBeenCalledTimes(2)

        seedGoalRun(taskID, runID, "grun_one", "completed", now + 10)
        seedGoalRun(taskID, runID, "grun_two", "completed", now + 11)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(2)
      },
    })
  })

  test("terminal goal refill notification is visible in task description with live siblings", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_refill_describe_${Date.now()}`
        const runID = `run_goal_refill_describe_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalRun(taskID, runID, "grun_refill_visible_one", "completed", now + 1)
        seedGoalRun(taskID, runID, "grun_refill_visible_two", "running", now + 2)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const notifications = goalRefillNotificationsForTask(taskID)
        expect(notifications).toHaveLength(1)

        const desc = await describeTask(taskID)
        expect(desc.recent_terminal_goal_refills).toHaveLength(1)
        expect(desc.recent_terminal_goal_refills![0]).toMatchObject({
          run_id: runID,
          terminal_goal_run: { id: "grun_refill_visible_one", status: "completed" },
          live_sibling_goal_runs: [{ id: "grun_refill_visible_two", status: "running" }],
        })

        const md = renderTaskDescription(desc)
        expect(md).toContain("Terminal goal refill wake facts")
        expect(md).toContain(`run=${runID}`)
        expect(md).toContain("grun_refill_visible_one:completed")
        expect(md).toContain("grun_refill_visible_two:running")
      },
    })
  })

  test("notified terminal refill does not clear orchestrator stream-error blocker", async () => {
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
        seedGoalRefillNotification(
          taskID,
          runID,
          { id: "grun_aborted_one", goal_id: "goal_grun_aborted_one", status: "aborted" },
          [{ id: "grun_aborted_two", goal_id: "goal_grun_aborted_two", status: "aborted" }],
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

  test("blocked orchestrator stream-error run does not liveness-dispatch without a notification fact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_stream_error_blocked_${Date.now()}`
        const runID = `run_goal_stream_error_blocked_${Date.now()}`
        const now = Date.now()
        seedTaskRun(taskID, runID, now, {
          status: "blocked",
          blocking_reason: "orchestrator_stream_error",
          error: "OrchestratorAborted: explicit task cancellation",
        })
        seedGoalRun(taskID, runID, "grun_aborted_blocked_one", "aborted", now + 1)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("orchestrator_stream_error")
        expect(run?.error).toBe("OrchestratorAborted: explicit task cancellation")
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(0)
      },
    })
  })

  test("terminal refill dispatch records a fact after starting a wake", async () => {
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

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(1)
      },
    })
  })

  test("terminal success refill exposes newly dispatchable dependent goals in FIFO order while siblings live", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_fifo_refill_${Date.now()}`
        const runID = `run_goal_fifo_refill_${Date.now()}`
        const specID = `spec_goal_fifo_refill_${Date.now()}`
        const now = Date.now()
        const goalA = `gol_fifo_a_${now}`
        const goalB = `gol_fifo_b_${now}`
        const goalC = `gol_fifo_c_${now}`
        const goalD = `gol_fifo_d_${now}`
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalGraph(taskID, specID, now, [
          { id: goalA, title: "A", order: 0, dependsOn: [] },
          { id: goalB, title: "B", order: 1, dependsOn: [] },
          { id: goalC, title: "C", order: 2, dependsOn: [goalA] },
          { id: goalD, title: "D", order: 3, dependsOn: [goalA] },
        ])
        seedGoalRun(taskID, runID, "grun_fifo_a", "completed", now + 1, goalA)
        seedGoalRun(taskID, runID, "grun_fifo_b", "running", now + 2, goalB)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(1)
        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.dispatchable_goal_ids).toEqual([goalC, goalD])
      },
    })
  })

  test("terminal failure refill wakes diagnosis without dispatching dependents or retrying the failed goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_goal_failed_refill_${Date.now()}`
        const runID = `run_goal_failed_refill_${Date.now()}`
        const specID = `spec_goal_failed_refill_${Date.now()}`
        const now = Date.now()
        const goalA = `gol_failed_a_${now}`
        const goalB = `gol_failed_b_${now}`
        const goalC = `gol_failed_c_${now}`
        seedTaskRun(taskID, runID, now, {
          status: "running",
          blocking_reason: null,
          error: null,
        })
        seedGoalGraph(taskID, specID, now, [
          { id: goalA, title: "A", order: 0, dependsOn: [] },
          { id: goalB, title: "B", order: 1, dependsOn: [] },
          { id: goalC, title: "C", order: 2, dependsOn: [goalA] },
        ])
        seedGoalRun(taskID, runID, "grun_failed_a", "failed", now + 1, goalA)
        seedGoalRun(taskID, runID, "grun_failed_b", "running", now + 2, goalB)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(goalRefillNotificationsForTask(taskID)).toHaveLength(1)
        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.failed_goal_ids).toContain(goalA)
        expect(desc.collaboration_closure?.dispatchable_goal_ids).not.toContain(goalC)
        expect(goalRefillNotificationsForTask(taskID)[0]?.payload).toMatchObject({
          terminal_goal_run: { id: "grun_failed_a", goal_id: goalA, status: "failed" },
        })
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

function goalRefillNotificationsForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "goal_refill_notification" as EngineArtifactKind),
        ),
      )
      .all(),
  )
}

function seedGoalRun(taskID: string, runID: string, goalRunID: string, status: string, now: number, goalID?: string) {
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
          goal_id: goalID ?? `goal_${goalRunID}`,
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

function seedGoalGraph(
  taskID: string,
  specID: string,
  now: number,
  goals: Array<{ id: string; title: string; order: number; dependsOn: string[] }>,
) {
  Database.use((db) => {
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Goal refill graph",
        content: "Goal refill graph",
        scope: "Goal refill graph",
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    for (const goal of goals) {
      db.insert(EngineGoalTable)
        .values({
          id: goal.id,
          task_id: taskID,
          spec_snapshot_id: specID,
          title: goal.title,
          slug: goal.id,
          objective: `Complete goal ${goal.title}`,
          acceptance_specs: [],
          owned_paths: [],
          depends_on: goal.dependsOn,
          exports: [],
          imports: [],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
          source: "test",
          status: "pending",
          order_index: goal.order,
          time_created: now + goal.order,
          time_updated: now + goal.order,
        } as any)
        .run()
    }
  })
}

function seedGoalRefillNotification(
  taskID: string,
  runID: string,
  terminalGoalRun: { id: string; goal_id: string; status: string },
  liveSiblingGoalRuns: Array<{ id: string; goal_id: string; status: string }>,
  now: number,
) {
  const fingerprint = `${terminalGoalRun.id}:${terminalGoalRun.status}`
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `art_goal_refill_notification_${now}`,
        task_id: taskID,
        run_id: runID,
        goal_run_id: terminalGoalRun.id,
        kind: "goal_refill_notification" as EngineArtifactKind,
        label: "goal-refill-wake-dispatched",
        payload: {
          task_id: taskID,
          run_id: runID,
          fingerprint,
          terminal_goal_run: terminalGoalRun,
          live_sibling_goal_runs: liveSiblingGoalRuns.sort((a, b) => a.id.localeCompare(b.id)),
          dispatch_result: "started",
          time_dispatched: now,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run(),
  )
}
