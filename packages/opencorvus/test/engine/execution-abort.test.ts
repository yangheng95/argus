import { afterEach, describe, expect, test } from "bun:test"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createGoalRun, updateGoalRun } from "../../src/engine/persist"
import { createRun } from "../../src/engine/writer"
import { updateRun } from "../../src/engine/state"
import { findGoalRun } from "../../src/engine/store"
import { abortGoalRunExecution } from "../../src/engine/execution-abort"
import { ExecutorRegistry } from "../../src/executor/registry"
import type { ExecutorAdapter } from "../../src/executor/contract"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  ExecutorRegistry.reset()
  await resetDatabase()
})

function fakeAbortAdapter(calls: Array<{ sessionID?: string; queueTaskID?: string }>): ExecutorAdapter {
  return {
    capabilities: () => ({
      submit: true,
      status: true,
      abort: true,
      acceptance: false,
      resume: false,
      events: false,
    }),
    submit: async () => {
      throw new Error("not used")
    },
    status: async () => {
      throw new Error("not used")
    },
    abort: async (input) => {
      calls.push(input)
      return true
    },
    acceptance: async () => {
      throw new Error("not used")
    },
    resume: async () => {
      throw new Error("not used")
    },
    events: () => {
      throw new Error("not used")
    },
  } as unknown as ExecutorAdapter
}

describe("execution abort", () => {
  test("abortGoalRunExecution aborts the coordinator executor before marking the goal run aborted", async () => {
    await using tmp = await tmpdir({ git: true })
    const abortCalls: Array<{ sessionID?: string; queueTaskID?: string }> = []
    ExecutorRegistry.register("opencorvus", fakeAbortAdapter(abortCalls))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_abort_goal_${now}`
        const goalID = `gol_abort_goal_${now}`
        const session = await Session.create({ kind: "build", title: "abort goal run child" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "abort goal run",
              request: "abort goal run executor handle",
              priority: "normal",
              executor: "opencorvus",
              session_id: session.id,
              time_started: now,
              time_completed: null,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Abort goal",
              slug: "abort-goal",
              objective: "Abort the goal run executor",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              kind: "feature",
              requirement_ids: [],
              priority: "blocking",
              source: "test",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const run = createRun({
          taskID,
          sessionID: session.id,
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          now,
        })
        await updateRun(
          run,
          {
            executor_ref: {
              session_id: "provider_session_abort_goal",
              queue_task_id: "queue_abort_goal",
            },
          },
          "bind abort handle",
        )
        const goalRun = createGoalRun({
          taskID,
          goalID,
          coordinatorRunID: run.id,
          sessionID: session.id,
          metadata: {
            provider_session_id: "provider_session_abort_goal",
            queue_task_id: "queue_abort_goal",
          },
          now: now + 1,
        })
        updateGoalRun(goalRun.id, {
          status: "running",
          time_started: now + 2,
        })

        const result = await abortGoalRunExecution({
          taskID,
          goalRunID: goalRun.id,
          reason: "test abort",
        })

        expect(abortCalls).toEqual([
          {
            sessionID: "provider_session_abort_goal",
            queueTaskID: "queue_abort_goal",
          },
        ])
        expect(result.executorAbortAttempted).toBe(true)
        expect(result.executorAbortSucceeded).toBe(true)
        expect(result.goalRunAborted).toBe(true)
        expect(findGoalRun(goalRun.id)?.status).toBe("aborted")
      },
    })
  })
})
