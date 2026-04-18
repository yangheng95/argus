/**
 * Pipeline type definitions — the contract between GoalPipeline and Orchestrator.
 *
 * GoalPipeline is the central abstraction: a self-driving process that takes a
 * GoalContract and produces a verified delivery through Plan → Execute → Eval.
 * The orchestrator only sees PipelineEvent — it never reaches into pipeline internals.
 */

import type { GoalRunRow, PlanRow, RunRow, TaskRow, PlanNodeRow } from "@/engine"
import type { ExecutorAdapter } from "@/executor/contract"
import type { DecisionLog } from "@/decision-log"
import type { AcceptanceSpec } from "@/acceptance/types"

// ---------------------------------------------------------------------------
// Goal Contract — the ONLY interface between Requirements and Pipeline.
//
// Invariants (from architecture spec):
// ① Requirements Agent is the sole producer, GoalPipeline is the sole consumer.
// ② DB mapping is lossless: each field gets its own column, no compression.
// ③ acceptance_specs must be Eval Agent executable (deterministic shell + rubric).
// ④ owned_paths is the hard write boundary for Executor.
// ⑤ Contract is immutable once created. Only re-running requirements can change it.
// ---------------------------------------------------------------------------

export interface GoalContractFields {
  /** Unique goal ID. */
  id: string
  /** Short goal title (standalone, not merged into description). */
  title: string
  /** What this goal accomplishes — the full objective statement. */
  objective: string
  /**
   * Typed acceptance specs (IR). Evaluator translates these to heuristic
   * commands and rubric checks — no free-form text interpretation.
   */
  acceptance_specs: AcceptanceSpec[]
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
   * Declared at requirements time so dependents can code against them before this goal completes.
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
  /** The goal contract fields (from Requirements Agent → DB → Pipeline). */
  goal: GoalContractFields & Record<string, unknown>
  /** The plan node for this goal (may be empty if per-goal planner hasn't run yet). */
  planNode: PlanNodeRow | null
  /** The coordinator run. */
  run: RunRow
  /** The parent task. */
  task: TaskRow
  /** The plan version (summary, prompt, metadata). */
  plan: PlanRow
  /**
   * Direct dependency goals only (subset of task's goals where this goal
   * lists them in depends_on). Carries each dependency's exports/title so
   * planner/executor can code against sibling interfaces without seeing
   * unrelated goals — the previous `allGoals` shape inflated every per-goal
   * prompt with N-1 irrelevant contracts.
   */
  dependencies: Array<GoalContractFields & Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Pipeline Events — the output of GoalPipeline (AsyncIterable<PipelineEvent>)
// ---------------------------------------------------------------------------

export type PipelineEvent =
  | { type: "executing" }
  | { type: "executor_event"; event: { type: string; summary?: string; payload?: Record<string, unknown> } }
  | { type: "executed"; delivery: PipelineDelivery }
  | { type: "completed"; delivery: PipelineDelivery }
  | { type: "failed"; error: string; failureClass: FailureClass }
  | { type: "aborted" }
  | { type: "heartbeat" }

// ---------------------------------------------------------------------------
// Delivery — what the executor produces
// ---------------------------------------------------------------------------

export interface PipelineDelivery {
  summary: string
  /**
   * Authoritative integration handle. Set iff the goal produced file changes —
   * the delivery commit in the goal's worktree. All integration decisions
   * (merge, owned_paths validation, changed-file scope for checks) MUST read
   * `git show --name-status ${commitRef}` (see `goal/merge.ts → filesChangedByCommit`)
   * rather than `diffs`. Absence of `commitRef` means the executor produced
   * nothing — the goal is failed, not silently passed.
   */
  commitRef?: string
  /**
   * Display / audit only.
   * Carries before/after content for UI diff viewers, LLM delivery prompts,
   * and event payloads. Do NOT use this for integration (merge, verification,
   * scope filtering) — the commit pointed to by `commitRef` is the single
   * source of truth for "which files changed".
   */
  diffs: Array<{ file: string; before?: string; after?: string; status?: string; additions?: number; deletions?: number; [key: string]: unknown }>
}

// ---------------------------------------------------------------------------
// Eval Verdict — what the deterministic evaluator produces
// ---------------------------------------------------------------------------

/** Per-check structured row carried alongside the verdict so consumers can
 *  sink results into criteria_results / forward to the delivery agent without
 *  re-parsing the formatted evidence strings. */
export interface EvalCheckResult {
  name: string
  command: string
  passed: boolean
  output: string
  source: "spec_heuristic" | "spec_rubric" | "project_discovery" | "visual"
  mode: "soft" | "strict"
  severity?: "essential" | "important" | "optional" | "pitfall"
}

export interface EvalVerdict {
  pass: boolean
  verdict: "accepted" | "rejected" | "inconclusive"
  evidence: string[]
  /** Per-evidence pass/fail status parsed from PASS:/FAIL: prefixes. undefined = no explicit marker. */
  evidenceStatus?: Array<"passed" | "failed" | undefined>
  reasoning: string
  /** Eval agent's classification of why it failed (used by retry policy). */
  failureClass?: FailureClass
  /** Structured per-check rows — populated by evaluateGoal so the deliver
   *  tool can sink results into criteria_results without parsing evidence. */
  checks: EvalCheckResult[]
}

// ---------------------------------------------------------------------------
// Failure classification (used by eval verdict, read by Orchestrator for reasoning)
// ---------------------------------------------------------------------------

export type FailureClass = "bug" | "plan_wrong" | "goal_wrong"

// ---------------------------------------------------------------------------
// Execution Dependencies — what execute_goal needs to run
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
  /** Abort signal (orchestrator can abort the execution). */
  signal: AbortSignal
  /** Decision Log (injected, scoped to task). */
  decisionLog?: DecisionLog
  /**
   * Snapshot tree hash captured via Snapshot.track() INSIDE
   * `Instance.provide({ directory: workDir })` immediately before the
   * executor runs. Required for delivery extraction — without it there is
   * no stable "before" reference to diff against. Missing baseRef is a
   * dispatch-time bug, not a runtime condition, so extractDelivery will
   * throw rather than silently return an empty delivery.
   */
  baseRef: string
}
