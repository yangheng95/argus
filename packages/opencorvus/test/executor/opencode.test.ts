import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { TaskQueueService } from "../../src/scheduler/task-queue-service"
import { Database, eq } from "../../src/storage/db"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
import { Bus } from "../../src/bus"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("executor.opencode", () => {
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
        const session = await Session.create({ title: "executor test" })
        const result = await OpencodeExecutor.resume({
          sessionID: session.id,
          message: "continue with the latest operator note",
        })
        expect(result.sessionID).toBe(session.id)
        const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, result.queueTaskID)).get())
        expect(row?.session_id).toBe(session.id)
        expect(row?.source).toBe("orchestrator.task")
      },
    })
  })

  test("events streams session-scoped bus activity", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "executor events" })
        const stream = OpencodeExecutor.events({ sessionID: session.id })
        const next = stream.next()
        await Bus.publish(MessageV2.Event.PartDelta, {
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
        const session = await Session.create({ title: "executor permissions" })
        const other = await Session.create({ title: "other session" })
        const stream = OpencodeExecutor.events({ sessionID: session.id })
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
})
