import { afterEach, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorGoalRunTable,
  OrchestratorPlanNodeTable,
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { buildRetryContext, decideRetryOrReplan } from "../../src/orchestrator/strategy"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase().catch(() => undefined)
})

test("buildRetryContext falls back to latest goal-run delivery and evaluation", async () => {
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
      const nodeID = Identifier.ascending("node")
      const goalRunID = Identifier.ascending("goal_run")

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
        db.insert(OrchestratorGoalRunTable)
          .values({
            id: goalRunID,
            task_id: taskID,
            coordinator_run_id: runID,
            goal_id: goalID,
            plan_node_id: nodeID,
            status: "failed",
            executor: "opencode",
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorDeliveryTable)
          .values({
            id: Identifier.ascending("delivery"),
            task_id: taskID,
            run_id: runID,
            goal_run_id: goalRunID,
            status: "candidate",
            summary: "goal delivery",
            result: {
              summary: "goal delivery",
              changed_files: [],
              diffs: [],
            },
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorEvaluationTable)
          .values({
            id: Identifier.ascending("evaluation"),
            task_id: taskID,
            run_id: runID,
            goal_run_id: goalRunID,
            status: "failed",
            verdict: "rejected",
            summary: "goal evaluation failed",
            checks: [
              {
                name: "verify_cmd",
                status: "failed",
                evidence: "no files changed",
              },
            ],
            time_completed: now,
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      const run = Database.use((db) =>
        db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get()!,
      )
      const context = buildRetryContext(run, "failed")
      expect(context.deliverySummary).toBe("goal delivery")
      expect(context.changedFiles).toEqual([])
      expect(context.checks?.[0]?.name).toBe("verify_cmd")
    },
  })
})

test("decideRetryOrReplan replans immediately for empty deliveries", async () => {
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
            request: "task",
            status: "running",
            priority: "normal",
            active_run_id: runID,
            active_plan_version_id: planID,
            budget: {
              max_runs: 3,
              max_replans: 1,
            },
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
            status: "running",
            phase: "dispatch",
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
      const decision = decideRetryOrReplan(task, run, "no files changed", {
        verdict: "rejected",
        classification: "evaluation",
        summary: "no files changed",
        goal_statuses: [],
        replan_guidance: null,
      }, {
        changedFiles: [],
      })

      expect(decision.action).toBe("replan")
    },
  })
})
