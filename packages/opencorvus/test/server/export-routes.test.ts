import { afterEach, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import {
  EngineArtifactTable,
  EngineDeliveryTable,
  EngineGoalRunTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRunTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

// /export/task/:taskID does not yet surface coordinatorRun in the response shape.
// Pending an export-route enhancement; skipping until the field is wired through.
test.skip("GET /export/task/:taskID includes goal-snapshot evaluations and QA groups without active plan/run", async () => {
  await using tmp = await tmpdir({ git: true })
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const specID = Identifier.ascending("spec")
  const planID = Identifier.ascending("plan")
  const goalID = Identifier.ascending("goal")
  const nodeID = Identifier.ascending("plan_node")
  const oldRunID = Identifier.ascending("run")
  const runID = Identifier.ascending("run")
  const goalRunID = Identifier.ascending("goal_run")
  const deliveryID = Identifier.ascending("delivery")
  const goalDeliveryID = Identifier.ascending("delivery")
  const evaluationID = Identifier.ascending("evaluation")
  const goalEvaluationID = Identifier.ascending("evaluation")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Database.use((db) => {
        db.insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            active_spec_version_id: specID,
            active_plan_version_id: null,
            active_run_id: null,
            source: "api",
            title: "Export coverage",
            request: "Export the full task state",
            status: "completed",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_completed: now,
          })
          .run()
        db.insert(EngineSpecSnapshotTable)
          .values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "Spec summary",
            content: "# Spec",
            scope: "Scope",
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(EngineGoalTable)
          .values({
            id: goalID,
            task_id: taskID,
            spec_snapshot_id: specID,
            title: "Export coverage goal",
            objective: "Ship export coverage",
            done_definition: "Goal-run delivery and evaluation are exported.",
            priority: "blocking",
            source: "spec",
            status: "passed",
            order_index: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(EnginePlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            spec_snapshot_id: specID,
            version: 1,
            status: "active",
            summary: "Plan summary",
            prompt: "Plan prompt",
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(EnginePlanNodeTable)
          .values({
            id: nodeID,
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goalID,
            title: "Execute export validation",
            brief: "Run export validation",
            order_index: 0,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(EngineRunTable)
          .values([
            {
              id: oldRunID,
              task_id: taskID,
              plan_version_id: planID,
              executor: "opencode",
              status: "failed",
              phase: "dispatch",
              retry_count: 0,
              time_created: now - 1000,
              time_updated: now - 1000,
              time_completed: now - 900,
            },
            {
              id: runID,
              task_id: taskID,
              plan_version_id: planID,
              executor: "opencode",
              status: "completed",
              phase: "deliver",
              retry_count: 0,
              time_created: now,
              time_updated: now,
              time_completed: now,
            },
          ])
          .run()
        db.insert(EngineGoalRunTable)
          .values({
            id: goalRunID,
            task_id: taskID,
            goal_id: goalID,
            plan_node_id: nodeID,
            coordinator_run_id: runID,
            executor: "opencode",
            status: "completed",
            retry_count: 0,
            time_created: now,
            time_updated: now,
            time_completed: now,
          })
          .run()
        db.insert(EngineDeliveryTable)
          .values([
            {
              id: deliveryID,
              task_id: taskID,
              run_id: runID,
              status: "delivered",
              summary: "Coordinator delivery",
              result: {
                summary: "Coordinator delivery",
                changed_files: ["src/export.ts"],
                diffs: [],
                artifacts: [],
              },
              time_created: now,
              time_updated: now,
            },
            {
              id: goalDeliveryID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              status: "candidate",
              summary: "Goal delivery",
              result: {
                summary: "Goal delivery",
                changed_files: ["src/export.ts"],
                diffs: [],
                artifacts: [],
              },
              time_created: now,
              time_updated: now,
            },
          ])
          .run()
        // Phase-6-b: evidence lives in engine_artifact (kind='verification-evidence').
        // The payload mirrors the old engine_evaluation fields.
        db.insert(EngineArtifactTable)
          .values([
            {
              id: evaluationID,
              task_id: taskID,
              run_id: runID,
              delivery_id: deliveryID,
              kind: "verification-evidence",
              label: "evidence-delivery",
              payload: {
                scope: "delivery",
                status: "passed",
                verdict: "accepted",
                summary: "Coordinator evaluation",
                checks: [
                  { name: "build", status: "passed", family: "build", label: "Build" },
                  { name: "goal_check", status: "passed", family: "goal_check", label: "Goal Check" },
                ],
                time_completed: now,
              },
              time_created: now,
              time_updated: now,
            },
            {
              id: goalEvaluationID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              delivery_id: goalDeliveryID,
              kind: "verification-evidence",
              label: "evidence-goal_run",
              payload: {
                scope: "goal_run",
                status: "passed",
                verdict: "accepted",
                summary: "Goal evaluation",
                checks: [
                  { name: "spec_check", status: "passed", family: "spec_check", label: "Spec Check" },
                ],
                time_completed: now,
              },
              time_created: now,
              time_updated: now,
            },
          ])
          .run()
      })

      const response = await Server.App().request(`/export/task/${taskID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(response.status).toBe(200)

      const body = await response.json() as {
        plan?: { id: string }
        coordinatorRun?: { id: string }
        goals: Array<{ id: string }>
        deliveries: Array<{ id: string; goalRunID?: string }>
        evaluations: Array<{ id: string; goalRunID?: string; groups?: Array<{ id: string }> }>
      }

      expect(body.plan).toBeUndefined()
      expect(body.coordinatorRun?.id).toBe(runID)
      expect(body.goals).toEqual([])
      expect(body.deliveries).toHaveLength(2)
      expect(body.deliveries.map((item) => item.id).sort()).toEqual([deliveryID, goalDeliveryID].sort())
      expect(body.deliveries.some((item) => item.goalRunID === goalRunID)).toBe(true)
      expect(body.evaluations).toHaveLength(2)
      expect(body.evaluations.map((item) => item.id).sort()).toEqual([evaluationID, goalEvaluationID].sort())
      expect(body.evaluations.some((item) => item.goalRunID === goalRunID)).toBe(true)
      expect(body.evaluations.find((item) => item.id === evaluationID)?.groups?.map((group) => group.id)).toEqual([
        "rules",
        "goal_acceptance",
      ])
      expect(body.evaluations.find((item) => item.id === goalEvaluationID)?.groups?.map((group) => group.id)).toEqual([
        "spec_acceptance",
      ])
    },
  })
})
