import { readdir } from "fs/promises"
import path from "path"
import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { CheckRunner } from "../../src/evaluator/service"
import { type GoalJudgmentType } from "../../src/evaluator/agent"
import { type CheckReport } from "../../src/evaluator/shared"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
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
import { activeGoalRunByCoordinator, listGoalsBySpec } from "../../src/orchestrator/store"
import { beginEvaluation, createGoalRun, createRetryRun, persistEvaluation } from "../../src/orchestrator/transition"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase().catch(() => undefined)
})

test("persistEvaluation writes goal snapshots from transaction state", async () => {
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
            status: "active",
            summary: "plan",
            prompt: "prompt",
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
            description: "goal",
            criteria: "criteria",
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
            summary: "done",
            result: {
              summary: "done",
              changed_files: [],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )
      const goals = listGoalsBySpec(specID)
      const result: CheckReport = {
        status: "passed",
        verdict: "accepted",
        summary: "accepted",
        checks: [{
          name: "build",
          label: "Build",
          family: "build",
          status: "passed",
          evidence: "ok",
        }],
        artifacts: [],
      }
      const analysis: GoalJudgmentType = {
        verdict: "accepted",
        classification: "unknown",
        summary: "accepted",
        goal_statuses: [{
          goal_index: 0,
          status: "passed",
          evidence: "goal met",
          reasoning: "all checks passed",
        }],
        replan_guidance: null,
      }

      persistEvaluation({
        task,
        run,
        deliveryID,
        evaluationID,
        delivery: {
          summary: "done",
          diffs: [],
        },
        result,
        analysis,
        finalVerdict: "accepted",
        finalStatus: "passed",
        finalSummary: "accepted",
        goals,
        finalizeSpec: false,
      })

      const goal = Database.use((db) =>
        db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).get()!,
      )
      expect(goal.status).toBe("passed")

      const dir = path.join(tmp.path, ".opencorvus", "goals")
      const [file] = (await readdir(dir)).sort()
      const text = await Bun.file(path.join(dir, file!)).text()
      expect(text).toContain("1. [passed] [blocking] goal")
      expect(text).toContain("- Passed: 1")
      expect(text).toContain("- Pending: 0")
    },
  })
})

test("beginEvaluation reserves a single row that persistEvaluation completes in place", async () => {
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
      const deliveryID = Identifier.ascending("delivery")
      const evaluationID = Identifier.ascending("evaluation")

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "ship the change",
            status: "evaluating",
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
            status: "active",
            summary: "plan",
            prompt: "prompt",
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
            description: "goal",
            criteria: "criteria",
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
            summary: "done",
            result: {
              summary: "done",
              changed_files: [],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )
      const goals = listGoalsBySpec(specID)

      beginEvaluation({ task, run, deliveryID, evaluationID, now, summary: "working" })

      persistEvaluation({
        task,
        run,
        deliveryID,
        evaluationID,
        delivery: {
          summary: "done",
          diffs: [],
        },
        result: {
          status: "passed",
          verdict: "accepted",
          summary: "accepted",
          checks: [{
            name: "build",
            label: "Build",
            family: "build",
            status: "passed",
            evidence: "ok",
          }],
          artifacts: [],
        },
        analysis: {
          verdict: "accepted",
          classification: "unknown",
          summary: "accepted",
          goal_statuses: [{
            goal_index: 0,
            status: "passed",
            evidence: "goal met",
            reasoning: "all checks passed",
          }],
          replan_guidance: null,
        },
        finalVerdict: "accepted",
        finalStatus: "passed",
        finalSummary: "accepted",
        goals,
        finalizeSpec: false,
      })

      const evaluations = Database.use((db) =>
        db
          .select()
          .from(OrchestratorEvaluationTable)
          .where(eq(OrchestratorEvaluationTable.run_id, runID))
          .all(),
      )

      expect(evaluations).toHaveLength(1)
      expect(evaluations[0]?.id).toBe(evaluationID)
      expect(evaluations[0]?.status).toBe("passed")
      expect(evaluations[0]?.summary).toBe("accepted")
    },
  })
})

