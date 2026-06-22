import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Config } from "../../src/config/config"
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
        const requestID = response.headers.get("x-opencorvus-request-id")
        expect(requestID).toBeTruthy()
        await Bun.sleep(50)

        const logs = await app.request("/log/tail?n=500", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(logs.status).toBe(200)
        const body = (await logs.json()) as { lines: string[] }
        const line = [...body.lines]
          .reverse()
          .map((item) => JSON.parse(item) as Record<string, unknown>)
          .find((item) => item.service === "server" && item.message === "session.get" && item.sessionID === session.id)

        expect(line).toBeDefined()
        expect(line?.sessionID).toBe(session.id)
        expect(line?.session).toMatchObject({
          id: session.id,
          title: "log-session",
        })
        const requestCompleted = [...body.lines]
          .reverse()
          .map((item) => JSON.parse(item) as Record<string, unknown>)
          .find(
            (item) =>
              item.service === "server" &&
              item.message === "request" &&
              item.requestID === requestID &&
              item.status === "completed",
          )
        expect(requestCompleted).toMatchObject({
          method: "GET",
          path: `/session/${session.id}`,
          statusCode: 200,
        })
        expect(typeof requestCompleted?.duration).toBe("number")
      },
    })
  })

  test("project-scoped route errors include request id and failed request log", async () => {
    const app = Server.App()
    const response = await app.request("/session/missing-directory")
    expect(response.status).toBe(400)
    const requestID = response.headers.get("x-opencorvus-request-id")
    expect(requestID).toBeTruthy()
    await Bun.sleep(50)

    const logs = await app.request("/log/tail?n=500")
    expect(logs.status).toBe(200)
    const body = (await logs.json()) as { lines: string[] }
    const records = body.lines.map((item) => JSON.parse(item) as Record<string, unknown>)

    const boundaryCompletion = [...records]
      .reverse()
      .find(
        (item) =>
          item.service === "server" &&
          item.message === "request" &&
          item.requestID === requestID &&
          item.status === "completed",
      )
    expect(boundaryCompletion).toMatchObject({
      method: "GET",
      path: "/session/missing-directory",
      statusCode: 400,
    })
    expect(typeof boundaryCompletion?.duration).toBe("number")

    const routeFailure = [...records]
      .reverse()
      .find((item) => item.service === "server" && item.message === "request failed" && item.requestID === requestID)
    expect(routeFailure).toMatchObject({
      method: "GET",
      path: "/session/missing-directory",
      statusCode: 400,
    })
    expect(routeFailure?.error).toMatchObject({
      type: "DirectoryRequiredError",
    })
  })

  test("PATCH /session/:id/config applies prompt profile overlay and rejects unknown profiles", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ kind: "root", title: "profile-session" })

        const saved = await app.request(`/session/${session.id}/config`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ prompt_profile: { active: "testing" } }),
        })
        expect(saved.status).toBe(200)
        const body = (await saved.json()) as { config: Config.Info; origin: any }
        expect(body.config.prompt_profile.active).toBe("testing")
        expect(body.origin.prompt_profile.active).toBe("session")

        const rejected = await app.request(`/session/${session.id}/config`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ prompt_profile: { active: "missing-profile" } }),
        })
        expect(rejected.status).toBe(400)
        expect((await Session.get(session.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: "testing" },
        })
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
          db
            .insert(EngineTaskTable)
            .values({
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
            })
            .run(),
        )

        const removed = await app.request(`/session/${session.id}?deleteTasks=true`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(
          Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get()),
        ).toBeUndefined()
        expect(
          Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get()),
        ).toBeUndefined()
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
          db
            .insert(EngineTaskTable)
            .values({
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
            })
            .run(),
        )

        const removed = await app.request(`/session/${session.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(
          Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get()),
        ).toBeUndefined()

        const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(task?.session_id).toBeNull()

        const listed = await app.request("/tasks", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(listed.status).toBe(200)
        const body = (await listed.json()) as {
          tasks: Array<{ task: { id: string; sessionID?: string | null } }>
        }
        expect(body.tasks).toHaveLength(1)
        expect(body.tasks[0]?.task.id).toBe(taskID)
        expect(body.tasks[0]?.task.sessionID).toBeUndefined()
      },
    })
  })
})
