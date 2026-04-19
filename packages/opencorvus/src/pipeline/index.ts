/**
 * Pipeline module — per-goal execution tools.
 *
 * These are TOOLS the Orchestrator can call, not a fixed pipeline.
 * The agent decides when to plan, execute, deliver — not this code.
 *
 * Tools:
 *   runGoalPipeline  — execute a goal (worktree + executor + delivery)
 *   planGoal          — create implementation steps for a goal (optional)
 *
 * Per-goal evaluator (`evaluateGoal`) was removed on 2026-04-20: the
 * delivery agent now owns per-goal verification (it reads
 * acceptance_specs as INFORMATION and runs its own checks via run_command
 * and parallel subagents).
 */

export { runGoalPipeline } from "./executor"
export { planGoal, type PlanSteps } from "@/planner/agent"
export type {
  GoalContract,
  GoalContractFields,
  PipelineEvent,
  PipelineDelivery,
  FailureClass,
  PipelineDeps,
} from "./types"
