import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineGoalRunTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRunTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { startNewAttempt, updateGoalRun } from "../../src/engine/persist"
import { listQueuedGoalRunsForRun } from "../../src/engine/store"
import { queueRedispatchGoals } from "../../src/orchestrator/dispatch-queue"
import { resetDatabase } from "../fixture/db"

describe("queueRedispatchGoals", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("queues only ready superseded goals, then replenishes dependents after prerequisites pass", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_redispatch_${stamp}`
    const taskID = `tsk_redispatch_${stamp}`
    const planID = `plan_redispatch_${stamp}`
    const runID = `run_redispatch_${stamp}`
    const goalA = `goal_root_${stamp}`
    const goalB = `goal_leaf_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Redispatch test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Redispatch task",
        request: "Verify redispatch queue materialization",
        status: "active",
        priority: "normal",
        active_run_id: runID,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EnginePlanVersionTable).values({
        id: planID,
        task_id: taskID,
        version: 1,
        status: "active",
        summary: "Redispatch plan",
        prompt: "Redispatch prompt",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineRunTable).values({
        id: runID,
        task_id: taskID,
        plan_version_id: planID,
        executor: "opencode",
        status: "running",
        phase: "execute",
        retry_count: 0,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineGoalTable).values([
        {
          id: goalA,
          task_id: taskID,
          plan_version_id: planID,
          title: "Root goal",
          slug: "root-goal",
          objective: "Root goal redispatch",
          acceptance_specs: [],
          owned_paths: ["src/root.ts"],
          depends_on: [],
          exports: [],
          imports: [],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
          source: "spec",
          status: "pending",
          order_index: 0,
          time_created: now,
          time_updated: now,
        },
        {
          id: goalB,
          task_id: taskID,
          plan_version_id: planID,
          title: "Leaf goal",
          slug: "leaf-goal",
          objective: "Leaf goal redispatch",
          acceptance_specs: [],
          owned_paths: ["src/leaf.ts"],
          depends_on: [goalA],
          exports: [],
          imports: [],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
          source: "spec",
          status: "pending",
          order_index: 1,
          time_created: now,
          time_updated: now,
        },
      ]).run()
      db.insert(EnginePlanNodeTable).values([
        {
          id: `node_root_${stamp}`,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: goalA,
          title: "Root goal",
          brief: "Root",
          order_index: 0,
          time_created: now,
          time_updated: now,
        },
        {
          id: `node_leaf_${stamp}`,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: goalB,
          title: "Leaf goal",
          brief: "Leaf",
          depends_on_ids: [`node_root_${stamp}`],
          order_index: 1,
          time_created: now,
          time_updated: now,
        },
      ]).run()
      db.insert(EngineGoalRunTable).values([
        {
          id: `gr_root_done_${stamp}`,
          task_id: taskID,
          goal_id: goalA,
          coordinator_run_id: runID,
          executor: "opencode",
          status: "completed",
          time_started: now - 10_000,
          time_completed: now - 8_000,
          time_created: now - 10_000,
          time_updated: now - 8_000,
        },
        {
          id: `gr_leaf_done_${stamp}`,
          task_id: taskID,
          goal_id: goalB,
          coordinator_run_id: runID,
          executor: "opencode",
          status: "completed",
          time_started: now - 7_000,
          time_completed: now - 5_000,
          time_created: now - 7_000,
          time_updated: now - 5_000,
        },
      ]).run()
    })

    startNewAttempt({ goalID: goalA, reason: "delivery_rework" })
    startNewAttempt({ goalID: goalB, reason: "delivery_rework" })

    const firstBatch = queueRedispatchGoals(taskID, [goalA, goalB])
    expect(firstBatch).toEqual([goalA])

    const firstQueued = listQueuedGoalRunsForRun(runID)
    expect(firstQueued.map((goalRun) => goalRun.goal_id)).toEqual([goalA])

    updateGoalRun(firstQueued[0]!.id, {
      status: "completed",
      time_completed: now + 1_000,
    })

    const secondBatch = queueRedispatchGoals(taskID, [goalA, goalB])
    expect(secondBatch).toEqual([goalB])
    expect(listQueuedGoalRunsForRun(runID).map((goalRun) => goalRun.goal_id)).toEqual([goalB])
  })
})