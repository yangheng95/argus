/**
 * Pipeline type definitions — the contract between GoalPipeline and Orchestrator.
 *
 * GoalPipeline is the central abstraction: a self-driving process that takes a
 * GoalContract and produces a verified delivery through Plan → Execute → Eval.
 * The orchestrator only sees PipelineEvent — it never reaches into pipeline internals.
 */

import type { GoalRunRow, PlanRow, RunRow, TaskRow, PlanNodeRow } from "@/orchestrator/store"
import type { ExecutorAdapter } from "@/executor/compat"

// ---------------------------------------------------------------------------
// Goal Contract — the ONLY interface between Decompose and Pipeline.
//
// Invariants (from architecture spec):
// ① Decompose Agent is the sole producer, GoalPipeline is the sole consumer.
// ② DB mapping is lossless: each field gets its own column, no compression.
// ③ done_definition must be executable/judgeable by Eval Agent.
// ④ owned_paths is the hard write boundary for Executor.
// ⑤ Contract is immutable once created. Only re-decompose can change it.
// ---------------------------------------------------------------------------

export interface GoalContractFields {
  /** Unique goal ID. */
  id: string
  /** Short goal title (standalone, not merged into description). */
  title: string
  /** What this goal accomplishes — the full objective statement. */
  objective: string
  /** Verifiable pass/fail criteria. Must be Eval Agent executable, not vague. */
  done_definition: string
  /** Files this goal owns exclusively. Executor hard write boundary. */
  owned_paths: string[]
  /** Goal IDs this depends on (must complete before this goal starts). */
  depends_on: string[]
  /** blocking = must pass for task success. advisory = failure doesn't block. */
  priority: "blocking" | "advisory"
  /** Goal category. */
  kind: string
  /** Requirement IDs from user input that this goal covers (for fidelity tracing). */
  requirement_ids: string[]
  /**
   * Interfaces this goal EXPORTS for dependent goals.
   * Declared at decompose time so dependents can code against them before this goal completes.
   * Example: ["getStocks(): Stock[]", "type Stock = { id: string; name: string; price: number }"]
   */
  exports: string[]
  /**
   * Interfaces this goal IMPORTS from its dependencies.
   * Must be a subset of the union of all depends_on goals' exports.
   */
  imports: string[]
}

/**
 * Full goal contract passed to GoalPipeline.
 * Contains the contract fields + runtime context (run, task, plan, sibling goals).
 */
export interface GoalContract {
  /** The goal contract fields (from Decompose Agent → DB → Pipeline). */
  goal: GoalContractFields & Record<string, unknown>
  /** The plan node for this goal (may be empty if per-goal planner hasn't run yet). */
  planNode: PlanNodeRow | null
  /** The coordinator run. */
  run: RunRow
  /** The parent task. */
  task: TaskRow
  /** The plan version (summary, prompt, metadata). */
  plan: PlanRow
  /** All goals in this task (for dependency context). */
  allGoals: Array<GoalContractFields & Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Pipeline Events — the output of GoalPipeline (AsyncIterable<PipelineEvent>)
// ---------------------------------------------------------------------------

export type PipelineEvent =
  | { type: "planning" }
  | { type: "planned"; planNodeID: string }
  | { type: "executing" }
  | { type: "executor_event"; event: { type: string; summary?: string; payload?: Record<string, unknown> } }
  | { type: "executed"; delivery: PipelineDelivery }
  | { type: "evaluating" }
  | { type: "evaluated"; verdict: EvalVerdict }
  | { type: "retrying"; level: RetryLevel; attempt: number; reason: string }
  | { type: "completed"; delivery: PipelineDelivery }
  | { type: "failed"; verdict?: EvalVerdict; error: string; failureClass: FailureClass }
  | { type: "aborted" }
  | { type: "heartbeat" }

// ---------------------------------------------------------------------------
// Delivery — what the executor produces
// ---------------------------------------------------------------------------

export interface PipelineDelivery {
  summary: string
  diffs: Array<{ file: string; before?: string; after?: string; status?: string; additions?: number; deletions?: number; [key: string]: unknown }>
}

// ---------------------------------------------------------------------------
// Eval Verdict — what the eval agent produces
// ---------------------------------------------------------------------------

export interface EvalVerdict {
  pass: boolean
  verdict: "accepted" | "rejected" | "inconclusive"
  evidence: string[]
  reasoning: string
  /** Eval agent's classification of why it failed (used by retry policy). */
  failureClass?: FailureClass
}

// ---------------------------------------------------------------------------
// Retry types
// ---------------------------------------------------------------------------

export type RetryLevel = "executor" | "planner"
export type FailureClass = "bug" | "plan_wrong" | "goal_wrong"

export interface RetryDecision {
  type: "retry" | "give_up"
  level?: RetryLevel
  class?: FailureClass
}

export interface RetryPolicy {
  /** Given an eval verdict and current attempt number, decide what to do. */
  decide(verdict: EvalVerdict, attempt: number): RetryDecision
}

// ---------------------------------------------------------------------------
// Pipeline Dependencies — injected via constructor (not global state)
// ---------------------------------------------------------------------------

export interface PipelineDeps {
  /** The executor adapter to use for this goal. */
  executor: ExecutorAdapter
  /** Worktree directory for this goal (already created by orchestrator). */
  workDir: string
  /** Session ID for this goal (child of task session). */
  sessionID: string
  /** Executor session ID. */
  executorSessionID: string
  /** Queue task ID from executor.submit(). */
  queueTaskID: string
  /** Retry policy (injected, not hardcoded). */
  retryPolicy: RetryPolicy
  /** Abort signal (orchestrator can abort the pipeline). */
  signal: AbortSignal
}
