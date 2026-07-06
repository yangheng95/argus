import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { CronService } from "../../src/scheduler/cron-service"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionWake } from "../../src/session/wake"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Message } from "../../src/session/message"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import * as EngineQueue from "../../src/engine/queue"
import { Identifier } from "../../src/id/id"

async function waitUntil(check: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out")
}

function seedTask(input: { taskID: string; sessionID?: string; completed?: boolean }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        session_id: input.sessionID,
        source: "test",
        title: "Cron wait activity fixture",
        request: "Wait for external activity",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
        ...(input.completed ? { time_completed: now } : {}),
      } as any)
      .run(),
  )
}

async function importCurrentProjectChildWithForeignParent(input: {
  directory: string
  parentID: string
  title: string
}) {
  let sessionID = ""
  await Instance.provide({
    directory: input.directory,
    fn: async () => {
      const now = Date.now()
      const child: Session.Info = {
        id: Identifier.descending("session"),
        slug: `cron-cross-parent-${Math.random().toString(36).slice(2)}`,
        projectID: Instance.project.id,
        directory: input.directory,
        parentID: input.parentID,
        title: input.title,
        version: "test",
        kind: "assistant",
        metadata: {},
        time: {
          created: now,
          updated: now,
        },
      }
      await Session.importSnapshot({ info: child, messages: [] })
      sessionID = child.id
    },
  })
  return sessionID
}

async function appendTerminalToolResult(input: { sessionID: string; tool: string }) {
  const now = Date.now()
  const assistant = {
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    parentID: Identifier.ascending("message"),
    agent: "orchestrator",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "test-model",
    providerID: "test-provider",
    finish: "tool-calls",
    time: { created: now, completed: now },
  } satisfies Message.Assistant
  const part = {
    id: Identifier.ascending("part"),
    messageID: assistant.id,
    sessionID: input.sessionID,
    type: "tool",
    callID: Identifier.ascending("call"),
    tool: input.tool,
    state: {
      status: "completed",
      input: {},
      output: "done",
      title: "Done",
      metadata: {},
      time: { start: now, end: now + 1 },
    },
  } satisfies Message.ToolPart
  await Session.persistMessage({ info: assistant, parts: [part], touchSessionID: input.sessionID })
}

