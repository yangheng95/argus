import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ kind: "assistant", title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ kind: "assistant", title: "second-session" }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ kind: "assistant", title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...Session.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports compound cursor pagination without skipping same-timestamp sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const alpha = await Session.create({ kind: "assistant", title: "Alpha global" })
        const beta = await Session.create({ kind: "assistant", title: "Beta global" })
        const gamma = await Session.create({ kind: "assistant", title: "Gamma global" })
        const fixedUpdated = Date.now() + 10_000
        Database.use((db) => {
          for (const session of [alpha, beta, gamma]) {
            db.update(SessionTable).set({ time_updated: fixedUpdated }).where(eq(SessionTable.id, session.id)).run()
          }
        })

        const expectedOrder = [alpha.id, beta.id, gamma.id].sort((left, right) => right.localeCompare(left))
        const page = [...Session.listGlobal({ directory: tmp.path, limit: 2 })]
        expect(page.map((session) => session.id)).toEqual(expectedOrder.slice(0, 2))

        const next = [
          ...Session.listGlobal({
            directory: tmp.path,
            limit: 10,
            cursorUpdated: page[1].time.updated,
            cursorSessionID: page[1].id,
          }),
        ]
        expect(next.map((session) => session.id)).toEqual(expectedOrder.slice(2))
      },
    })
  })

  test("GET /session/global rejects half cursors and returns compound next-cursor headers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const alpha = await Session.create({ kind: "assistant", title: "Route alpha global" })
        const beta = await Session.create({ kind: "assistant", title: "Route beta global" })
        const fixedUpdated = Date.now() + 20_000
        Database.use((db) => {
          for (const session of [alpha, beta]) {
            db.update(SessionTable).set({ time_updated: fixedUpdated }).where(eq(SessionTable.id, session.id)).run()
          }
        })

        const onlyUpdated = await Server.App().request(
          `/session/global?${new URLSearchParams({ directory: tmp.path, cursorUpdated: String(fixedUpdated) })}`,
        )
        expect(onlyUpdated.status).toBe(400)

        const onlySession = await Server.App().request(
          `/session/global?${new URLSearchParams({ directory: tmp.path, cursorSessionID: beta.id })}`,
        )
        expect(onlySession.status).toBe(400)

        const response = await Server.App().request(
          `/session/global?${new URLSearchParams({ directory: tmp.path, limit: "1" })}`,
        )
        expect(response.status).toBe(200)
        const body = (await response.json()) as Session.GlobalInfo[]
        expect(body).toHaveLength(1)
        expect(response.headers.get("x-next-cursor-updated")).toBe(String(fixedUpdated))
        expect(response.headers.get("x-next-cursor-session-id")).toBe(body[0].id)

        const nextResponse = await Server.App().request(
          `/session/global?${new URLSearchParams({
            directory: tmp.path,
            limit: "10",
            cursorUpdated: response.headers.get("x-next-cursor-updated") ?? "",
            cursorSessionID: response.headers.get("x-next-cursor-session-id") ?? "",
          })}`,
        )
        expect(nextResponse.status).toBe(200)
        const nextBody = (await nextResponse.json()) as Session.GlobalInfo[]
        expect(nextBody.map((session) => session.id)).toEqual(
          [alpha.id, beta.id].sort((left, right) => right.localeCompare(left)).slice(1),
        )
      },
    })
  })
})
