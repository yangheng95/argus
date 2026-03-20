import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { Log } from "@/util/log"

const STAGE_MAX_RETRIES = 2

/**
 * Unified stage retry wrapper. Attempts fn once, retries up to STAGE_MAX_RETRIES
 * times on failure. Agents are pure (attempt once, succeed or throw); this
 * wrapper applies the retry policy uniformly across all stages.
 *
 * If signal is provided and already aborted, throws immediately.
 * Between retries, checks signal to avoid wasting time on aborted stages.
 */
export async function withStageRetry<T>(
  stage: string,
  fn: () => Promise<T>,
  options?: { onRetry?: (attempt: number, error: Error) => void; signal?: AbortSignal },
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= STAGE_MAX_RETRIES; attempt++) {
    // Check signal before each attempt to avoid retrying after abort
    if (options?.signal?.aborted) {
      throw lastError ?? new Error(`${stage} stage aborted before attempt ${attempt + 1}`)
    }
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < STAGE_MAX_RETRIES) {
        options?.onRetry?.(attempt + 1, lastError)
      }
    }
  }
  throw lastError!
}
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_RUNS,
  SAME_PLAN_RETRY_LIMIT,
  type RetryContext,
} from "./helpers"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlans,
  findRuns,
  type RunRow,
  type TaskRow,
} from "./store"

const log = Log.create({ service: "orchestrator-strategy" })

export type RetryDecision = {
  action: "retry"
  summary: string
  retryContext: RetryContext
}

export type ReplanDecision = {
  action: "replan"
  summary: string
  analysis?: EvaluatorAnalysisType
}

export type FailDecision = {
  action: "fail"
  summary: string
  retryContext: RetryContext
}

export type StrategyDecision = RetryDecision | ReplanDecision | FailDecision

export function decideRetryOrReplan(
  task: TaskRow,
  run: RunRow,
  summary: string,
  analysis?: EvaluatorAnalysisType,
  retryContext?: RetryContext,
): StrategyDecision {
  const ctx = retryContext ?? {}
  const limits = {
    maxRuns: task.budget?.max_runs ?? DEFAULT_MAX_RUNS,
    maxReplans: task.budget?.max_replans ?? DEFAULT_MAX_REPLANS,
  }
  const totalRuns = findRuns(task.id).length
  if (totalRuns >= limits.maxRuns) {
    return { action: "fail", summary, retryContext: ctx }
  }

  const classification = analysis?.classification ?? "unknown"

  if (classification === "input" || classification === "permission") {
    log.info("failure classified as non-retryable", { classification, taskID: task.id })
    return { action: "fail", summary, retryContext: ctx }
  }

  if (classification === "strategy") {
    log.info("failure classified as strategy -> replanning", { classification, taskID: task.id })
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) {
      return { action: "fail", summary, retryContext: ctx }
    }
    return { action: "replan", summary, analysis }
  }

  if (run.retry_count < SAME_PLAN_RETRY_LIMIT) {
    log.info("retrying current plan", { classification, retryCount: run.retry_count, taskID: task.id })
    return { action: "retry", summary, retryContext: ctx }
  }

  const replans = findPlans(task.id).length - 1
  if (replans >= limits.maxReplans) {
    return { action: "fail", summary, retryContext: ctx }
  }
  log.info("retries exhausted, replanning", { classification, replans, taskID: task.id })
  return { action: "replan", summary, analysis }
}

export function buildRetryContext(
  run: RunRow,
  summary: string,
  analysis?: EvaluatorAnalysisType,
): RetryContext {
  const delivery = findDeliveryByRun(run.id)
  const evaluation = findEvaluationByRun(run.id)
  return {
    deliverySummary: delivery?.summary ?? undefined,
    changedFiles: delivery?.result?.changed_files as string[] | undefined,
    checks: (evaluation?.checks as Array<{ name: string; status: string; evidence: string }>) ?? undefined,
    rootCause: analysis?.replan_guidance?.root_cause ?? undefined,
    avoidApproaches: analysis?.replan_guidance?.avoid_approaches ?? undefined,
    suggestedStrategy: analysis?.replan_guidance?.suggested_strategy ?? undefined,
    classification: analysis?.classification ?? undefined,
  }
}
