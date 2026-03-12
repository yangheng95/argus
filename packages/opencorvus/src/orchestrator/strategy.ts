import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { Log } from "@/util/log"
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_RUNS,
  SAME_PLAN_RETRY_LIMIT,
  type RetryContext,
} from "./helpers"
import {
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findEvaluationByGoalRun,
  findEvaluationByRun,
  findPlans,
  findRun,
  findRuns,
  latestGoalRunByCoordinator,
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
  const allRuns = findRuns(task.id)
  const samePlanRuns = allRuns.filter((r) => r.plan_version_id === run.plan_version_id).length
  if (samePlanRuns >= limits.maxRuns) {
    // Check if replanning is still possible before giving up
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) {
      return { action: "fail", summary, retryContext: ctx }
    }
    log.info("same-plan run budget exhausted, trying replan", { samePlanRuns, maxRuns: limits.maxRuns, taskID: task.id })
    return { action: "replan", summary, analysis }
  }
  if (allRuns.length >= limits.maxRuns * (limits.maxReplans + 1)) {
    return { action: "fail", summary, retryContext: ctx }
  }

  const classification = analysis?.classification ?? "unknown"
  if (classification === "input" || classification === "permission") {
    log.info("failure classified as non-retryable", { classification, taskID: task.id })
    return { action: "fail", summary, retryContext: ctx }
  }

  if (classification === "environment") {
    log.info("failure classified as environment -> fail", { classification, taskID: task.id })
    return { action: "fail", summary, retryContext: ctx }
  }

  if (ctx.changedFiles?.length === 0) {
    log.info("empty delivery detected -> replanning", { classification, taskID: task.id })
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) {
      return { action: "fail", summary, retryContext: ctx }
    }
    return { action: "replan", summary, analysis }
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
  const goalRun = latestGoalRunByCoordinator(run.id)
  const delivery = findDeliveryByRun(run.id) ?? (goalRun ? findDeliveryByGoalRun(goalRun.id) : undefined)
  const evaluation = findEvaluationByRun(run.id) ?? (goalRun ? findEvaluationByGoalRun(goalRun.id) : undefined)
  const files = deliveryChangedFiles(delivery?.result?.changed_files) ?? inheritedChangedFiles(run)
  return {
    deliverySummary: delivery?.summary ?? undefined,
    changedFiles: files,
    checks: Array.isArray(evaluation?.checks)
      ? evaluation.checks as Array<{ name: string; status: string; evidence: string }>
      : undefined,
    rootCause: analysis?.replan_guidance?.root_cause ?? undefined,
    avoidApproaches: analysis?.replan_guidance?.avoid_approaches ?? undefined,
    suggestedStrategy: analysis?.replan_guidance?.suggested_strategy ?? undefined,
    classification: analysis?.classification ?? undefined,
  }
}

function deliveryChangedFiles(input: unknown) {
  if (!Array.isArray(input)) return
  const files = [...new Set(input.filter((item): item is string => typeof item === "string" && item.length > 0))]
  if (files.length === 0) return
  return files
}

function inheritedChangedFiles(run: RunRow) {
  const seen = new Set<string>()
  let current: RunRow | undefined = run
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const meta =
      current.metadata?.retry_context && typeof current.metadata.retry_context === "object" && !Array.isArray(current.metadata.retry_context)
        ? current.metadata.retry_context as RetryContext
        : undefined
    const files = deliveryChangedFiles(meta?.changedFiles)
    if (files) return files
    const previous = typeof current.metadata?.previous_run_id === "string" ? current.metadata.previous_run_id : undefined
    current = previous ? findRun(previous) ?? undefined : undefined
  }
}
