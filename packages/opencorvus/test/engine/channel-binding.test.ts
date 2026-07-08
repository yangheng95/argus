import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { deleteEngineChannelBindingsForTask, insertEngineChannelBinding } from "../../src/engine/channel-binding"
import { EngineChannelBindingTable, EngineTaskTable } from "../../src/engine/engine.sql"
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
      const root = await Session.create({ kind: "root", title: "channel binding writer" })
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
            title: "channel binding writer",
            request: "Verify channel binding write boundary.",
            priority: "normal",
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

describe("engine channel binding writer", () => {
  test("creates and deletes channel binding rows through the writer", () => {
    const now = Date.now()
    const bindingID = Database.transaction((db) =>
      insertEngineChannelBinding(db, {
        taskID,
        platform: "slack",
        channel: "C_writer",
        thread: "T_writer",
        payload: { source: "test" },
        timeCreated: now,
      }),
    )

    const row = Database.use((db) =>
      db.select().from(EngineChannelBindingTable).where(eq(EngineChannelBindingTable.id, bindingID)).get(),
    )
    expect(row).toMatchObject({
      id: bindingID,
      task_id: taskID,
      platform: "slack",
      channel: "C_writer",
      thread: "T_writer",
      payload: { source: "test" },
      time_created: now,
      time_updated: now,
    })

    Database.transaction((db) => deleteEngineChannelBindingsForTask(db, taskID))
    expect(
      Database.use((db) =>
        db.select().from(EngineChannelBindingTable).where(eq(EngineChannelBindingTable.task_id, taskID)).all(),
      ),
    ).toEqual([])
  })
})
