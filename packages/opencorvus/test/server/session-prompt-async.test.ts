import { describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("session prompt_async route", () => {
  test("returns taskID and enqueues queued task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as { taskID: string }
        expect(typeof json.taskID).toBe("string")
        expect(json.taskID.length).toBeGreaterThan(0)

        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, json.taskID)).get())
        expect(row?.status).toBe("queued")
        expect(row?.session_id).toBe(session.id)
      },
    })
  })

  test("returns task status for prompt_async task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.App()
        const created = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          }),
        })

        expect(created.status).toBe(202)
        const { taskID } = await created.json() as { taskID: string }
        const status = await app.request(`/session/${session.id}/prompt_async/${taskID}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(status.status).toBe(200)
        const body = await status.json() as {
          taskID: string
          sessionID: string
          status: string
          retryCount: number
        }
        expect(body.taskID).toBe(taskID)
        expect(body.sessionID).toBe(session.id)
        expect(body.status).toBe("queued")
        expect(body.retryCount).toBe(0)
      },
    })
  })
})
