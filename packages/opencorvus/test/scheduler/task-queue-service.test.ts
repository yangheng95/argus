import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function result() {
  return {
    info: {} as never,
    parts: [],
  } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
}

describe("scheduler.task-queue-service", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
  })

  test("executes queued prompt task", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "hello queue",
              },
            ],
          },
          source: "test",
        })
        await TaskQueueService.runNow()
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(row?.status).toBe("completed")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("retries on failure and marks failed after max retries", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("boom"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "retry me",
              },
            ],
          },
          maxRetries: 1,
          source: "test",
        })

        await TaskQueueService.runNow()
        const first = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(first?.status).toBe("retrying")
        expect(first?.retry_count).toBe(1)

        await TaskQueueService.runNow()
        const second = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(second?.status).toBe("failed")
        expect(second?.retry_count).toBe(2)
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test("poll only processes tasks for current project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    let id = ""

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const session = await Session.create({})
        id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "other project",
              },
            ],
          },
          source: "test",
        })
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        await TaskQueueService.runNow()
      },
    })

    const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
    expect(row?.status).toBe("queued")
    expect(prompt).toHaveBeenCalledTimes(0)
  })
})
