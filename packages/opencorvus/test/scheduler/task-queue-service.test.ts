import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Session } from "../../src/session"
import { SessionControl } from "../../src/session/control"
import { SessionPrompt } from "../../src/session/prompt"
import { Scheduler } from "../../src/scheduler"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { expectNoProcessErrors } from "../fixture/process-errors"

function result() {
  return {
    info: {} as never,
    parts: [],
  } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function createSourceUserMessage(sessionID: string, text = "compact source") {
  const info = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "assistant",
    model: { providerID: "test", modelID: "test-model" },
  })
  if (info.role !== "user") throw new Error(`expected user source message, got ${info.role}`)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: info.id,
    type: "text",
    text,
  })
  return info
}

async function waitForQueueStatus(id: string, status: string) {
  for (let i = 0; i < 50; i += 1) {
    const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
    if (row?.status === status) return row
    await Bun.sleep(10)
  }
  const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
  throw new Error(`queue task ${id} did not reach ${status}; current=${row?.status ?? "missing"}`)
}

async function waitUntil(fn: () => boolean, label: string) {
  for (let i = 0; i < 50; i += 1) {
    if (fn()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe("scheduler.task-queue-service", () => {
  afterEach(async () => {
    delete process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY
    mock.restore()
    await Instance.disposeAll()
  })

  test("init does not register a background task-flow poller", async () => {
    await using tmp = await tmpdir({ git: true })
    const register = spyOn(Scheduler, "register")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TaskQueueService.init()
      },
    })

    expect(register).not.toHaveBeenCalled()
  })

  test("enqueue explicitly starts prompt execution without caller-side runNow", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "start from enqueue",
              },
            ],
          },
          source: "test",
        })
        const row = await waitForQueueStatus(id, "completed")
        expect(row?.status).toBe("completed")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("background prompt failure is recorded without process-level rejection", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("prompt failed"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        await expectNoProcessErrors(async () => {
          const id = TaskQueueService.enqueuePrompt({
            sessionID: session.id,
            prompt: {
              parts: [{ type: "text", text: "fail from background drain" }],
            },
            source: "test",
          })
          const row = await waitForQueueStatus(id, "failed")
          expect(row?.error_message).toBe("prompt failed")
        })
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("executes queued prompt task", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
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
        expect(prompt.mock.calls[0]?.[0]?.extra?.wake_reason).toEqual({
          source: "scheduler.task_queue",
          queueTaskID: id,
          queueSource: "test",
        })
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
        const session = await Session.create({ kind: "assistant" })
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
    expect(prompt.mock.calls[0]?.[0]?.extra?.wake_reason).toEqual({
      source: "scheduler.task_queue",
      queueSource: "test",
    })
  })

  test("executes automatic compaction through session control and default loop mode", async () => {
    await using tmp = await tmpdir({ git: true })
    const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(result() as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const source = await createSourceUserMessage(session.id)
        const beforeUsers = (await Session.messages({ sessionID: session.id }))
          .filter((message) => message.info.role === "user")
          .map((message) => message.info.id)

        await TaskQueueService.executeCompaction({
          sessionID: session.id,
          sourceUserMessageID: source.id,
          auto: true,
          overflow: true,
        })

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0]).toMatchObject({
          kind: "compaction_request",
          payload: {
            source_user_message_id: source.id,
            overflow: true,
          },
        })
        expect(loop).toHaveBeenCalledWith({ sessionID: session.id })

        const afterUsers = (await Session.messages({ sessionID: session.id }))
          .filter((message) => message.info.role === "user")
          .map((message) => message.info.id)
        expect(afterUsers).toEqual(beforeUsers)
      },
    })
  })

  test("queued manual compaction stores scheduler intent and drains through summary loop mode", async () => {
    await using tmp = await tmpdir({ git: true })
    const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(result() as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const source = await createSourceUserMessage(session.id, "queued compact source")
        const beforeUsers = (await Session.messages({ sessionID: session.id })).filter(
          (message) => message.info.role === "user",
        )

        const id = TaskQueueService.enqueueCompaction({
          sessionID: session.id,
          sourceUserMessageID: source.id,
          model: { providerID: "test", modelID: "test-model" },
          priority: "high",
          source: "test.compaction",
          focus: "queued compact",
        })
        const created = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(created?.metadata).toMatchObject({
          kind: "session_compaction",
          input: {
            sourceUserMessageID: source.id,
            auto: false,
            overflow: false,
            model: { providerID: "test", modelID: "test-model" },
            focus: "queued compact",
          },
        })
        expect(created?.previous_summary).toBeNull()

        const completed = await waitForQueueStatus(id, "completed")
        expect(completed?.source).toBe("test.compaction")
        expect(SessionControl.pending(session.id).map((control) => control.kind)).toEqual(["manual_summarize"])
        expect(loop).toHaveBeenCalledWith({ sessionID: session.id, result_mode: "summary" })

        const afterUsers = (await Session.messages({ sessionID: session.id })).filter(
          (message) => message.info.role === "user",
        )
        expect(afterUsers.map((message) => message.info.id)).toEqual(beforeUsers.map((message) => message.info.id))
      },
    })
  })

  test("direct queued prompt preserves agent-owned session identity", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission" })
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "mission queue",
              },
            ],
          },
          source: "test",
        })
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(row?.metadata.input).toMatchObject({
          agent: "mission",
          parts: [{ type: "text", text: "mission queue" }],
        })
        await TaskQueueService.runNow()
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("direct execute prompt preserves agent-owned session identity", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "explore" })
        await TaskQueueService.executePrompt({
          sessionID: session.id,
          prompt: {
            agent: "coding",
            parts: [
              {
                type: "text",
                text: "explore execute",
              },
            ],
          },
          source: "test",
        })
      },
    })

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "explore",
      }),
    )
  })

  test("marks prompt failure failed without automatic retry", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("boom"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [
              {
                type: "text",
                text: "fail once",
              },
            ],
          },
          source: "test",
        })

        await TaskQueueService.runNow()
        const first = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(first?.status).toBe("failed")

        await TaskQueueService.runNow()
        const second = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(second?.status).toBe("failed")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("marks queued compaction failure failed without automatic retry", async () => {
    await using tmp = await tmpdir({ git: true })
    const loop = spyOn(SessionPrompt, "loop").mockRejectedValue(new Error("compact failed"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const source = await createSourceUserMessage(session.id, "compact once")
        const id = TaskQueueService.enqueueCompaction({
          sessionID: session.id,
          sourceUserMessageID: source.id,
          source: "test.compaction.failure",
        })

        const first = await waitForQueueStatus(id, "failed")
        expect(first?.error_message).toBe("compact failed")

        await TaskQueueService.runNow()
        const second = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(second?.status).toBe("failed")
      },
    })

    expect(loop).toHaveBeenCalledTimes(1)
  })

  test("publishes session error when queued prompt reaches terminal failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("provider rejected request"))
    const errors: Array<{ sessionID?: string; message?: string }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stop = Bus.subscribe(Session.Event.Error, (event) => {
          errors.push({
            sessionID: event.properties.sessionID,
            message: event.properties.error?.data?.message,
          })
        })
        try {
          const session = await Session.create({ kind: "assistant" })
          TaskQueueService.enqueuePrompt({
            sessionID: session.id,
            prompt: {
              parts: [
                {
                  type: "text",
                  text: "fail visibly",
                },
              ],
            },
            source: "test",
          })

          await TaskQueueService.runNow()
          expect(errors).toEqual([{ sessionID: session.id, message: "provider rejected request" }])
        } finally {
          stop()
        }
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("explicit drain only processes tasks for current project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    let id = ""

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const now = Date.now()
        id = "task_other_project_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values({
              id,
              session_id: session.id,
              prompt: "other project",
              status: "queued",
              source: "test",
              metadata: {
                kind: "session_prompt",
                input: {
                  parts: [{ type: "text", text: "other project" }],
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
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

  test("prefers high priority task over older low priority task in same session", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "1"
    const seen: string[] = []
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation((async (
      input: Parameters<typeof SessionPrompt.prompt>[0],
    ) => {
      const text = input.parts.find((part) => part.type === "text")?.text
      if (text) seen.push(text)
      return result()
    }) as never)
    let high = ""
    let low = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const now = Date.now()
        low = "task_low_" + Math.random().toString(36).slice(2)
        high = "task_high_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values([
              {
                id: low,
                session_id: session.id,
                prompt: "low",
                priority: "low",
                status: "queued",
                source: "test",
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "low" }],
                  },
                },
                time_created: now,
                time_updated: now,
              },
              {
                id: high,
                session_id: session.id,
                prompt: "high",
                priority: "high",
                status: "queued",
                source: "test",
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "high" }],
                  },
                },
                time_created: now + 1,
                time_updated: now + 1,
              },
            ])
            .run(),
        )

        await TaskQueueService.runNow()
        const highRow = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, high)).get())
        const lowRow = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, low)).get())
        expect(highRow?.status).toBe("completed")
        expect(lowRow?.status).toBe("completed")
        expect(seen).toEqual(["high", "low"])
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
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
        const a = await Session.create({ kind: "assistant" })
        const b = await Session.create({ kind: "assistant" })
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

  test("claims new session work while earlier tasks are still running", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "2"
    let releaseFirst: (() => void) | undefined
    let firstStarted: (() => void) | undefined
    let secondStarted: (() => void) | undefined
    const firstRunning = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const secondRunning = new Promise<void>((resolve) => {
      secondStarted = resolve
    })
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({ kind: "assistant" })
        const second = await Session.create({ kind: "assistant" })
        const prompt = spyOn(SessionPrompt, "prompt").mockImplementation((async (
          input: Parameters<typeof SessionPrompt.prompt>[0],
        ) => {
          if (input.sessionID === first.id) {
            firstStarted?.()
            await firstReleased
          }
          if (input.sessionID === second.id) {
            secondStarted?.()
          }
          return result()
        }) as never)

        TaskQueueService.enqueuePrompt({
          sessionID: first.id,
          prompt: {
            parts: [{ type: "text", text: "first" }],
          },
        })
        const firstRun = TaskQueueService.runNow()
        await firstRunning

        TaskQueueService.enqueuePrompt({
          sessionID: second.id,
          prompt: {
            parts: [{ type: "text", text: "second" }],
          },
        })
        const secondRun = TaskQueueService.runNow()

        await Promise.race([
          secondRunning,
          Bun.sleep(250).then(() => {
            throw new Error("second task was not claimed while the first task was still running")
          }),
        ])

        releaseFirst?.()
        await Promise.all([firstRun, secondRun])
        expect(prompt).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("completion event advances queued work in the same session", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_TASK_QUEUE_CONCURRENCY = "4"
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())
    let first = ""
    let second = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
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
        expect(secondRow?.status).toBe("completed")
      },
    })

    expect(prompt).toHaveBeenCalledTimes(2)
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
        const a = await Session.create({ kind: "assistant" })
        const b = await Session.create({ kind: "assistant" })
        const now = Date.now()
        const bulk = Array.from({ length: 40 }, (_, i) => ({
          id: `task_a_${i}_${Math.random().toString(36).slice(2)}`,
          session_id: a.id,
          prompt: `a-${i}`,
          priority: "high" as const,
          status: "queued" as const,
          source: "test",
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

    expect(prompt).toHaveBeenCalledTimes(41)
    expect(new Set(seen).size).toBe(2)
    expect(new Set(seen.slice(0, 2)).size).toBe(2)
  })

  test("does not claim queued task when same session already has running task", async () => {
    await using tmp = await tmpdir({ git: true })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
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

  test("cancelSessionPrompts stops claimed in-flight wake before it starts a loop", async () => {
    await using tmp = await tmpdir({ git: true })
    const releaseGet = deferred()
    let getBlocked = false
    let sessionID = ""
    const originalGet = Session.get
    const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(result() as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        sessionID = session.id
        const get = spyOn(Session, "get").mockImplementation((async (id: string) => {
          if (id === sessionID && !getBlocked) {
            getBlocked = true
            await releaseGet.promise
          }
          return originalGet(id)
        }) as never)
        const now = Date.now()
        const id = "task_claimed_cancel_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values({
              id,
              session_id: sessionID,
              prompt: "claimed wake",
              priority: "normal",
              status: "queued",
              source: "test",
              metadata: {
                kind: "session_wake",
                messageID: Identifier.ascending("message"),
                input: { parts: [{ type: "text", text: "claimed wake" }] },
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const run = TaskQueueService.runNow()
        await waitForQueueStatus(id, "running")
        await waitUntil(() => getBlocked, "claimed wake Session.get")
        const cancelled = TaskQueueService.cancelSessionPrompts({
          sessionIDs: [sessionID],
          reason: "task cancelled",
        })
        releaseGet.resolve()
        await run

        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(cancelled).toBe(1)
        expect(row).toMatchObject({
          status: "failed",
          error_message: "task cancelled",
        })
        expect(loop).toHaveBeenCalledTimes(0)
        expect(get).toHaveBeenCalled()
      },
    })
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
        const blocked = await Session.create({ kind: "assistant" })
        const ready = await Session.create({ kind: "assistant" })
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
    // The OPENCORVUS_TASK_QUEUE_RUN_TIMEOUT_MS env var was retired in favor
    // of the single-source `assistant.activity.task_queue_run_timeout_ms`
    // config field (rule 25 — one place to adjust). Inject via tmpdir's
    // config option so EngineConfig.get() picks it up; setting the env var
    // is a no-op now and silently leaves the default 600_000ms in place,
    // which is the bug the old skip annotation misattributed to
    // "Question.ask cross-file pollution".
    await using tmp = await tmpdir({
      git: true,
      config: { assistant: { activity: { task_queue_run_timeout_ms: 1000 } } },
    })
    const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(result())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
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

    expect(prompt).toHaveBeenCalledTimes(0)
  })

  test("recovery releases stale in-flight prompt promises that stop producing activity", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { assistant: { activity: { task_queue_run_timeout_ms: 1000 } } },
    })
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation((async () => {
      await new Promise<never>(() => {})
    }) as never)
    const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant" })
        const id = TaskQueueService.enqueuePrompt({
          sessionID: session.id,
          prompt: {
            parts: [{ type: "text", text: "hang without activity" }],
          },
          source: "test",
        })
        await waitForQueueStatus(id, "running")
        await Bun.sleep(1100)

        const outcome = await Promise.race([
          TaskQueueService.runNow().then(() => "resolved" as const),
          Bun.sleep(3_000).then(() => "timed-out" as const),
        ])

        expect(outcome).toBe("resolved")
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
        expect(row?.status).toBe("failed")
        expect(row?.error_message).toBe("task timed out while running")
        expect(cancel).toHaveBeenCalledWith(session.id, tmp.path)
      },
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("publishes session error when stale running task reaches terminal failure", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { assistant: { activity: { task_queue_run_timeout_ms: 1000 } } },
    })
    const errors: Array<{ sessionID?: string; message?: string }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stop = Bus.subscribe(Session.Event.Error, (event) => {
          errors.push({
            sessionID: event.properties.sessionID,
            message: event.properties.error?.data?.message,
          })
        })
        try {
          const session = await Session.create({ kind: "assistant" })
          const now = Date.now()
          Database.use((db) =>
            db
              .insert(TaskQueueTable)
              .values({
                id: "task_stale_visible_" + Math.random().toString(36).slice(2),
                session_id: session.id,
                prompt: "stale-visible",
                status: "running",
                source: "test",
                metadata: {
                  kind: "session_prompt",
                  input: {
                    parts: [{ type: "text", text: "stale-visible" }],
                  },
                },
                time_created: now - 5000,
                time_updated: now - 5000,
                time_started: now - 5000,
              })
              .run(),
          )

          await TaskQueueService.runNow()
          expect(errors).toEqual([{ sessionID: session.id, message: "task timed out while running" }])
        } finally {
          stop()
        }
      },
    })
  })
})
