import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { SessionPromptState } from "../../src/session/prompt/state"
import { SessionStatus } from "../../src/session/status"
import { Database } from "../../src/storage/db"
import { ExecutorRegistry } from "../../src/executor/registry"
import { resetDatabase } from "../fixture/db"
import { Log } from "../../src/util/log"
import type { ExecutorAdapter } from "../../src/executor/contract"
import { DecisionLogTable } from "../../src/decision-log/schema"
import { eq } from "drizzle-orm"
import { TaskCancellationIncompleteError } from "../../src/engine/cancellation-error"

Log.init({ print: false })

afterEach(async () => {
  ExecutorRegistry.reset()
  await resetDatabase()
})

/**
 * Fake adapter that satisfies ExecutorAdapter just enough for cancelTask.
 * The critical bit is `abort()` which returns a promise that never settles
 * — this is exactly what opencorvus looks like when its child is
 * unresponsive. cancelTask must not mark a task cancelled when the executor
 * handle cannot be proven stopped.
 */
function fakeStuckAdapter(): ExecutorAdapter {
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
    abort: () =>
      new Promise<boolean>(() => {
        // Never resolves. Tests rely on cancelTask's withTimeout wrapper.
      }),
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

function seedRunningTaskRun() {
  const now = Date.now()
  const taskID = `task_cancel_${now}_${Math.random().toString(36).slice(2)}`
  const runID = `run_cancel_${now}_${Math.random().toString(36).slice(2)}`
  const projectID = `project_cancel_${now}_${Math.random().toString(36).slice(2)}`
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "cancel timeout test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "cancel timeout regression",
        request: "force executor.abort to hang and assert cancelTask still terminates",
        priority: "normal",
        executor: "opencorvus",
        time_started: now,
        time_completed: null,
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: "running",
          phase: "deliver",
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
      .run()
  })
  return { taskID, runID, projectID }
}

function seedRunningTaskSession() {
  const now = Date.now()
  const taskID = `task_cancel_prompt_${now}_${Math.random().toString(36).slice(2)}`
  const sessionID = `ses_cancel_prompt_${now}_${Math.random().toString(36).slice(2)}`
  const projectID = `project_cancel_prompt_${now}_${Math.random().toString(36).slice(2)}`
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "cancel prompt settle test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        parent_id: null,
        slug: "cancel-prompt-settle",
        directory: process.cwd(),
        title: "Cancel prompt settle",
        version: "1",
        kind: "root",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        session_id: sessionID,
        source: "test",
        title: "cancel prompt settle regression",
        request: "prove terminal status is not cancellation proof",
        priority: "normal",
        executor: "opencorvus",
        time_started: now,
        time_completed: null,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  return { taskID, sessionID }
}

describe("cancelTask under unresponsive executor.abort", () => {
  test("fails fast without marking task cancelled + records abort_timeout in decision_log", async () => {
    ExecutorRegistry.reset()
    ExecutorRegistry.register("opencorvus", fakeStuckAdapter())

    const { taskID, runID } = seedRunningTaskRun()

    // Defer the import so the mock module wired by other tests doesn't
    // bind a stale `git`/`createDecisionLog`. Also matches the lazy
    // import pattern used elsewhere for engine-state side effects.
    const { EngineService } = await import("../../src/task-api")

    const started = Date.now()
    await expect(
      EngineService.cancelTask(taskID, {
        abortTimeoutMs: 50,
        cleanupTimeoutMs: 100,
      }),
    ).rejects.toBeInstanceOf(TaskCancellationIncompleteError)
    const elapsed = Date.now() - started

    // Pre-Phase-1 this would be > 5 minutes (or forever) on a hung
    // executor; now it must fail in well under a second.
    expect(elapsed).toBeLessThan(2_000)

    // The task row must not claim successful cancellation while the executor
    // child may still be alive.
    const taskRow = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(taskRow?.time_completed).toBeNull()
    expect(taskRow?.error).toBeNull()

    // The cancellation-incomplete breadcrumb must exist so an operator can
    // find the stuck executor handle.
    const decisions = Database.use((db) =>
      db.select().from(DecisionLogTable).where(eq(DecisionLogTable.task_id, taskID)).all(),
    )
    const timeoutEntry = decisions.find((d) => d.key === "abort_timeout")
    expect(timeoutEntry).toBeTruthy()
    expect(timeoutEntry?.phase).toBe("cancel")
    expect(timeoutEntry?.value).toContain("executor.abort")
  }, 5_000)

  test("does not mark task cancelled while the cancelled prompt state is still live", async () => {
    const { taskID, sessionID } = seedRunningTaskSession()
    const abort = SessionPromptState.start(sessionID, process.cwd())
    expect(abort).toBeDefined()
    SessionStatus.set(sessionID, { type: "streaming" }, { publish: false })

    const { EngineService } = await import("../../src/task-api")
    try {
      await expect(
        EngineService.cancelTask(taskID, {
          cleanupTimeoutMs: 100,
          promptSettleInactivityMs: 20,
        }),
      ).rejects.toBeInstanceOf(TaskCancellationIncompleteError)

      const taskRow = Database.use((db) =>
        db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
      )
      expect(taskRow?.time_completed).toBeNull()
      expect(taskRow?.error).toBeNull()
      expect(SessionPromptState.isActive(sessionID, process.cwd())).toBe(true)
    } finally {
      SessionPromptState.finish(sessionID, abort, process.cwd())
    }
  }, 5_000)
})
