import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  advanceQueue,
  directoryQueueSnapshot,
  dispatchTaskLoop,
  queuedTaskEventStats,
  reorderQueuedTasksForCwd,
  taskCwd,
} from "../../src/engine/queue"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { processOwner } from "../../src/engine/lease"
import { beginBuildAttempt } from "../../src/engine/persist"
import { findGoalRun, findRun, findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { resolveConfiguredModelRef } from "../../src/agent/model"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { EngineService } from "../../src/task-api"

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
import { Instance } from "../../src/project/instance"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Database, eq } from "../../src/storage/db"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("engine queue", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
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

  test("advanceQueue terminalizes dead-owner active tasks before claiming same-cwd queued work", async () => {
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
        const reason = "Directory queue: previous owner process died before terminalization"

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
              request: "must start after the dead owner is terminalized",
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

        expect(taskStatus(activeID)).toBe("failed")
        expect(findTask(activeID)?.error).toBe(reason)
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
        expect(queuedTaskEventStats()).toMatchObject({ tasks: 1 })

        await EngineService.cancelTask(queuedID)

        expect(queuedTaskEventStats()).toMatchObject({ tasks: 0 })
        expect(taskStatus(queuedID)).toBe("cancelled")
      },
    })
  })

  test("internal event to a terminal task is scheduled instead of being status-gated", async () => {
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

        await dispatchTaskLoop({ taskID: terminalID, event: { note: "internal batch settled" } })
        await new Promise((resolve) => setTimeout(resolve, 0))

        const task = findTask(terminalID)!
        expect(taskStatus(terminalID)).toBe("failed")
        expect(task.time_completed).not.toBeNull()
        expect(task.error).toBe("terminal failure")
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID: terminalID,
          event: { note: "internal batch settled" },
        })
      },
    })
  })

  test(
    "operator message wake to a terminal task is scheduled even with an active same-cwd task",
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

          await dispatchTaskLoop({
            taskID: terminalID,
            event: {
              note: "operator follow-up",
              operatorMessage: { text: "continue after failure" },
            },
          })
          await new Promise((resolve) => setTimeout(resolve, 0))

          expect(taskStatus(activeID)).toBe("active")
          expect(taskStatus(terminalID)).toBe("completed")
          expect(findTask(terminalID)?.time_completed).not.toBeNull()
          expect(runTaskLoop).toHaveBeenCalledTimes(1)
          expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({
            taskID: terminalID,
            event: {
              note: "operator follow-up",
              operatorMessage: { text: "continue after failure" },
            },
          })
        },
      })
    },
    { timeout: 10_000 },
  )

  test("runTaskLoop forwards terminal task wakes to orchestrator processing", async () => {
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
        expect(processTask).toHaveBeenCalledTimes(1)
        expect(processTask).toHaveBeenCalledWith(taskID, { note: "stale wake" })
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
            note: "operator guidance for one failed build",
            operatorMessage: {
              text: "resume only the failed build",
              source: "overlay_build_steer",
              target: { kind: "build_session", sessionID: `ses_build_a_${now}`, goalID: `goal_queue_multi_a_${now}` },
            },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(result).toBe("queued")
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
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

  test("startQueuedTaskNow starts the clicked task even when another same-cwd task is active", async () => {
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

        expect(result.started).toBe(true)
        expect(result.status).toBe("active")
        expect(taskStatus(activeID)).toBe("active")
        expect(taskStatus(secondID)).toBe("active")
        expect(directoryQueueSnapshot(taskCwd(secondID)).queuedTaskIDs).toEqual([firstID])
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(runTaskLoop.mock.calls[0]?.[0]).toMatchObject({ taskID: secondID })
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
            orderedTaskIDs: [activeID, queuedID],
          }),
        ).toThrow("orderedTaskIDs must contain every queued task")
      },
    })
  })
})
