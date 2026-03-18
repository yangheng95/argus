import { expect, test } from "bun:test"
import { remapGoalAnalysisToRunScope } from "../../src/orchestrator/runtime"
import { type GoalJudgmentType } from "../../src/evaluator/agent"

test("remapGoalAnalysisToRunScope rewrites single-goal analysis indexes to the coordinator run scope", () => {
  const analysis: GoalJudgmentType = {
    verdict: "rejected",
    classification: "evaluation",
    summary: "Tests failed",
    goal_statuses: [{
      goal_index: 0,
      status: "failed",
      evidence: "src/auth.ts is incomplete",
      reasoning: "The auth flow is incomplete.",
    }],
    replan_guidance: {
      root_cause: "The auth flow is incomplete.",
      what_failed: "Authentication failed",
      suggested_strategy: "Fix auth before retrying.",
      avoid_approaches: [],
    },
  }
  const goals = [
    { id: "goal_setup", description: "Project setup" },
    { id: "goal_auth", description: "Authentication" },
    { id: "goal_timeline", description: "Timeline" },
  ] as any

  const remapped = remapGoalAnalysisToRunScope(analysis, goals, goals[1])

  expect(remapped?.goal_statuses).toHaveLength(1)
  expect(remapped?.goal_statuses[0]?.goal_index).toBe(1)
  expect(remapped?.goal_statuses[0]?.evidence).toBe("src/auth.ts is incomplete")
})

test("remapGoalAnalysisToRunScope leaves multi-goal analyses unchanged", () => {
  const analysis: GoalJudgmentType = {
    verdict: "rejected",
    classification: "strategy",
    summary: "Multiple goals failed",
    goal_statuses: [{
      goal_index: 0,
      status: "passed",
      evidence: "setup ok",
      reasoning: "Setup is complete.",
    }, {
      goal_index: 1,
      status: "failed",
      evidence: "auth failed",
      reasoning: "Auth is incomplete.",
    }],
    replan_guidance: {
      root_cause: "Authentication is incomplete.",
      what_failed: "Auth flow",
      suggested_strategy: "Retry auth.",
      avoid_approaches: [],
    },
  }
  const goals = [
    { id: "goal_setup", description: "Project setup" },
    { id: "goal_auth", description: "Authentication" },
  ] as any

  const remapped = remapGoalAnalysisToRunScope(analysis, goals, goals[1])

  expect(remapped).toEqual(analysis)
})
