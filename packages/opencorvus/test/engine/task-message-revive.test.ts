import { describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database, eq } from "../../src/storage/db"
import {
  EngineArtifactTable,
  EngineInteractionRequestTable,
  EnginePlanVersionTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { findActivePlanForTask, findRun, findTask } from "../../src/engine/store"
import { EngineRuntime } from "../../src/engine/runtime"
import { hooks } from "../../src/engine/state"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { EngineService } from "../../src/task-api"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { afterEach } from "bun:test"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

describe("EngineService.retryTask — active blocked run reopen", () => {
  test("retry clears a stale active run blocker and dispatches retry intent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
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
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const event = (
          runTaskLoop.mock.calls[0]?.[0] as
            | { event?: { note?: string; operatorIntent?: { kind?: string } } }
            | undefined
        )?.event
        expect(event?.operatorIntent).toEqual({ kind: "retry" })
        expect(event?.note).toContain("User requested retry")
        expect(event?.note).not.toContain("User requested replan")
      },
    })
  })
})

describe("EngineService.replanTask — structured replan intent", () => {
  test("replan supersedes the active plan and does not reopen a blocked run as retry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const planID = Identifier.ascending("plan")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "replan blocked run" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Replan blocked task",
              request: "replan",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
          db.insert(EnginePlanVersionTable)
            .values({
              id: planID,
              task_id: taskID,
              version: 1,
              status: "active",
              summary: "stale active plan",
              prompt: "old plan",
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
              label: "run-blocked",
              payload: {
                plan_version_id: planID,
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

        await EngineService.replanTask(taskID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(findActivePlanForTask(taskID)).toBeUndefined()
        const blocked = findRun(runID)
        expect(blocked?.status).toBe("blocked")
        expect(blocked?.blocking_reason).toBe("orchestrator_stream_error")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const event = (
          runTaskLoop.mock.calls[0]?.[0] as
            | { event?: { note?: string; operatorIntent?: { kind?: string } } }
            | undefined
        )?.event
        expect(event?.operatorIntent).toEqual({ kind: "replan" })
        expect(event?.note).toContain("User requested replan")
        expect(event?.note).not.toContain("User requested retry")
      },
    })
  })
})

describe("EngineService.recordOperatorNote — active blocked run wake", () => {
  test("operator notes reopen stale active run blockers before waking", async () => {
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

  test("operator notes on failed tasks record the note without waking terminal work", async () => {
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

        expect(result).toMatchObject({ resumed: false, status: "failed" })
        const task = findTask(taskID)!
        expect(deriveTaskStatus(task)).toBe("failed")
        expect(task.error).toBe("previous failure")
        expect(task.time_completed).toBe(now + 1)
        expect((task.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
        const blocked = findRun(runID)
        expect(blocked?.status).toBe("blocked")
        expect(blocked?.blocking_reason).toBe("orchestrator_stream_error")
        expect(blocked?.error).toBe("session prompt loop finished")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("operator notes on completed tasks record the note without waking terminal work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "completed note wake" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Operator note completed task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now - 10,
              time_completed: now,
              error: null,
            } as any)
            .run()
        })

        const result = await EngineService.recordOperatorNote(taskID, "continue this completed task")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toMatchObject({ resumed: false, status: "completed" })
        const task = findTask(taskID)!
        expect(deriveTaskStatus(task)).toBe("completed")
        expect(task.error).toBeNull()
        expect(task.time_completed).toBe(now)
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("operator notes on cancelled tasks preserve cancellation without waking terminal work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "cancelled note wake" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Operator note cancelled task",
              request: "continue",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now - 10,
              time_completed: now,
              error: "task cancelled",
              metadata: { cancelled: true, decision_log: ["keep-me"] },
            } as any)
            .run()
        })

        const result = await EngineService.recordOperatorNote(taskID, "continue this cancelled task")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toMatchObject({ resumed: false, status: "cancelled" })
        const task = findTask(taskID)!
        expect(deriveTaskStatus(task)).toBe("cancelled")
        expect(task.error).toBe("task cancelled")
        expect(task.time_completed).toBe(now)
        expect((task.metadata as { cancelled?: boolean; decision_log?: string[] } | null)?.cancelled).toBe(true)
        expect((task.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })
})

describe("EngineService.handleTaskMessage — active blocked run wake", () => {
  test("service-level message clears task rewind cursor for the new branch", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "message clears rewind" })
        await seedRootSession(root.id)
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Message clears rewind task",
              request: "continue",
              priority: "normal",
              rewind_cursor_time: now - 500,
              rewind_cursor_event_id: "evt_rewind_anchor",
              rewind_count: 1,
              time_created: now - 1_000,
              time_updated: now,
              time_started: now,
            } as any)
            .run()
        })

        const result = await EngineService.handleTaskMessage(taskID, {
          text: "Continue from the rewound point.",
          source: "panel",
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.should_resume).toBe(true)
        expect(findTask(taskID)?.rewind_cursor_time).toBeNull()
        expect(findTask(taskID)?.rewind_cursor_event_id).toBeNull()
        const rewindEvent = ProtocolStore.listTaskEvents(taskID).find((event) => event.type === "task.rewound")
        expect(rewindEvent?.payload).toMatchObject({
          taskID,
          cursorTime: 0,
          resetWorktree: false,
        })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("service-level messages reopen stale active run blockers before dispatch", async () => {
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

  test("service-level continue lets a completed goal retry trigger the next refill wake", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const goalRunID = Identifier.ascending("grun")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "message refill wake" })
        await seedRootSession(root.id)
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Message continues blocked task",
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
                error: "OrchestratorAborted: orchestrator aborted",
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
          db.insert(EngineArtifactTable)
            .values({
              id: goalRunID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              kind: "goal_run_attempt",
              label: "goal-run-completed",
              payload: {
                goal_id: "gol_retry_completed",
                session_id: null,
                status: "completed",
                retry_count: 1,
                workspace_dir: null,
                workspace_branch: null,
                workspace_base_ref: null,
                owner: null,
                summary: "retry completed",
                error: null,
                files: null,
                metrics: null,
                time_started: now + 1,
                time_completed: now + 2,
              },
              time_created: now + 2,
              time_updated: now + 2,
            })
            .run()
        })

        await EngineService.handleTaskMessage(taskID, {
          text: "继续",
          source: "panel",
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        const reopened = findRun(runID)
        expect(reopened?.status).toBe("running")
        expect(reopened?.blocking_reason).toBeNull()
        expect(reopened?.error).toBeNull()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        await EngineRuntime.syncRun(runID, hooks())
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({ taskID })
        const refillFacts = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
        ).filter((row) => row.kind === "goal_refill_notification")
        expect(refillFacts).toHaveLength(1)
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
