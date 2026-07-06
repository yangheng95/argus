import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  advanceQueue,
  directoryQueueSnapshot,
  dispatchTaskLoop,
  dispatchTaskLoopInBackground,
  drainQueuedTaskEventIfUnowned,
  queuedTaskEventStats,
  reorderQueuedTasksForCwd,
  taskCwd,
  waitForQueueCompletionHooksForTest,
} from "../../src/engine/queue"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { processOwner } from "../../src/engine/lease"
import { beginBuildAttempt } from "../../src/engine/persist"
import { findGoalRun, findRun, findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { CronService } from "../../src/scheduler/cron-service"
import { resolveConfiguredModelRef } from "../../src/agent/model"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { EngineService } from "../../src/task-api"
import { Identifier } from "../../src/id/id"

function taskStatus(id: string): string | undefined {
  const t = findTask(id)
  return t ? deriveTaskStatus(t) : undefined
}

async function waitForTaskStatus(id: string, status: string) {
  for (let i = 0; i < 50; i++) {
    if (taskStatus(id) === status) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForMockCalls(mockFn: { mock: { calls: unknown[] } }, count: number) {
  for (let i = 0; i < 50; i++) {
    if (mockFn.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function seedRootSession(sessionID: string, text = "initial request") {
  const info = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user" as const,
    time: { created: Date.now() - 1_000 },
    agent: "orchestrator",
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
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Database, eq } from "../../src/storage/db"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { resetDatabase, TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS } from "../fixture/db"
import { expectNoProcessErrors } from "../fixture/process-errors"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ENGINE_QUEUE_TEST_TIMEOUT_MS = TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS + 15_000

async function importCurrentProjectRootWithForeignParent(input: {
  directory: string
  foreignParentID: string
  title: string
}): Promise<Session.Info> {
  const now = Date.now()
  const info: Session.Info = {
    id: Identifier.descending("session"),
    slug: `queue-cross-parent-${Math.random().toString(36).slice(2)}`,
    projectID: Instance.project.id,
    directory: input.directory,
    parentID: input.foreignParentID,
    title: input.title,
    version: "test",
    kind: "root",
    metadata: {},
    time: {
      created: now,
      updated: now,
    },
  }
  await Session.importSnapshot({ info, messages: [] })
  return info
}

function queuedOperatorWakeLabels(taskID: string): string[] {
  return Database.use((db) => db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all())
    .filter((row) => row.kind === "queued_operator_wake")
    .map((row) => row.label)
}

describe("engine queue", () => {
  afterEach(
    async () => {
      await waitForQueueCompletionHooksForTest()
      mock.restore()
      await resetDatabase()
    },
    { timeout: ENGINE_QUEUE_TEST_TIMEOUT_MS },
  )

  test("loop completion finally promise is observed", async () => {
    const source = await Bun.file(new URL("../../src/engine/queue.ts", import.meta.url)).text()
    const attach = source.slice(source.indexOf("function attachLoopCompletion"))
    expect(attach).toContain("const completionHook = loopPromise")
    expect(attach).toContain(".finally(async () => {")
    expect(attach).toContain(".catch((err) => {")
    expect(attach).toContain("loopCompletionHooksForTest.add(completionHook)")
    expect(attach).toContain("completionHook.finally(() => {")
    expect(attach.indexOf(".finally(async () => {")).toBeLessThan(attach.indexOf(".catch((err) => {"))
  })

  test("background dispatch contains database unavailable rejection", async () => {
    try {
      const sqliteError = new Error("disk I/O error") as Error & { code: string }
      sqliteError.name = "SQLiteError"
      sqliteError.code = "SQLITE_IOERR_READ"
      Database.normalizeError(sqliteError, "test.seed")

      await expectNoProcessErrors(async () => {
        dispatchTaskLoopInBackground({ taskID: "task_db_unavailable" }, "test.background-dispatch")
      })

      expect(Database.unavailable()).toMatchObject({
        code: "SQLITE_IOERR_READ",
        operation: "test.seed",
      })
    } finally {
      Database.close()
    }
  })

  test("dispatchTaskLoop preserves the caller's event through the queue claim", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_created_${Date.now()}`
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued created task",
              request: "dispatch through queue",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        await dispatchTaskLoop({ taskID, event: { note: "caller-supplied note" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: { note: "caller-supplied note" },
        })
        expect(taskStatus(taskID)).toBe("active")
      },
    })
  })

  test("operator message active re-entry records a started wake commitment", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "operator started task" })
        await seedRootSession(root.id)
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "operator started task",
              request: "operator started task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const result = await EngineService.handleTaskMessage(taskID, {
          text: "马上重新看当前要求。",
          source: "panel",
        })
        await waitForMockCalls(runTaskLoop, 1)

        expect(result).toMatchObject({
          wake_status: "started",
          should_resume: true,
        })
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "马上重新看当前要求。",
              source: "panel",
              messageID: result.user_message.info.id,
            },
          },
        })
        const wakeRows = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
        ).filter((row) => row.kind === "operator_message_wake")
        expect(wakeRows).toHaveLength(1)
        expect(wakeRows[0]).toMatchObject({
          label: "started",
          payload: {
            task_id: taskID,
            message_id: result.user_message.info.id,
            source: "panel",
            wake_status: "started",
          },
        })
      },
    })
  })

  test("accepted task wake consumes pending task wait cron before launching the loop", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_wait_consume_${Date.now()}`
        const now = Date.now()
        const session = await Session.create({ kind: "orchestrator", title: "task queue wait consume root" })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              source: "test",
              title: "active wait task",
              request: "consume pending wait before wake",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const scheduled = await CronService.createTaskWake({
          name: "task wait",
          reason: "external signal",
          projectId: Instance.project.id,
          taskId: taskID,
          durationMs: 20 * 60 * 1000,
        })

        const result = await dispatchTaskLoop({ taskID, event: { note: "external result arrived" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("started")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(
          Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, scheduled.id)).get()),
        ).toBeUndefined()
      },
    })
  })

  test("active task wake is not queued by stale live goal_run alone", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_stale_goal_run_${Date.now()}`
        const goalID = `goal_queue_stale_goal_run_${Date.now()}`
        const now = Date.now()

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "active task with stale live goal_run",
              request: "wake should not queue behind audit-only lifecycle facts",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Stale live goal",
              slug: "stale-live-goal",
              objective: "Do not queue task wake from this row alone.",
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
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: `ses_queue_stale_goal_run_${now}`,
          now,
        })
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const result = await dispatchTaskLoop({
          taskID,
          event: { note: "operator wake should not queue behind stale goal_run" },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("started")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: { note: "operator wake should not queue behind stale goal_run" },
        })
      },
    })
  })

  test("passive wake does not restart a stream-error blocked run", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_stream_blocked_${Date.now()}`
        const runID = `run_queue_stream_blocked_${Date.now()}`
        const now = Date.now()

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "stream blocked task",
              request: "do not restart without operator intent",
              priority: "normal",
              time_started: now,
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
                plan_version_id: null,
                session_id: null,
                executor: "opencorvus",
                status: "blocked",
                phase: "dispatch",
                blocking_reason: "orchestrator_stream_error",
                error: "certificate has expired",
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

        const passiveResult = await dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(passiveResult).toBe("ignored")
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(findRun(runID)?.status).toBe("blocked")

        const lifecycleResult = await dispatchTaskLoop({
          taskID,
          event: {
            lifecycleFact: {
              kind: "terminal_goal_refill_dispatched",
              eventID: "pev_terminal_refill_queue",
            },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(lifecycleResult).toBe("started")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            lifecycleFact: {
              kind: "terminal_goal_refill_dispatched",
              eventID: "pev_terminal_refill_queue",
            },
          },
        })
        runTaskLoop.mockClear()

        const operatorResult = await dispatchTaskLoop({
          taskID,
          event: {
            note: "User requested replan after stream error.",
            operatorIntent: { kind: "replan" },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(operatorResult).toBe("started")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            note: "User requested replan after stream error.",
            operatorIntent: { kind: "replan" },
          },
        })

        runTaskLoop.mockClear()
        const coordinationResult = await dispatchTaskLoop({
          taskID,
          event: {
            note: "Operator steer created a coordination request.",
            coordinationRequest: { requestID: "artifact_operator_steer_queue" },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(coordinationResult).toBe("started")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            note: "Operator steer created a coordination request.",
            coordinationRequest: { requestID: "artifact_operator_steer_queue" },
          },
        })
      },
    })
  })

  test("queued passive wake is discarded after the run becomes stream-error blocked", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_stream_blocked_drain_${Date.now()}`
        const runID = `run_queue_stream_blocked_drain_${Date.now()}`
        const goalID = `goal_queue_stream_blocked_drain_${Date.now()}`
        const childSessionID = `ses_stream_blocked_drain_${Date.now()}`
        const now = Date.now()

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "stream blocked drain task",
              request: "discard passive queued wake",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live goal",
              slug: "live-goal",
              objective: "Hold ownership while a passive wake queues.",
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
            .run()
        })

        const goalRunID = beginBuildAttempt({ taskID, goalID, sessionID: childSessionID, now })
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

        const queuedResult = await dispatchTaskLoop({
          taskID,
          event: { note: "terminal goal refill wake queued behind live ownership" },
        })
        expect(queuedResult).toBe("queued")

        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: `${runID}_blocked`,
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
                error: "certificate has expired",
                retry_count: 0,
                executor_ref: null,
                metadata: null,
                time_started: now,
                time_completed: null,
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run(),
        )
        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 2,
        })

        const drained = await drainQueuedTaskEventIfUnowned(taskID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(drained).toBe(false)
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(findRun(runID)?.status).toBe("blocked")
      },
    })
  })

  test("drainQueuedTaskEventIfUnowned preserves a queued wake when task root parent leaves the project", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })
    await using foreign = await tmpdir({ git: true, config: { model: "foreign/default" } })

    let foreignParentID = ""
    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "root", title: "foreign queued wake parent" })).id
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const root = await importCurrentProjectRootWithForeignParent({
          directory: tmp.path,
          foreignParentID,
          title: "polluted queued wake root",
        })
        const taskID = `task_queue_polluted_wake_${now}`

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "polluted queued wake task",
              request: "queued wake must not cross project lineage",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "queued_operator_wake",
              label: "pending",
              payload: {
                wake_id: `wake_polluted_${now}`,
                task_id: taskID,
                source_kind: "operator_message",
                event: {
                  note: "queued operator wake for polluted lineage",
                  operatorMessage: {
                    text: "continue polluted lineage",
                    source: "panel",
                    messageID: `msg_polluted_${now}`,
                  },
                },
                time_queued: now,
                queued_by_process_id: process.pid,
                queued_by_instance_directory: tmp.path,
                queued_by_project_id: Instance.project.id,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        await expect(drainQueuedTaskEventIfUnowned(taskID)).rejects.toThrow("Session not found")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(taskStatus(taskID)).toBe("active")
        expect(queuedOperatorWakeLabels(taskID)).toEqual(["pending"])
      },
    })
  })

  test("createTask with queue=false starts immediately when the cwd is idle", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "start immediately",
          title: "direct-start task",
          executor: "opencorvus",
          queue: false,
        })
        await waitForTaskStatus(taskID, "active")
        await waitForMockCalls(runTaskLoop, 1)

        expect(taskStatus(taskID)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID })
      },
    })
  })

  test("createTask stores an explicit task model in the root session overlay", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "use explicit model",
          title: "explicit model task",
          executor: "opencorvus",
          model: "openai/gpt-5.5",
          queue: false,
        })

        await expect(resolveConfiguredModelRef({ taskID })).resolves.toEqual({
          providerID: "openai",
          modelID: "gpt-5.5",
        })

        const task = findTask(taskID)!
        const root = await Session.get(task.session_id!)
        expect(root.metadata?.configOverlay).toEqual({ model: "openai/gpt-5.5" })
      },
    })
  })

  test("createTask without a model does not write a task model overlay", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "use project model",
          title: "project model task",
          executor: "opencorvus",
          queue: false,
        })

        await expect(resolveConfiguredModelRef({ taskID })).resolves.toEqual({
          providerID: "project",
          modelID: "default",
        })

        const task = findTask(taskID)!
        const root = await Session.get(task.session_id!)
        expect((root.metadata as Record<string, unknown>)?.configOverlay).toBeUndefined()
      },
    })
  })

  test("createTask without explicit or configured model fails before persisting task", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        await expect(
          EngineService.createTask({
            request: "missing model should fail",
            title: "missing model task",
            executor: "opencorvus",
            queue: false,
          }),
        ).rejects.toThrow("No `model` configured")

        const tasks = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.project_id, Instance.project.id)).all(),
        )
        expect(tasks).toHaveLength(0)
      },
    })
  })

  test(
    "createTask with queue=false bypasses an active task in the same cwd",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const now = Date.now()
          const activeID = `task_queue_existing_${now}`

          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id: activeID,
                project_id: Instance.project.id,
                source: "test",
                title: "existing active task",
                request: "already owns the old serial queue slot",
                priority: "normal",
                time_started: now,
                time_created: now,
                time_updated: now,
              })
              .run(),
          )

          const taskID = await EngineService.createTask({
            request: "start beside the active cwd sibling",
            title: "direct-start beside active task",
            executor: "opencorvus",
            queue: false,
          })
          await waitForTaskStatus(taskID, "active")
          await waitForMockCalls(runTaskLoop, 1)

          expect(taskStatus(activeID)).toBe("active")
          expect(taskStatus(taskID)).toBe("active")
          expect(directoryQueueSnapshot(tmp.path).queuedTaskIDs).not.toContain(taskID)
          expect(runTaskLoop).toHaveBeenCalledTimes(1)
          expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID })
        },
      })
    },
    { timeout: 10_000 },
  )

  test("createTask with queue=true waits behind an active task in the same cwd", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const activeID = `task_queue_existing_${now}`

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "existing active task",
              request: "holds the explicit queue slot",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const taskID = await EngineService.createTask({
          request: "wait because the caller explicitly requested queueing",
          title: "queued opt-in task",
          executor: "opencorvus",
          queue: true,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(taskStatus(taskID)).toBe("queued")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("advanceQueue interrupts dead-owner active tasks before claiming same-cwd queued work", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const activeID = `task_queue_dead_owner_${now}`
        const queuedID = `task_queue_after_dead_owner_${now}`
        const runID = `run_queue_dead_owner_${now}`
        const goalID = `goal_queue_dead_owner_${now}`
        const goalRunID = `grun_queue_dead_owner_${now}`
        const reason = "Directory queue: previous owner process died before interruption"

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "dead-owner active task",
              request: "holds the cwd queue until convergence",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: queuedID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued sibling",
              request: "must start after the dead owner is interrupted",
              priority: "normal",
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: activeID,
              title: "Dead owner goal",
              slug: "dead-owner-goal",
              objective: "Expose cwd queue dead-owner convergence.",
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
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: activeID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                plan_version_id: null,
                session_id: null,
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
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: `${goalRunID}_${now}`,
              task_id: activeID,
              run_id: runID,
              goal_run_id: goalRunID,
              kind: "goal_run_attempt",
              label: "goal-run-running",
              payload: {
                goal_id: goalID,
                session_id: null,
                status: "running",
                retry_count: 0,
                blocking_reason: null,
                error: null,
                workspace_dir: null,
                workspace_branch: null,
                workspace_base_ref: null,
                base_ref: null,
                merge_ref: null,
                owner: "999999:dead:beef00",
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            } as any)
            .run()
        })

        await advanceQueue(taskCwd(queuedID))
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(taskStatus(activeID)).toBe("active")
        expect(findTask(activeID)?.time_completed).toBeNull()
        expect(findTask(activeID)?.error).toBe(reason)
        expect(findTask(activeID)?.metadata).toEqual(expect.objectContaining({ interrupted: true }))
        expect(findRun(runID)?.status).toBe("aborted")
        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(taskStatus(queuedID)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: queuedID })
      },
    })
  })

  test("advanceQueue keeps live-owner active tasks ahead of same-cwd queued work", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const activeID = `task_queue_live_owner_${now}`
        const queuedID = `task_queue_after_live_owner_${now}`
        const runID = `run_queue_live_owner_${now}`
        const goalID = `goal_queue_live_owner_${now}`
        const goalRunID = `grun_queue_live_owner_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "live-owner active task",
              request: "must keep the cwd queue slot",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: queuedID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued sibling",
              request: "must wait behind the live owner",
              priority: "normal",
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: activeID,
              title: "Live owner goal",
              slug: "live-owner-goal",
              objective: "Prove cwd queue convergence does not kill live owners.",
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
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: activeID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                plan_version_id: null,
                session_id: null,
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
            } as any)
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: `${goalRunID}_${now}`,
              task_id: activeID,
              run_id: runID,
              goal_run_id: goalRunID,
              kind: "goal_run_attempt",
              label: "goal-run-running",
              payload: {
                goal_id: goalID,
                session_id: null,
                status: "running",
                retry_count: 0,
                blocking_reason: null,
                error: null,
                workspace_dir: null,
                workspace_branch: null,
                workspace_base_ref: null,
                base_ref: null,
                merge_ref: null,
                owner: processOwner(),
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            } as any)
            .run()
        })

        await advanceQueue(taskCwd(queuedID))
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(taskStatus(activeID)).toBe("active")
        expect(findRun(runID)?.status).toBe("running")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(taskStatus(queuedID)).toBe("queued")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test("cancelled queued tasks release retained wake events", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const activeID = `task_queue_active_${now}`
        const queuedID = `task_queue_cancelled_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "active task",
              request: "holds cwd slot",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: queuedID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued task",
              request: "will be cancelled before start",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        await dispatchTaskLoop({ taskID: queuedID, event: { note: "queued wake retained until start" } })
        expect(queuedTaskEventStats(queuedID)).toMatchObject({ tasks: 1 })

        await EngineService.cancelTask(queuedID)

        expect(queuedTaskEventStats(queuedID)).toMatchObject({ tasks: 0 })
        expect(taskStatus(queuedID)).toBe("cancelled")
      },
    })
  })

  test("internal event to a terminal task is ignored without scheduling work", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const terminalID = `task_queue_terminal_internal_${now}`

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: terminalID,
              project_id: Instance.project.id,
              source: "test",
              title: "failed task",
              request: "must stay failed",
              priority: "normal",
              time_started: now - 10_000,
              time_completed: now - 1_000,
              error: "terminal failure",
              time_created: now - 10_000,
              time_updated: now - 1_000,
            })
            .run(),
        )

        const result = await dispatchTaskLoop({ taskID: terminalID, event: { note: "internal batch settled" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        const task = findTask(terminalID)!
        expect(result).toBe("ignored")
        expect(taskStatus(terminalID)).toBe("failed")
        expect(task.time_completed).not.toBeNull()
        expect(task.error).toBe("terminal failure")
        expect(runTaskLoop).not.toHaveBeenCalled()
      },
    })
  })

  test(
    "operator message wake to a terminal task queues it behind an active same-cwd task",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const now = Date.now()
          const activeID = `task_queue_active_${now}`
          const terminalID = `task_queue_terminal_${now}`

          Database.transaction((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: activeID,
                project_id: Instance.project.id,
                source: "test",
                title: "active task",
                request: "holds the cwd gate",
                priority: "normal",
                time_started: now,
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineTaskTable)
              .values({
                id: terminalID,
                project_id: Instance.project.id,
                source: "test",
                title: "terminal task",
                request: "must stay completed",
                priority: "normal",
                time_started: now - 10_000,
                time_completed: now - 1_000,
                time_created: now - 10_000,
                time_updated: now - 1_000,
              })
              .run()
          })

          const result = await dispatchTaskLoop({
            taskID: terminalID,
            event: {
              note: "operator follow-up",
              operatorMessage: { text: "continue after failure" },
            },
          })
          await new Promise((resolve) => setTimeout(resolve, 0))

          expect(result).toBe("queued")
          expect(taskStatus(activeID)).toBe("active")
          expect(taskStatus(terminalID)).toBe("queued")
          expect(findTask(terminalID)?.time_completed).toBeNull()
          expect(directoryQueueSnapshot(tmp.path).queuedTaskIDs).toContain(terminalID)
          expect(runTaskLoop).not.toHaveBeenCalled()
        },
      })
    },
    { timeout: 10_000 },
  )

  test("runTaskLoop ignores terminal task wakes before orchestrator processing", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processTask = spyOn(Orchestrator, "processTask").mockResolvedValue(undefined)
        const now = Date.now()
        const taskID = `task_loop_terminal_${now}`

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "failed task",
              request: "must not run",
              priority: "normal",
              time_started: now - 10_000,
              time_completed: now - 1_000,
              error: "terminal failure",
              time_created: now - 10_000,
              time_updated: now - 1_000,
            })
            .run(),
        )

        await TaskLoop.runTaskLoop({
          taskID,
          event: { note: "stale wake" },
        })

        expect(taskStatus(taskID)).toBe("failed")
        expect(processTask).not.toHaveBeenCalled()
      },
    })
  })

  test("waking a live-owned active task queues the wake until ownership closes", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_live_interrupt_${now}`
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        let runCount = 0
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          runCount += 1
          if (runCount === 1) await holdLoop
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "live owned task",
              request: "operator message must not interrupt a running child agent",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const goalID = `goal_queue_live_interrupt_${now}`
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live goal",
              slug: "live-goal",
              objective: "Prove operator wake waits behind live ownership.",
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
        const childSessionID = `ses_build_${now}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: childSessionID,
          now,
        })

        await dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

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
          event: { note: "stop the running agent and reconsider" },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("queued")
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        release!()
        await holdLoop
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (runTaskLoop.mock.calls.length >= 2) break
        }
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
          event: { note: "stop the running agent and reconsider" },
        })
      },
    })
  })

  test("operator wake with multiple live owners does not abort sibling goal ownership", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_multi_owner_${now}`
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "multi owner task",
              request: "operator wake must not abort sibling live owners",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        await dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        const owners: Array<{ goalRunID: string; ownershipID: string }> = []
        for (const suffix of ["a", "b"]) {
          const goalID = `goal_queue_multi_${suffix}_${now}`
          Database.use((db) =>
            db
              .insert(EngineGoalTable)
              .values({
                id: goalID,
                task_id: taskID,
                title: `Live goal ${suffix}`,
                slug: `live-goal-${suffix}`,
                objective: `Keep live goal ${suffix} running.`,
                acceptance_specs: [],
                owned_paths: [],
                depends_on: [],
                kind: "feature",
                requirement_ids: [],
                priority: "blocking",
                source: "test",
                order_index: owners.length,
                time_created: now,
                time_updated: now,
              })
              .run(),
          )
          const childSessionID = `ses_build_${suffix}_${now}`
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
            toolCallID: `cal_build_${suffix}_${now}`,
            toolPartID: `prt_build_${suffix}_${now}`,
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
          owners.push({ goalRunID, ownershipID: ownershipPayload.ownership_id })
        }

        const result = await dispatchTaskLoop({
          taskID,
          event: {
            note: "operator guidance for the task root",
            operatorMessage: {
              text: "re-evaluate the active build evidence",
              source: "panel",
            },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("started")
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "re-evaluate the active build evidence",
              source: "panel",
            },
          },
        })
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(2)
        for (const owner of owners) {
          expect(findGoalRun(owner.goalRunID)?.status).toBe("running")
        }

        release!()
        await holdLoop
      },
    })
  })

  test("live ownership queues operator wake even after the root loop has exited", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `task_queue_owner_no_loop_${now}`
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "live owner without root loop",
              request: "operator wake must wait for live ownership even when root loop exited",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const goalID = `goal_queue_owner_no_loop_${now}`
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live owner goal",
              slug: "live-owner-goal",
              objective: "Keep ownership as the wake scheduling boundary.",
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
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: `ses_owner_no_loop_${now}`,
          now,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: `ses_orchestrator_${now}`,
          orchestratorMessageID: `msg_orchestrator_${now}`,
          toolCallID: `cal_owner_no_loop_${now}`,
          toolPartID: `prt_owner_no_loop_${now}`,
          childSessionID: `ses_owner_no_loop_${now}`,
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

        const event = { note: "operator guidance while owner is still live" }
        const result = await dispatchTaskLoop({
          taskID,
          event,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("queued")
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(findGoalRun(goalRunID)?.status).toBe("running")

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (runTaskLoop.mock.calls.length >= 1) break
        }

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID, event })
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(findGoalRun(goalRunID)?.status).toBe("running")
      },
    })
  })

  test("task message response starts immediate root wake while live ownership remains running", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "queued task message root" })
        await seedRootSession(root.id)
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "task message immediate wake with live owner",
              request: "operator task message must wake the root without cancelling live ownership",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const goalID = Identifier.ascending("goal")
        Database.use((db) =>
          db
            .insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live build goal",
              slug: "live-build-goal",
              objective: "Keep active build ownership while recording an operator message.",
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
        const childSessionID = `ses_queue_message_result_${now}`
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
          toolCallID: `cal_queue_message_result_${now}`,
          toolPartID: `prt_queue_message_result_${now}`,
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

        const result = await EngineService.handleTaskMessage(taskID, {
          text: "改成手机版布局 html",
          source: "panel",
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toMatchObject({
          kind: "note",
          message: "Operator note recorded. Task wake dispatched.",
          wake_status: "started",
          should_resume: true,
        })
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            operatorMessage: {
              text: "改成手机版布局 html",
              source: "panel",
              messageID: result.user_message.info.id,
            },
          },
        })
        const pendingWakeRows = Database.use((db) =>
          db
            .select({ label: EngineArtifactTable.label, payload: EngineArtifactTable.payload })
            .from(EngineArtifactTable)
            .where(eq(EngineArtifactTable.task_id, taskID))
            .all()
            .filter((row) => row.label === "pending" && (row.payload as { event?: unknown }).event),
        )
        expect(pendingWakeRows).toHaveLength(0)
        const wakeCommitments = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
        ).filter((row) => row.kind === "operator_message_wake")
        expect(wakeCommitments).toHaveLength(1)
        expect(wakeCommitments[0]).toMatchObject({
          label: "started",
          payload: {
            task_id: taskID,
            message_id: result.user_message.info.id,
            source: "panel",
            wake_status: "started",
          },
        })
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)
        expect(findGoalRun(goalRunID)?.status).toBe("running")

        const messages = await Session.messages({ sessionID: root.id })
        expect(messages[messages.length - 1]?.info.id).toBe(result.user_message.info.id)
        expect(messages[messages.length - 1]?.parts[0]).toMatchObject({
          type: "text",
          text: "改成手机版布局 html",
        })

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("loop exit flips the queued sibling in the same cwd to active", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const activeID = `task_queue_active_${now}`
        const siblingID = `task_queue_sibling_${now}`

        // Hold the leader's runTaskLoop open until we release it; the
        // sibling's runTaskLoop resolves immediately. Modelling a real task
        // lifecycle: when the leader's loop exits it also flips task.status
        // to a terminal value (runTaskLoopInner does this via updateTask in
        // production); the queue-advance hook then finds the cwd idle and
        // the sibling must flip `queued → active`.
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async (arg: { taskID: string }) => {
          if (arg.taskID === activeID) {
            await holdLoop
            Database.use((db) =>
              db
                .update(EngineTaskTable)
                .set({ time_completed: Date.now() })
                .where(eq(EngineTaskTable.id, activeID))
                .run(),
            )
          }
        })

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "active task",
              request: "holds the cwd lock until loop exits",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: siblingID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued sibling",
              request: "must flip to active after the leader's loop exits",
              priority: "normal",
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        await dispatchTaskLoop({ taskID: activeID })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(taskStatus(activeID)).toBe("active")
        // Sibling stays queued while the leader's loop is still running —
        // the cwd lock is held.
        expect(taskStatus(siblingID)).toBe("queued")

        // Release the loop: the real loop exit → `.finally` → advanceQueue
        // should now flip the sibling to active. Without the fix, advance
        // fired right after scheduling and the sibling would remain queued.
        release!()
        await holdLoop
        // Give microtasks + queueMicrotask + the follow-up advanceQueue a
        // few turns to settle.
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (taskStatus(siblingID) === "active") break
        }

        expect(taskStatus(siblingID)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(runTaskLoop.mock.calls[1]?.[0]).toMatchObject({ taskID: siblingID })
      },
    })
  })

  test("advanceQueue forwards queued work without synthesising a trigger", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const taskID = `task_queue_retry_${Date.now()}`
        const runID = `run_queue_retry_${Date.now()}`
        const now = Date.now()

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued retry task",
              request: "advanceQueue must forward without deriving a trigger from the latest run",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
          // Phase-6-e: run rows live in engine_artifact (kind="run").
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-failed",
              payload: {
                plan_version_id: null,
                session_id: null,
                executor: "opencorvus",
                status: "failed",
                phase: "dispatch",
                blocking_reason: null,
                error: null,
                retry_count: 0,
                executor_ref: null,
                metadata: null,
                time_started: null,
                time_completed: now,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        await advanceQueue(taskCwd(taskID))
        await new Promise((resolve) => setTimeout(resolve, 0))

        // Phase 2: the queue must NOT invent an OrchestratorEvent from
        // active_run_id. The orchestrator reads the describe snapshot on
        // wake and decides for itself — the event is purely caller-supplied.
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        const firstCall = runTaskLoop.mock.calls[0]?.[0] as { taskID: string; event?: unknown }
        expect(firstCall.taskID).toBe(taskID)
        expect(firstCall.event).toBeUndefined()
      },
    })
  })

  test("reordered queued siblings are claimed by directory queue order", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const firstID = `task_queue_first_${now}`
        const secondID = `task_queue_second_${now}`
        const thirdID = `task_queue_third_${now}`

        Database.transaction((db) => {
          for (const [index, id] of [firstID, secondID, thirdID].entries()) {
            db.insert(EngineTaskTable)
              .values({
                id,
                project_id: Instance.project.id,
                source: "test",
                title: `queued task ${index}`,
                request: "claim by user queue order",
                priority: "normal",
                queue_order: index,
                time_created: now + index,
                time_updated: now + index,
              })
              .run()
          }
        })

        const cwd = taskCwd(firstID)
        const result = reorderQueuedTasksForCwd({
          cwd,
          projectID: Instance.project.id,
          orderedTaskIDs: [thirdID, firstID, secondID],
          now: now + 10,
        })

        expect(result.queuedTaskIDs).toEqual([thirdID, firstID, secondID])

        await advanceQueue(cwd)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: thirdID })
        expect(taskStatus(thirdID)).toBe("active")
        expect(taskStatus(firstID)).toBe("queued")
      },
    })
  })

  test("startQueuedTaskNow directly claims a queued task when the cwd is idle", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const firstID = `task_queue_first_${now}`
        const secondID = `task_queue_second_${now}`

        Database.transaction((db) => {
          for (const [index, id] of [firstID, secondID].entries()) {
            db.insert(EngineTaskTable)
              .values({
                id,
                project_id: Instance.project.id,
                source: "test",
                title: `queued task ${index}`,
                request: "start queued task now",
                priority: "normal",
                queue_order: index,
                time_created: now + index,
                time_updated: now + index,
              })
              .run()
          }
        })

        const result = await EngineService.startQueuedTaskNow(secondID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.started).toBe(true)
        expect(result.status).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: secondID })
        expect(taskStatus(secondID)).toBe("active")
        expect(taskStatus(firstID)).toBe("queued")
      },
    })
  })

  test("startQueuedTaskNow starts the clicked task instead of a higher-priority queued sibling", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const criticalID = `task_queue_critical_${now}`
        const normalID = `task_queue_normal_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: criticalID,
              project_id: Instance.project.id,
              source: "test",
              title: "critical queued task",
              request: "would normally win priority ordering",
              priority: "critical",
              queue_order: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: normalID,
              project_id: Instance.project.id,
              source: "test",
              title: "normal queued task",
              request: "explicit operator start",
              priority: "normal",
              queue_order: 1,
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const result = await EngineService.startQueuedTaskNow(normalID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.started).toBe(true)
        expect(taskStatus(normalID)).toBe("active")
        expect(taskStatus(criticalID)).toBe("queued")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: normalID })
      },
    })
  })

  test("startQueuedTaskNow rejects a queued task whose root session parent leaves the project before claiming", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })
    await using foreign = await tmpdir({ git: true, config: { model: "foreign/default" } })

    let foreignParentID = ""
    await Instance.provide({
      directory: foreign.path,
      fn: async () => {
        foreignParentID = (await Session.create({ kind: "root", title: "foreign start-now parent" })).id
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const root = await importCurrentProjectRootWithForeignParent({
          directory: tmp.path,
          foreignParentID,
          title: "polluted start-now root",
        })
        const taskID = `task_queue_polluted_start_now_${now}`

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "polluted start-now task",
              request: "start now must not cross project lineage",
              priority: "normal",
              queue_order: 0,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        await expect(EngineService.startQueuedTaskNow(taskID)).rejects.toThrow("Session not found")

        expect(runTaskLoop).not.toHaveBeenCalled()
        expect(taskStatus(taskID)).toBe("queued")
        expect(findTask(taskID)?.time_started).toBeNull()
        expect(directoryQueueSnapshot(taskCwd(taskID)).queuedTaskIDs).toEqual([taskID])
      },
    })
  })

  test("startQueuedTaskNow preserves same-cwd serialization when another task is active", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const activeID = `task_queue_active_${now}`
        const firstID = `task_queue_first_${now}`
        const secondID = `task_queue_second_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "active task",
              request: "holds the directory gate",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          for (const [index, id] of [firstID, secondID].entries()) {
            db.insert(EngineTaskTable)
              .values({
                id,
                project_id: Instance.project.id,
                source: "test",
                title: `queued task ${index}`,
                request: "explicit operator start while another task is active",
                priority: "normal",
                queue_order: index,
                time_created: now + index + 1,
                time_updated: now + index + 1,
              })
              .run()
          }
        })

        const result = await EngineService.startQueuedTaskNow(secondID)

        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.started).toBe(false)
        expect(result.status).toBe("queued")
        expect(taskStatus(activeID)).toBe("active")
        expect(taskStatus(secondID)).toBe("queued")
        expect(directoryQueueSnapshot(taskCwd(secondID)).queuedTaskIDs).toEqual([firstID, secondID])
        expect(runTaskLoop).toHaveBeenCalledTimes(0)
      },
    })
  })

  test("startQueuedTaskNow can claim when the only same-cwd active sibling is already interrupted", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const now = Date.now()
        const interruptedID = `task_queue_interrupted_${now}`
        const queuedID = `task_queue_after_interrupted_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: interruptedID,
              project_id: Instance.project.id,
              source: "test",
              title: "interrupted task",
              request: "interrupted task should not hold the cwd queue slot",
              priority: "normal",
              error: "previous owner died",
              metadata: { interrupted: true },
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: queuedID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued after interrupted",
              request: "explicit operator start after interrupted sibling",
              priority: "normal",
              queue_order: 0,
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const result = await EngineService.startQueuedTaskNow(queuedID)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result.started).toBe(true)
        expect(result.status).toBe("active")
        expect(taskStatus(interruptedID)).toBe("active")
        expect(taskStatus(queuedID)).toBe("active")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: queuedID })
      },
    })
  })

  test("reorder rejects active tasks and partial directory queues", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "project/default" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const activeID = `task_queue_locked_${now}`
        const queuedID = `task_queue_waiting_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: activeID,
              project_id: Instance.project.id,
              source: "test",
              title: "active locked task",
              request: "must not be draggable",
              priority: "normal",
              queue_order: 0,
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: queuedID,
              project_id: Instance.project.id,
              source: "test",
              title: "queued task",
              request: "only queued tasks may be reordered",
              priority: "normal",
              queue_order: 1,
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        expect(() =>
          reorderQueuedTasksForCwd({
            cwd: taskCwd(activeID),
            projectID: Instance.project.id,
            orderedTaskIDs: [activeID, queuedID],
          }),
        ).toThrow("orderedTaskIDs must contain every queued task")
      },
    })
  })
})
