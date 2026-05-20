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

test("latestDeliveredGoalRunFromRows skips a fresh pending tip whose run has no delivery, returning the prior delivered run", () => {
  // Regression for the post-rejection Files-panel hole: when delivery is
  // rejected, resetTaskGoalsToPending supersedes every goal's tip with a
  // fresh pending row. The pending row has no delivery yet, but the old
  // superseded row's merged files are still on master. Goal cards in the
  // overlay must anchor to the delivered run (not the tip) for the Files
  // panel + per-row diff fetch, otherwise G8/G9-style goals silently
  // disappear from the panel even though their commits exist.
  const rows = [
    { id: "run_post_reject_pending" }, // tip, newest, no delivery
    { id: "run_passed_then_superseded" },
    { id: "run_old_failed" },
  ]
  const deliveries = new Set(["run_passed_then_superseded"])
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe(
    "run_passed_then_superseded",
  )
})

test("latestDeliveredGoalRunFromRows returns undefined when no run in the chain has shipped a delivery", () => {
  const rows = [{ id: "run_pending_first_attempt" }]
  expect(latestDeliveredGoalRunFromRows(rows, () => false)).toBeUndefined()
})

test("latestDeliveredGoalRunFromRows prefers a newer delivered run over an older one", () => {
  const rows = [
    { id: "run_v3_passed" }, // newest, has delivery
    { id: "run_v2_passed" }, // also has delivery, older
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
