import { afterEach, describe, expect, test } from "bun:test"
import { TuiRuntime } from "../../src/tui/runtime"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Database, and, eq } from "../../src/storage/db"

describe("tui.runtime.submitTask", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("throws when session id is missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(TuiRuntime.submitTask({ text: "hello", wait: false })).rejects.toThrow("sessionID is required")
      },
    })
  })

  test("enqueues task when wait=false", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const result = await TuiRuntime.submitTask({
          text: "queue from runtime",
          sessionID: session.id,
          wait: false,
        })

        expect(result.accepted).toBe(true)
        expect(result.waited).toBe(false)
        expect(result.completed).toBe(false)
        expect(result.sessionID).toBe(session.id)

        const row = Database.use((db) =>
          db
            .select()
            .from(TaskQueueTable)
            .where(and(eq(TaskQueueTable.session_id, session.id), eq(TaskQueueTable.source, "tui.runtime.submit-task")))
            .get(),
        )
        expect(row?.status).toBe("queued")
        expect(row?.prompt).toBe("queue from runtime")
      },
    })
  })
})
