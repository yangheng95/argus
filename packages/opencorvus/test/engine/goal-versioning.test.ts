import { beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { upsertGoalsFromArchitect } from "../../src/engine/persist"
import { findGoal } from "../../src/engine/store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

const projectID = "proj_goal_versioning"
const taskID = "task_goal_versioning"
const specID = "spec_goal_versioning"

function seedTask(now = Date.now()) {
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "goal versioning",
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
        title: "Goal versioning",
        request: "Goal versioning",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "spec",
        content: "spec",
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function seedGoal(id: string, orderIndex: number, now = Date.now()) {
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id,
        task_id: taskID,
        spec_snapshot_id: specID,
        title: `Goal ${orderIndex + 1}`,
        slug: `goal-${orderIndex + 1}`,
        objective: `Objective for goal ${orderIndex + 1}`,
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        order_index: orderIndex,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  seedTask()
})

describe("goal versioning labels", () => {
  test("architect-added goals append after the historical maximum G number", () => {
    for (let i = 0; i < 5; i++) seedGoal(`goal_${i + 1}`, i)

    const result = Database.transaction((db) =>
      upsertGoalsFromArchitect(db, {
        taskID,
        specSnapshotID: specID,
        removedLLMIDs: ["goal_3"],
        now: Date.now(),
        architectGoals: [
          {
            llmID: "goal_1",
            title: "Goal 1 revised",
            objective: "Existing goal revised without changing its operator number.",
            acceptance_specs: [],
            owned_paths: [],
            depends_on: [],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
          },
          {
            llmID: "goal_new",
            title: "Brand new missing goal",
            objective: "A genuinely new goal added during architect refinement.",
            acceptance_specs: [],
            owned_paths: [],
            depends_on: [],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
          },
        ],
      }),
    )

    const newGoalID = result.llmToDBID.get("goal_new")
    expect(newGoalID).toBeTruthy()
    expect(findGoal("goal_1")?.order_index).toBe(0)
    expect(findGoal(newGoalID!)?.order_index).toBe(5)
  })
})
