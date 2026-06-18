import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Scheduler } from "../../src/scheduler"
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

async function waitForQueueStatus(id: string, status: string) {
  for (let i = 0; i < 50; i += 1) {
    const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
    if (row?.status === status) return row
    await Bun.sleep(10)
  }
  const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get())
  throw new Error(`queue task ${id} did not reach ${status}; current=${row?.status ?? "missing"}`)
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
