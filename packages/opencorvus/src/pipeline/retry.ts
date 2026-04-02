/**
 * Tiered retry policy for GoalPipeline.
 *
 * Retry levels:
 *   bug         → re-execute (same plan, code had a fixable error)
 *   plan_wrong  → re-plan + re-execute (planner chose wrong approach)
 *   goal_wrong  → give up (goal contract itself is flawed, needs re-decompose)
 *
 * The policy is injected into GoalPipeline, not hardcoded.
 * Different scenarios can use different policies.
 */

import type { EvalVerdict, RetryDecision, RetryPolicy } from "./types"

const DEFAULT_MAX_EXECUTOR_RETRIES = 2
const DEFAULT_MAX_PLANNER_RETRIES = 1

export interface TieredRetryConfig {
  maxExecutorRetries?: number
  maxPlannerRetries?: number
}

/**
 * Default tiered retry policy.
 *
 * Attempt counting:
 *   attempt 0 = first eval failure
 *   attempt 1 = second eval failure (after first retry)
 *   ...
 *
 * Decision logic:
 *   1. If eval says goal_wrong → give up immediately (needs re-decompose, not retry)
 *   2. If eval says bug and executor retries remaining → retry executor
 *   3. If eval says plan_wrong and planner retries remaining → retry planner
 *   4. If eval says bug but executor retries exhausted → try planner retry
 *   5. All retries exhausted → give up
 */
export function createTieredRetryPolicy(config?: TieredRetryConfig): RetryPolicy {
  const maxExec = config?.maxExecutorRetries ?? DEFAULT_MAX_EXECUTOR_RETRIES
  const maxPlan = config?.maxPlannerRetries ?? DEFAULT_MAX_PLANNER_RETRIES
  let executorRetries = 0
  let plannerRetries = 0

  return {
    decide(verdict: EvalVerdict, _attempt: number): RetryDecision {
      const cls = verdict.failureClass ?? "bug"

      // Goal itself is wrong — no amount of retrying will fix it
      if (cls === "goal_wrong") {
        return { type: "give_up", class: "goal_wrong" }
      }

      // Bug in code — retry executor with same plan
      if (cls === "bug" && executorRetries < maxExec) {
        executorRetries++
        return { type: "retry", level: "executor" }
      }

      // Plan was wrong — retry planner (which also re-executes)
      if ((cls === "plan_wrong" || executorRetries >= maxExec) && plannerRetries < maxPlan) {
        plannerRetries++
        executorRetries = 0 // reset executor retries for the new plan
        return { type: "retry", level: "planner" }
      }

      // All retries exhausted
      return { type: "give_up", class: cls }
    },
  }
}