describe("scheduler.cron-service", () => {
  afterEach(async () => {
    delete process.env.OPENCORVUS_CRON_CONCURRENCY
    mock.restore()
    await Instance.disposeAll()
  })

  test("one-shot job is not lost on wake failure and is disabled after a later success", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake")
    wake.mockImplementationOnce(async () => {
      throw new Error("wake failed")
    })
    wake.mockResolvedValue("ses_mock")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_one_shot_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "oneshot",
              expression: "1m",
              prompt: "hello",
              enabled: true,
              one_shot: true,
              next_run: now - 1000,
            })
            .run(),
        )

        await CronService.runNow()

        const first = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect(first?.enabled).toBe(true)
        expect(first?.one_shot).toBe(true)
        expect(first?.failure_count).toBe(1)
        expect((first?.last_run ?? null) === null).toBe(true)

        Database.use((db) =>
          db
            .update(CronJobTable)
            .set({ next_run: Date.now() - 1000 })
            .where(eq(CronJobTable.id, id))
            .run(),
        )
        await CronService.runNow()

        const second = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect(second?.enabled).toBe(false)
        expect((second?.last_run ?? 0) > 0).toBe(true)
        expect(second?.failure_count).toBe(0)
        expect(wake).toHaveBeenCalledTimes(2)
        expect(wake.mock.calls[0]?.[0]?.reason).toMatchObject({
          source: "scheduler.cron",
          jobID: id,
          jobName: "oneshot",
          expression: "1m",
          oneShot: true,
        })
        expect(wake.mock.calls[0]?.[0]?.reason?.fireID).toMatch(/^cal_/)
      },
    })
  })

  test("poll only processes cron jobs for the current project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const id = "crn_scope_" + Math.random().toString(36).slice(2)
    const wake = spyOn(SessionWake, "wake").mockResolvedValue("ses_mock")

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "other-project",
              expression: "1m",
              prompt: "hello",
              enabled: true,
              one_shot: false,
              next_run: now - 1000,
            })
            .run(),
        )
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        await CronService.runNow()
      },
    })

    const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
    expect(wake).toHaveBeenCalledTimes(0)
    expect((row?.last_run ?? null) === null).toBe(true)
  }, 30_000)

  test("poll rejects persisted session jobs whose parent lineage leaves the current project", async () => {
    await using current = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
    let foreignParentID = ""

    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign parent" })).id
      },
    })
    const childID = await importCurrentProjectChildWithForeignParent({
      directory: current.path,
      parentID: foreignParentID,
      title: "current cron child with foreign parent",
    })

    await Instance.provide({
      directory: current.path,
      fn: async () => {
        const id = "crn_foreign_parent_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              session_id: childID,
              name: "foreign parent persisted cron",
              expression: "1m",
              prompt: "must not wake",
              enabled: true,
              one_shot: true,
              next_run: Date.now() - 1000,
            })
            .run(),
        )

        await CronService.runNow()

        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect(row?.enabled).toBe(true)
        expect(row?.last_run).toBeNull()
        expect(row?.lease_owner).toBeNull()
        expect(row?.failure_count).toBe(1)
        expect(row?.last_error).toContain("Session not found")
      },
    })

    expect(loop).not.toHaveBeenCalled()
  })

  test("create rejects foreign sessions and remove reports only current-project rows", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const foreignJobID = "crn_foreign_remove_" + Math.random().toString(36).slice(2)
    let oneProjectID = ""
    let twoProjectID = ""
    let twoSessionID = ""
    let oneChildWithForeignParentID = ""
    let twoTaskID = ""

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        oneProjectID = Instance.project.id
      },
    })

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const now = Date.now()
        twoProjectID = Instance.project.id
        twoSessionID = (await Session.create({ kind: "assistant", title: "foreign cron session" })).id
        twoTaskID = "tsk_foreign_cron_" + Math.random().toString(36).slice(2)
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: twoTaskID,
              project_id: twoProjectID,
              source: "test",
              title: "Foreign cron task",
              request: "foreign task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(CronJobTable)
            .values({
              id: foreignJobID,
              project_id: twoProjectID,
              session_id: twoSessionID,
              name: "foreign remove sentinel",
              expression: "1m",
              prompt: "foreign",
              enabled: true,
              one_shot: true,
              next_run: Date.now() + 60_000,
            })
            .run()
        })
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        const child: Session.Info = {
          id: Identifier.descending("session"),
          slug: "cron-cross-parent-child",
          projectID: Instance.project.id,
          directory: one.path,
          parentID: twoSessionID,
          title: "project one cron child with project two parent",
          version: "test",
          kind: "build",
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        }
        await Session.importSnapshot({ info: child, messages: [] })
        oneChildWithForeignParentID = child.id
      },
    })

    await expect(
      CronService.create({
        name: "bad cron session",
        expression: "1m",
        prompt: "bad",
        projectId: oneProjectID,
        sessionId: twoSessionID,
      }),
    ).rejects.toThrow("Session not found")
    await expect(
      CronService.create({
        name: "bad cron foreign parent",
        expression: "1m",
        prompt: "bad",
        projectId: oneProjectID,
        sessionId: oneChildWithForeignParentID,
      }),
    ).rejects.toThrow("Session not found")
    await expect(
      CronService.createTaskWake({
        name: "bad cron task",
        reason: "bad",
        projectId: oneProjectID,
        taskId: twoTaskID,
        durationMs: 1000,
      }),
    ).rejects.toThrow("Task not found")

    expect(CronService.remove(foreignJobID, oneProjectID)).toBe(false)
    expect(
      Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, foreignJobID)).get()),
    ).toBeDefined()
  }, 30_000)

  test("consumePendingTaskWaits deletes unclaimed waits and preserves claimed due jobs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = "tsk_cron_consume_" + Math.random().toString(36).slice(2)
        const session = await Session.create({ kind: "orchestrator", title: "task wait consume root" })
        seedTask({ taskID, sessionID: session.id })
        const open = await CronService.createTaskWake({
          name: "task wait",
          reason: "external signal",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })
        const claimed = await CronService.createTaskWake({
          name: "task wait",
          reason: "claimed due signal",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })
        Database.use((db) =>
          db
            .update(CronJobTable)
            .set({ lease_owner: "active-poll", lease_until: Date.now() + 60_000 })
            .where(eq(CronJobTable.id, claimed.id))
            .run(),
        )

        const consumed = await CronService.consumePendingTaskWaits({
          taskId: taskID,
          projectId: Instance.project.id,
          reason: "accepted wake",
        })

        expect(consumed.jobIDs).toEqual([open.id])
        expect(Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, open.id)).get())).toBe(
          undefined,
        )
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, claimed.id)).get()),
        ).toBeDefined()
      },
    })
  })

  test("consumePendingTaskWaits does not require a task root session when no pending wait exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = "tsk_cron_no_pending_" + Math.random().toString(36).slice(2)
        seedTask({ taskID })

        const consumed = await CronService.consumePendingTaskWaits({
          taskId: taskID,
          projectId: Instance.project.id,
          reason: "ordinary wake without scheduled wait",
        })

        expect(consumed.jobIDs).toEqual([])
      },
    })
  })

  test("session activity does not consume pending session waits whose parent lineage leaves the current project", async () => {
    await using current = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    let foreignParentID = ""

    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign session wait parent" })).id
      },
    })
    const childID = await importCurrentProjectChildWithForeignParent({
      directory: current.path,
      parentID: foreignParentID,
      title: "current session wait child with foreign parent",
    })

    await Instance.provide({
      directory: current.path,
      fn: async () => {
        CronService.init()
        const id = "crn_session_wait_foreign_parent_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              session_id: childID,
              name: "session wait",
              expression: "delay:1200000ms",
              prompt: "must remain pending",
              enabled: true,
              one_shot: true,
              next_run: Date.now() + 20 * 60 * 1000,
            })
            .run(),
        )
        const messageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: messageID,
            sessionID: childID,
            role: "user",
            time: { created: Date.now() },
            agent: "assistant",
            model: { providerID: "test-provider", modelID: "test-model" },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID,
              sessionID: childID,
              type: "text",
              text: "do not consume polluted wait",
              kind: "user_content",
            },
          ],
          touchSessionID: childID,
        })
        await Database.awaitEffectIdle(500)

        expect(Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())).toBeDefined()
      },
    })
  })

  test("task wake creation rejects tasks whose root session parent lineage leaves the current project", async () => {
    await using current = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    let foreignParentID = ""

    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign task wake parent" })).id
      },
    })
    const childID = await importCurrentProjectChildWithForeignParent({
      directory: current.path,
      parentID: foreignParentID,
      title: "current task wake child with foreign parent",
    })

    await Instance.provide({
      directory: current.path,
      fn: async () => {
        const taskID = "tsk_cron_foreign_root_create_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: childID })

        await expect(
          CronService.createTaskWake({
            name: "task wait",
            reason: "must reject polluted root",
            projectId: Instance.project.id,
            taskId: taskID,
            durationMs: 20 * 60 * 1000,
          }),
        ).rejects.toThrow("Session not found")
      },
    })
  })

  test("due task cron with invalid root session lineage fails before dispatching the task loop", async () => {
    await using current = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")
    let foreignParentID = ""

    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign due task parent" })).id
      },
    })
    const childID = await importCurrentProjectChildWithForeignParent({
      directory: current.path,
      parentID: foreignParentID,
      title: "current due task child with foreign parent",
    })

    await Instance.provide({
      directory: current.path,
      fn: async () => {
        const taskID = "tsk_cron_foreign_root_due_" + Math.random().toString(36).slice(2)
        const cronID = "crn_task_wait_foreign_parent_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: childID })
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id: cronID,
              project_id: Instance.project.id,
              task_id: taskID,
              name: "task wait",
              expression: "delay:1200000ms",
              prompt: "must fail before dispatch",
              enabled: true,
              one_shot: true,
              next_run: Date.now() - 1000,
            })
            .run(),
        )

        await CronService.runNow()

        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, cronID)).get())
        expect(row?.enabled).toBe(true)
        expect(row?.last_run).toBeNull()
        expect(row?.lease_owner).toBeNull()
        expect(row?.failure_count).toBe(1)
        expect(row?.last_error).toContain("Session not found")
      },
    })
  })

  test("early task wait activity preserves invalid lineage rows and does not dispatch", async () => {
    await using current = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")
    let foreignParentID = ""

    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "assistant", title: "foreign early task parent" })).id
      },
    })
    const childID = await importCurrentProjectChildWithForeignParent({
      directory: current.path,
      parentID: foreignParentID,
      title: "current early task child with foreign parent",
    })

    await Instance.provide({
      directory: current.path,
      fn: async () => {
        const taskID = "tsk_cron_foreign_root_early_" + Math.random().toString(36).slice(2)
        const cronID = "crn_task_wait_foreign_early_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: childID })
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id: cronID,
              project_id: Instance.project.id,
              task_id: taskID,
              name: "task wait",
              expression: "delay:1200000ms",
              prompt: "must not be consumed",
              enabled: true,
              one_shot: true,
              next_run: Date.now() + 20 * 60 * 1000,
            })
            .run(),
        )

        await expect(
          CronService.triggerTaskWaitFromActivity({
            taskId: taskID,
            projectId: Instance.project.id,
            source: "test.activity",
            detail: "invalid root session lineage",
          }),
        ).rejects.toThrow("Session not found")

        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, cronID)).get()),
        ).toBeDefined()
      },
    })
  })

  test("normal user message consumes pending session wait cron", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "assistant", title: "session wait consume" })
        const scheduled = await CronService.createDelayedSessionWake({
          name: "session wait",
          prompt: "scheduled session wait",
          projectId: Instance.project.id,
          sessionId: session.id,
          durationMs: 20 * 60 * 1000,
        })
        const messageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: {
            id: messageID,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "assistant",
            model: { providerID: "test-provider", modelID: "test-model" },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID,
              sessionID: session.id,
              type: "text",
              text: "wake before cron due",
              kind: "user_content",
            },
          ],
          touchSessionID: session.id,
        })

        await waitUntil(
          () =>
            Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()) ===
            undefined,
        )
      },
    })
  })

  test("new user updateMessage consumes pending session wait cron", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "assistant", title: "session wait updateMessage consume" })
        const scheduled = await CronService.createDelayedSessionWake({
          name: "session wait",
          prompt: "scheduled session wait",
          projectId: Instance.project.id,
          sessionId: session.id,
          durationMs: 20 * 60 * 1000,
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "assistant",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        await waitUntil(
          () =>
            Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()) ===
            undefined,
        )
      },
    })
  })

  test("existing user message update preserves pending session wait cron", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "assistant", title: "session wait update preserve" })
        const message = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "assistant",
          model: { providerID: "test-provider", modelID: "test-model" },
        } satisfies Message.User
        await Session.updateMessage(message)
        await Database.awaitEffectIdle(500)

        const scheduled = await CronService.createDelayedSessionWake({
          name: "session wait",
          prompt: "scheduled session wait",
          projectId: Instance.project.id,
          sessionId: session.id,
          durationMs: 20 * 60 * 1000,
        })
        await Session.updateMessage(message)
        await Database.awaitEffectIdle(500)

        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()),
        ).toBeDefined()
      },
    })
  })

  test("existing user message update preserves pending task wait cron", async () => {
    await using tmp = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "orchestrator", title: "task wait update preserve" })
        const taskID = "tsk_cron_message_update_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: session.id })
        const message = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "orchestrator",
          model: { providerID: "test-provider", modelID: "test-model" },
        } satisfies Message.User
        await Session.updateMessage(message)
        await Database.awaitEffectIdle(500)

        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "external user activity",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })
        await Session.updateMessage(message)
        await Database.awaitEffectIdle(500)

        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()),
        ).toBeDefined()
      },
    })
  })

  test("terminal non-wait tool result consumes pending task wait and dispatches early", async () => {
    await using tmp = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "orchestrator", title: "wait activity root" })
        const taskID = "tsk_cron_tool_activity_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: session.id })
        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "external tool output",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })

        await appendTerminalToolResult({ sessionID: session.id, tool: "read_context" })
        await waitUntil(() => dispatchTaskLoop.mock.calls.length === 1)

        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.taskID).toBe(taskID)
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.event?.note).toContain("early task wait wake")
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.event?.note).toContain("wait_job_ids=")
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()),
        ).toBeUndefined()
      },
    })
  })

  test("wait tool result does not consume the cron created by wait itself", async () => {
    await using tmp = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        CronService.init()
        const session = await Session.create({ kind: "orchestrator", title: "wait self result root" })
        const taskID = "tsk_cron_wait_self_" + Math.random().toString(36).slice(2)
        seedTask({ taskID, sessionID: session.id })
        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "external clock",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })

        await appendTerminalToolResult({ sessionID: session.id, tool: "wait" })
        await Bun.sleep(50)

        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()),
        ).toBeDefined()
      },
    })
  })

  test("task cron wake dispatches the task loop and disables the one-shot row", async () => {
    await using tmp = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("started")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = "tsk_cron_wait_" + Math.random().toString(36).slice(2)
        const session = await Session.create({ kind: "orchestrator", title: "task cron wait root" })
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "Task cron wait",
              request: "Wait for webhook",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run(),
        )

        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "external webhook landed",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 1000,
        })
        Database.use((db) =>
          db
            .update(CronJobTable)
            .set({ next_run: Date.now() - 1000 })
            .where(eq(CronJobTable.id, scheduled.id))
            .run(),
        )

        await CronService.runNow()

        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.taskID).toBe(taskID)
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.event?.note).toContain("scheduled task wait wake")
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.event?.note).toContain("external webhook landed")
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get())
        expect(row?.enabled).toBe(false)
        expect(row?.one_shot).toBe(true)
        expect((row?.last_run ?? 0) > 0).toBe(true)
        expect(row?.failure_count).toBe(0)
        expect(row?.last_error).toBeNull()
      },
    })
  })

  test("ignored task cron wake is consumed instead of retried", async () => {
    await using tmp = await tmpdir({ git: true })
    const dispatchTaskLoop = spyOn(EngineQueue, "dispatchTaskLoop").mockResolvedValue("ignored")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = "tsk_cron_wait_ignored_" + Math.random().toString(36).slice(2)
        const session = await Session.create({ kind: "orchestrator", title: "ignored task cron wait root" })
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "Ignored task cron wait",
              request: "Wait for terminal no-op",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now,
            } as any)
            .run(),
        )

        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "terminal passive wake",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 1000,
        })
        Database.use((db) =>
          db
            .update(CronJobTable)
            .set({ next_run: Date.now() - 1000 })
            .where(eq(CronJobTable.id, scheduled.id))
            .run(),
        )

        await CronService.runNow()

        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get())
        expect(row?.enabled).toBe(false)
        expect(row?.failure_count).toBe(0)
        expect(row?.last_error).toBeNull()
      },
    })
  })

  test("reentry guard prevents overlapping poll runs", async () => {
    await using tmp = await tmpdir({ git: true })

    let resolve = (_value: string) => {}
    const gate = new Promise<string>((r) => {
      resolve = r
    })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async () => gate)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_reentry_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "reentry",
              expression: "*/5 * * * *",
              prompt: "hello",
              enabled: true,
              one_shot: false,
              next_run: now - 1000,
            })
            .run(),
        )

        const pending = [CronService.runNow(), CronService.runNow(), CronService.runNow()]
        await waitUntil(() => wake.mock.calls.length === 1)
        resolve("ses_gate")
        await Promise.all(pending)

        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect((row?.last_run ?? 0) > 0).toBe(true)
      },
    })

    expect(wake).toHaveBeenCalledTimes(1)
  })

  test("executes due cron jobs in parallel within one poll", async () => {
    await using tmp = await tmpdir({ git: true })
    let release = (_value: string) => {}
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async (input) => {
      if (input.prompt === "slow") return gate
      return "ses_fast"
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const slowID = "crn_parallel_slow_" + Math.random().toString(36).slice(2)
        const fastID = "crn_parallel_fast_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values([
              {
                id: slowID,
                project_id: Instance.project.id,
                name: "parallel-slow",
                expression: "1m",
                prompt: "slow",
                enabled: true,
                one_shot: false,
                next_run: now - 2000,
              },
              {
                id: fastID,
                project_id: Instance.project.id,
                name: "parallel-fast",
                expression: "1m",
                prompt: "fast",
                enabled: true,
                one_shot: false,
                next_run: now - 1000,
              },
            ])
            .run(),
        )

        const run = CronService.runNow()
        await waitUntil(() => wake.mock.calls.some((call) => call[0]?.prompt === "slow"))
        await waitUntil(() => wake.mock.calls.some((call) => call[0]?.prompt === "fast"))
        release("ses_slow")
        await run

        const slow = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, slowID)).get())
        const fast = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, fastID)).get())
        expect((slow?.last_run ?? 0) > 0).toBe(true)
        expect((fast?.last_run ?? 0) > 0).toBe(true)
      },
    })

    expect(wake).toHaveBeenCalledTimes(2)
  })

  test("respects OPENCORVUS_CRON_CONCURRENCY limit", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_CRON_CONCURRENCY = "1"
    let running = 0
    let peak = 0
    const wake = spyOn(SessionWake, "wake").mockImplementation(async () => {
      running += 1
      peak = Math.max(peak, running)
      await Bun.sleep(80)
      running -= 1
      return "ses_serial"
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = "crn_serial_a_" + Math.random().toString(36).slice(2)
        const b = "crn_serial_b_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values([
              {
                id: a,
                project_id: Instance.project.id,
                name: "serial-a",
                expression: "1m",
                prompt: "a",
                enabled: true,
                one_shot: false,
                next_run: now - 2000,
              },
              {
                id: b,
                project_id: Instance.project.id,
                name: "serial-b",
                expression: "1m",
                prompt: "b",
                enabled: true,
                one_shot: false,
                next_run: now - 1000,
              },
            ])
            .run(),
        )

        await CronService.runNow()
      },
    })

    expect(wake).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
  })

  test("interval next_run is computed from completion time", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async () => {
      await Bun.sleep(120)
      return "ses_mock"
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_interval_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "interval",
              expression: "1m",
              prompt: "hello",
              enabled: true,
              one_shot: false,
              next_run: now - 1000,
            })
            .run(),
        )

        const startedAt = Date.now()
        await CronService.runNow()
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect((row?.last_run ?? 0) - startedAt).toBeGreaterThanOrEqual(80)
        expect((row?.next_run ?? 0) - (row?.last_run ?? 0)).toBe(60 * 1000)
      },
    })

    expect(wake).toHaveBeenCalledTimes(1)
  })

  test("failure backoff is capped at five minutes for repeated failures", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async () => {
      throw new Error("wake failed")
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_fail_cap_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "fail-cap",
              expression: "1m",
              prompt: "boom",
              enabled: true,
              one_shot: false,
              failure_count: 40,
              next_run: now - 1000,
            })
            .run(),
        )

        const startedAt = Date.now()
        await CronService.runNow()
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        const delay = (row?.next_run ?? 0) - startedAt
        expect(row?.failure_count).toBe(41)
        expect(delay).toBeGreaterThanOrEqual(295000)
        expect(delay).toBeLessThanOrEqual(305000)
      },
    })

    expect(wake).toHaveBeenCalledTimes(1)
  })
})
