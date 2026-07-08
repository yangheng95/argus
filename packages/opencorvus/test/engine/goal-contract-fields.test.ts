import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { insertGoalRows, updateGoalContractFields } from "../../src/engine/persist"
import { insertEngineSpecSnapshot } from "../../src/engine/spec-snapshot"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let specSnapshotID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "goal contract field writer" })
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "goal contract field writer",
            request: "Verify goal contract field write boundary.",
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      specSnapshotID = Database.transaction((db) =>
        insertEngineSpecSnapshot(db, {
          taskID,
          version: 1,
          status: "ready",
          summary: "Spec summary",
          content: "Spec content",
          scope: "Spec scope",
          timeCreated: now,
        }),
      )
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("goal contract field writer", () => {
  test("applies a contract field patch to one goal row", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const [goal] = Database.transaction((db) =>
          insertGoalRows(db, {
            taskID,
            specSnapshotID,
            now,
            goals: [
              {
                goalID: "goal_contract_patch",
                title: "Original title",
                objective: "Original objective.",
                acceptance_specs: [],
                owned_paths: ["src/original.ts"],
              },
            ],
          }),
        )

        Database.transaction((db) =>
          updateGoalContractFields(db, {
            goalID: goal.id,
            values: {
              title: "Updated title",
              objective: "Updated objective.",
              owned_paths: ["src/updated.ts"],
              depends_on: ["goal_dependency"],
              time_updated: now + 1,
            },
          }),
        )

        const row = Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goal.id)).get())
        expect(row).toMatchObject({
          id: goal.id,
          title: "Updated title",
          objective: "Updated objective.",
          owned_paths: ["src/updated.ts"],
          depends_on: ["goal_dependency"],
          spec_snapshot_id: specSnapshotID,
          time_created: now,
          time_updated: now + 1,
        })
      },
    })
  })
})
