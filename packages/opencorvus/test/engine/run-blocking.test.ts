import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineRuntime } from "../../src/engine/runtime"
import { blockActiveRunForTask, hooks } from "../../src/engine/state"
import { findRun } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("run blocking state", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("blocks the active run with the orchestrator stream error reason", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "stream-error" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "stream error",
              request: "stream error",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                plan_version_id: null,
                session_id: session.id,
                executor: "opencorvus",
                status: "running",
                phase: "dispatch",
                blocking_reason: null,
                error: null,
                retry_count: 0,
                executor_ref: null,
                metadata: null,
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        await blockActiveRunForTask(taskID, {
          blockingReason: "orchestrator_stream_error",
          error: "APIError: HTTP 429",
          summary: "Orchestrator stream error: APIError: HTTP 429",
        })

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("orchestrator_stream_error")
        expect(run?.error).toBe("APIError: HTTP 429")
      },
    })
  })

  test("syncRun preserves non-interaction blockers without queue refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "stream-error-sync" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "stream error sync",
              request: "stream error sync",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
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
                blocking_reason: "orchestrator_stream_error",
                error: "APIError: HTTP 429",
                retry_count: 0,
                executor_ref: null,
                metadata: null,
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        await EngineRuntime.syncRun(runID, hooks())

        const run = findRun(runID)
        expect(run?.status).toBe("blocked")
        expect(run?.blocking_reason).toBe("orchestrator_stream_error")
        expect(run?.error).toBe("APIError: HTTP 429")
      },
    })
  })
})
