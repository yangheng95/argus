import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { mergeEngineTaskMetadata, touchEngineTask } from "../../src/engine/task"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task writer" })
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
            title: "task writer",
            request: "Verify task writer.",
            priority: "normal",
            metadata: { existing: true },
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("engine task writer", () => {
  test("touches task timestamps and merges metadata patches", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.transaction((db) => touchEngineTask(db, { taskID, timeUpdated: now + 1 }))
        let row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          metadata: { existing: true },
          time_updated: now + 1,
        })

        const metadata = Database.transaction((db) =>
          mergeEngineTaskMetadata(db, {
            taskID,
            metadata: { architect_fidelity: { sourceCoverage: ["REQ-1"] } },
            timeUpdated: now + 2,
          }),
        )
        expect(metadata).toEqual({
          existing: true,
          architect_fidelity: { sourceCoverage: ["REQ-1"] },
        })
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          metadata,
          time_updated: now + 2,
        })
      },
    })
  })
})
