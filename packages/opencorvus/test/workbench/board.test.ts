import { afterEach, expect, test } from "bun:test"
import { boardTag, currentGoalRunFromRows, compileBoard } from "../../src/workbench/board"
import { latestDeliveredGoalRunFromRows } from "../../src/engine/store"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Instance } from "../../src/project/instance"
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
  // Regression for the post-rejection Files-panel hole: when acceptance is
  // rejected, resetTaskGoalsToPending supersedes every goal's tip with a
  // fresh pending row. The pending row has no acceptance yet, but the old
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
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe(
    "run_passed_then_superseded",
  )
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
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe(
    "run_v3_passed",
  )
})

test("compileBoard cache and task-scope status include workflow step protocol events", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_${now}`
  const taskID = `tsk_${now.toString(16)}BoardProtocol`

  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: tmp.path,
      name: "Board protocol projection",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Board protocol projection",
      request: "Show running task-scope steps from protocol events",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID })
      const beforeTag = boardTag({ taskID })
      expect(before.lastSequence).toBe(0)
      expect(before.snapshotVersion).toBe(beforeTag)
      expect(before.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("pending")

      await EngineProtocol.emit(Event.WorkflowStepUpdated, {
        taskID,
        stepID: "architect",
        status: "running",
        summary: "Step \"Architect\" started",
      }, { source: "test.board" })

      const after = compileBoard({ taskID })
      const afterTag = boardTag({ taskID })
      expect(after.lastSequence).toBe(1)
      expect(after.snapshotVersion).toBe(afterTag)
      expect(after.snapshotVersion).not.toBe(before.snapshotVersion)
      expect(after.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("running")
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
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: tmp.path,
      name: "Board runless retry projection",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
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
    } as any).run()
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

test("queued task without a run exposes cancel but not retry", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_cancel_${now}`
  const taskID = `tsk_board_cancel_${now.toString(16)}`

  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: tmp.path,
      name: "Board runless cancel projection",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Runless queued task",
      request: "queued task",
      kind: "workflow",
      priority: "normal",
      time_created: now,
      time_updated: now,
    } as any).run()
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
