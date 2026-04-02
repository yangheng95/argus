/**
 * Pipeline module — per-goal self-driving execution pipeline.
 *
 * Core exports:
 *   runGoalPipeline  — async generator: GoalContract → AsyncIterable<PipelineEvent>
 *   createTieredRetryPolicy — default retry policy (bug→executor, plan→planner, goal→give up)
 *
 * Types:
 *   GoalContract, PipelineEvent, PipelineDelivery, EvalVerdict,
 *   RetryPolicy, RetryDecision, PipelineDeps
 */

export { runGoalPipeline } from "./goal-pipeline"
export { createTieredRetryPolicy } from "./retry"
export type {
  GoalContract,
  GoalContractFields,
  PipelineEvent,
  PipelineDelivery,
  EvalVerdict,
  RetryPolicy,
  RetryDecision,
  RetryLevel,
  FailureClass,
  PipelineDeps,
} from "./types"
