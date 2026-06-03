import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { type CodingProvider } from "../../src/executor/contract"
import { type ExecutorAdapter } from "../../src/executor/contract"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { EngineService } from "@/task-api"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { findRun } from "../../src/engine/store"
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
        const session = await Session.create({ kind: "assistant", title: "protocol-interaction" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "test",
            title: "protocol interaction",
            request: "protocol interaction",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )
        // Phase-6-e: run rows live in engine_artifact (kind="run").
        Database.use((db) =>
          db.insert(EngineArtifactTable).values({
            id: runID,
            task_id: taskID,
            run_id: runID,
            kind: "run",
            label: "run-blocked",
            payload: {
              plan_version_id: null,
              session_id: session.id,
              executor: "codex",
              status: "blocked",
              phase: "execute",
              blocking_reason: "permission",
              error: null,
              retry_count: 0,
              executor_ref: {
                session_id: "thr_1:turn_1",
                queue_task_id: "queue_1",
              },
              metadata: null,
              time_started: null,
              time_completed: null,
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(EngineInteractionRequestTable).values({
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

        await EngineService.replyInteraction(interactionID, {
          reply: "always",
          autoReply: false,
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
          db.select().from(EngineInteractionRequestTable).where(eq(EngineInteractionRequestTable.id, interactionID)).get(),
        )
        expect(row?.status).toBe("answered")
      },
    })
  })

  test("syncRun clears resolved coordinator question blockers without queue refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "coordinator-blocker" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()

        Database.use((db) =>
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "test",
            title: "coordinator blocker",
            request: "coordinator blocker",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(EngineArtifactTable).values({
            id: runID,
            task_id: taskID,
            run_id: runID,
            kind: "run",
            label: "run-blocked",
            payload: {
              plan_version_id: null,
              session_id: session.id,
              executor: "opencorvus",
              status: "blocked",
              phase: "dispatch",
              blocking_reason: "question",
              error: null,
              retry_count: 0,
              executor_ref: null,
              metadata: null,
              time_started: now,
              time_completed: null,
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )

        await EngineRuntime.syncRun(runID, hooks())

        const run = findRun(runID)
        expect(run?.status).toBe("running")
        expect(run?.blocking_reason).toBeNull()
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
      acceptance: true,
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
  async acceptance() {
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
