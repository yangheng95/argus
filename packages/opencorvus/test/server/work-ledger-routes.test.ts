import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { WorkLedgerRoutes } from "../../src/server/routes/work-ledger"
import { serverErrorResponse } from "../../src/server/error-handler"
import { SessionTable } from "../../src/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("work ledger routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("GET /work-ledger returns unified Mission, Task, and Chat rows without duplicating Mission-owned tasks", async () => {
    await using tmp = await tmpdir()

    const app = new Hono().onError(serverErrorResponse).route("/work-ledger", WorkLedgerRoutes())
    const projectID = "proj-ledger"
    const missionID = "m-ledger"
    const missionSessionID = Identifier.ascending("session")
    const chatSessionID = Identifier.ascending("session")
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Ledger project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: missionSessionID,
          project_id: projectID,
          slug: "mission-ledger",
          directory: tmp.path,
          title: "Ledger mission",
          version: "local",
          kind: "mission",
          metadata: { mission: { id: missionID, channelKey: `mission:${missionID}`, cwd: tmp.path } },
          time_created: now,
          time_updated: now + 30,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: chatSessionID,
          project_id: projectID,
          slug: "chat-ledger",
          directory: tmp.path,
          title: "Ledger chat",
          version: "local",
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
          time_created: now,
          time_updated: now + 20,
        })
        .run()
    })

    function insertTask(input: {
      title: string
      source: string
      metadata?: Record<string, unknown>
      updated: number
    }) {
      const id = Identifier.ascending("task")
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id,
            project_id: projectID,
            source: input.source,
            title: input.title,
            request: input.title,
            metadata: input.metadata,
            time_created: now,
            time_updated: input.updated,
          })
          .run(),
      )
      return id
    }

    const missionTaskID = insertTask({
      title: "Mission child task",
      source: "mission",
      metadata: { actor: "mission", mission: { id: missionID, session_id: missionSessionID } },
      updated: now + 10,
    })
    const standaloneTaskID = insertTask({
      title: "Standalone task",
      source: "api",
      updated: now,
    })

    const response = await app.request("/work-ledger?limit=10")

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      rows: Array<
        | { kind: "mission"; id: string; tasks: Array<{ kind: "task"; id: string; missionID?: string }> }
        | { kind: "task"; id: string; missionID?: string }
        | { kind: "chat"; id: string; sessionID: string }
      >
      nextCursor: { updated: number; rowKey: string } | null
    }
    const missionRow = body.rows.find((row): row is Extract<(typeof body.rows)[number], { kind: "mission" }> => {
      return row.kind === "mission" && row.id === missionID
    })
    expect(missionRow).toBeDefined()
    expect(missionRow!.tasks.map((task) => task.id)).toEqual([missionTaskID])
    expect(missionRow!.tasks[0]?.missionID).toBe(missionID)

    const topLevelTasks = body.rows.filter(
      (row): row is Extract<(typeof body.rows)[number], { kind: "task" }> => row.kind === "task",
    )
    expect(topLevelTasks.map((row) => row.id)).toEqual([standaloneTaskID])
    expect(topLevelTasks.some((row) => row.id === missionTaskID)).toBe(false)

    const chatRow = body.rows.find((row) => row.kind === "chat")
    expect(chatRow).toMatchObject({ kind: "chat", id: chatSessionID, sessionID: chatSessionID })

    const childSearchResponse = await app.request("/work-ledger?limit=10&search=Mission%20child")
    expect(childSearchResponse.status).toBe(200)
    const childSearchBody = (await childSearchResponse.json()) as typeof body
    expect(childSearchBody.rows.map((row) => row.kind)).toEqual(["mission"])
    const childSearchMission = childSearchBody.rows[0]
    expect(childSearchMission?.kind).toBe("mission")
    if (childSearchMission?.kind !== "mission") throw new Error("expected child task search to return its Mission")
    expect(childSearchMission.tasks.map((task) => task.id)).toEqual([missionTaskID])
    expect(childSearchBody.rows.some((row) => row.kind === "task" && row.id === missionTaskID)).toBe(false)

    const standaloneSearchResponse = await app.request("/work-ledger?limit=10&search=Standalone")
    expect(standaloneSearchResponse.status).toBe(200)
    const standaloneSearchBody = (await standaloneSearchResponse.json()) as typeof body
    expect(standaloneSearchBody.rows.map((row) => (row.kind === "task" ? row.id : row.kind))).toEqual([
      standaloneTaskID,
    ])
  })
})
