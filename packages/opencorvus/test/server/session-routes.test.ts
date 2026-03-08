import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("DELETE /session/:id?deleteTasks=true removes the bound task too", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "delete-me" })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "panel",
            title: "delete bound task",
            request: "delete bound task",
            status: "cancelled",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run(),
        )

        const removed = await app.request(`/session/${session.id}?deleteTasks=true`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )).toBeUndefined()
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get(),
        )).toBeUndefined()
      },
    })
  })
})
