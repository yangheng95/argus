import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { type CodingProvider } from "../../src/executor/compat"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
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
