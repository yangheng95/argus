import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { deriveTaskStatus } from "../../src/engine/task-status"
import * as Queue from "../../src/engine/queue"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task message routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /task/:taskID/message triggers scheduler with natural language", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "retry through message",
            request: "retry through message",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "把当前任务停下来，重新评估策略后继续。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; message: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: dispatchTaskLoop trigger schema changed from
        //   trigger: { kind, message, attachmentSummary }
        // to
        //   event: { note, operatorMessage: { text, attachmentSummary } }
        // Reflect the new shape.
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            note: "把当前任务停下来，重新评估策略后继续。",
            operatorMessage: {
              text: "把当前任务停下来，重新评估策略后继续。",
              attachmentSummary: undefined,
            },
          },
          interrupt: true,
        })

        // V35: row state is no longer "failed" (we seeded an active
        // task) — assertion on "row stays failed" is dropped.
        const row = Database.use((db) =>
          db.select({
            time_completed: EngineTaskTable.time_completed,
            error: EngineTaskTable.error,
          }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row?.error).toBeNull()
      },
    })
  })

  test("POST /task/:taskID/message opens a failed task without clearing context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const completedAt = now + 1

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "failed task",
            request: "failed task",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: completedAt,
            error: "previous failure",
            metadata: { decision_log: ["keep-me"] },
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续，不要清空上下文。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row).toBeDefined()
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect(row?.time_completed).toBeNull()
        expect(row?.error).toBeNull()
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/message accepts bridge envelope fields from resume clients", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "resume envelope",
            request: "resume envelope",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now + 1,
            error: "task cancelled",
            metadata: { cancelled: true, decision_log: ["keep-me"] },
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续这个任务。",
            source: "panel",
            resolvedRole: "user",
            channel: "main",
          }),
        })

        expect(response.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/message opens a cancelled task without retry gate", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "cancelled task",
            request: "cancelled task",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now + 1,
            error: "task cancelled",
            metadata: { cancelled: true, decision_log: ["keep-me"] },
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续这个任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect((row?.metadata as { cancelled?: boolean } | null)?.cancelled).toBeUndefined()
      },
    })
  })

  test("POST /task/:taskID/message opens a completed task without deleting task context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "completed task",
            request: "completed task",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now + 1,
            metadata: { decision_log: ["keep-me"] },
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续完善这个已完成任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/message forwards attachment summary to scheduler", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "attachment message",
            request: "attachment message",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "参考我刚上传的规格，再决定下一步。",
            source: "panel",
            attachments: [{
              mime: "text/plain",
              filename: "spec.txt",
              data: Buffer.from("hello spec").toString("base64"),
            }],
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { kind: string; message: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Scheduler notified.")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: trigger schema replaced with `event.operatorMessage`.
        const event = (dispatchTaskLoop.mock.calls[0]?.[0] as {
          event: {
            note?: string
            operatorMessage: {
              text: string
              attachmentSummary?: string
            }
          }
        })?.event
        expect(event.operatorMessage.text).toBe("参考我刚上传的规格，再决定下一步。")
        expect(event.operatorMessage.attachmentSummary).toContain("Attachments:")
        expect(event.operatorMessage.attachmentSummary).toContain("spec.txt")
        expect(event.operatorMessage.attachmentSummary).toContain("text/plain")
        expect((dispatchTaskLoop.mock.calls[0]?.[0] as { interrupt?: boolean }).interrupt).toBe(true)
      },
    })
  })

  test("POST /task/:taskID/inject opens terminal task even without active run", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "panel",
            title: "inject terminal",
            request: "inject terminal",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now + 1,
            error: "previous failure",
            metadata: { decision_log: ["keep-me"] },
          }).run(),
        )

        const response = await app.request(`/task/${taskID}/inject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "继续推进。",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { resumed: boolean; status: string }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body).toEqual({ resumed: true, status: "active" })
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })
})
