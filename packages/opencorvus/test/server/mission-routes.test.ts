import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
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

  test("GET /mission projects mission-created tasks and scoped stats", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await ensureMissionSession({ missionID: "m-tasks", defaultCwd: tmp.path })
        const other = await ensureMissionSession({ missionID: "m-other", defaultCwd: tmp.path })
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

        const activeTaskID = insertTask({
          title: "Mission active task",
          source: "mission",
          metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
          started: now,
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
          tasks: Array<{ id: string; title: string; status: string }>
          taskStats: Record<string, number>
        }>
        const record = body.find((item) => item.missionID === session.missionID)
        expect(record).toBeDefined()
        expect(record!.tasks.map((task) => task.id).sort()).toEqual([activeTaskID, completedTaskID].sort())
        expect(record!.tasks.map((task) => task.title).sort()).toEqual([
          "Mission active task",
          "Mission completed task",
        ])
        expect(record!.taskStats).toMatchObject({
          total: 2,
          queued: 0,
          active: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
        })
      },
    })
  })

  test("GET /mission/:missionID/status and /task/:taskID/status expose normalized progress details", async () => {
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

        const activeTaskID = insertTask({ title: "Mission active status task", started: now - 2000 })
        const completedTaskID = insertTask({
          title: "Mission completed status task",
          started: now - 4000,
          completed: now - 1000,
        })
        const goalID = Identifier.ascending("goal")
        const runID = Identifier.ascending("run")
        const goalRunID = Identifier.ascending("goal_run")
        Database.use((db) => {
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: activeTaskID,
              title: "Implement status API",
              slug: "implement-status-api",
              objective: "Expose detailed mission and task status snapshots.",
              order_index: 0,
              time_created: now,
              time_updated: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: goalRunID,
              task_id: activeTaskID,
              run_id: runID,
              goal_run_id: goalRunID,
              kind: "goal_run_attempt",
              label: "running-goal",
              payload: {
                goal_id: goalID,
                status: "running",
                retry_count: 0,
                time_started: now - 1500,
              },
              time_created: now - 1500,
              time_updated: now - 1500,
            })
            .run()
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
        const activeTask = mission.tasks.find((task: any) => task.taskID === activeTaskID)
        expect(activeTask).toMatchObject({
          taskID: activeTaskID,
          status: "running",
          lifecycleStatus: "active",
          goals: [
            {
              goalID,
              title: "Implement status API",
              status: "running",
              rawStatus: "running",
              progress: {
                running: 1,
              },
            },
          ],
        })
        expect(mission.tasks.find((task: any) => task.taskID === completedTaskID)).toMatchObject({
          status: "success",
          lifecycleStatus: "completed",
        })

        const taskResponse = await app.request(`/task/${activeTaskID}/status`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(taskResponse.status).toBe(200)
        const task = (await taskResponse.json()) as any
        expect(task).toMatchObject({
          taskID: activeTaskID,
          status: "running",
          lifecycleStatus: "active",
        })
        expect(task.goals[0]).toMatchObject({
          goalID,
          status: "running",
          steps: [
            {
              status: "running",
              rawStatus: "running",
            },
          ],
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
