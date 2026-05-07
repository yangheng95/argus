import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { advanceQueue, dispatchTaskLoop, reorderQueuedTasksForCwd, taskCwd } from "../../src/engine/queue"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"

function taskStatus(id: string): string | undefined {
  const t = findTask(id)
  return t ? deriveTaskStatus(t) : undefined
}
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("engine queue", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("dispatchTaskLoop preserves the caller's event through the queue claim", async () => {
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
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run(),
        )

        await dispatchTaskLoop({ taskID, event: { note: "caller-supplied note" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: { note: "caller-supplied note" },
        })
        expect(taskStatus(taskID)).toBe("active")
      },
    })
  })

  test("loop exit flips the queued sibling in the same cwd to active", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const activeID = `task_queue_active_${now}`
        const siblingID = `task_queue_sibling_${now}`

        // Hold the leader's runTaskLoop open until we release it; the
        // sibling's runTaskLoop resolves immediately. Modelling a real task
        // lifecycle: when the leader's loop exits it also flips task.status
        // to a terminal value (runTaskLoopInner does this via updateTask in
        // production); the queue-advance hook then finds the cwd idle and
        // the sibling must flip `queued → active`.
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(
          async (arg: { taskID: string }) => {
            if (arg.taskID === activeID) {
              await holdLoop
              Database.use((db) =>
                db
                  .update(EngineTaskTable)
                  .set({ time_completed: Date.now() })
                  .where(eq(EngineTaskTable.id, activeID))
                  .run(),
              )
            }
          },
        )

        Database.transaction((db) => {
          db.insert(EngineTaskTable).values({
            id: activeID,
            project_id: Instance.project.id,
            source: "test",
            title: "active task",
            request: "holds the cwd lock until loop exits",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: siblingID,
            project_id: Instance.project.id,
            source: "test",
            title: "queued sibling",
            request: "must flip to active after the leader's loop exits",
            priority: "normal",
            time_created: now + 1,
            time_updated: now + 1,
          }).run()
        })

        await dispatchTaskLoop({ taskID: activeID })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(taskStatus(activeID)).toBe("active")
        // Sibling stays queued while the leader's loop is still running —
        // the cwd lock is held.
        expect(taskStatus(siblingID)).toBe("queued")

        // Release the loop: the real loop exit → `.finally` → advanceQueue
        // should now flip the sibling to active. Without the fix, advance
        // fired right after scheduling and the sibling would remain queued.
        release!()
        await holdLoop
        // Give microtasks + queueMicrotask + the follow-up advanceQueue a
        // few turns to settle.
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (taskStatus(siblingID) === "active") break
        }

        expect(taskStatus(siblingID)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({ taskID: siblingID })
      },
    })
  })

  test("advanceQueue forwards queued work without synthesising a trigger", async () => {
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
            request: "advanceQueue must forward without deriving a trigger from the latest run",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run()
          // Phase-6-e: run rows live in engine_artifact (kind="run").
          db.insert(EngineArtifactTable).values({
            id: runID,
            task_id: taskID,
            run_id: runID,
            kind: "run",
            label: "run-failed",
            payload: {
              plan_version_id: null,
              session_id: null,
              executor: "mirrorcode",
              status: "failed",
              phase: "dispatch",
              blocking_reason: null,
              error: null,
              retry_count: 0,
              executor_ref: null,
              metadata: null,
              time_started: null,
              time_completed: now,
            },
            time_created: now,
            time_updated: now,
          }).run()
        })

        await advanceQueue(taskCwd(taskID))
        await new Promise((resolve) => setTimeout(resolve, 0))

        // Phase 2: the queue must NOT invent an OrchestratorEvent from
        // active_run_id. The orchestrator reads the describe snapshot on
        // wake and decides for itself — the event is purely caller-supplied.
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const firstCall = runTaskLoop.mock.calls[0]?.[0] as { taskID: string; event?: unknown }
        expect(firstCall.taskID).toBe(taskID)
        expect(firstCall.event).toBeUndefined()
      },
    })
  })

  test("reordered queued siblings are claimed by directory queue order", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const firstID = `task_queue_first_${now}`
        const secondID = `task_queue_second_${now}`
        const thirdID = `task_queue_third_${now}`

        Database.transaction((db) => {
          for (const [index, id] of [firstID, secondID, thirdID].entries()) {
            db.insert(EngineTaskTable).values({
              id,
              project_id: Instance.project.id,
              source: "test",
              title: `queued task ${index}`,
              request: "claim by user queue order",
              priority: "normal",
              queue_order: index,
              time_created: now + index,
              time_updated: now + index,
            }).run()
          }
        })

        const cwd = taskCwd(firstID)
        const result = reorderQueuedTasksForCwd({
          cwd,
          orderedTaskIDs: [thirdID, firstID, secondID],
          now: now + 10,
        })

        expect(result.queuedTaskIDs).toEqual([thirdID, firstID, secondID])

        await advanceQueue(cwd)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: thirdID })
        expect(taskStatus(thirdID)).toBe("active")
        expect(taskStatus(firstID)).toBe("queued")
      },
    })
  })

  test("reorder rejects active tasks and partial directory queues", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const activeID = `task_queue_locked_${now}`
        const queuedID = `task_queue_waiting_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable).values({
            id: activeID,
            project_id: Instance.project.id,
            source: "test",
            title: "active locked task",
            request: "must not be draggable",
            priority: "normal",
            queue_order: 0,
            time_started: now,
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: queuedID,
            project_id: Instance.project.id,
            source: "test",
            title: "queued task",
            request: "only queued tasks may be reordered",
            priority: "normal",
            queue_order: 1,
            time_created: now + 1,
            time_updated: now + 1,
          }).run()
        })

        expect(() => reorderQueuedTasksForCwd({
          cwd: taskCwd(activeID),
          orderedTaskIDs: [activeID, queuedID],
        })).toThrow("orderedTaskIDs must contain every queued task")
      },
    })
  })
})
