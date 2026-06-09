import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencorvusExecutor } from "../../src/executor/opencorvus"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { Database, eq } from "../../src/storage/db"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionSummary } from "../../src/session/summary"
import { Bus } from "../../src/bus"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("executor.opencorvus", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("resume enqueues a follow-up prompt on the same session", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(TaskQueueService, "runNow").mockResolvedValue()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "executor test" })
        const result = await OpencorvusExecutor.resume({
          sessionID: session.id,
          message: "continue with the latest operator note",
        })
        expect(result.sessionID).toBe(session.id)
        const row = Database.use((db) =>
          db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, result.queueTaskID)).get(),
        )
        expect(row?.session_id).toBe(session.id)
        expect(row?.source).toBe("engine.task")
      },
    })
  })

  test("events streams session-scoped bus activity", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "executor events" })
        const stream = OpencorvusExecutor.events({ sessionID: session.id })
        const next = stream.next()
        await Bus.publish(Message.Event.PartDelta, {
          sessionID: session.id,
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: "hello",
        })
        const item = await next
        expect(item.done).toBe(false)
        expect(item.value?.type).toBe("message.part.delta")
        expect(item.value?.summary).toContain("text")
        await stream.return?.(undefined)
      },
    })
  })

  test("events ignores other sessions and includes permission requests", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "executor permissions" })
        const other = await Session.create({ kind: "assistant", title: "other session" })
        const stream = OpencorvusExecutor.events({ sessionID: session.id })
        const next = stream.next()
        await Bus.publish(PermissionNext.Event.Asked, {
          id: "perm_other",
          sessionID: other.id,
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          tool: {
            messageID: "msg_other",
            callID: "call_other",
          },
        })
        await Bus.publish(PermissionNext.Event.Asked, {
          id: "perm_self",
          sessionID: session.id,
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          tool: {
            messageID: "msg_self",
            callID: "call_self",
          },
        })
        const item = await next
        expect(item.done).toBe(false)
        expect(item.value?.type).toBe("permission.asked")
        expect(item.value?.summary).toContain("bash")
        await stream.return?.(undefined)
      },
    })
  })

  test("events streams child-session activity when scoped by goalID", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "assistant", goalID: "gol_shared", title: "root session" })
        const child = await Session.create({
          kind: "assistant",
          goalID: "gol_shared",
          parentID: root.id,
          title: "child session",
        })
        const other = await Session.create({ kind: "assistant", goalID: "gol_other", title: "other goal" })
        const stream = OpencorvusExecutor.events({ goalID: "gol_shared", sessionID: root.id })
        const next = stream.next()
        await Bus.publish(Message.Event.PartDelta, {
          sessionID: other.id,
          messageID: "msg_other",
          partID: "prt_other",
          field: "text",
          delta: "ignore me",
        })
        await Bus.publish(Message.Event.PartDelta, {
          sessionID: child.id,
          messageID: "msg_child",
          partID: "prt_child",
          field: "text",
          delta: "hello from child",
        })
        const item = await next
        expect(item.done).toBe(false)
        expect(item.value?.type).toBe("message.part.delta")
        expect(item.value?.payload?.sessionID).toBe(child.id)
        await stream.return?.(undefined)
      },
    })
  })

  test("acceptance only includes messages since the current run start", async () => {
    await using tmp = await tmpdir({ git: true })
    const old = Date.now() - 10_000
    const now = Date.now()
    const spy = spyOn(SessionSummary, "computeDiff").mockResolvedValue([])
    spyOn(Session, "messages").mockResolvedValue([
      {
        info: {
          id: "msg_old",
          sessionID: "ses_test",
          role: "assistant",
          time: {
            created: old,
          },
        } as Message.Assistant,
        parts: [
          {
            id: "prt_old",
            sessionID: "ses_test",
            messageID: "msg_old",
            type: "text",
            text: "old summary",
          } as Message.TextPart,
        ],
      },
      {
        info: {
          id: "msg_new",
          sessionID: "ses_test",
          role: "assistant",
          time: {
            created: now,
          },
        } as Message.Assistant,
        parts: [
          {
            id: "prt_new",
            sessionID: "ses_test",
            messageID: "msg_new",
            type: "text",
            text: "new summary",
          } as Message.TextPart,
        ],
      },
    ] as Message.WithParts[])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await OpencorvusExecutor.acceptance({
          sessionID: "ses_test",
          since: now - 100,
        })

        expect(result.summary).toContain("new summary")
        expect(result.summary).not.toContain("old summary")
        expect(spy).toHaveBeenCalled()
      },
    })
  })
})
