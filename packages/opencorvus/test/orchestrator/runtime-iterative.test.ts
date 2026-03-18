import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { type ExecutorAdapter } from "../../src/executor/contracts"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorEvaluationTable,
  OrchestratorGoalRunTable,
  OrchestratorGoalSnapshotTable,
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
import { createGoalRun, updateGoalRun } from "../../src/orchestrator/transition"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  ExecutorRegistry.reset()
  await resetDatabase().catch(() => undefined)
})

function adapter(submit: (input: { sessionID: string }) => Promise<{ sessionID: string; queueTaskID: string }>): ExecutorAdapter {
  return {
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
}

async function seedRun(input: {
  rootID: string
  taskID: string
  specID: string
  goalSnapshotID?: string
  planID: string
  runID: string
  goals: Array<{ id: string; description: string; metadata?: Record<string, unknown> }>
}) {
  const now = Date.now()
  const goalSnapshotID = input.goalSnapshotID ?? Identifier.ascending("goal_snapshot")
  Database.transaction((db) => {
    db.insert(OrchestratorTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.rootID,
        active_run_id: input.runID,
        active_plan_version_id: input.planID,
        source: "test",
        title: "iterative dispatch",
        request: "iterative dispatch",
        status: "running",
        priority: "normal",
        time_started: now,
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(OrchestratorSpecSnapshotTable)
      .values({
        id: input.specID,
        task_id: input.taskID,
        version: 1,
        status: "ready",
        summary: "spec",
        content: "spec",
        scope: "",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(OrchestratorGoalSnapshotTable)
      .values({
        id: goalSnapshotID,
        task_id: input.taskID,
        spec_snapshot_id: input.specID,
        version: 1,
        status: "ready",
        summary: `${input.goals.length} goals`,
        metadata: { goal_count: input.goals.length },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: input.planID,
        task_id: input.taskID,
        spec_snapshot_id: input.specID,
        version: 1,
        status: "active",
        summary: "plan",
        prompt: "Execute the plan",
        metadata: { goal_snapshot_id: goalSnapshotID },
        time_created: now,
        time_updated: now,
      })
      .run()
    for (const [index, goal] of input.goals.entries()) {
      db.insert(OrchestratorGoalTable)
        .values({
          id: goal.id,
          task_id: input.taskID,
          spec_snapshot_id: input.specID,
          description: goal.description,
          criteria: `${goal.description} succeeds.`,
          metadata: {
            goal_snapshot_id: goalSnapshotID,
            ...(goal.metadata ?? {}),
          },
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
          task_id: input.taskID,
          plan_version_id: input.planID,
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
        id: input.runID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        session_id: input.rootID,
        executor: "codex",
        status: "queued",
        phase: "dispatch",
        retry_count: 0,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

test("dispatch queues only the first ready goal stage", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  ExecutorRegistry.register("codex", adapter(submit))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "iterative root" })
      const goals = [
        { id: Identifier.ascending("goal"), description: "Build passes" },
        { id: Identifier.ascending("goal"), description: "Tests pass" },
        { id: Identifier.ascending("goal"), description: "Lint passes" },
      ]

      await seedRun({ rootID: root.id, taskID, specID, planID, runID, goals })
      await OrchestratorRuntime.dispatch(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(submit).toHaveBeenCalledTimes(1)
      expect(goalRuns).toHaveLength(1)
      expect(goalRuns[0]?.goal_id).toBe(goals[0]?.id)
      expect(goalRuns[0]?.status).toBe("accepted")
    },
  })
})

test("dispatch queues only the first iterative stage even when goal metadata references multiple stages in one wave", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  ExecutorRegistry.register("codex", adapter(submit))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "iterative stages root" })
      const goals = [{
        id: Identifier.ascending("goal"),
        description: "Build app shell",
        metadata: { wave_index: 0, wave_title: "Foundation" },
      }, {
        id: Identifier.ascending("goal"),
        description: "Build API client",
        metadata: { wave_index: 1, wave_title: "Integration" },
      }, {
        id: Identifier.ascending("goal"),
        description: "Build theme",
        metadata: { wave_index: 2, wave_title: "Polish" },
      }]

      await seedRun({ rootID: root.id, taskID, specID, planID, runID, goals })
      await OrchestratorRuntime.dispatch(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(submit).toHaveBeenCalledTimes(1)
      expect(goalRuns).toHaveLength(1)
      expect(goalRuns[0]?.goal_id).toBe(goals[0]?.id)
    },
  })
})

