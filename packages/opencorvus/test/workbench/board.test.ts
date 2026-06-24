import { afterEach, expect, test } from "bun:test"
import { boardTag, currentGoalRunFromRows, compileBoard } from "../../src/workbench/board"
import { compileBrief } from "../../src/workbench/brief"
import { latestDeliveredGoalRunFromRows } from "../../src/engine/store"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Identifier } from "../../src/id/id"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("currentGoalRunFromRows selects the supersede-chain tip", () => {
  const rows = [
    { id: "run_retry", supersede_of: "run_old" },
    { id: "run_old", supersede_of: null },
  ]

  expect(currentGoalRunFromRows(rows)?.id).toBe("run_retry")
})

test("currentGoalRunFromRows falls back to the first row when no supersede edge exists", () => {
  const rows = [
    { id: "run_latest", supersede_of: null },
    { id: "run_older", supersede_of: null },
  ]

  expect(currentGoalRunFromRows(rows)?.id).toBe("run_latest")
})

test("latestDeliveredGoalRunFromRows skips a fresh pending tip whose run has no acceptance, returning the prior delivered run", () => {
  // Regression for the post-rejection Files-panel hole: when a targeted
  // acceptance retry opens a fresh pending tip, that row has no acceptance yet, but the old
  // superseded row's merged files are still on master. Goal cards in the
  // overlay must anchor to the delivered run (not the tip) for the Files
  // panel + per-row diff fetch, otherwise G8/G9-style goals silently
  // disappear from the panel even though their commits exist.
  const rows = [
    { id: "run_post_reject_pending" }, // tip, newest, no acceptance
    { id: "run_passed_then_superseded" },
    { id: "run_old_failed" },
  ]
  const deliveries = new Set(["run_passed_then_superseded"])
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe("run_passed_then_superseded")
})

test("latestDeliveredGoalRunFromRows returns undefined when no run in the chain has shipped a acceptance", () => {
  const rows = [{ id: "run_pending_first_attempt" }]
  expect(latestDeliveredGoalRunFromRows(rows, () => false)).toBeUndefined()
})

test("latestDeliveredGoalRunFromRows prefers a newer delivered run over an older one", () => {
  const rows = [
    { id: "run_v3_passed" }, // newest, has acceptance
    { id: "run_v2_passed" }, // also has acceptance, older
    { id: "run_v1_failed" },
  ]
  const deliveries = new Set(["run_v3_passed", "run_v2_passed"])
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe("run_v3_passed")
})

test("compileBoard does not retain a mutable process board between hydrations", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_no_cache_${now}`
  const taskID = `tsk_${now.toString(16)}BoardNoCache`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board no process cache",
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
        title: "Board no process cache",
        request: "initial request",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID }) as any
      const tag = boardTag({ taskID })
      expect(before.task.request).toBe("initial request")

      before.task.request = "mutated in memory"

      expect(boardTag({ taskID })).toBe(tag)
      const after = compileBoard({ taskID }) as any
      expect(after.snapshotVersion).toBe(tag)
      expect(after.task).not.toBe(before.task)
      expect(after.task.request).toBe("initial request")
    },
  })
})

test("compileBrief surfaces memory recall backend errors", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_brief_memory_error_${now}`
  const taskID = `tsk_${now.toString(16)}BriefMemoryError`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Brief memory error",
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
        title: "Brief memory error",
        request: "Recall relevant memory while preparing the workbench brief",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  const originalRecall = Memory.recall
  try {
    ;(Memory as typeof Memory & { recall: typeof Memory.recall }).recall = () => {
      throw new Error("memory index unavailable")
    }

    expect(() => compileBrief({ taskID })).toThrow("memory index unavailable")
  } finally {
    ;(Memory as typeof Memory & { recall: typeof Memory.recall }).recall = originalRecall
  }
})

test("board snapshot tag and task-scope status include workflow step protocol events", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_${now}`
  const taskID = `tsk_${now.toString(16)}BoardProtocol`

  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board protocol projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board protocol projection",
        request: "Show running task-scope steps from protocol events",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID })
      const beforeTag = boardTag({ taskID })
      expect(before.lastSequence).toBe(0)
      expect(before.snapshotVersion).toBe(beforeTag)
      expect(before.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("pending")

      await EngineProtocol.emit(
        Event.WorkflowStepUpdated,
        {
          taskID,
          stepID: "architect",
          status: "running",
          summary: 'Step "Architect" started',
        },
        { source: "test.board" },
      )

      const after = compileBoard({ taskID })
      const afterTag = boardTag({ taskID })
      expect(after.lastSequence).toBe(1)
      expect(after.snapshotVersion).toBe(afterTag)
      expect(after.snapshotVersion).not.toBe(before.snapshotVersion)
      expect(after.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("running")
    },
  })
})

test("board snapshot tag ignores stream noise while lastSequence stays current", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_noise_${now}`
  const taskID = `tsk_${now.toString(16)}BoardNoise`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board protocol noise",
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
        title: "Board protocol noise",
        request: "Ignore stream noise in board tag",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID })
      const beforeTag = boardTag({ taskID })
      expect(before.lastSequence).toBe(0)

      Database.use((db) => {
        for (const [index, type] of ["session.status", "review.stream.chunk"].entries()) {
          const seq = index + 1
          db.insert(ProtocolEventTable)
            .values({
              id: Identifier.ascending("protocol_event"),
              kind: "event",
              type,
              aggregate_type: "task",
              aggregate_id: taskID,
              task_id: taskID,
              source: "test.board-noise",
              seq,
              emitted_at: now + seq,
              payload: { taskID, status: { type: "streaming" }, delta: "noise" },
              time_created: now + seq,
              time_updated: now + seq,
            })
            .run()
        }
      })

      const afterNoise = compileBoard({ taskID })
      expect(boardTag({ taskID })).toBe(beforeTag)
      expect(afterNoise.snapshotVersion).toBe(before.snapshotVersion)
      expect(afterNoise.lastSequence).toBe(2)

      await EngineProtocol.emit(
        Event.WorkflowStepUpdated,
        {
          taskID,
          stepID: "architect",
          status: "running",
          summary: 'Step "Architect" started',
        },
        { source: "test.board-visible" },
      )

      const afterVisible = compileBoard({ taskID })
      expect(afterVisible.lastSequence).toBe(3)
      expect(afterVisible.snapshotVersion).not.toBe(before.snapshotVersion)
      expect(afterVisible.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("running")
    },
  })
})

