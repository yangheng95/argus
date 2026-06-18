import { describe, expect, test } from "bun:test"
import {
  DISPATCHABLE_RUN_STATUSES,
  EXECUTOR_ACTIVE_RUN_STATUSES,
  GOAL_RUN_RESETTABLE_STATUSES,
  LIVE_GOAL_RUN_STATUSES,
  LIVE_RUN_STATUSES,
  doesGoalRunSatisfyGoal,
  isDispatchableRunStatus,
  isLiveGoalRunStatus,
  isLiveRunStatus,
} from "../../src/engine/catalog"

describe("engine status catalog", () => {
  test("goal-run liveness catalog is internally consistent", () => {
    // `live` means in-flight only. `completed` is a distinct `terminal`
    // class — merging completed into `live` deadlocked the orchestrator
    // when a successful goal finished. Dispatch-dedup call sites combine
    // `live ∪ satisfies` instead of relying on an over-inclusive `live`.
    expect(LIVE_GOAL_RUN_STATUSES).toEqual(["queued", "accepted", "planning", "running", "evaluating", "blocked"])
    // `completed` is intentionally NOT resettable: the success record +
    // verification evidence are preserved across contract changes; retry
    // proceeds by creating a new goal_run and supersede-annotating the old.
    expect(GOAL_RUN_RESETTABLE_STATUSES).toEqual(["queued", "accepted", "planning", "running", "evaluating", "blocked"])

    expect(isLiveGoalRunStatus("planning")).toBe(true)
    expect(isLiveGoalRunStatus("completed")).toBe(false)
    expect(isLiveGoalRunStatus("failed")).toBe(false)
    expect(doesGoalRunSatisfyGoal("completed")).toBe(true)
    expect(doesGoalRunSatisfyGoal("running")).toBe(false)
  })

  test("run status catalog separates live from dispatchable", () => {
    expect(LIVE_RUN_STATUSES).toEqual(["queued", "accepted", "running", "blocked"])
    expect(DISPATCHABLE_RUN_STATUSES).toEqual(["accepted", "running", "blocked"])
    expect(EXECUTOR_ACTIVE_RUN_STATUSES).toEqual(["accepted", "running"])

    expect(isLiveRunStatus("queued")).toBe(true)
    expect(isDispatchableRunStatus("queued")).toBe(false)
    expect(isDispatchableRunStatus("running")).toBe(true)
    expect(isLiveRunStatus("completed")).toBe(false)
  })
})