test("syncRun skips reevaluation while a coordinator evaluation is pending", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = Identifier.ascending("task")
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
            status: "evaluating",
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
            summary: "done",
            result: {
              summary: "done",
              changed_files: [],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )
      beginEvaluation({ task, run, deliveryID, evaluationID, now, summary: "working" })

      const evaluate = spyOn(CheckRunner, "evaluate").mockImplementation(async () => {
        throw new Error("should not rerun")
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const evaluation = Database.use((db) =>
        db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.id, evaluationID)).get()!,
      )
      const nextTask = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const nextRun = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )

      expect(evaluate).not.toHaveBeenCalled()
      expect(evaluation.status).toBe("pending")
      expect(nextTask.status).toBe("evaluating")
      expect(nextRun.status).toBe("completed")
    },
  })
})

test("syncRun fails a stale pending coordinator evaluation instead of rerunning it", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now() - 12 * 60 * 1000
      const taskID = Identifier.ascending("task")
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
            status: "evaluating",
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
            summary: "done",
            result: {
              summary: "done",
              changed_files: [],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )
      beginEvaluation({ task, run, deliveryID, evaluationID, now, summary: "working" })

      const evaluate = spyOn(CheckRunner, "evaluate").mockImplementation(async () => {
        throw new Error("should not rerun")
      })

      await OrchestratorRuntime.syncRun(runID, hooks())

      const evaluation = Database.use((db) =>
        db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.id, evaluationID)).get()!,
      )

      expect(evaluate).not.toHaveBeenCalled()
      expect(evaluation.status).toBe("failed")
      expect(evaluation.summary).toContain("Evaluation stalled")
      expect(Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())?.status).toBe("failed")
      expect(Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get())?.status).toBe("failed")
    },
  })
})

test("activeGoalRunByCoordinator uses a stable secondary sort", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = "task-cr"
      const specID = "spec-cr"
      const planID = "plan-cr"
      const runID = "run-cr"
      const goalID = "goal-cr"

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "task",
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
            status: "active",
            summary: "plan",
            prompt: "prompt",
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
            description: "goal",
            criteria: "criteria",
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
        db.insert(OrchestratorGoalRunTable)
          .values([{
            id: "goal_run_a",
            task_id: taskID,
            goal_id: goalID,
            coordinator_run_id: runID,
            executor: "opencode",
            status: "running",
            time_created: now,
            time_updated: now,
          }, {
            id: "goal_run_b",
            task_id: taskID,
            goal_id: goalID,
            coordinator_run_id: runID,
            executor: "opencode",
            status: "accepted",
            time_created: now,
            time_updated: now,
          }])
          .run()
      })

      expect(activeGoalRunByCoordinator(runID)?.id).toBe("goal_run_b")
    },
  })
})

test("createRetryRun reuses an active retry run for the same previous run", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = "task-retry"
      const specID = "spec-retry"
      const planID = "plan-retry"
      const runID = "run-retry"

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "task",
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
            status: "active",
            summary: "plan",
            prompt: "prompt",
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
            status: "failed",
            phase: "evaluate",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const task = Database.use((db) =>
        db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
      )
      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )

      const first = createRetryRun(task, run, "failed")
      const second = createRetryRun(task, run, "failed")
      const runs = Database.use((db) =>
        db
          .select()
          .from(OrchestratorRunTable)
          .where(eq(OrchestratorRunTable.task_id, taskID))
          .all(),
      ).filter((item) => item.metadata?.previous_run_id === runID && item.metadata?.strategy === "retry_same_plan")

      expect(second).toBe(first)
      expect(runs).toHaveLength(1)
    },
  })
})

test("createGoalRun reuses an active goal run for the same node", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = "task-goal-run"
      const specID = "spec-goal-run"
      const planID = "plan-goal-run"
      const runID = "run-goal-run"
      const goalID = "goal-goal-run"
      const nodeID = "node-goal-run"

      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "task",
            request: "task",
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
            status: "active",
            summary: "plan",
            prompt: "prompt",
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
            description: "goal",
            criteria: "criteria",
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
            id: nodeID,
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goalID,
            title: "goal",
            brief: "",
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

      const first = createGoalRun({
        taskID,
        goalID,
        planNodeID: nodeID,
        coordinatorRunID: runID,
        executor: "opencode",
        workspaceDir: "D:/tmp/a",
      })
      const second = createGoalRun({
        taskID,
        goalID,
        planNodeID: nodeID,
        coordinatorRunID: runID,
        executor: "opencode",
        workspaceDir: "D:/tmp/b",
      })
      const rows = Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalRunTable)
          .where(eq(OrchestratorGoalRunTable.coordinator_run_id, runID))
          .all(),
      )

      expect(second.id).toBe(first.id)
      expect(second.workspace_dir).toBe("D:/tmp/a")
      expect(rows).toHaveLength(1)
    },
  })
})
