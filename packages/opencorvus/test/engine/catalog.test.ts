import { describe, expect, test } from "bun:test"
import {
  ACTIVE_GOAL_RUN_STATUSES,
  DISPATCHABLE_RUN_STATUSES,
  EXECUTOR_ACTIVE_RUN_STATUSES,
  GOAL_RUN_RESETTABLE_STATUSES,
  LIVE_GOAL_RUN_STATUSES,
  LIVE_RUN_STATUSES,
  doesGoalRunStatusImplyStarted,
  doesGoalRunSatisfyGoal,
  goalRunGoalProjectionStatus,
  goalRunWorkflowProjectionStatus,
  doesRunStatusImplyStarted,
  isAbortedGoalRunStatus,
  isActiveGoalRunStatus,
  isDispatchableRunStatus,
  isExecutorActiveRunStatus,
  isFailedGoalRunStatus,
  isGoalRunStatus,
  isLiveGoalRunStatus,
  isLiveRunStatus,
  isRunStatus,
  isSuccessfulGoalRunStatus,
  isTerminalGoalRunStatus,
  isTerminalRunStatus,
} from "../../src/engine/catalog"

describe("engine status catalog", () => {
  test("goal-run catalog centralizes projection and terminal semantics", () => {
    const cases = [
      ["queued", "pending", "pending", true, false, false, false, false, false, false],
      ["accepted", "pending", "pending", true, true, false, false, false, false, true],
      ["planning", "pending", "pending", true, true, false, false, false, false, true],
      ["running", "running", "running", true, true, false, false, false, false, true],
      ["evaluating", "running", "running", true, true, false, false, false, false, true],
      ["blocked", "running", "running", true, true, false, false, false, false, true],
      ["completed", "passed", "completed", false, false, true, true, false, false, true],
      ["failed", "failed", "failed", false, false, true, false, true, false, false],
      ["aborted", "failed", "aborted", false, false, true, false, false, true, false],
    ] as const

    for (const [
      status,
      goalProjection,
      workflowProjection,
      live,
      active,
      terminal,
      successful,
      failed,
      aborted,
      started,
    ] of cases) {
      expect(goalRunGoalProjectionStatus(status)).toBe(goalProjection)
      expect(goalRunWorkflowProjectionStatus(status)).toBe(workflowProjection)
      expect(isLiveGoalRunStatus(status)).toBe(live)
      expect(isActiveGoalRunStatus(status)).toBe(active)
      expect(isTerminalGoalRunStatus(status)).toBe(terminal)
      expect(isSuccessfulGoalRunStatus(status)).toBe(successful)
      expect(isFailedGoalRunStatus(status)).toBe(failed)
      expect(isAbortedGoalRunStatus(status)).toBe(aborted)
      expect(doesGoalRunStatusImplyStarted(status)).toBe(started)
    }

    expect(ACTIVE_GOAL_RUN_STATUSES).toEqual(LIVE_GOAL_RUN_STATUSES.filter((status) => status !== "queued"))
    expect(GOAL_RUN_RESETTABLE_STATUSES).toEqual(LIVE_GOAL_RUN_STATUSES)
    expect(doesGoalRunSatisfyGoal("completed")).toBe(true)
    expect(doesGoalRunSatisfyGoal("running")).toBe(false)
    expect(isGoalRunStatus("queued")).toBe(true)
    expect(isGoalRunStatus("zombie")).toBe(false)
  })

  test("run status catalog centralizes projection semantics", () => {
    expect(LIVE_RUN_STATUSES).toEqual(["queued", "accepted", "running", "blocked"])
    expect(DISPATCHABLE_RUN_STATUSES).toEqual(["accepted", "running", "blocked"])
    expect(EXECUTOR_ACTIVE_RUN_STATUSES).toEqual(["queued", "accepted", "running", "blocked"])

    const cases = [
      ["queued", true, false, true, false, false],
      ["accepted", true, true, true, false, true],
      ["running", true, true, true, false, true],
      ["blocked", true, true, true, false, true],
      ["completed", false, false, false, true, true],
      ["failed", false, false, false, true, false],
      ["aborted", false, false, false, true, false],
    ] as const

    for (const [status, live, dispatchable, executorActive, terminal, started] of cases) {
      expect(isLiveRunStatus(status)).toBe(live)
      expect(isDispatchableRunStatus(status)).toBe(dispatchable)
      expect(isExecutorActiveRunStatus(status)).toBe(executorActive)
      expect(isTerminalRunStatus(status)).toBe(terminal)
      expect(doesRunStatusImplyStarted(status)).toBe(started)
    }

    expect(isRunStatus("queued")).toBe(true)
    expect(isRunStatus("zombie")).toBe(false)
  })
})
