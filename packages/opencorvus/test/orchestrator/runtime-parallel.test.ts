import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorGoalRunTable,
  OrchestratorGoalTable,
  OrchestratorPlanNodeTable,
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorRuntime } from "../../src/orchestrator/runtime"
import { hooks } from "../../src/orchestrator/state"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Snapshot } from "../../src/snapshot"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  ExecutorRegistry.reset()
  await resetDatabase().catch(() => undefined)
})

test("dispatch queues every ready goal run in parallel", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  const adapter: ExecutorAdapter = {
    capabilities() {
      return {
        submit: true,
        status: true,
        abort: true,
        delivery: true,
        resume: true,
        events: false,
      }
    },
    submit,
    async status(queueTaskID) {
      return {
        queueTaskID,
        status: "queued",
        error: null,
      }
    },
    async abort() {
      return true
    },
    async delivery() {
      return {
        summary: "",
        diffs: [],
      }
    },
    async resume(input) {
      return {
        sessionID: input.sessionID,
        queueTaskID: Identifier.ascending("queue"),
      }
    },
    async *events() {},
  }
  ExecutorRegistry.register("codex", adapter)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "parallel root" })
      const goals = [{
        id: Identifier.ascending("goal"),
        description: "Build passes",
      }, {
        id: Identifier.ascending("goal"),
        description: "Tests pass",
      }, {
        id: Identifier.ascending("goal"),
        description: "Lint passes",
      }]

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            active_run_id: runID,
            active_plan_version_id: planID,
            source: "test",
            title: "parallel dispatch",
            request: "parallel dispatch",
            status: "running",
            priority: "normal",
            time_started: now,
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
            status: "active",
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        for (const [index, goal] of goals.entries()) {
          db.insert(OrchestratorGoalTable)
            .values({
              id: goal.id,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: goal.description,
              criteria: `${goal.description} succeeds.`,
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: index,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorPlanNodeTable)
            .values({
              id: Identifier.ascending("plan_node"),
              task_id: taskID,
              plan_version_id: planID,
              kind: "goal",
              goal_id: goal.id,
              title: goal.description,
              brief: goal.description,
              order_index: index,
              time_created: now,
              time_updated: now,
            })
            .run()
        }
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            session_id: root.id,
            executor: "codex",
            status: "queued",
            phase: "dispatch",
            retry_count: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      await OrchestratorRuntime.dispatch(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )
      const run = Database.use((db) =>
        db
          .select()
          .from(OrchestratorRunTable)
          .where(eq(OrchestratorRunTable.id, runID))
          .get(),
      )

      expect(submit).toHaveBeenCalledTimes(3)
      expect(goalRuns).toHaveLength(3)
      expect(new Set(goalRuns.map((goalRun) => goalRun.goal_id)).size).toBe(3)
      expect(goalRuns.every((goalRun) => goalRun.status === "accepted")).toBe(true)
      expect(run?.status).toBe("accepted")
    },
  })
})