test("syncRun serializes the same coordinator run and only queues one iterative goal", async () => {
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
  ExecutorRegistry.register("codex", adapter(submit))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "race root" })
      const goalID = Identifier.ascending("goal")

      await seedRun({
        rootID: root.id,
        taskID,
        specID,
        planID,
        runID,
        goals: [{ id: goalID, description: "Build passes" }],
      })

      Database.use((db) =>
        db
          .update(OrchestratorRunTable)
          .set({ status: "accepted", time_started: Date.now() })
          .where(eq(OrchestratorRunTable.id, runID))
          .run(),
      )

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

test("syncRun does not queue the next goal while the previous goal evaluation is pending", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  ExecutorRegistry.register("codex", adapter(submit))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "pending evaluation root" })
      const goals = [
        { id: Identifier.ascending("goal"), description: "Build passes" },
        { id: Identifier.ascending("goal"), description: "Tests pass" },
      ]

      await seedRun({ rootID: root.id, taskID, specID, planID, runID, goals })
      Database.use((db) =>
        db
          .update(OrchestratorRunTable)
          .set({ status: "accepted", time_started: now, time_updated: now })
          .where(eq(OrchestratorRunTable.id, runID))
          .run(),
      )

      const goalRun = createGoalRun({
        taskID,
        goalID: goals[0]!.id,
        coordinatorRunID: runID,
        executor: "codex",
        now,
      })
      updateGoalRun(goalRun.id, {
        status: "completed",
        time_started: now,
        time_completed: now,
      })
      Database.transaction((db) => {
        db.insert(OrchestratorEvaluationTable)
          .values({
            id: Identifier.ascending("evaluation"),
            task_id: taskID,
            run_id: runID,
            goal_run_id: goalRun.id,
            status: "pending",
            verdict: "rejected",
            summary: `Evaluating goal delivery: ${goals[0]!.description}`,
            checks: [],
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(submit).toHaveBeenCalledTimes(0)
      expect(goalRuns).toHaveLength(1)
      expect(goalRuns[0]?.goal_id).toBe(goals[0]?.id)
      expect(goalRuns.some((row) => row.goal_id === goals[1]?.id)).toBe(false)
    },
  })
})

test("syncRun does not queue the next goal while a completed goal is still awaiting its first evaluation record", async () => {
  await using tmp = await tmpdir({ git: true })
  const submit = mock(async (input: { sessionID: string }) => ({
    sessionID: input.sessionID,
    queueTaskID: Identifier.ascending("queue"),
  }))
  ExecutorRegistry.register("codex", adapter(submit))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
      const specID = Identifier.ascending("spec")
      const planID = Identifier.ascending("plan")
      const runID = Identifier.ascending("run")
      const root = await Session.create({ title: "missing evaluation root" })
      const goals = [
        { id: Identifier.ascending("goal"), description: "Build passes" },
        { id: Identifier.ascending("goal"), description: "Tests pass" },
      ]

      await seedRun({ rootID: root.id, taskID, specID, planID, runID, goals })
      Database.use((db) =>
        db
          .update(OrchestratorRunTable)
          .set({ status: "accepted", time_started: now, time_updated: now })
          .where(eq(OrchestratorRunTable.id, runID))
          .run(),
      )

      const goalRun = createGoalRun({
        taskID,
        goalID: goals[0]!.id,
        coordinatorRunID: runID,
        executor: "codex",
        now,
      })
      updateGoalRun(goalRun.id, {
        status: "completed",
        time_started: now,
        time_completed: now,
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const goalRuns = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(submit).toHaveBeenCalledTimes(0)
      expect(goalRuns).toHaveLength(1)
      expect(goalRuns[0]?.goal_id).toBe(goals[0]?.id)
      expect(goalRuns.some((row) => row.goal_id === goals[1]?.id)).toBe(false)
    },
  })
})
