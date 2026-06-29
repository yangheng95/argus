import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { ensureMissionSession } from "../../src/mission/session"
import { Server } from "../../src/server/server"
import { Session, SessionStatus } from "../../src/session"
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
        const body = (await response.json()) as { missionID: string; sessionID: string; title: string }
        expect(body).toMatchObject({
          missionID: "m-rename",
          sessionID: session.id,
          title: "Renamed Mission",
        })
        expect((await Session.get(session.id)).title).toBe("Renamed Mission")
      },
    })
  })

  test("POST /mission/wake documents and returns bad request for unknown prompt profile", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mission/wake", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "start mission",
            promptProfile: "missing-profile",
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { success?: boolean; error?: Array<{ message?: string }> }
        expect(body.success).toBe(false)
        expect(body.error?.[0]?.message).toContain("Unknown prompt profile")
        const spec = await Server.openapi()
        expect(spec.paths?.["/mission/wake"]?.post?.responses?.[400]).toBeDefined()
      },
    })
  })

  test("Mission detail routes return named NotFoundError for missing Mission sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const requests: Array<{ method: string; path: string; headers?: Record<string, string>; body?: string }> = [
          { method: "GET", path: "/mission/m-missing/status" },
          { method: "GET", path: "/mission/m-missing/project-archive" },
          {
            method: "PATCH",
            path: "/mission/m-missing/title",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Missing Mission" }),
          },
          { method: "POST", path: "/mission/m-missing/abort" },
          { method: "DELETE", path: "/mission/m-missing" },
        ]

        for (const request of requests) {
          const response = await app.request(request.path, {
            method: request.method,
            headers: {
              "x-opencorvus-directory": tmp.path,
              ...request.headers,
            },
            body: request.body,
          })

          expect(response.status).toBe(404)
          expect((await response.json()) as { name?: string }).toMatchObject({ name: "NotFoundError" })
        }
      },
    })
  })

  test("GET /mission projects mission-created tasks and scoped stats", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-tasks", defaultCwd: tmp.path })
        const other = await ensureMissionSession({ missionID: "m-other", defaultCwd: tmp.path })
        SessionStatus.set(session.id, { type: "streaming" }, { publish: false })
        const now = Date.now()

        function insertTask(input: {
          title: string
          source: string
          metadata: Record<string, unknown>
          started?: number | null
          completed?: number | null
          error?: string | null
        }) {
          const id = Identifier.ascending("task")
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id,
                project_id: Instance.project.id,
                source: input.source,
                title: input.title,
                request: input.title,
                metadata: input.metadata,
                time_started: input.started ?? null,
                time_completed: input.completed ?? null,
                error: input.error ?? null,
                time_created: now,
                time_updated: now + id.length,
              })
              .run(),
          )
          return id
        }

        const queuedTaskID = insertTask({
          title: "Mission queued task",
          source: "mission",
          metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
        })
        const completedTaskID = insertTask({
          title: "Mission completed task",
          source: "mission",
          metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
          started: now,
          completed: now + 1000,
        })
        insertTask({
          title: "Other mission task",
          source: "mission",
          metadata: { actor: "mission", mission: { id: other.missionID, session_id: other.id } },
          started: now,
        })
        insertTask({
          title: "Forged mission metadata",
          source: "panel",
          metadata: { actor: "panel_ui", mission: { id: session.missionID, session_id: session.id } },
          started: now,
        })

        const response = await app.request("/mission", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Array<{
          missionID: string
          interruptible: boolean
          tasks: Array<{ id: string; title: string; status: string }>
          taskStats: Record<string, number>
        }>
        const record = body.find((item) => item.missionID === session.missionID)
        expect(record).toBeDefined()
        expect(record!.interruptible).toBe(true)
        expect(record!.tasks.map((task) => task.id).sort()).toEqual([queuedTaskID, completedTaskID].sort())
        expect(record!.tasks.map((task) => task.title).sort()).toEqual([
          "Mission completed task",
          "Mission queued task",
        ])
        expect(record!.taskStats).toMatchObject({
          total: 2,
          queued: 1,
          active: 0,
          completed: 1,
          failed: 0,
          cancelled: 0,
        })
      },
    })
  })

  test("GET /mission/:missionID/status and /task/:taskID/status expose normalized queued progress details", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-status", defaultCwd: tmp.path })
        const now = Date.now()

        function insertTask(input: { title: string; started?: number | null; completed?: number | null }) {
          const id = Identifier.ascending("task")
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id,
                project_id: Instance.project.id,
                source: "mission",
                title: input.title,
                request: input.title,
                metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
                time_started: input.started ?? null,
                time_completed: input.completed ?? null,
                time_created: now,
                time_updated: now + id.length,
              })
              .run(),
          )
          return id
        }

        const queuedTaskID = insertTask({ title: "Mission queued status task" })
        const completedTaskID = insertTask({
          title: "Mission completed status task",
          started: now - 4000,
          completed: now - 1000,
        })

        const missionResponse = await app.request("/mission/m-status/status", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(missionResponse.status).toBe(200)
        const mission = (await missionResponse.json()) as any
        expect(mission).toMatchObject({
          missionID: "m-status",
          sessionID: session.id,
          status: "running",
          taskCounts: {
            total: 2,
            success: 1,
            failed: 0,
            running: 1,
          },
          progress: {
            total: 2,
            completed: 1,
            failed: 0,
            running: 1,
            pending: 0,
            percent: 50,
          },
        })
        const queuedTask = mission.tasks.find((task: any) => task.taskID === queuedTaskID)
        expect(queuedTask).toMatchObject({
          taskID: queuedTaskID,
          status: "running",
          lifecycleStatus: "queued",
          goals: [],
        })
        expect(mission.tasks.find((task: any) => task.taskID === completedTaskID)).toMatchObject({
          status: "success",
          lifecycleStatus: "completed",
        })

        const taskResponse = await app.request(`/task/${queuedTaskID}/status`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(taskResponse.status).toBe(200)
        const task = (await taskResponse.json()) as any
        expect(task).toMatchObject({
          taskID: queuedTaskID,
          status: "running",
          lifecycleStatus: "queued",
          goals: [],
        })
      },
    })
  })

  test("GET /mission/:missionID/status reports zero progress for a Mission without tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-empty-status", defaultCwd: tmp.path })

        const response = await app.request("/mission/m-empty-status/status", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          missionID: "m-empty-status",
          sessionID: session.id,
          status: "running",
          taskCounts: {
            total: 0,
            success: 0,
            failed: 0,
            running: 0,
          },
          progress: {
            total: 0,
            completed: 0,
            failed: 0,
            running: 0,
            pending: 0,
            percent: 0,
          },
          tasks: [],
        })
      },
    })
  })

  test("POST /mission/:missionID/abort cancels the Mission session prompt and active child tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-abort", defaultCwd: tmp.path })
        SessionStatus.set(session.id, { type: "streaming" }, { publish: false })
        const now = Date.now()
        const queuedTaskID = Identifier.ascending("task")
        const completedTaskID = Identifier.ascending("task")
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values([
              {
                id: queuedTaskID,
                project_id: Instance.project.id,
                source: "mission",
                title: "Mission queued child",
                request: "queued child",
                metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
                time_started: null,
                time_completed: null,
                error: null,
                time_created: now,
                time_updated: now,
              },
              {
                id: completedTaskID,
                project_id: Instance.project.id,
                source: "mission",
                title: "Mission completed child",
                request: "completed child",
                metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
                time_started: now,
                time_completed: now + 1,
                error: null,
                time_created: now + 1,
                time_updated: now + 1,
              },
            ])
            .run()
        })
        const cancel = spyOn(SessionPrompt, "cancel").mockImplementation((sessionID) => {
          SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" }, { publish: false })
          return true
        })

        const response = await app.request("/mission/m-abort/abort", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id, tmp.path)
        const queuedTask = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, queuedTaskID)).get(),
        )
        expect(queuedTask?.time_completed).not.toBeNull()
        expect(queuedTask?.error).toBe("task cancelled")
        expect((queuedTask?.metadata as Record<string, unknown> | null)?.cancelled).toBe(true)
        const completedTask = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, completedTaskID)).get(),
        )
        expect(completedTask?.error).toBeNull()
        expect((completedTask?.metadata as Record<string, unknown> | null)?.cancelled).not.toBe(true)
        const list = await app.request("/mission", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(list.status).toBe(200)
        const rows = (await list.json()) as Array<{ missionID: string; interruptible: boolean }>
        expect(rows.find((row) => row.missionID === "m-abort")).toMatchObject({
          missionID: "m-abort",
          interruptible: false,
        })
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
        expect(
          Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get()),
        ).toBeUndefined()
      },
    })
  })

  test("DELETE /mission/:missionID uses the explicit row directory to disambiguate global ledger rows", async () => {
    await using alpha = await tmpdir({ git: true })
    await using beta = await tmpdir({ git: true })

    const alphaSession = await Instance.provide({
      directory: alpha.path,
      fn: () => ensureMissionSession({ missionID: "m-shared", defaultCwd: alpha.path }),
    })
    const betaSession = await Instance.provide({
      directory: beta.path,
      fn: () => ensureMissionSession({ missionID: "m-shared", defaultCwd: beta.path }),
    })

    const app = Server.App()
    const response = await app.request(`/mission/m-shared?directory=${encodeURIComponent(alpha.path)}`, {
      method: "DELETE",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    expect(
      Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, alphaSession.id)).get()),
    ).toBeUndefined()
    expect(
      Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, betaSession.id)).get()),
    ).toBeDefined()
  }, 15_000)

  test("DELETE /mission/:missionID follows the listed row directory when project identity drifted", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const sessionID = Identifier.ascending("session")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-stale-mission-row",
          name: "Stale Mission Row",
          worktree: tmp.path,
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: "project-stale-mission-row",
          slug: "stale-mission-row",
          directory: tmp.path,
          title: "Stale Mission Row",
          version: "0.0.1",
          kind: "mission",
          metadata: { mission: { id: "m-stale-row", channelKey: "mission:m-stale-row", cwd: tmp.path } },
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const app = Server.App()
    const list = await app.request(`/mission?directory=${encodeURIComponent(tmp.path)}`, { method: "GET" })
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject([{ missionID: "m-stale-row", sessionID, directory: tmp.path }])

    const response = await app.request(`/mission/m-stale-row?directory=${encodeURIComponent(tmp.path)}`, {
      method: "DELETE",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    expect(
      Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()),
    ).toBeUndefined()
  }, 15_000)

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
