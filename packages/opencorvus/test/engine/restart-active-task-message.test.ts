import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { dispatchTaskLoop } from "@/engine/queue"
import * as TaskLoop from "@/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function waitForMockCalls(mockFn: { mock: { calls: unknown[] } }, count: number) {
  let last = mockFn.mock.calls.length
  let deadline = Date.now() + 15_000
  while (Date.now() <= deadline) {
    const current = mockFn.mock.calls.length
    if (current >= count) return
    if (current !== last) {
      last = current
      deadline = Date.now() + 15_000
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${count} mock calls; last=${mockFn.mock.calls.length}`)
}

async function restartMessages(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  return messages.filter(
    (message) =>
      message.info.role === "user" &&
      message.parts.some((part) => part.type === "text" && part.text === "请继续执行剩余任务"),
  )
}

async function waitForRestartMessages(sessionID: string, count: number) {
  let last = 0
  let deadline = Date.now() + 15_000
  while (Date.now() <= deadline) {
    const messages = await restartMessages(sessionID)
    if (messages.length >= count) return messages
    if (messages.length !== last) {
      last = messages.length
      deadline = Date.now() + 15_000
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${count} restart messages; last=${last}`)
}

describe("restart active task message", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("startup liveness sends one visible restart message only to active tasks without a current loop", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const orphanTaskID = `tsk_restart_orphan_${now}`
        const currentTaskID = `tsk_restart_current_${now}`
        const orphanRoot = await Session.create({ kind: "root", title: "orphan active restart task" })
        const currentRoot = await Session.create({ kind: "root", title: "current active task" })
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values([
              {
                id: orphanTaskID,
                project_id: Instance.project.id,
                session_id: orphanRoot.id,
                source: "test",
                title: "orphan active restart task",
                request: "append a restart message after server restart",
                priority: "normal",
                time_started: now,
                time_created: now,
                time_updated: now,
              },
              {
                id: currentTaskID,
                project_id: Instance.project.id,
                session_id: currentRoot.id,
                source: "test",
                title: "current active task",
                request: "do not duplicate a current process loop",
                priority: "normal",
                time_started: now,
                time_created: now,
                time_updated: now,
              },
            ])
            .run(),
        )

        expect(await dispatchTaskLoop({ taskID: currentTaskID })).toBe("started")
        await waitForMockCalls(runTaskLoop, 1)

        EngineService.init()
        const orphanRestartMessages = await waitForRestartMessages(orphanRoot.id, 1)
        await waitForMockCalls(runTaskLoop, 2)

        expect(orphanRestartMessages).toHaveLength(1)
        expect((orphanRestartMessages[0]?.info as any)?.extra?.operator_message?.source).toBe("server_restart")
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID: orphanTaskID,
          event: {
            operatorMessage: {
              text: "请继续执行剩余任务",
              source: "server_restart",
              messageID: orphanRestartMessages[0]?.info.id,
            },
          },
        })
        expect(await restartMessages(currentRoot.id)).toHaveLength(0)

        EngineService.init()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(await restartMessages(orphanRoot.id)).toHaveLength(1)
        expect(await restartMessages(currentRoot.id)).toHaveLength(0)

        release!()
        await holdLoop
      },
    })
  })
})