test("dispatch splits a wave when owned paths conflict or parallelism is reached", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  const adapter: ExecutorAdapter = {
    capabilities() {
      return {
        submit: true,
        status: true,
        abort: true,
        delivery: true,
        resume: true,
        events: false,
      }
    },
    submit,
    async status(queueTaskID) {
      return {
        queueTaskID,
        status: "queued",
        error: null,
      }
    },
    async abort() {
      return true
    },
    async delivery() {
      return {
        summary: "",
        diffs: [],
      }
    },
    async resume(input) {
      return {
        sessionID: input.sessionID,
        queueTaskID: Identifier.ascending("queue"),
      }
    },
    async *events() {},
  }
  ExecutorRegistry.register("codex", adapter)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "wave root" })
      const goals = [{
        id: Identifier.ascending("goal"),
        description: "Build app shell",
        metadata: { owned_paths: ["src/app.tsx"], wave_index: 0, wave_title: "Foundation", wave_parallelism: 2 },
      }, {
        id: Identifier.ascending("goal"),
        description: "Refine app shell",
        metadata: { owned_paths: ["src/app.tsx"], wave_index: 0, wave_title: "Foundation", wave_parallelism: 2 },
      }, {
        id: Identifier.ascending("goal"),
        description: "Build API client",
        metadata: { owned_paths: ["src/api.ts"], wave_index: 0, wave_title: "Foundation", wave_parallelism: 2 },
      }, {
        id: Identifier.ascending("goal"),
        description: "Build theme",
        metadata: { owned_paths: ["src/theme.css"], wave_index: 0, wave_title: "Foundation", wave_parallelism: 2 },
      }]

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            active_run_id: runID,
            active_plan_version_id: planID,
            source: "test",
            title: "wave dispatch",
            request: "wave dispatch",
            status: "running",
            priority: "normal",
            time_started: now,
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
            status: "active",
            summary: "plan",
            prompt: "Execute the plan",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        for (const [index, goal] of goals.entries()) {
          db.insert(OrchestratorGoalTable)
            .values({
              id: goal.id,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: goal.description,
              criteria: `${goal.description} succeeds.`,
              metadata: goal.metadata,
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: index,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorPlanNodeTable)
            .values({
              id: Identifier.ascending("plan_node"),
              task_id: taskID,
              plan_version_id: planID,
              kind: "goal",
              goal_id: goal.id,
              title: goal.description,
              brief: goal.description,
              order_index: index,
              metadata: goal.metadata,
              time_created: now,
              time_updated: now,
            })
            .run()
        }
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            session_id: root.id,
            executor: "codex",
            status: "queued",
            phase: "dispatch",
            retry_count: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      await OrchestratorRuntime.dispatch(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(submit).toHaveBeenCalledTimes(2)
      expect(goalRuns).toHaveLength(2)
      expect(new Set(goalRuns.map((goalRun) => goalRun.goal_id))).toEqual(new Set([goals[0].id, goals[2].id]))
    },
  })
})

test("syncRun serializes the same coordinator run while keeping goal execution parallel", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => {
    await Bun.sleep(25)
    return {
      sessionID: input.sessionID,
      queueTaskID: Identifier.ascending("queue"),
    }
  })
  const track = spyOn(Snapshot, "track").mockImplementation(async () => {
    await Bun.sleep(25)
    return Identifier.ascending("snapshot")
  })
  const adapter: ExecutorAdapter = {
    capabilities() {
      return {
        submit: true,
        status: true,
        abort: true,
        delivery: true,
        resume: true,
        events: false,
      }
    },
    submit,
    async status(queueTaskID) {
      return {
        queueTaskID,
        status: "queued",
        error: null,
      }
    },
    async abort() {
      return true
    },
    async delivery() {
      return {
        summary: "",
        diffs: [],
      }
    },
    async resume(input) {
      return {
        sessionID: input.sessionID,
        queueTaskID: Identifier.ascending("queue"),
      }
    },
    async *events() {},
  }
  ExecutorRegistry.register("codex", adapter)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const goalID = Identifier.ascending("goal")
      const root = await Session.create({ title: "race root" })

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            active_run_id: runID,
            active_plan_version_id: planID,
            source: "test",
            title: "race sync",
            request: "race sync",
            status: "running",
            priority: "normal",
            time_started: now,
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
            status: "active",
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
            criteria: "Build passes",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanNodeTable)
          .values({
            id: Identifier.ascending("plan_node"),
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goalID,
            title: "Build passes",
            brief: "Build passes",
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
            session_id: root.id,
            executor: "codex",
            status: "accepted",
            phase: "dispatch",
            retry_count: 0,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      await Promise.all([
        OrchestratorRuntime.syncRun(runID, hooks()),
        OrchestratorRuntime.syncRun(runID, hooks()),
      ])

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(track).toHaveBeenCalledTimes(1)
      expect(submit).toHaveBeenCalledTimes(1)
      expect(goalRuns).toHaveLength(1)
      expect(goalRuns[0]?.goal_id).toBe(goalID)
      expect(goalRuns[0]?.status).toBe("accepted")
    },
  })
})
