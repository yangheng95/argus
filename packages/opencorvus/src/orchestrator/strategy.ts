import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { OrchestratorConfig } from "./config"
import { Log } from "@/util/log"

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
  const retryLog = Log.create({ service: "stage-retry" })
  const maxRetries = (await OrchestratorConfig.get()).stage_max_retries
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check signal before each attempt to avoid retrying after abort
    if (options?.signal?.aborted) {
      throw lastError ?? new Error(`${stage} stage aborted before attempt ${attempt + 1}`)
    }
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const cause = lastError.cause instanceof Error ? lastError.cause.message : undefined
      retryLog.warn(`${stage} attempt ${attempt + 1}/${maxRetries + 1} failed`, {
        stage,
        attempt: attempt + 1,
        error: lastError.message,
        cause,
      })
      if (attempt < maxRetries) {
        options?.onRetry?.(attempt + 1, lastError)
      }
    }
  }
  throw lastError!
}
import {
  DEFAULT_MAX_RUNS,
  DEFAULT_MAX_FIX_RUNS,
  type FixContext,
} from "./helpers"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findRuns,
  type RunRow,
  type TaskRow,
} from "./store"

const log = Log.create({ service: "orchestrator-strategy" })

export type FixDecision = {
  action: "fix"
  summary: string
  fixContext: FixContext
}

export type FailDecision = {
  action: "fail"
  summary: string
  fixContext: FixContext
}

export type StrategyDecision = FixDecision | FailDecision

export function decideFixOrFail(
  task: TaskRow,
  run: RunRow,
  summary: string,
  analysis?: EvaluatorAnalysisType,
  fixContext?: FixContext,
): StrategyDecision {
  const ctx = fixContext ?? {}
  const limits = {
    maxRuns: task.budget?.max_runs ?? DEFAULT_MAX_RUNS,
    maxFixRuns: task.budget?.max_fix_runs ?? DEFAULT_MAX_FIX_RUNS,
  }
  const totalRuns = findRuns(task.id).length
  if (totalRuns >= limits.maxRuns) {
    log.info("total runs budget exhausted", { totalRuns, maxRuns: limits.maxRuns, taskID: task.id })
    return { action: "fail", summary, fixContext: ctx }
  }

  const classification = analysis?.classification ?? "unknown"

  if (classification === "input" || classification === "permission") {
    log.info("failure classified as non-retryable", { classification, taskID: task.id })
    return { action: "fail", summary, fixContext: ctx }
  }

  // Count fix runs for the current plan
  const fixRunCount = run.retry_count
  if (fixRunCount >= limits.maxFixRuns) {
    log.info("fix runs budget exhausted", { fixRunCount, maxFixRuns: limits.maxFixRuns, taskID: task.id })
    return { action: "fail", summary, fixContext: ctx }
  }

  log.info("creating fix run", { classification, fixRunCount, taskID: task.id })
  return { action: "fix", summary, fixContext: ctx }
}

export function buildFixContext(
  run: RunRow,
  summary: string,
  analysis?: EvaluatorAnalysisType,
  source?: "eval_failure" | "delivery_rejection",
): FixContext {
  const delivery = findDeliveryByRun(run.id)
  const evaluation = findEvaluationByRun(run.id)
  return {
    source,
    deliverySummary: delivery?.summary ?? undefined,
    changedFiles: delivery?.result?.changed_files as string[] | undefined,
    checks: (evaluation?.checks as Array<{ name: string; status: string; evidence: string }>) ?? undefined,
    rootCause: analysis?.replan_guidance?.root_cause ?? undefined,
    avoidApproaches: analysis?.replan_guidance?.avoid_approaches ?? undefined,
    suggestedStrategy: analysis?.replan_guidance?.suggested_strategy ?? undefined,
    classification: analysis?.classification ?? undefined,
  }
}

/** @deprecated Use decideFixOrFail instead */
export const decideRetryOrReplan = decideFixOrFail
/** @deprecated Use buildFixContext instead */
export const buildRetryContext = buildFixContext
