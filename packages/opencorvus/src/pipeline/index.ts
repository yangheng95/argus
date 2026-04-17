/**
 * Pipeline module — per-goal execution tools.
 *
 * These are TOOLS the Orchestrator can call, not a fixed pipeline.
 * The agent decides when to plan, execute, deliver — not this code.
 *
 * Tools:
 *   runGoalPipeline  — execute a goal (worktree + executor + delivery)
 *   planGoal          — create implementation steps for a goal (optional)
 *   evaluateGoal      — deterministic command runner; the deliver tool
 *                       (orchestrator/tools.ts) drives it per-goal before
 *                       handing checkResults to the delivery agent.
 */

export { runGoalPipeline } from "./executor"
export { planGoal, type PlanSteps } from "@/planner/agent"
export { evaluateGoal } from "@/delivery/checks"
export type {
  GoalContract,
  GoalContractFields,
  PipelineEvent,
  PipelineDelivery,
  EvalVerdict,
  EvalCheckResult,
  FailureClass,
  PipelineDeps,
} from "./types"