test("cancelled terminal task without a run exposes task-level retry", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_retry_${now}`
  const taskID = `tsk_board_retry_${now.toString(16)}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board runless retry projection",
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
        title: "Runless cancelled task",
        request: "retry after provider failure",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: "task cancelled",
        metadata: { cancelled: true },
      } as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      expect(board.task.status).toBe("cancelled")
      expect(board.overview.nextStep.kind).toBe("retry")
      expect(board.overview.controls.canRetry).toBe(true)
      expect(board.overview.controls.canCancel).toBe(false)
    },
  })
})

test("cancelled terminal task does not project partially completed goal workflow as running", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_cancelled_workflow_${stamp}`
  const taskID = `tsk_board_cancelled_workflow_${stamp}`
  const runID = `run_board_cancelled_workflow_${stamp}`
  const completedGoalID = `gol_board_done_${stamp}`
  const pendingGoalID = `gol_board_pending_${stamp}`
  const completedGoalRunID = `glr_board_done_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board cancelled workflow projection",
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
        title: "Cancelled partial workflow",
        request: "cancel after some goals finish",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: "operator cancelled",
        metadata: { cancelled: true },
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values([
        {
          id: completedGoalID,
          task_id: taskID,
          title: "Finished goal",
          slug: "finished-goal",
          objective: "Finish one goal before cancellation.",
          order_index: 0,
          time_created: now,
          time_updated: now,
        },
        {
          id: pendingGoalID,
          task_id: taskID,
          title: "Pending goal",
          slug: "pending-goal",
          objective: "Remain pending after cancellation.",
          order_index: 1,
          time_created: now,
          time_updated: now,
        },
      ] as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: completedGoalRunID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: completedGoalRunID,
        kind: "goal_run_attempt",
        label: "completed-before-cancel",
        payload: {
          goal_id: completedGoalID,
          status: "completed",
          retry_count: 0,
          time_started: now - 5_000,
          time_completed: now - 1_000,
        },
        time_created: now - 1_000,
        time_updated: now - 1_000,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const buildStep = board.workflow.steps.find((step: any) => step.id === "build")
      expect(board.task.status).toBe("cancelled")
      expect(board.overview.headline).toBe("Task was cancelled")
      expect(buildStep?.status).toBe("skipped")
      expect(buildStep?.status).not.toBe("running")
    },
  })
})

test("shutdown-interrupted task is not presented as acceptance failure", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_interrupted_${stamp}`
  const taskID = `tsk_board_interrupted_${stamp}`
  const runID = `run_board_interrupted_${stamp}`
  const goalID = `gol_board_interrupted_${stamp}`
  const goalRunID = `glr_board_interrupted_${stamp}`
  const reason = "Server shutdown: SIGINT"

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board interrupted workflow projection",
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
        title: "Interrupted task",
        request: "resume after server shutdown",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: reason,
        metadata: { interrupted: true },
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "Interrupted goal",
        slug: "interrupted-goal",
        objective: "This goal was running when the server exited.",
        order_index: 0,
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: goalRunID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: "running-before-shutdown",
        payload: {
          goal_id: goalID,
          status: "running",
          retry_count: 0,
          time_started: now - 5_000,
        },
        time_created: now - 5_000,
        time_updated: now - 5_000,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const buildStep = board.workflow.steps.find((step: any) => step.id === "build")
      expect(board.task.status).toBe("failed")
      expect(board.task.terminalReason).toBe("interrupted")
      expect(board.overview.currentFailure.title).toBe("Task interrupted")
      expect(board.overview.headline).toBe("Task was interrupted")
      expect(board.overview.nextStep.kind).toBe("retry")
      expect(buildStep?.status).toBe("pending")
      expect(buildStep?.status).not.toBe("failed")
    },
  })
})

test("queued task without a run exposes cancel but not retry", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_cancel_${now}`
  const taskID = `tsk_board_cancel_${now.toString(16)}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board runless cancel projection",
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
        title: "Runless queued task",
        request: "queued task",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
      } as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      expect(board.task.status).toBe("queued")
      expect(board.overview.controls.canCancel).toBe(true)
      expect(board.overview.controls.canRetry).toBe(false)
    },
  })
})
