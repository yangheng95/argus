import { describe, expect, test } from "bun:test"
import { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, restartStagePlan } from "../../src/orchestrator/scheduler"

describe("orchestrator scheduler invariants", () => {
  test("live run statuses do not include terminal runs", () => {
    expect(LIVE_RUN_STATUSES).toEqual(["queued", "accepted", "running", "blocked"])
    expect(LIVE_RUN_STATUSES.includes("completed" as never)).toBe(false)
    expect(LIVE_RUN_STATUSES.includes("failed" as never)).toBe(false)
    expect(LIVE_RUN_STATUSES.includes("aborted" as never)).toBe(false)
  })

  test("resettable goal-run statuses exclude completed — retry goes through supersede", () => {
    // `completed` is intentionally excluded: its verification evidence is
    // load-bearing and its parent goal.status should stay `passed` until a
    // fresh goal_run under the new contract transitions. Rework routes
    // through Goal.startNewAttempt (sets `superseded_reason` column on
    // the old terminal row), not an FSM flip.
    expect(GOAL_RUN_RESETTABLE_STATUSES).toEqual(["queued", "accepted", "planning", "running", "evaluating", "blocked"])
  })

  test("requirements restart clears spec/plan and deletes goals", () => {
    expect(restartStagePlan("requirements", true)).toEqual({
      clearSpec: true,
      clearPlan: true,
      deleteGoals: true,
      resetGoalStatuses: false,
      retireGoalRuns: false,
      queueFreshRun: false,
      nextAction: "requirements",
    })
  })

  test("plan restart preserves spec but fully regenerates the goal plan", () => {
    expect(restartStagePlan("plan", true)).toEqual({
      clearSpec: false,
      clearPlan: true,
      deleteGoals: true,
      resetGoalStatuses: false,
      retireGoalRuns: true,
      queueFreshRun: false,
      nextAction: "architect",
    })
  })

  test("executor restart reuses an active plan by queuing a fresh run", () => {
    expect(restartStagePlan("executor", true)).toEqual({
      clearSpec: false,
      clearPlan: false,
      deleteGoals: false,
      resetGoalStatuses: true,
      retireGoalRuns: true,
      queueFreshRun: true,
      nextAction: "submit_execution",
    })
  })

  test("executor restart falls back to create_run when no plan is active", () => {
    expect(restartStagePlan("executor", false)).toEqual({
      clearSpec: false,
      clearPlan: false,
      deleteGoals: false,
      resetGoalStatuses: true,
      retireGoalRuns: true,
      queueFreshRun: false,
      nextAction: "create_run",
    })
  })
})
