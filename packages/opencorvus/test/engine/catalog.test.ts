import { describe, expect, test } from "bun:test"
import {
  DISPATCHABLE_RUN_STATUSES,
  EXECUTOR_ACTIVE_RUN_STATUSES,
  GOAL_RUN_RESETTABLE_STATUSES,
  GOAL_RUN_SUCCESS_STATUSES,
  LIVE_EXECUTOR_SESSION_STATUSES,
  LIVE_GOAL_RUN_STATUSES,
  LIVE_RUN_STATUSES,
  RUNTIME_MONITORED_RUN_STATUSES,
  doesGoalRunSatisfyGoal,
  isDispatchableRunStatus,
  isLiveExecutorSessionStatus,
  isLiveGoalRunStatus,
  isLiveRunStatus,
  isResettableGoalRunStatus,
  isRetriableGoalRunStatus,
} from "../../src/engine/catalog"

describe("engine status catalog", () => {
  test("goal-run liveness catalog is internally consistent", () => {
    // `live` means in-flight only. `completed` is a distinct `terminal`
    // class because the dispatch gate (agent.ts) must release on
    // completion — merging completed into `live` deadlocked the
    // orchestrator when a successful goal finished. Dispatch-dedup call
    // sites (readyGoalNodes, blockedGoalDiagnostics) explicitly combine
    // `live ∪ satisfies` instead of relying on an over-inclusive `live`.
    expect(LIVE_GOAL_RUN_STATUSES).toEqual([
      "queued",
      "accepted",
      "planning",
      "running",
      "evaluating",
      "blocked",
    ])
    expect(GOAL_RUN_SUCCESS_STATUSES).toEqual(["completed"])
    expect(GOAL_RUN_RESETTABLE_STATUSES).toEqual([
      "queued",
      "accepted",
      "planning",
      "running",
      "evaluating",
      "blocked",
      "completed",
    ])

    expect(isLiveGoalRunStatus("planning")).toBe(true)
    expect(isLiveGoalRunStatus("completed")).toBe(false)
    expect(isLiveGoalRunStatus("failed")).toBe(false)
    expect(isRetriableGoalRunStatus("aborted")).toBe(true)
    expect(isRetriableGoalRunStatus("completed")).toBe(false)
    expect(isResettableGoalRunStatus("completed")).toBe(true)
    expect(doesGoalRunSatisfyGoal("completed")).toBe(true)
    expect(doesGoalRunSatisfyGoal("running")).toBe(false)
  })

  test("run status catalog separates live from dispatchable", () => {
    expect(LIVE_RUN_STATUSES).toEqual(["queued", "accepted", "running", "blocked"])
    expect(DISPATCHABLE_RUN_STATUSES).toEqual(["accepted", "running", "blocked"])
    expect(EXECUTOR_ACTIVE_RUN_STATUSES).toEqual(["accepted", "running"])
    expect(RUNTIME_MONITORED_RUN_STATUSES).toEqual(["accepted", "running", "blocked", "completed"])

    expect(isLiveRunStatus("queued")).toBe(true)
    expect(isDispatchableRunStatus("queued")).toBe(false)
    expect(isDispatchableRunStatus("running")).toBe(true)
    expect(isLiveRunStatus("completed")).toBe(false)
  })

  test("executor-session liveness has a single live state", () => {
    expect(LIVE_EXECUTOR_SESSION_STATUSES).toEqual(["active"])
    expect(isLiveExecutorSessionStatus("active")).toBe(true)
    expect(isLiveExecutorSessionStatus("aborted")).toBe(false)
  })
})
