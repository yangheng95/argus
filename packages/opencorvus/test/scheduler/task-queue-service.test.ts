import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
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
    delete process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY
    delete process.env.OPENCORVUS_TASK_QUEUE_HEARTBEAT_MS
    delete process.env.OPENCORVUS_TASK_QUEUE_STALL_TIMEOUT_MS
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

  test("executes prompt immediately via shared executor", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await TaskQueueService.executePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "hello sync",
              },
            ],
          },
          source: "test",
        })
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

  test("retries reuse the same prompt ids", async () => {
    await using tmp = await tmpdir({ git: true })
    const calls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      calls.push(input)
      throw new Error("boom")
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "retry me twice",
              },
            ],
          },
          maxRetries: 1,
          source: "test",
        })

        await TaskQueueService.runNow()
        await TaskQueueService.runNow()
      },
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.messageID).toBeTruthy()
    expect(calls[1]?.messageID).toBe(calls[0]?.messageID)
    expect(calls[1]?.parts.map((part) => part.id)).toEqual(calls[0]?.parts.map((part) => part.id))
  })

  test("recover cancels stale running sessions before retry", async () => {
    await using tmp = await tmpdir({ git: true })
    const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => undefined)
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
                text: "resume after stale run",
              },
            ],
          },
          source: "test",
        })
        const past = Date.now() - 31 * 60 * 1000
        Database.use((db) =>
          db
            .update(TaskQueueTable)
            .set({
              status: "running",
              time_started: past,
              time_updated: past,
            })
            .where(eq(TaskQueueTable.id, id))
            .run(),
        )

        await TaskQueueService.runNow()

        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(row?.status).toBe("completed")
        expect(row?.retry_count).toBe(1)
        expect(cancel).toHaveBeenCalledWith(session.id)
        expect(prompt).toHaveBeenCalledTimes(1)
      },
    })
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

  test("runs queued tasks concurrently across sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "2"
    let running = 0
    let peak = 0
    const stub = async () => {
      running += 1
      peak = Math.max(peak, running)
      await Bun.sleep(40)
      running -= 1
      return result()
    }
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(stub as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({})
        const b = await Session.create({})
        TaskQueueService.enqueuePrompt({
          sessionID: a.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "A",
              },
            ],
          },
        })
        TaskQueueService.enqueuePrompt({
          sessionID: b.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "B",
              },
            ],
          },
        })
        await TaskQueueService.runNow()
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(peak).toBe(2)
  })

  test("only claims one task per session in a single run", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "4"
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    let first = ""
    let second = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        first = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "first",
              },
            ],
          },
        })
        second = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "second",
              },
            ],
          },
        })

        await TaskQueueService.runNow()
        const firstRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, first)).get(),
        )
        const secondRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, second)).get(),
        )
        expect(firstRow?.status).toBe("completed")
        expect(secondRow?.status).toBe("queued")

        await TaskQueueService.runNow()
        const finalRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, second)).get(),
        )
        expect(finalRow?.status).toBe("completed")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test("prefers high priority task over older low priority task in same session", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "1"
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    let high = ""
    let low = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        low = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "low",
              },
            ],
          },
          priority: "low",
        })
        high = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "high",
              },
            ],
          },
          priority: "high",
        })

        await TaskQueueService.runNow()
        const highRow = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, high)).get())
        const lowRow = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, low)).get())
        expect(highRow?.status).toBe("completed")
        expect(lowRow?.status).toBe("queued")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("scans deep queue and still picks another session", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "2"
    const seen: string[] = []
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation((async (
      input: Parameters<typeof SessionPrompt.prompt>[0],
    ) => {
      seen.push(input.sessionID)
      return result()
    }) as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({})
        const b = await Session.create({})
        const now = Date.now()
        const bulk = Array.from({ length: 340 }, (_, i) => ({
          id: `task_a_${i}_${Math.random().toString(36).slice(2)}`,
          session_id: a.id,
          prompt: `a-${i}`,
          priority: "high" as const,
          status: "queued" as const,
          source: "test",
          retry_count: 0,
          max_retries: 3,
          metadata: {
            kind: "session_prompt" as const,
            input: {
              parts: [{ type: "text", text: `a-${i}` }],
            },
          },
          time_created: now + i,
          time_updated: now + i,
        }))

        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values([
              ...bulk,
              {
                id: "task_b_" + Math.random().toString(36).slice(2),
                session_id: b.id,
                prompt: "b",
                priority: "high",
                status: "queued",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "b" }],
                  },
                },
                time_created: now + bulk.length + 1,
                time_updated: now + bulk.length + 1,
              },
            ])
            .run(),
        )

        await TaskQueueService.runNow()
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(new Set(seen).size).toBe(2)
  })

  test("does not claim queued task when same session already has running task", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const now = Date.now()
        const runningID = "task_running_" + Math.random().toString(36).slice(2)
        const queuedID = "task_queued_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values([
              {
                id: runningID,
                session_id: session.id,
                prompt: "running",
                status: "running",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "running" }],
                  },
                },
                time_created: now - 1000,
                time_updated: now,
                time_started: now,
              },
              {
                id: queuedID,
                session_id: session.id,
                prompt: "queued",
                status: "queued",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "queued" }],
                  },
                },
                time_created: now,
                time_updated: now,
              },
            ])
            .run(),
        )

        await TaskQueueService.runNow()
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, queuedID)).get())
        expect(row?.status).toBe("queued")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(0)
  })

  test("with concurrency=1 skips blocked session and executes another eligible session", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "1"
    const seen: string[] = []
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation((async (
      input: Parameters<typeof SessionPrompt.prompt>[0],
    ) => {
      seen.push(input.sessionID)
      return result()
    }) as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const blocked = await Session.create({})
        const ready = await Session.create({})
        const now = Date.now()
        const blockedRunning = "task_blocked_running_" + Math.random().toString(36).slice(2)
        const blockedQueued = "task_blocked_queued_" + Math.random().toString(36).slice(2)
        const readyQueued = "task_ready_queued_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values([
              {
                id: blockedRunning,
                session_id: blocked.id,
                prompt: "running",
                priority: "high",
                status: "running",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "running" }],
                  },
                },
                time_created: now - 2000,
                time_updated: now,
                time_started: now - 2000,
              },
              {
                id: blockedQueued,
                session_id: blocked.id,
                prompt: "blocked-queued",
                priority: "high",
                status: "queued",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "blocked-queued" }],
                  },
                },
                time_created: now - 1000,
                time_updated: now - 1000,
              },
              {
                id: readyQueued,
                session_id: ready.id,
                prompt: "ready-queued",
                priority: "normal",
                status: "queued",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "ready-queued" }],
                  },
                },
                time_created: now,
                time_updated: now,
              },
            ])
            .run(),
        )

        await TaskQueueService.runNow()

        const blockedRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, blockedQueued)).get(),
        )
        const readyRow = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, readyQueued)).get(),
        )
        expect(blockedRow?.status).toBe("queued")
        expect(readyRow?.status).toBe("completed")
        expect(seen).toEqual([ready.id])
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("recovery uses time_updated heartbeat for running tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    process.env.OPENCORVUS_TASK_QUEUE_RUN_TIMEOUT_MS = "1000"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const now = Date.now()
        const freshID = "task_fresh_" + Math.random().toString(36).slice(2)
        const staleID = "task_stale_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values([
              {
                id: freshID,
                session_id: session.id,
                prompt: "fresh",
                status: "running",
                source: "test",
                retry_count: 0,
                max_retries: 3,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "fresh" }],
                  },
                },
                time_created: now - 5000,
                time_updated: now,
                time_started: now - 5000,
              },
              {
                id: staleID,
                session_id: session.id,
                prompt: "stale",
                status: "running",
                source: "test",
                retry_count: 0,
                max_retries: 0,
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "stale" }],
                  },
                },
                time_created: now - 5000,
                time_updated: now - 5000,
                time_started: now - 5000,
              },
            ])
            .run(),
        )

        await TaskQueueService.runNow()
        const fresh = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, freshID)).get())
        const stale = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, staleID)).get())
        expect(fresh?.status).toBe("running")
        expect(stale?.status).toBe("failed")
      },
    })

    delete process.env.OPENCORVUS_TASK_QUEUE_RUN_TIMEOUT_MS
    expect(prompt).toHaveBeenCalledTimes(0)
  })

  test("retries stalled running prompt without session activity", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_STALL_TIMEOUT_MS = "1000"
    let reject: ((error: Error) => void) | undefined
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail as (error: Error) => void
        }) as ReturnType<typeof SessionPrompt.prompt>,
    )
    const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => {
      reject?.(new Error("Session cancelled"))
      return undefined
    })

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
                text: "stall me",
              },
            ],
          },
          source: "test",
        })
        await TaskQueueService.runNow()
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(row?.status).toBe("retrying")
        expect(row?.error_message).toBe("task stalled without session activity")
        expect(cancel).toHaveBeenCalledWith(session.id)
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("session activity keeps running prompt alive", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_STALL_TIMEOUT_MS = "1000"
    process.env.OPENCORVUS_TASK_QUEUE_HEARTBEAT_MS = "1000"
    const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => undefined)
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      await Bun.sleep(300)
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID,
        messageID: "msg_keepalive",
        partID: "prt_keepalive",
        field: "text",
        delta: "still running",
      })
      await Bun.sleep(300)
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID,
        messageID: "msg_keepalive",
        partID: "prt_keepalive",
        field: "text",
        delta: "and alive",
      })
      await Bun.sleep(300)
      return result()
    })

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
                text: "stay alive",
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
    expect(cancel).toHaveBeenCalledTimes(0)
  })
})
