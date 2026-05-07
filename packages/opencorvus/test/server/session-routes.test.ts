import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
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

  test("GET /session/:id writes full session info to logs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ kind: "assistant", title: "log-session" })

        const response = await app.request(`/session/${session.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        await Bun.sleep(50)

        const logs = await app.request("/log/tail?n=500", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(logs.status).toBe(200)
        const body = await logs.json() as { lines: string[] }
        const line = [...body.lines].reverse().find((item) =>
          item.includes("service=server") &&
          item.includes("session.get") &&
          item.includes(`sessionID=${session.id}`),
        )

        expect(line).toBeDefined()
        expect(line).toContain(`sessionID=${session.id}`)
        expect(line).toContain(`"id":"${session.id}"`)
        expect(line).toContain(`"title":"log-session"`)
      },
    })
  })

  test("DELETE /session/:id?deleteTasks=true removes the bound task too", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ kind: "assistant", title: "delete-me" })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "panel",
            title: "delete bound task",
            request: "delete bound task",
            priority: "normal",
            metadata: { cancelled: true },
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now,
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
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )).toBeUndefined()
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get(),
        )).toBeUndefined()
      },
    })
  })

  test("DELETE /session/:id keeps the task visible in /tasks when deleteTasks is omitted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ kind: "assistant", title: "keep-task" })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "panel",
            title: "keep bound task",
            request: "keep bound task",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now,
          }).run(),
        )

        const removed = await app.request(`/session/${session.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get(),
        )).toBeUndefined()

        const task = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(task?.session_id).toBeNull()

        const listed = await app.request("/tasks", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(listed.status).toBe(200)
        const body = await listed.json() as {
          tasks: Array<{ task: { id: string; sessionID?: string | null } }>
        }
        expect(body.tasks).toHaveLength(1)
        expect(body.tasks[0]?.task.id).toBe(taskID)
        expect(body.tasks[0]?.task.sessionID).toBeUndefined()
      },
    })
  })
})
