import { afterEach, describe, expect, test } from "bun:test"
import { and, eq } from "../../src/storage/db"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { Database } from "../../src/storage/db"
import { EventJobTable } from "../../src/scheduler/event.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function projectContext(directory: string, title: string) {
  let projectID = ""
  let sessionID = ""
  await Instance.provide({
    directory,
    fn: async () => {
      projectID = Instance.project.id
      sessionID = (await Session.create({ kind: "assistant", title })).id
    },
  })
  return { projectID, sessionID }
}

function jsonHeaders(directory: string) {
  return {
    "content-type": "application/json",
    "x-opencorvus-directory": directory,
  }
}

describe("experimental schedule routes", () => {
  afterEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("cron schedule routes bind project and session ownership to the active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    const suffix = Math.random().toString(36).slice(2)
    const app = Server.App()
    const a = await projectContext(projectA.path, `project-a-schedule-${suffix}`)
    const b = await projectContext(projectB.path, `project-b-schedule-${suffix}`)
    const foreignJobID = `cron_foreign_${suffix}`

    Database.use((db) =>
      db
        .insert(CronJobTable)
        .values({
          id: foreignJobID,
          project_id: b.projectID,
          session_id: b.sessionID,
          name: "foreign cron",
          expression: "1m",
          prompt: "foreign prompt",
          enabled: true,
          one_shot: true,
          next_run: Date.now() + 60_000,
        })
        .run(),
    )

    const foreignList = await app.request(`/experimental/schedule?projectId=${encodeURIComponent(b.projectID)}`, {
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(foreignList.status).toBe(400)

    const initialList = await app.request("/experimental/schedule", {
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(initialList.status).toBe(200)
    expect(await initialList.json()).toEqual([])

    const directoryQueryList = await app.request(
      `/experimental/schedule?directory=${encodeURIComponent(projectA.path)}`,
    )
    expect(directoryQueryList.status).toBe(200)
    expect(await directoryQueryList.json()).toEqual([])

    const crossProjectCreate = await app.request("/experimental/schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "cross project cron",
        expression: "1m",
        prompt: "must not write project B",
        projectId: b.projectID,
      }),
    })
    expect(crossProjectCreate.status).toBe(400)
    expect(
      Database.use((db) =>
        db
          .select()
          .from(CronJobTable)
          .where(and(eq(CronJobTable.project_id, b.projectID), eq(CronJobTable.name, "cross project cron")))
          .get(),
      ),
    ).toBeUndefined()

    const foreignSessionCreate = await app.request("/experimental/schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "foreign session cron",
        expression: "1m",
        prompt: "must not bind project B session",
        sessionId: b.sessionID,
      }),
    })
    expect(foreignSessionCreate.status).toBe(404)

    const validCreate = await app.request("/experimental/schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "project A cron",
        expression: "1m",
        prompt: "run project A",
        sessionId: a.sessionID,
      }),
    })
    expect(validCreate.status).toBe(200)
    const validBody = (await validCreate.json()) as { id: string }
    const ownRow = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, validBody.id)).get())
    expect(ownRow?.project_id).toBe(a.projectID)
    expect(ownRow?.session_id).toBe(a.sessionID)

    const foreignDeleteQuery = await app.request(
      `/experimental/schedule/${foreignJobID}?projectId=${encodeURIComponent(b.projectID)}`,
      {
        method: "DELETE",
        headers: { "x-opencorvus-directory": projectA.path },
      },
    )
    expect(foreignDeleteQuery.status).toBe(400)

    const foreignDelete = await app.request(`/experimental/schedule/${foreignJobID}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(foreignDelete.status).toBe(404)
    expect(
      Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, foreignJobID)).get()),
    ).toBeDefined()

    const ownDelete = await app.request(`/experimental/schedule/${validBody.id}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(ownDelete.status).toBe(200)
    expect(
      Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, validBody.id)).get()),
    ).toBeUndefined()
  }, 30_000)

  test("event schedule routes bind project and session ownership to the active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    const suffix = Math.random().toString(36).slice(2)
    const app = Server.App()
    const a = await projectContext(projectA.path, `project-a-event-${suffix}`)
    const b = await projectContext(projectB.path, `project-b-event-${suffix}`)
    const foreignJobID = `evt_foreign_${suffix}`

    Database.use((db) =>
      db
        .insert(EventJobTable)
        .values({
          id: foreignJobID,
          project_id: b.projectID,
          session_id: b.sessionID,
          name: "foreign event",
          event_type: "test.foreign",
          prompt: "foreign prompt",
          enabled: true,
          one_shot: false,
          cooldown_ms: 0,
        })
        .run(),
    )

    const foreignList = await app.request(`/experimental/event-schedule?projectId=${encodeURIComponent(b.projectID)}`, {
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(foreignList.status).toBe(400)

    const initialList = await app.request("/experimental/event-schedule", {
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(initialList.status).toBe(200)
    expect(await initialList.json()).toEqual([])

    const directoryQueryList = await app.request(
      `/experimental/event-schedule?directory=${encodeURIComponent(projectA.path)}`,
    )
    expect(directoryQueryList.status).toBe(200)
    expect(await directoryQueryList.json()).toEqual([])

    const crossProjectCreate = await app.request("/experimental/event-schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "cross project event",
        eventType: "test.cross",
        prompt: "must not write project B",
        projectId: b.projectID,
      }),
    })
    expect(crossProjectCreate.status).toBe(400)
    expect(
      Database.use((db) =>
        db
          .select()
          .from(EventJobTable)
          .where(and(eq(EventJobTable.project_id, b.projectID), eq(EventJobTable.name, "cross project event")))
          .get(),
      ),
    ).toBeUndefined()

    const foreignSessionCreate = await app.request("/experimental/event-schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "foreign session event",
        eventType: "test.foreign.session",
        prompt: "must not bind project B session",
        sessionId: b.sessionID,
      }),
    })
    expect(foreignSessionCreate.status).toBe(404)

    const validCreate = await app.request("/experimental/event-schedule", {
      method: "POST",
      headers: jsonHeaders(projectA.path),
      body: JSON.stringify({
        name: "project A event",
        eventType: "test.project-a",
        prompt: "run project A",
        sessionId: a.sessionID,
      }),
    })
    expect(validCreate.status).toBe(200)
    const validBody = (await validCreate.json()) as { id: string }
    const ownRow = Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, validBody.id)).get())
    expect(ownRow?.project_id).toBe(a.projectID)
    expect(ownRow?.session_id).toBe(a.sessionID)

    const foreignDeleteQuery = await app.request(
      `/experimental/event-schedule/${foreignJobID}?projectId=${encodeURIComponent(b.projectID)}`,
      {
        method: "DELETE",
        headers: { "x-opencorvus-directory": projectA.path },
      },
    )
    expect(foreignDeleteQuery.status).toBe(400)

    const foreignDelete = await app.request(`/experimental/event-schedule/${foreignJobID}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(foreignDelete.status).toBe(404)
    expect(
      Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, foreignJobID)).get()),
    ).toBeDefined()

    const ownDelete = await app.request(`/experimental/event-schedule/${validBody.id}`, {
      method: "DELETE",
      headers: { "x-opencorvus-directory": projectA.path },
    })
    expect(ownDelete.status).toBe(200)
    expect(
      Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, validBody.id)).get()),
    ).toBeUndefined()
  }, 30_000)
})
