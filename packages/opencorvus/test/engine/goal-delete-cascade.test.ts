import { beforeEach, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { deleteGoal, upsertGoalsFromArchitect } from "../../src/engine/persist"
import { findGoal } from "../../src/engine/store"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

function seedTaskGraph() {
  const now = Date.now()
  const stamp = `${now}_${Math.random().toString(36).slice(2)}`
  const projectID = `project_goal_delete_cascade_${stamp}`
  const taskID = `task_goal_delete_cascade_${stamp}`
  const planID = `plan_goal_delete_cascade_${stamp}`
  const specID = `spec_goal_delete_cascade_${stamp}`
  const goalA = `goal_a_${stamp}`
  const goalB = `goal_b_${stamp}`
  const goalC = `goal_c_${stamp}`
  const nodeA = `node_a_${stamp}`
  const nodeB = `node_b_${stamp}`
  const nodeC = `node_c_${stamp}`

  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "goal delete cascade",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "goal delete cascade",
        request: "delete a prerequisite goal",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "test spec",
        content: "test spec content",
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
        summary: "test plan",
        prompt: "test",
        time_created: now,
        time_updated: now,
      })
      .run()

    for (const goal of [
      { id: goalA, depends_on: [] as string[], order: 0 },
      { id: goalB, depends_on: [goalA], order: 1 },
      { id: goalC, depends_on: [goalA, goalB], order: 2 },
    ]) {
      db.insert(EngineGoalTable)
        .values({
          id: goal.id,
          task_id: taskID,
          plan_version_id: planID,
          spec_snapshot_id: specID,
          title: goal.id,
          slug: goal.id,
          objective: `Implement ${goal.id}`,
          acceptance_specs: [],
          owned_paths: [],
          depends_on: goal.depends_on,
          kind: "feature",
          requirement_ids: [],
          metadata: goal.depends_on.length > 0 ? { depends_on_goal_ids: goal.depends_on } : {},
          priority: "blocking",
          source: "test",
          order_index: goal.order,
          time_created: now,
          time_updated: now,
        })
        .run()
    }

    for (const node of [
      { id: nodeA, goal_id: goalA, depends_on_ids: null as string[] | null, order: 0 },
      { id: nodeB, goal_id: goalB, depends_on_ids: [nodeA], order: 1 },
      { id: nodeC, goal_id: goalC, depends_on_ids: [nodeA, nodeB], order: 2 },
    ]) {
      db.insert(EnginePlanNodeTable)
        .values({
          id: node.id,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: node.goal_id,
          title: node.id,
          brief: `Execute ${node.id}`,
          depends_on_ids: node.depends_on_ids,
          order_index: node.order,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
  })

  return { taskID, planID, specID, now, goalA, goalB, goalC, nodeA, nodeB, nodeC }
}

test("deleteGoal cascades goal dependencies and plan-node dependencies", () => {
  const { taskID, goalA, goalB, goalC, nodeA, nodeB, nodeC } = seedTaskGraph()

  const result = deleteGoal(goalA)

  expect(result.deletedGoals).toBe(1)
  expect(result.deletedPlanNodes).toBe(1)
  expect(result.prunedGoalDependencyRefs).toBe(2)
  expect(result.prunedPlanNodeDependencyRefs).toBe(2)
  expect(findGoal(goalA)).toBeUndefined()
  expect(findGoal(goalB)?.depends_on).toEqual([])
  expect(findGoal(goalB)?.metadata).toBeNull()
  expect(findGoal(goalC)?.depends_on).toEqual([goalB])
  expect(findGoal(goalC)?.metadata).toEqual({ depends_on_goal_ids: [goalB] })

  const planNodes = Database.use((db) =>
    db.select().from(EnginePlanNodeTable).where(eq(EnginePlanNodeTable.task_id, taskID)).all(),
  )
  expect(planNodes.find((node) => node.id === nodeA)).toBeUndefined()
  expect(planNodes.find((node) => node.id === nodeB)?.depends_on_ids).toBeNull()
  expect(planNodes.find((node) => node.id === nodeC)?.depends_on_ids).toEqual([nodeB])
})

test("upsertGoalsFromArchitect prunes dependencies on removed goals before validation can loop", () => {
  const { taskID, specID, now, goalA, goalB, goalC } = seedTaskGraph()

  Database.transaction((db) => {
    upsertGoalsFromArchitect(db, {
      taskID,
      specSnapshotID: specID,
      removedLLMIDs: [goalA],
      now: now + 1,
      architectGoals: [
        {
          llmID: goalB,
          title: "goal_b",
          objective: "Keep goal B after splitting out goal A.",
          acceptance_specs: [],
          owned_paths: [],
          depends_on: [goalA],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
        },
        {
          llmID: goalC,
          title: "goal_c",
          objective: "Keep goal C dependent only on goal B.",
          acceptance_specs: [],
          owned_paths: [],
          depends_on: [goalA, goalB],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
        },
      ],
    })
  })

  expect(findGoal(goalA)).toBeUndefined()
  expect(findGoal(goalB)?.depends_on).toEqual([])
  expect(findGoal(goalC)?.depends_on).toEqual([goalB])
})
