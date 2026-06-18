import { afterEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { upsertGoalsFromArchitect } from "../../src/engine/persist"
import { findGoal } from "../../src/engine/store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { Identifier } from "../../src/id/id"

type SeededTask = {
  projectID: string
  taskID: string
  specID: string
}

function seedTask(now = Date.now()): SeededTask {
  const seed = {
    projectID: `proj_${Identifier.ascending("task")}`,
    taskID: Identifier.ascending("task"),
    specID: Identifier.ascending("spec"),
  }
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: seed.projectID,
        worktree: process.cwd(),
        name: "goal versioning",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: seed.taskID,
        project_id: seed.projectID,
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
        id: seed.specID,
        task_id: seed.taskID,
        version: 1,
        status: "ready",
        summary: "spec",
        content: "spec",
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  return seed
}

function seedGoal(seed: SeededTask, id: string, orderIndex: number, now = Date.now()) {
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id,
        task_id: seed.taskID,
        spec_snapshot_id: seed.specID,
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

afterEach(async () => {
  await resetDatabase()
})

describe("goal versioning labels", () => {
  test.serial("architect upsert rejects internal runtime owned paths", async () => {
    await resetDatabase()
    const seed = seedTask()
    expect(() =>
      Database.transaction((db) =>
        upsertGoalsFromArchitect(db, {
          taskID: seed.taskID,
          specSnapshotID: seed.specID,
          removedLLMIDs: [],
          now: Date.now(),
          architectGoals: [
            {
              llmID: "goal_bad_runtime_doc",
              title: "Bad runtime doc",
              objective: "Create a durable handoff in the task runtime tree.",
              acceptance_specs: [],
              owned_paths: [".opencorvus/r/t/ab/cdef12/stage1/evidence-manifest-prd.md"],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: [],
              priority: "blocking",
            },
          ],
        }),
      ),
    ).toThrow(/internal OpenCorvus runtime path/)
  })

  test.serial("architect-added goals append after the historical maximum G number", async () => {
    await resetDatabase()
    const seed = seedTask()
    const goalIDs = Array.from({ length: 5 }, () => Identifier.ascending("goal"))
    for (let i = 0; i < goalIDs.length; i++) seedGoal(seed, goalIDs[i], i)
    const newGoalLLMID = Identifier.ascending("goal")

    const result = Database.transaction((db) =>
      upsertGoalsFromArchitect(db, {
        taskID: seed.taskID,
        specSnapshotID: seed.specID,
        removedLLMIDs: [goalIDs[2]],
        now: Date.now(),
        architectGoals: [
          {
            llmID: goalIDs[0],
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
            llmID: newGoalLLMID,
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

    const newGoalID = result.llmToDBID.get(newGoalLLMID)
    expect(newGoalID).toBeTruthy()
    expect(findGoal(goalIDs[0])?.order_index).toBe(0)
    expect(findGoal(newGoalID!)?.order_index).toBe(5)
  })
})
