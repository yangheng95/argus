import { afterEach, describe, expect, mock, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task conversation routes", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /task/:taskID/conversation preserves emittedAt for fidelity replays", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "hydrate fidelity replay",
            request: "hydrate fidelity replay",
            status: "active",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run(),
        )

        const session = await Session.create({
          kind: "assistant",
          title: "fidelity replay session",
        })

        await EngineProtocol.emit(Event.FidelityReviewCompleted, {
          taskID,
          sessionID: session.id,
          verdict: "faithful",
          issues: [],
          corrections: [],
          missingGoals: [],
          attempts: 1,
        }, { source: "test.server" })

        const response = await app.request(`/task/${taskID}/conversation`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          events?: Array<{
            type?: string
            emittedAt?: number
            timestamp?: number
            payload?: { sessionID?: string }
          }>
        }
        const event = body.events?.find((item) => item.type === "fidelity.review.completed")

        expect(event).toBeDefined()
        expect(event?.payload?.sessionID).toBe(session.id)
        expect(event?.emittedAt).toBeGreaterThan(0)
        expect(event?.emittedAt).toBe(event?.timestamp)
      },
    })
  })
})