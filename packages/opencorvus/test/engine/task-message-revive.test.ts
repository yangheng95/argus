import { describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database, eq } from "../../src/storage/db"
import { EngineArtifactTable, EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { reopenActiveRunForOperatorWake } from "../../src/engine/task-message-open"
import { findRun, findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { EngineService } from "../../src/task-api"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { afterEach } from "bun:test"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

describe("reopenActiveRunForOperatorWake", () => {
  test("clears stale non-interaction blockers through a durable run artifact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "Blocked task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: null,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "MessageAbortedError: total deadline",
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

        const task = findTask(taskID)
        expect(task).toBeDefined()
        await reopenActiveRunForOperatorWake(task!)

        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
        expect(reopened?.time_updated).toBeGreaterThan(now)
      },
    })
  })

  test("preserves blocked runs while a real interaction is pending", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "Permission blocked task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: null,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "permission",
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
          db.insert(EngineInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              session_id: null,
              external_id: "ext_pending",
              request_type: "permission",
              status: "pending",
              title: "Need permission",
              body: "Need permission",
              payload: {},
              time_created: now,
              time_updated: now,
            } as any)
            .run()
        })

        const task = findTask(taskID)
        expect(task).toBeDefined()
        await reopenActiveRunForOperatorWake(task!)

        const blocked = findRun(runID)
        expect(blocked?.status).toBe("blocked")
        expect(blocked?.blocking_reason).toBe("permission")
      },
    })
  })
})

describe("EngineService.retryTask — active blocked run reopen", () => {
  test("retry clears a stale active run blocker instead of queuing an already active task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "Retry blocked task",
              request: "retry",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: null,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "MessageAbortedError: total deadline",
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

        await EngineService.retryTask(taskID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(deriveTaskStatus(findTask(taskID)!)).toBe("active")
        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
      },
    })
  })
})

describe("EngineService.recordOperatorNote — active blocked run reopen", () => {
  test("operator notes reopen the active run instead of creating an operator run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "operator note wake" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Operator note blocked task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "MessageAbortedError: total deadline",
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

        const result = await EngineService.recordOperatorNote(taskID, "please retry the latest step")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.resumed).toBe(true)
        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
        const runArtifacts = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
        )
        expect(
          runArtifacts.filter((row) => {
            const payload = row.payload as Record<string, unknown> | null
            const metadata = payload?.metadata as Record<string, unknown> | null
            return row.kind === "run" && metadata?.strategy === "operator_note"
          }),
        ).toEqual([])
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("operator notes on failed tasks reopen the task before waking the active run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "failed note wake" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Operator note failed task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 1,
              error: "previous failure",
              metadata: { decision_log: ["keep-me"] },
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "session prompt loop finished",
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

        const result = await EngineService.recordOperatorNote(taskID, "please continue this failed task")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.resumed).toBe(true)
        const task = findTask(taskID)!
        expect(deriveTaskStatus(task)).toBe("active")
        expect(task.error).toBeNull()
        expect(task.time_completed).toBeNull()
        expect((task.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })
})

describe("EngineService.handleTaskMessage — active blocked run wake", () => {
  test("service-level messages clear stale active run blockers before dispatch", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "message wake" })
        await seedRootSession(root.id)
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Message wake blocked task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "MessageAbortedError: total deadline",
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

        const result = await EngineService.handleTaskMessage(taskID, {
          text: "Please continue from the latest note.",
          source: "panel",
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.should_resume).toBe(true)
        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "Please continue from the latest note.",
            },
          },
        })
      },
    })
  })

  test("service-level messages do not clear pending interactions", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "message pending interaction" })
        await seedRootSession(root.id)
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Message wake interaction task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-blocked",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "permission",
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
          db.insert(EngineInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              session_id: root.id,
              external_id: "ext_pending_service_message",
              request_type: "permission",
              status: "pending",
              title: "Need permission",
              body: "Need permission",
              payload: {},
              time_created: now,
              time_updated: now,
            } as any)
            .run()
        })

        await EngineService.handleTaskMessage(taskID, {
          text: "Additional context while permission is pending.",
          source: "panel",
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        const blocked = findRun(runID)
        expect(blocked?.status).toBe("blocked")
        expect(blocked?.blocking_reason).toBe("permission")
        const interaction = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.id, interactionID))
            .get(),
        )
        expect(interaction?.status).toBe("pending")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })
})

/**
 * Source-level pin for the appendTaskSessionMessage hardening
 * (rule 7: no silent fallback). The previous `if (!task.session_id) return`
 * let injectMessage believe the append succeeded and dispatch fired with
 * an invisible message; the throw forces the failure to surface.
 */
describe("appendTaskSessionMessage — no silent no-op", () => {
  test("source throws when task.session_id or message context is missing", async () => {
    const src = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "task-api", "index.ts"), "utf8")
    // The function signature must no longer admit `undefined` as a happy path.
    expect(src).toMatch(
      /async function appendTaskSessionMessage[\s\S]*?Promise<\{\s*info: Message\.User;\s*parts: Message\.Part\[\]\s*\}>/,
    )
    // Both guard branches must throw rather than `return`.
    expect(src).toMatch(/if \(!task\.session_id\) \{\s*throw new Error\(/)
    expect(src).toMatch(/if \(!ctx\) \{\s*throw new Error\(/)
    // The legacy silent-return wording is gone.
    expect(src).not.toMatch(/if \(!task\.session_id\) return\b/)
    expect(src).not.toMatch(/if \(!ctx\) return\b/)
  })
})

/**
 * Source-level pin for the overlay chat fix. The previous "completed →
 * fork new task" branch contradicted the same-task continuation invariant by severing
 * conversation history at the task boundary. Every status now goes
 * through /task/:id/message uniformly.
 */
describe("overlay chat — terminal tasks no longer fork on send", () => {
  test("panelMessage does not branch on taskStatus === 'completed'", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "..", "overlay", "src", "services", "chat.ts"),
      "utf8",
    )
    expect(src).not.toMatch(/taskStatus === ["']completed["']/)
    expect(src).not.toMatch(/Completed tasks → create a follow-up task/)
    expect(src).toMatch(/Every status .* send message directly to the task/s)
  })
})

async function seedRootSession(sessionID: string, text = "initial request") {
  const info = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user" as const,
    time: { created: Date.now() - 1_000 },
    agent: "build",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  }
  await Session.persistMessage({
    info,
    parts: [
      {
        id: Identifier.ascending("part"),
        messageID: info.id,
        sessionID,
        type: "text",
        text,
        kind: "user_content",
      },
    ],
    touchSessionID: sessionID,
  })
}
