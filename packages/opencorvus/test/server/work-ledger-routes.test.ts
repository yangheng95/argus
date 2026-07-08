import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { GlobalBus } from "../../src/bus/global"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { WorkLedgerRoutes } from "../../src/server/routes/work-ledger"
import { serverErrorResponse } from "../../src/server/error-handler"
import { Session, SessionStatus } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function sseReader(response: Response): { read: () => Promise<any>; cancel: () => Promise<void> } {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("SSE response body missing")
  const decoder = new TextDecoder()
  let buffer = ""
  return {
    read: async () => {
      while (true) {
        let boundary = buffer.indexOf("\n\n")
        let delimiterLength = 2
        const crlfBoundary = buffer.indexOf("\r\n\r\n")
        if (boundary < 0 || (crlfBoundary >= 0 && crlfBoundary < boundary)) {
          boundary = crlfBoundary
          delimiterLength = 4
        }
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + delimiterLength)
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trimStart())
            .join("\n")
          if (data) return JSON.parse(data)
          continue
        }
        const next = await reader.read()
        if (next.done) throw new Error("SSE stream ended before the expected event")
        buffer += decoder.decode(next.value, { stream: true })
      }
    },
    cancel: async () => {
      await reader.cancel()
      reader.releaseLock()
    },
  }
}

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

  test("GET /work-ledger/events emits when a Mission session becomes visible in the ledger", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = new Hono().onError(serverErrorResponse).route("/work-ledger", WorkLedgerRoutes())
    const response = await app.request("/work-ledger/events")
    expect(response.status).toBe(200)
    const stream = sseReader(response)

    expect(await stream.read()).toMatchObject({
      type: "work-ledger.connected",
      sourceType: "work-ledger.connected",
      sequence: 0,
    })

    const missionSessionID = Identifier.ascending("session")
    GlobalBus.emit("event", {
      payload: {
        type: Session.Event.Updated.type,
        properties: {
          info: {
            id: missionSessionID,
            slug: "ledger-live",
            version: "local",
            projectID: "proj-ledger-live",
            directory: tmp.path,
            title: "Live Mission",
            kind: "mission",
            metadata: {
              mission: { id: "m-ledger-live", channelKey: "mission:m-ledger-live", cwd: tmp.path },
            },
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      },
    })
    const event = await stream.read()
    expect(event).toMatchObject({
      type: "work-ledger.changed",
      sourceType: "session.updated",
      sessionID: missionSessionID,
    })
    expect(event.sequence).toBeGreaterThan(0)

    await stream.cancel()
  })

  test("GET /work-ledger/events emits when a visible Chat session status changes", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = new Hono().onError(serverErrorResponse).route("/work-ledger", WorkLedgerRoutes())
    const projectID = "proj-ledger-status"
    const chatSessionID = Identifier.ascending("session")
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Ledger status project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: chatSessionID,
          project_id: projectID,
          slug: "chat-ledger-status",
          directory: tmp.path,
          title: "Ledger status chat",
          version: "local",
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const response = await app.request("/work-ledger/events")
    expect(response.status).toBe(200)
    const stream = sseReader(response)

    expect(await stream.read()).toMatchObject({
      type: "work-ledger.connected",
      sourceType: "work-ledger.connected",
      sequence: 0,
    })

    GlobalBus.emit("event", {
      payload: {
        type: SessionStatus.Event.Status.type,
        properties: {
          sessionID: chatSessionID,
          status: { type: "streaming" },
        },
      },
    })

    const event = await stream.read()
    expect(event).toMatchObject({
      type: "work-ledger.changed",
      sourceType: "session.status",
      sessionID: chatSessionID,
    })
    expect(event.sequence).toBeGreaterThanOrEqual(now)

    await stream.cancel()
  })
})
