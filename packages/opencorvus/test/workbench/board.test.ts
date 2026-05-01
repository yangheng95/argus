import { expect, test } from "bun:test"
import { currentGoalRunFromRows } from "../../src/workbench/board"
import { latestDeliveredGoalRunFromRows } from "../../src/engine/store"

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
