import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { TaskCancellationIncompleteError } from "../../src/engine/cancellation-error"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { expectNoProcessErrors } from "../fixture/process-errors"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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

function queueRow(queueTaskID: string) {
  return Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, queueTaskID)).get())
}

async function createActiveTask(directory: string, request: string) {
  let taskID = ""
  let sessionID = ""
  await Instance.provide({
    directory,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: request })
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
            title: request,
            request,
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

describe("deleteTask running task settlement", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("waits for the live task loop before physically deleting task and root session rows", async () => {
    await using tmp = await tmpdir({ git: true })
    const releaseLoop = deferred()
    const { taskID, sessionID } = await createActiveTask(tmp.path, "delete while loop is still active")
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

    await expectNoProcessErrors(async () => {
      const deletePromise = EngineService.deleteTask(taskID, {
        taskLoopIdleTimeoutMs: 2_000,
      })
      await Bun.sleep(50)

      expect(taskRow(taskID)?.id).toBe(taskID)
      expect(sessionRow(sessionID)?.id).toBe(sessionID)

      releaseLoop.resolve()
      await loopPromise
      await deletePromise
    })

    expect(taskRow(taskID)).toBeUndefined()
    expect(sessionRow(sessionID)).toBeUndefined()
  })

  test("reports incomplete cancellation and preserves rows when the task loop does not become idle", async () => {
    await using tmp = await tmpdir({ git: true })
    const releaseLoop = deferred()
    const { taskID, sessionID } = await createActiveTask(tmp.path, "delete waits for zombie loop")
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

    try {
      await expect(
        EngineService.deleteTask(taskID, {
          taskLoopIdleTimeoutMs: 50,
        }),
      ).rejects.toBeInstanceOf(TaskCancellationIncompleteError)

      expect(taskRow(taskID)?.id).toBe(taskID)
      expect(sessionRow(sessionID)?.id).toBe(sessionID)
    } finally {
      releaseLoop.resolve()
      await loopPromise
    }
  })

  test("cancelTask marks task-owned queued prompts failed", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID, sessionID } = await createActiveTask(tmp.path, "cancel queued prompt rows")
    const queueTaskID = Identifier.ascending("task")
    const now = Date.now()

    Database.use((db) =>
      db
        .insert(TaskQueueTable)
        .values({
          id: queueTaskID,
          session_id: sessionID,
          prompt: "queued prompt",
          priority: "normal",
          status: "queued",
          source: "test",
          metadata: {
            kind: "session_prompt",
            input: { parts: [{ type: "text", text: "queued prompt" }] },
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    await EngineService.cancelTask(taskID)

    expect(queueRow(queueTaskID)).toMatchObject({
      status: "failed",
      error_message: "task cancelled",
    })
  })
})
