import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorDeliveryTable,
  OrchestratorExecutorSessionTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { ExecutorRegistry } from "../../src/executor/registry"
import { executorLeaseOwner } from "../../src/orchestrator/lease"
import { OrchestratorRuntime } from "../../src/orchestrator/runtime"
import { hooks } from "../../src/orchestrator/state"
import { renewExecutorSessionLease } from "../../src/orchestrator/transition"
import { createGoalRun, updateGoalRun } from "../../src/orchestrator/transition"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase().catch(() => undefined)
})

test("syncRun closes the failed coordinator run before queueing a retry", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const deliveryID = Identifier.ascending("delivery")
      const evaluationID = Identifier.ascending("evaluation")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "completed",
            phase: "evaluate",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorDeliveryTable)
          .values({
            id: deliveryID,
            task_id: taskID,
            run_id: runID,
            status: "candidate",
            summary: "candidate",
            result: {
              summary: "candidate",
              changed_files: ["src/retry.ts"],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorEvaluationTable)
          .values({
            id: evaluationID,
            task_id: taskID,
            run_id: runID,
            delivery_id: deliveryID,
            status: "failed",
            verdict: "rejected",
            summary: "Evaluation failed",
            checks: [],
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const dispatch = spyOn(OrchestratorRuntime, "dispatch").mockResolvedValue(undefined)

      await OrchestratorRuntime.syncRun(runID, hooks())

      const rows = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
      )
      const previous = rows.find((row) => row.id === runID)
      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
      )
      const active = rows.find((row) => row.id === task?.active_run_id)

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(previous?.status).toBe("failed")
      expect(previous?.error).toBe("Evaluation failed")
      expect(typeof previous?.time_completed).toBe("number")
      expect(active?.id).not.toBe(runID)
      expect(active?.status).toBe("queued")
      expect(active?.metadata?.previous_run_id).toBe(runID)
    },
  })
})

test("syncRun recovers a running coordinator when the latest goal run already failed", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const goalID = Identifier.ascending("goal")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            budget: {
              maxRuns: 1,
              maxReplans: 0,
            },
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorGoalTable)
          .values({
            id: goalID,
            task_id: taskID,
            spec_snapshot_id: specID,
            description: "Build passes",
            criteria: "Build command passes.",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const goalRun = createGoalRun({
        taskID,
        goalID,
        coordinatorRunID: runID,
        executor: "opencode",
        now,
      })
      updateGoalRun(goalRun.id, {
        status: "failed",
        error: "Goal evaluation failed",
        time_completed: now,
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get(),
      )
      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
      )

      expect(run?.status).toBe("failed")
      expect(run?.error).toBe("Goal evaluation failed")
      expect(task?.status).toBe("failed")
      expect(task?.error).toBe("Goal evaluation failed")
    },
  })
})

test("syncRun queues a retry when executor status lookup fails", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            executor_ref: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const status = spyOn(ExecutorRegistry.require("opencode"), "status")
        .mockRejectedValue(new Error("executor task not found: queue-1"))
      const dispatch = spyOn(OrchestratorRuntime, "dispatch").mockResolvedValue(undefined)

      await OrchestratorRuntime.syncRun(runID, hooks())

      const rows = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
      )
      const previous = rows.find((row) => row.id === runID)
      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
      )
      const active = rows.find((row) => row.id === task?.active_run_id)

      expect(status).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(previous?.status).toBe("failed")
      expect(previous?.error).toContain("Executor status unavailable")
      expect(active?.id).not.toBe(runID)
      expect(active?.status).toBe("queued")
      expect(active?.metadata?.previous_run_id).toBe(runID)
    },
  })
})

test("syncRun leaves runs untouched when another runtime still owns the executor lease", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            executor_ref: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorExecutorSessionTable)
          .values({
            id: Identifier.ascending("executor_session"),
            task_id: taskID,
            run_id: runID,
            provider: "opencode",
            protocol: "task_queue",
            protocol_version: "1",
            transport: "local",
            status: "active",
            refs: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            lease_owner: "old-runtime",
            lease_until: now + 60_000,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const status = spyOn(ExecutorRegistry.require("opencode"), "status")
      await OrchestratorRuntime.syncRun(runID, hooks())

      const rows = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
      )
      const previous = rows.find((row) => row.id === runID)
      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
      )

      expect(status).toHaveBeenCalledTimes(0)
      expect(previous?.status).toBe("running")
      expect(previous?.error ?? null).toBe(null)
      expect(task?.status).toBe("running")
    },
  })
})

test("syncRun takes over an expired executor lease before checking status", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const executorSessionID = Identifier.ascending("executor_session")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            executor_ref: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorExecutorSessionTable)
          .values({
            id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            provider: "opencode",
            protocol: "task_queue",
            protocol_version: "1",
            transport: "local",
            status: "active",
            refs: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            lease_owner: "old-runtime",
            lease_until: now - 1_000,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const status = spyOn(ExecutorRegistry.require("opencode"), "status").mockResolvedValue({
        queueTaskID: "queue-1",
        status: "running",
        error: null,
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const executorSession = Database.use((db) =>
        db.select().from(OrchestratorExecutorSessionTable).where(eq(OrchestratorExecutorSessionTable.id, executorSessionID)).get(),
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get(),
      )
      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
      )

      expect(status).toHaveBeenCalledTimes(1)
      expect(executorSession?.lease_owner).toBe(executorLeaseOwner())
      expect((executorSession?.lease_until ?? 0) > now).toBe(true)
      expect(run?.status).toBe("running")
      expect(task?.status).toBe("running")
    },
  })
})

test("syncRun renews executor lease after a successful status check", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const executorSessionID = Identifier.ascending("executor_session")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            executor_ref: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorExecutorSessionTable)
          .values({
            id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            provider: "opencode",
            protocol: "task_queue",
            protocol_version: "1",
            transport: "local",
            status: "active",
            refs: {
              session_id: "session-1",
              queue_task_id: "queue-1",
            },
            lease_owner: executorLeaseOwner(),
            lease_until: now + 1_000,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      spyOn(ExecutorRegistry.require("opencode"), "status").mockResolvedValue({
        queueTaskID: "queue-1",
        status: "running",
        error: null,
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const executorSession = Database.use((db) =>
        db.select().from(OrchestratorExecutorSessionTable).where(eq(OrchestratorExecutorSessionTable.id, executorSessionID)).get(),
      )

      expect(executorSession?.lease_owner).toBe(executorLeaseOwner())
      expect((executorSession?.lease_until ?? 0) > now + 1_000).toBe(true)
    },
  })
})

test("renewExecutorSessionLease does not steal a live lease from another runtime", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const runID = Identifier.ascending("run")
      const executorSessionID = Identifier.ascending("executor_session")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorExecutorSessionTable)
          .values({
            id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            provider: "opencode",
            protocol: "task_queue",
            protocol_version: "1",
            transport: "local",
            status: "active",
            lease_owner: "old-runtime",
            lease_until: now + 60_000,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const renewed = renewExecutorSessionLease({
        executorSessionID,
        now: now + 1_000,
      })
      const executorSession = Database.use((db) =>
        db.select().from(OrchestratorExecutorSessionTable).where(eq(OrchestratorExecutorSessionTable.id, executorSessionID)).get(),
      )

      expect(renewed).toBeUndefined()
      expect(executorSession?.lease_owner).toBe("old-runtime")
      expect(executorSession?.lease_until).toBe(now + 60_000)
    },
  })
})
