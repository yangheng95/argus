import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { type CodingProvider } from "../../src/executor/compat"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorGoalRunTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("protocol interaction resolution", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("replyInteraction routes protocol approval replies back to executor", async () => {
    await using tmp = await tmpdir({ git: true })
    const resolve = spyOn(adapter, "resolve").mockResolvedValue(true)
    ExecutorRegistry.register("codex", adapter)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "protocol-interaction" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()

        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            active_run_id: runID,
            source: "test",
            title: "protocol interaction",
            request: "protocol interaction",
            status: "blocked",
            priority: "normal",
            blocking_reason: "permission",
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: session.id,
            executor: "codex",
            status: "blocked",
            phase: "dispatch",
            blocking_reason: "permission",
            retry_count: 0,
            executor_ref: {
              session_id: "thr_1:turn_1",
              queue_task_id: "queue_1",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorInteractionRequestTable).values({
            id: interactionID,
            task_id: taskID,
            run_id: runID,
            session_id: session.id,
            external_id: "protocol:executor_session:7",
            request_type: "permission",
            status: "pending",
            title: "Executor approval",
            body: "git status",
            payload: {
              protocol_request: true,
              request_id: "7",
              request_kind: "approval_request",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )

        await OrchestratorService.replyInteraction(interactionID, {
          reply: "always",
        })

        expect(resolve).toHaveBeenCalledWith({
          sessionID: session.id,
          queueTaskID: "queue_1",
          requestID: "7",
          kind: "approval",
          response: {
            decision: "acceptForSession",
          },
        })

        const row = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.id, interactionID)).get(),
        )
        expect(row?.status).toBe("answered")
      },
    })
  })

  test("replyInteraction routes protocol replies to the matching goal run when multiple are active", async () => {
    await using tmp = await tmpdir({ git: true })
    const resolve = spyOn(adapter, "resolve").mockResolvedValue(true)
    spyOn(adapter, "status").mockResolvedValue({
      queueTaskID: "queue_2",
      status: "queued",
      error: null,
    })
    ExecutorRegistry.register("codex", adapter)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "protocol-multi-root" })
        const goalSessionA = await Session.create({ parentID: root.id, title: "goal-a" })
        const goalSessionB = await Session.create({ parentID: root.id, title: "goal-b" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const specID = Identifier.ascending("spec")
        const interactionID = Identifier.ascending("interaction")
        const goalA = Identifier.ascending("goal")
        const goalB = Identifier.ascending("goal")
        const goalRunA = Identifier.ascending("goal_run")
        const goalRunB = Identifier.ascending("goal_run")
        const now = Date.now()

        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            active_run_id: runID,
            source: "test",
            title: "protocol interaction multi goal",
            request: "protocol interaction multi goal",
            status: "blocked",
            priority: "normal",
            blocking_reason: "permission",
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: root.id,
            executor: "codex",
            status: "blocked",
            phase: "dispatch",
            blocking_reason: "permission",
            retry_count: 0,
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorSpecSnapshotTable).values({
            id: specID,
            task_id: taskID,
            version: 1,
            status: "ready",
            summary: "spec",
            content: "spec",
            scope: "",
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorGoalTable).values([{
            id: goalA,
            task_id: taskID,
            spec_snapshot_id: specID,
            description: "goal a",
            criteria: "goal a",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 0,
            time_created: now,
            time_updated: now,
          }, {
            id: goalB,
            task_id: taskID,
            spec_snapshot_id: specID,
            description: "goal b",
            criteria: "goal b",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 1,
            time_created: now,
            time_updated: now,
          }]).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorGoalRunTable).values([{
            id: goalRunA,
            task_id: taskID,
            goal_id: goalA,
            coordinator_run_id: runID,
            session_id: goalSessionA.id,
            executor: "codex",
            status: "blocked",
            metadata: {
              queue_task_id: "queue_1",
            },
            time_created: now,
            time_updated: now,
          }, {
            id: goalRunB,
            task_id: taskID,
            goal_id: goalB,
            coordinator_run_id: runID,
            session_id: goalSessionB.id,
            executor: "codex",
            status: "blocked",
            metadata: {
              queue_task_id: "queue_2",
            },
            time_created: now + 1,
            time_updated: now + 1,
          }]).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorInteractionRequestTable).values({
            id: interactionID,
            task_id: taskID,
            run_id: runID,
            session_id: goalSessionB.id,
            external_id: "protocol:executor_session:17",
            request_type: "permission",
            status: "pending",
            title: "Executor approval",
            body: "git push",
            payload: {
              protocol_request: true,
              goal_run_id: goalRunB,
              request_id: "17",
              request_kind: "approval_request",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )

        await OrchestratorService.replyInteraction(interactionID, {
          reply: "once",
        })

        expect(resolve).toHaveBeenCalledWith({
          sessionID: goalSessionB.id,
          queueTaskID: "queue_2",
          requestID: "17",
          kind: "approval",
          response: {
            decision: "accept",
          },
        })
      },
    })
  })

  test("stale protocol approvals are rejected in the executor before the run resumes", async () => {
    await using tmp = await tmpdir({ git: true })
    const resolve = spyOn(adapter, "resolve").mockResolvedValue(true)
    spyOn(adapter, "status").mockResolvedValue({
      queueTaskID: "queue_1",
      status: "queued",
      error: null,
    })
    ExecutorRegistry.register("codex", adapter)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "protocol-timeout" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()

        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            active_run_id: runID,
            source: "test",
            title: "protocol timeout",
            request: "protocol timeout",
            status: "blocked",
            priority: "normal",
            blocking_reason: "permission",
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: session.id,
            executor: "codex",
            status: "blocked",
            phase: "dispatch",
            blocking_reason: "permission",
            retry_count: 0,
            executor_ref: {
              session_id: "thr_1:turn_1",
              queue_task_id: "queue_1",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorInteractionRequestTable).values({
            id: interactionID,
            task_id: taskID,
            run_id: runID,
            session_id: session.id,
            external_id: "protocol:executor_session:9",
            request_type: "permission",
            status: "pending",
            title: "Executor approval",
            body: "git push",
            payload: {
              protocol_request: true,
              request_id: "9",
              request_kind: "approval_request",
            },
            time_created: now - 60_000,
            time_updated: now - 60_000,
          }).run(),
        )

        const progress = await OrchestratorService.getProgress(taskID)

        expect(resolve).toHaveBeenCalledWith({
          sessionID: session.id,
          queueTaskID: "queue_1",
          requestID: "9",
          kind: "approval",
          response: {
            decision: "decline",
          },
        })
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")

        const row = Database.use((db) =>
          db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.id, interactionID)).get(),
        )
        expect(row?.status).toBe("rejected")
      },
    })
  })
})

const adapter: ExecutorAdapter = {
  capabilities() {
    return {
      submit: true,
      status: true,
      abort: true,
      delivery: true,
      resume: true,
      events: true,
    }
  },
  async submit(input) {
    return {
      sessionID: input.sessionID,
      queueTaskID: "queue_1",
    }
  },
  async status(queueTaskID) {
    return {
      queueTaskID,
      status: "blocked",
      error: null,
    }
  },
  async abort() {
    return true
  },
  async delivery() {
    return {
      summary: "",
      diffs: [],
    }
  },
  async resume(input) {
    return {
      sessionID: input.sessionID,
      queueTaskID: "queue_1",
    }
  },
  async *events() {},
  async resolve() {
    return true
  },
}
