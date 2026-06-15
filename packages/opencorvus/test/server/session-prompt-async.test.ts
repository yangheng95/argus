import { describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const TEST_MODEL = { providerID: "test", modelID: "test-model" }

describe("session prompt_async route", () => {
  test("mission session prompt_async preserves mission agent identity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "continue mission",
              },
            ],
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as {
          taskID: string
          user_message: { info: { id: string; agent?: string; channel?: string; resolvedRole?: string } }
        }
        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, json.taskID)).get(),
        )
        expect(row?.metadata.input).toMatchObject({
          agent: "mission",
          parts: [{ type: "text", text: "continue mission" }],
        })
        expect(json.user_message.info.agent).toBe("mission")
        expect(json.user_message.info.channel).toBe("main")
        expect(json.user_message.info.resolvedRole).toBe("user")
      },
    })
  })

  test("agent-owned session prompt_async preserves session kind as agent identity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "explore" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "continue investigation",
              },
            ],
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as {
          taskID: string
          user_message: { info: { id: string; agent?: string; channel?: string; resolvedRole?: string } }
        }
        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, json.taskID)).get(),
        )
        expect(row?.metadata.input).toMatchObject({
          agent: "explore",
          parts: [{ type: "text", text: "continue investigation" }],
        })
        expect(json.user_message.info.agent).toBe("explore")
        expect(json.user_message.info.channel).toBe("main")
        expect(json.user_message.info.resolvedRole).toBe("user")
      },
    })
  })

  test("mission session sync prompt preserves mission agent identity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "coding",
            model: { providerID: "test", modelID: "test-model" },
            noReply: true,
            parts: [
              {
                type: "text",
                text: "continue mission sync",
              },
            ],
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { info: { agent?: string } }
        expect(body.info.agent).toBe("mission")
      },
    })
  })

  test("returns taskID and enqueues queued task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as { taskID: string; user_message: { info: { id: string } } }
        expect(typeof json.taskID).toBe("string")
        expect(json.taskID.length).toBeGreaterThan(0)
        expect(typeof json.user_message.info.id).toBe("string")

        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, json.taskID)).get(),
        )
        expect(row?.status).toBe("queued")
        expect(row?.session_id).toBe(session.id)
        expect(row?.metadata.kind).toBe("session_wake")
        expect(row?.metadata.messageID).toBe(json.user_message.info.id)
      },
    })
  })

  test("prompt_async queue execution wakes the session without creating a duplicate user message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "queued visible prompt",
              },
            ],
          }),
        })

        expect(response.status).toBe(202)
        const { taskID, user_message } = (await response.json()) as {
          taskID: string
          user_message: { info: { id: string } }
        }
        const before = await Session.messages({ sessionID: session.id })
        expect(before.filter((message) => message.info.role === "user").map((message) => message.info.id)).toEqual([
          user_message.info.id,
        ])

        const loop = spyOn(SessionPrompt, "loop").mockResolvedValue({
          info: {
            id: "message_assistant_mock",
            sessionID: session.id,
            role: "assistant",
            parentID: user_message.info.id,
            time: { created: Date.now() },
            modelID: "mock",
            providerID: "mock",
            agent: "assistant",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [],
        } as never)
        try {
          await TaskQueueService.runNow()
          expect(loop).toHaveBeenCalledTimes(1)
        } finally {
          mock.restore()
        }

        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get())
        expect(row?.status).toBe("completed")
        const after = await Session.messages({ sessionID: session.id })
        expect(after.filter((message) => message.info.role === "user").map((message) => message.info.id)).toEqual([
          user_message.info.id,
        ])
      },
    })
  })

  test("returns task status for prompt_async task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()
        const created = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          }),
        })

        expect(created.status).toBe(202)
        const { taskID } = (await created.json()) as { taskID: string }
        const status = await app.request(`/session/${session.id}/prompt_async/${taskID}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(status.status).toBe(200)
        const body = (await status.json()) as {
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

  test("returns 404 when prompt_async task does not exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async/task_missing_123`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(404)
        const body = (await response.json()) as { message: string }
        expect(body.message).toContain("task_missing_123")
      },
    })
  })

  test("returns 404 when task exists but is not created by prompt_async route", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const taskID = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          },
          source: "test",
        })
        const app = Server.App()
        const response = await app.request(`/session/${session.id}/prompt_async/${taskID}`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(404)
      },
    })
  })

  test("session abort cancels queued prompt_async work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const app = Server.App()
        const created = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            model: TEST_MODEL,
            parts: [
              {
                type: "text",
                text: "queued prompt",
              },
            ],
          }),
        })

        expect(created.status).toBe(202)
        const { taskID } = (await created.json()) as { taskID: string }
        const aborted = await app.request(`/session/${session.id}/abort`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(aborted.status).toBe(200)

        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, taskID)).get())
        expect(row?.status).toBe("failed")
        expect(row?.error_message).toBe("session aborted")
      },
    })
  })
})
