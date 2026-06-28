import { afterEach, describe, expect, test } from "bun:test"
import {
  createAgentCoordinationRequest,
  findAgentCoordinationRequest,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

await Log.init({ print: false })

describe("task session cancel error contract", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("pending A2A coordination returns structured AgentSessionPendingCoordinationError", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "task root",
        })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "build",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "cancel build with pending A2A",
              request: "cancel build with pending A2A",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        SessionStatus.set(build.id, { type: "streaming" })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: build.id,
          agent: "build",
          messageID: "msg_http_cancel_pending_a2a",
          summary: "Worker asks to be cancelled",
          details: "The worker has explicitly asked the orchestrator to cancel it.",
          blocking: true,
          requestedDecision: "cancel_worker",
          now: now + 1,
        })

        const response = await app.request(`/task/${taskID}/session/${build.id}/cancel`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(409)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const body = (await response.json()) as {
          name: string
          data: { message: string; taskID: string; sessionID: string; requestIDs: string[] }
        }
        expect(body).toMatchObject({
          name: "AgentSessionPendingCoordinationError",
          data: {
            taskID,
            sessionID: build.id,
            requestIDs: [request.payload.request_id],
          },
        })
        expect(body.data.message).toContain("pending A2A")
        expect(body.data.message).toContain("respond_agent_coordination")
        expect(SessionStatus.get(build.id)).toEqual({ type: "streaming" })
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
      },
    })
  })
})
