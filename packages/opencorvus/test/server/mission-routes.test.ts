import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ensureMissionSession } from "../../src/mission/session"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionTable } from "../../src/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("mission routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("PATCH /mission/:missionID/title renames the Mission session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-rename", defaultCwd: tmp.path })

        const response = await app.request("/mission/m-rename/title", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ title: "Renamed Mission" }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { missionID: string; sessionID: string; title: string }
        expect(body).toMatchObject({
          missionID: "m-rename",
          sessionID: session.id,
          title: "Renamed Mission",
        })
        expect((await Session.get(session.id)).title).toBe("Renamed Mission")
      },
    })
  })

  test("POST /mission/:missionID/abort cancels the Mission session prompt", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-abort", defaultCwd: tmp.path })
        const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => undefined)

        const response = await app.request("/mission/m-abort/abort", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id)
        cancel.mockRestore()
      },
    })
  })

  test("DELETE /mission/:missionID deletes the Mission session history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-delete", defaultCwd: tmp.path })

        const response = await app.request("/mission/m-delete", {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get(),
        )).toBeUndefined()
      },
    })
  })

  test("Mission actions do not target non-Mission sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ kind: "assistant", title: "not mission" })
        await Session.mergeMetadata({
          sessionID: session.id,
          patch: { mission: { id: "m-not-mission" } },
        })

        const response = await app.request("/mission/m-not-mission", {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(404)
        expect(await Session.get(session.id)).toMatchObject({ id: session.id, kind: "assistant" })
      },
    })
  })
})
