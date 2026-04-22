import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { advanceQueue, dispatchTaskLoop, taskCwd } from "../../src/engine/queue"
import { EngineRunTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("engine queue", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("dispatchTaskLoop claims queued work with its preserved trigger", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_created_${Date.now()}`
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "test",
            title: "queued created task",
            request: "dispatch through queue",
            status: "queued",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run(),
        )

        await dispatchTaskLoop({ taskID, trigger: { kind: "created" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          trigger: { kind: "created" },
        })
        expect(findTask(taskID)?.status).toBe("active")
      },
    })
  })

  test("advanceQueue derives retry for queued retry work after process-local trigger state is gone", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_retry_${Date.now()}`
        const runID = `run_queue_retry_${Date.now()}`
        const now = Date.now()

        Database.transaction((db) => {
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            source: "test",
            title: "queued retry task",
            request: "derive retry trigger from durable state",
            status: "queued",
            active_run_id: runID,
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineRunTable).values({
            id: runID,
            task_id: taskID,
            executor: "opencode",
            status: "failed",
            phase: "dispatch",
            time_created: now,
            time_updated: now,
          }).run()
        })

        await advanceQueue(taskCwd(taskID))
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          trigger: { kind: "retry" },
        })
      },
    })
  })
})