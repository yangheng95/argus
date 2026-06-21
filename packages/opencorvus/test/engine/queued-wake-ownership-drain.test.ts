import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { beginBuildAttempt } from "../../src/engine/persist"
import { dispatchTaskLoop, drainPendingQueuedOperatorWakes, queuedTaskEventStats } from "../../src/engine/queue"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
} from "../../src/engine/tool-ownership"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Instance } from "../../src/project/instance"
import { Database, and, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
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

  test("startup liveness drains pending durable operator wakes when ownership is already clear", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_pending_operator_restart_${now}`
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "pending operator wake restart task",
              request: "pending durable operator wake must drain after restart",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "queued_operator_wake",
              label: "pending",
              payload: {
                wake_id: `msg_operator_restart_${now}`,
                message_id: `msg_operator_restart_${now}`,
                event: {
                  note: "queued operator message survived process restart",
                  operatorMessage: {
                    text: "continue after restart",
                    source: "api_message",
                    messageID: `msg_operator_restart_${now}`,
                  },
                },
                time_queued: now,
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        expect(drainPendingQueuedOperatorWakes()).toBe(1)
        await waitForMockCalls(runTaskLoop, 1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "continue after restart",
              messageID: `msg_operator_restart_${now}`,
            },
          },
        })
        expect(queuedOperatorWakeLabels(taskID)).toEqual(["drained"])
      },
    })
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

  test("retry and replan operator intents queued behind live ownership are durable and ordered", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_operator_intents_${now}`
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "operator intent queue task",
              request: "retry and replan intents must persist behind live ownership",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const goalID = `goal_queue_operator_intents_${now}`
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live goal",
              slug: "live-goal",
              objective: "Prove retry and replan operator intents drain in order.",
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
        const childSessionID = `ses_build_operator_intents_${now}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: childSessionID,
          now,
        })
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

        expect(
          await dispatchTaskLoop({
            taskID,
            event: { note: "User requested retry.", operatorIntent: { kind: "retry" } },
          }),
        ).toBe("queued")
        expect(
          await dispatchTaskLoop({
            taskID,
            event: { note: "User requested replan.", operatorIntent: { kind: "replan" } },
          }),
        ).toBe("queued")
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1, events: 2 })
        expect(queuedOperatorWakePayloads(taskID).map((payload) => payload.event.operatorIntent?.kind)).toEqual([
          "retry",
          "replan",
        ])

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        await waitForMockCalls(runTaskLoop, 2)

        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: { note: "User requested retry.", operatorIntent: { kind: "retry" } },
        })
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
          event: { note: "User requested replan.", operatorIntent: { kind: "replan" } },
        })
        expect(queuedOperatorWakeLabels(taskID)).toEqual(["drained", "drained"])
      },
    })
  })

  test("operator message wakes queued behind live ownership drain in order", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_operator_messages_${now}`
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
              title: "operator wake queue task",
              request: "operator messages must remain ordered behind live ownership",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const goalID = `goal_queue_operator_messages_${now}`
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live goal",
              slug: "live-goal",
              objective: "Prove queued operator messages drain in order.",
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
        const childSessionID = `ses_build_operator_messages_${now}`
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

        const first = await dispatchTaskLoop({
          taskID,
          event: {
            note: "first operator message",
            operatorMessage: {
              text: "first queued operator message",
              source: "api_message",
              messageID: `msg_operator_first_${now}`,
            },
          },
        })
        const second = await dispatchTaskLoop({
          taskID,
          event: {
            note: "second operator message",
            operatorMessage: {
              text: "second queued operator message",
              source: "api_message",
              messageID: `msg_operator_second_${now}`,
            },
          },
        })
        expect(first).toBe("queued")
        expect(second).toBe("queued")
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1, events: 2 })

        release!()
        await holdLoop
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1, events: 2 })

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        await waitForMockCalls(runTaskLoop, 3)

        expect(queuedTaskEventStats()).toMatchObject({ tasks: 0, events: 0 })
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "first queued operator message",
              messageID: `msg_operator_first_${now}`,
            },
          },
        })
        expect(runTaskLoop.mock.calls[2]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "second queued operator message",
              messageID: `msg_operator_second_${now}`,
            },
          },
        })
      },
    })
  })
})

function queuedOperatorWakeLabels(taskID: string): string[] {
  return Database.use((db) =>
    db
      .select({ label: EngineArtifactTable.label })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "queued_operator_wake")))
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .all()
      .map((row) => row.label),
  )
}

function queuedOperatorWakePayloads(taskID: string): Array<{ event: { operatorIntent?: { kind?: string } } }> {
  return Database.use((db) =>
    db
      .select({ payload: EngineArtifactTable.payload })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "queued_operator_wake")))
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .all()
      .map((row) => row.payload as { event: { operatorIntent?: { kind?: string } } }),
  )
}
