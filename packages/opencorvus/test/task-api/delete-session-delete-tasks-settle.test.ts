import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { TaskCancellationIncompleteError } from "../../src/engine/cancellation-error"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitUntil(fn: () => boolean, label: string) {
  for (let i = 0; i < 500; i += 1) {
    if (fn()) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function taskRow(taskID: string) {
  return Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
}

function sessionRow(sessionID: string) {
  return Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
}

async function createActiveTask(directory: string) {
  let taskID = ""
  let sessionID = ""
  await Instance.provide({
    directory,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "delete session running task" })
      sessionID = root.id
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: sessionID,
            source: "test",
            title: "delete session running task",
            request: "delete session running task",
            priority: "normal",
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })
  return { taskID, sessionID }
}

describe("deleteSession deleteTasks running task settlement", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("waits for the live task loop before physically deleting task rows", async () => {
    await using tmp = await tmpdir({ git: true })
    const releaseLoop = deferred()
    const { taskID, sessionID } = await createActiveTask(tmp.path)
    let processTaskStarted = false

    spyOn(Orchestrator, "processTask").mockImplementation(async () => {
      processTaskStarted = true
      await releaseLoop.promise
    })

    let loopPromise!: Promise<void>
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        loopPromise = TaskLoop.runTaskLoop({ taskID })
      },
    })
    await waitUntil(() => processTaskStarted, "orchestrator task loop start")

    let deletePromise!: Promise<boolean>
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        deletePromise = EngineService.deleteSession(sessionID, { deleteTasks: true })
        await Bun.sleep(50)

        expect(taskRow(taskID)?.id).toBe(taskID)
        expect(sessionRow(sessionID)?.id).toBe(sessionID)

        releaseLoop.resolve()
        await loopPromise
        await deletePromise
      },
    })

    expect(taskRow(taskID)).toBeUndefined()
    expect(sessionRow(sessionID)).toBeUndefined()
  }, 15_000)

  test("preserves task and session rows when task loop idle settlement fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID, sessionID } = await createActiveTask(tmp.path)

    spyOn(TaskLoop, "awaitTaskLoopIdle").mockRejectedValue(new Error("loop still active"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(EngineService.deleteSession(sessionID, { deleteTasks: true })).rejects.toBeInstanceOf(
          TaskCancellationIncompleteError,
        )
      },
    })

    expect(taskRow(taskID)?.id).toBe(taskID)
    expect(sessionRow(sessionID)?.id).toBe(sessionID)
    expect(createDecisionLog(taskID).readByKey("task_physical_delete_breadcrumb")).toBeUndefined()
  })
})
