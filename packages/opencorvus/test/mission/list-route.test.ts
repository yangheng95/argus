import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

async function getMissionList(query = "") {
  return Server.App().request(`/mission${query}`, {
    method: "GET",
  })
}

function directoryQuery(directory: string, suffix = ""): string {
  const params = new URLSearchParams({ directory })
  if (suffix) {
    const extra = new URLSearchParams(suffix.replace(/^\?/, ""))
    extra.forEach((value, key) => params.set(key, value))
  }
  return `?${params.toString()}`
}

async function createMission(input: {
  id?: string
  missionID?: unknown
  title: string
  directory: string
  updated?: number
  archived?: number
}) {
  const session = await Session.createNext({
    id: input.id,
    kind: "mission",
    title: input.title,
    directory: input.directory,
  })
  await Session.mergeMetadata({
    sessionID: session.id,
    patch: {
      mission: {
        id: input.missionID,
        channelKey: `mission:${String(input.missionID)}`,
        cwd: input.directory,
      },
    },
  })
  if (input.updated !== undefined || input.archived !== undefined) {
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          ...(input.updated !== undefined ? { time_created: input.updated - 1, time_updated: input.updated } : {}),
          ...(input.archived !== undefined ? { time_archived: input.archived } : {}),
        })
        .where(eq(SessionTable.id, session.id))
        .run(),
    )
  }
  return Session.get(session.id)
}

describe("GET /mission", () => {
  test("lists valid Mission sessions across project directories", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })

    let projectASessionID = ""
    let projectBSessionID = ""
    await Instance.provide({
      directory: tmpA.path,
      fn: async () => {
        const mission = await createMission({
          missionID: "project-a",
          title: "Project A Mission",
          directory: tmpA.path,
        })
        projectASessionID = mission.id
        await Session.createNext({ kind: "assistant", title: "Assistant", directory: tmpA.path })
        await createMission({
          missionID: "BAD_ID",
          title: "Malformed Mission",
          directory: tmpA.path,
        })
      },
    })

    await Instance.provide({
      directory: tmpB.path,
      fn: async () => {
        const mission = await createMission({
          missionID: "project-b",
          title: "Project B Mission",
          directory: tmpB.path,
        })
        projectBSessionID = mission.id
      },
    })

    const res = await getMissionList()
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ missionID: string; sessionID: string; title: string; directory: string }>
    expect(body.map((row) => row.missionID).sort()).toEqual(["project-a", "project-b"])
    expect(body.find((row) => row.missionID === "project-a")).toMatchObject({
      sessionID: projectASessionID,
      title: "Project A Mission",
      directory: tmpA.path,
    })
    expect(body.find((row) => row.missionID === "project-b")).toMatchObject({
      sessionID: projectBSessionID,
      title: "Project B Mission",
      directory: tmpB.path,
    })

    const filtered = (await (
      await getMissionList(`?directory=${encodeURIComponent(tmpA.path)}`)
    ).json()) as Array<{ missionID: string }>
    expect(filtered.map((row) => row.missionID)).toEqual(["project-a"])
  })

  test("hides archived Missions by default and includes them when requested", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await createMission({ missionID: "live", title: "Live", directory: tmp.path, updated: 300 })
        await createMission({ missionID: "old", title: "Old", directory: tmp.path, updated: 200, archived: 250 })

        const visible = (await (await getMissionList(directoryQuery(tmp.path))).json()) as Array<{ missionID: string }>
        expect(visible.map((row) => row.missionID)).toEqual(["live"])

        const withArchived = (await (
          await getMissionList(directoryQuery(tmp.path, "archived=true"))
        ).json()) as Array<{ missionID: string }>
        expect(withArchived.map((row) => row.missionID)).toEqual(["live", "old"])
      },
    })
  })

  test("searches title, missionID, and directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await createMission({ missionID: "alpha-id", title: "Alpha title", directory: tmp.path, updated: 200 })
        await createMission({ missionID: "beta-id", title: "Beta title", directory: tmp.path, updated: 100 })

        const byTitle = (await (await getMissionList("?search=Alpha")).json()) as Array<{ missionID: string }>
        expect(byTitle.map((row) => row.missionID)).toEqual(["alpha-id"])

        const byID = (await (await getMissionList("?search=beta-id")).json()) as Array<{ missionID: string }>
        expect(byID.map((row) => row.missionID)).toEqual(["beta-id"])

        const byDirectory = (await (
          await getMissionList(`?search=${encodeURIComponent(tmp.path)}`)
        ).json()) as Array<{ missionID: string }>
        expect(byDirectory.map((row) => row.missionID)).toEqual(["alpha-id", "beta-id"])
      },
    })
  })

  test("uses compound cursor pagination for equal updated timestamps", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await createMission({ id: "ses_z", missionID: "z", title: "Z", directory: tmp.path, updated: 100 })
        await createMission({ id: "ses_a", missionID: "a", title: "A", directory: tmp.path, updated: 100 })

        const first = (await (await getMissionList(directoryQuery(tmp.path, "limit=1"))).json()) as Array<{
          missionID: string
          sessionID: string
          updated: number
        }>
        expect(first.map((row) => row.sessionID)).toEqual(["ses_z"])

        const next = (await (
          await getMissionList(directoryQuery(
            tmp.path,
            `cursorUpdated=${first[0].updated}&cursorSessionID=${first[0].sessionID}`,
          ))
        ).json()) as Array<{ sessionID: string }>
        expect(next.map((row) => row.sessionID)).toEqual(["ses_a"])
      },
    })
  })

  test("rejects incomplete compound cursor query", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await getMissionList("?cursorUpdated=100")
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
      },
    })
  })
})
