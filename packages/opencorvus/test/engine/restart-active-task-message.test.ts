import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { dispatchTaskLoop } from "@/engine/queue"
import * as TaskLoop from "@/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
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

async function syntheticRestartMessages(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  return messages.filter(
    (message) =>
      message.info.role === "user" &&
      message.parts.some((part) => part.type === "text" && part.text === "请继续执行剩余任务"),
  )
}

async function waitForTaskLifecycleEvents(taskID: string, count: number) {
  let last = 0
  let deadline = Date.now() + 15_000
  while (Date.now() <= deadline) {
    const events = ProtocolStore.listTaskEvents(taskID).filter((event) => event.type === "task.lifecycle")
    if (events.length >= count) return events
    if (events.length !== last) {
      last = events.length
      deadline = Date.now() + 15_000
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${count} task.lifecycle events; last=${last}`)
}

describe("restart active task lifecycle fact", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("startup liveness records one lifecycle fact and no synthetic operator message for active tasks without a current loop", async () => {
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
                request: "wake from lifecycle fact after server restart",
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
        const orphanLifecycleEvents = await waitForTaskLifecycleEvents(orphanTaskID, 1)
        await waitForMockCalls(runTaskLoop, 2)

        expect(orphanLifecycleEvents).toHaveLength(1)
        expect(orphanLifecycleEvents[0]).toMatchObject({
          type: "task.lifecycle",
          source: "engine.liveness",
          target: "orchestrator",
          payload: {
            taskID: orphanTaskID,
            fact: "server_restart_active_task_recovered",
            status: "active",
            orphaned: true,
          },
        })
        expect(await syntheticRestartMessages(orphanRoot.id)).toHaveLength(0)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID: orphanTaskID,
          event: {
            lifecycleFact: {
              kind: "server_restart_active_task_recovered",
              eventID: orphanLifecycleEvents[0]?.id,
            },
          },
        })
        expect((runTaskLoop.mock.calls[1]?.[0] as any)?.event?.note).toBeUndefined()
        expect((runTaskLoop.mock.calls[1]?.[0] as any)?.event?.operatorMessage).toBeUndefined()
        expect(await syntheticRestartMessages(currentRoot.id)).toHaveLength(0)
        expect(
          ProtocolStore.listTaskEvents(currentTaskID).filter((event) => event.type === "task.lifecycle"),
        ).toHaveLength(0)

        EngineService.init()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(
          ProtocolStore.listTaskEvents(orphanTaskID).filter((event) => event.type === "task.lifecycle"),
        ).toHaveLength(1)
        expect(await syntheticRestartMessages(orphanRoot.id)).toHaveLength(0)
        expect(await syntheticRestartMessages(currentRoot.id)).toHaveLength(0)

        release!()
        await holdLoop
      },
    })
  })
})
