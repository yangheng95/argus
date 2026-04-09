/**
 * Pipeline module — per-goal execution tools.
 *
 * These are TOOLS the Task Agent can call, not a fixed pipeline.
 * The agent decides when to plan, execute, deliver — not this code.
 *
 * Tools:
 *   runGoalPipeline  — execute a goal (worktree + executor + delivery)
 *   planGoal          — create implementation steps for a goal (optional)
 *   evaluateGoal      — deterministic command runner (used by delivery agent, not auto-gated)
 */

export { runGoalPipeline } from "./executor"
export { planGoal, type PlanSteps } from "@/planner/per-goal"
export { evaluateGoal } from "@/evaluator/per-goal"
export type {
  GoalContract,
  GoalContractFields,
  PipelineEvent,
  PipelineDelivery,
  EvalVerdict,
  FailureClass,
  PipelineDeps,
} from "./types"
