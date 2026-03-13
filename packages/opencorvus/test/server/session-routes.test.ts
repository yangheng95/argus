import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionTable } from "../../src/session/session.sql"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session routes", () => {
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
  })

  afterEach(async () => {
    mock.restore()
    Config.global.reset()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /session/:id writes full session info to logs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "log-session" })

        const response = await app.request(`/session/${session.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        let line: string | undefined
        for (const _ of Array.from({ length: 10 })) {
          await Bun.sleep(100)
          const logs = await app.request("/log/tail?n=5000", {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(logs.status).toBe(200)
          const body = await logs.json() as { lines: string[] }
          line = [...body.lines].reverse().find((item) =>
            item.includes("service=server") &&
            item.includes("session.get") &&
            item.includes(`sessionID=${session.id}`),
          )
          if (line) break
        }

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

  test("DELETE /session/:id keeps the task visible in /tasks when deleteTasks is omitted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "keep-task" })
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "panel",
            title: "keep bound task",
            request: "keep bound task",
            status: "completed",
            priority: "normal",
            time_created: now,
            time_updated: now,
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
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
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

  test("DELETE /session/:id aborts the session before removing it", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "abort-on-delete" })
        const spy = spyOn(SessionPrompt, "cancel").mockImplementation(() => undefined)
        const removed = await app.request(`/session/${session.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(spy).toHaveBeenCalledWith(session.id)
      },
    })
  })

  test("GET/PATCH /session/:id/panel-settings persists session-scoped panel settings", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "panel-settings" })

        const empty = await app.request(`/session/${session.id}/panel-settings`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(empty.status).toBe(200)
        expect(await empty.json()).toEqual({})

        const updated = await app.request(`/session/${session.id}/panel-settings`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            theme: "light",
            zoom: 1.1,
            directory: "D:/session/workspace",
          }),
        })

        expect(updated.status).toBe(200)
        expect(await updated.json()).toEqual({
          theme: "light",
          zoom: 1.1,
          directory: "D:/session/workspace",
        })

        const fetched = await app.request(`/session/${session.id}/panel-settings`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(fetched.status).toBe(200)
        expect(await fetched.json()).toEqual({
          theme: "light",
          zoom: 1.1,
          directory: "D:/session/workspace",
        })
      },
    })
  })
})
