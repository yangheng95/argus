import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { beginBuildAttempt } from "../../src/engine/persist"
import { dispatchTaskLoop, queuedTaskEventStats } from "../../src/engine/queue"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
} from "../../src/engine/tool-ownership"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
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

describe("queued wake ownership drain", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("queued wake drains when live orchestrator tool ownership completes after loop exit", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_late_owner_clear_${now}`
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        let runCount = 0
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          runCount += 1
          if (runCount === 1) await holdLoop
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "late owner clear task",
              request: "queued wake must drain after ownership completes",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const goalID = `goal_queue_late_owner_clear_${now}`
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live goal",
              slug: "live-goal",
              objective: "Prove queued wake drains after ownership completion.",
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
            .run(),
        )
        const childSessionID = `ses_build_late_clear_${now}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: childSessionID,
          now,
        })

        await dispatchTaskLoop({ taskID })
        await waitForMockCalls(runTaskLoop, 1)

        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: `ses_orchestrator_${now}`,
          orchestratorMessageID: `msg_orchestrator_${now}`,
          toolCallID: `cal_build_${now}`,
          toolPartID: `prt_build_${now}`,
          childSessionID,
          scope: "goal",
          goalID,
          goalRunID,
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })

        const result = await dispatchTaskLoop({
          taskID,
          event: { note: "queued behind live ownership" },
          interrupt: true,
        })
        expect(result).toBe("queued")
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1 })

        release!()
        await holdLoop
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1 })

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        await waitForMockCalls(runTaskLoop, 2)

        expect(queuedTaskEventStats()).toMatchObject({ tasks: 0 })
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
          event: { note: "queued behind live ownership" },
        })
      },
    })
  })
})
