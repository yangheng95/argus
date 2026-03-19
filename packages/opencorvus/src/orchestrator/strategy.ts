import { type GoalJudgmentType } from "@/evaluator/agent"
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
  listGoalRunsByCoordinator,
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
  analysis?: GoalJudgmentType
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
  analysis?: GoalJudgmentType,
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
    // Environment failures (missing dep, broken tool) are often fixable by the executor.
    // Replan so the planner gets the evaluator's guidance on what to fix.
    log.info("failure classified as environment -> replan", { classification, taskID: task.id })
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) {
      return { action: "fail", summary, retryContext: ctx }
    }
    return { action: "replan", summary, analysis }
  }

  if (ctx.changedFiles?.length === 0) {
    log.info("empty delivery detected -> replanning", { classification, taskID: task.id })
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) {
      return { action: "fail", summary, retryContext: ctx }
    }
    return { action: "replan", summary, analysis }
  }

  if (classification === "strategy" || summaryNeedsReplan(summary)) {
    log.info("failure requires replanning", {
      classification,
      summary_replan: summaryNeedsReplan(summary),
      taskID: task.id,
    })
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
  analysis?: GoalJudgmentType,
): RetryContext {
  const goalRun = latestGoalRunByCoordinator(run.id)
  const runDelivery = findDeliveryByRun(run.id)
  const goalDelivery = goalRun ? findDeliveryByGoalRun(goalRun.id) : undefined
  const delivery = runDelivery ?? goalDelivery
  const evaluation = findEvaluationByRun(run.id) ?? (goalRun ? findEvaluationByGoalRun(goalRun.id) : undefined)
  const currentFiles = deliveryChangedFiles(delivery?.result)
  const inheritedFiles = inheritedChangedFiles(run)
  const mergedFiles = mergeChangedFiles(currentFiles, inheritedFiles)
  const files = mergedFiles.length > 0 ? mergedFiles : (delivery ? [] : undefined)
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
  if (Array.isArray(input)) {
    const files = [...new Set(input.filter((item): item is string => typeof item === "string" && item.length > 0))]
    return files.length > 0 ? files : []
  }
  if (!input || typeof input !== "object") return
  const result = input as Record<string, unknown>
  const changed = Array.isArray(result.changed_files)
    ? [...new Set(result.changed_files.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : []
  if (changed.length > 0) return changed
  const diffs = Array.isArray(result.diffs)
    ? [...new Set(result.diffs.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const file = (item as Record<string, unknown>).file
        return typeof file === "string" && file.length > 0 ? [file] : []
      }))]
    : []
  if (diffs.length > 0) return diffs
  return Array.isArray(result.changed_files) || Array.isArray(result.diffs) ? [] : undefined
}

function mergeChangedFiles(...groups: Array<string[] | undefined>) {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function inheritedChangedFiles(run: RunRow) {
  const seen = new Set<string>()
  const files = new Set<string>()
  let current: RunRow | undefined = run
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const meta =
      current.metadata?.retry_context && typeof current.metadata.retry_context === "object" && !Array.isArray(current.metadata.retry_context)
        ? current.metadata.retry_context as RetryContext
        : undefined
    for (const file of deliveryChangedFiles(meta?.changedFiles) ?? []) files.add(file)
    const runFiles = deliveryChangedFiles(findDeliveryByRun(current.id)?.result)
    for (const file of runFiles ?? []) files.add(file)
    const goalRuns = listGoalRunsByCoordinator(current.id)
      .sort((a, b) => (b.time_created ?? 0) - (a.time_created ?? 0) || b.id.localeCompare(a.id))
    for (const goalRun of goalRuns) {
      const goalFiles = deliveryChangedFiles(findDeliveryByGoalRun(goalRun.id)?.result)
      for (const file of goalFiles ?? []) files.add(file)
    }
    const previous = typeof current.metadata?.previous_run_id === "string" ? current.metadata.previous_run_id : undefined
    current = previous ? findRun(previous) ?? undefined : undefined
  }
  return files.size > 0 ? [...files] : undefined
}


function summaryNeedsReplan(summary: string) {
  return /(placeholder|stub|todo|returns?\s+null|only\s+console\.log|only\s+log|not implemented|implementation is incomplete|critical .* incomplete|manual .* step|cannot be satisfied|\u65e0\u6cd5\u6ee1\u8db3|\u672a\u5b9e\u73b0|\u5360\u4f4d|\u4ec5\u65e5\u5fd7|\u8fd4\u56de\s*null)/i.test(summary)
}
