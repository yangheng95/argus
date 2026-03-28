import { Bus } from "@/bus"
import { EvaluatorService } from "@/evaluator/service"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { installRuntimeShims } from "@/runtime/shims"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { DeliveryService } from "./delivery"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { Event } from "./model"
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_RUNS,
  SAME_PLAN_RETRY_LIMIT,
  buildOperatorPrompt,
  buildRetryPrompt,
  type RetryContext,
} from "./helpers"
import {
  buildReplanContext,
  compileTransition,
  persistReplanTransition,
  persistReplanTransitionFailure,
} from "./transition"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findPlans,
  findRuns,
  findSpecItems,
  listGoalsByPlan,
  requireTask,
  type DeliveryRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { updateExecutorSessionStatus } from "./executor-session"
import { deriveMilestoneStatuses, fallbackAnalysis, selectorList, selectorsSatisfied, failGoals } from "./evaluation-helpers"
import type { RuntimeHooks } from "./runtime-hooks"

const log = Log.create({ service: "orchestrator-runtime" })

/** Dispatch function type — injected from runtime.ts to avoid circular dependency */
export type DispatchFn = (runID: string, hooks: RuntimeHooks) => Promise<void>

export async function completeRun(run: RunRow, hooks: RuntimeHooks, dispatchFn: DispatchFn) {
  installRuntimeShims()
  updateExecutorSessionStatus(run.id, "completed")
  const existingDelivery = findDeliveryByRun(run.id)
  if (existingDelivery) {
    const task = requireTask(run.task_id)
    const evaluation = findEvaluationByRun(run.id)
    if (run.status !== "completed") {
      await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
    }
    if (!evaluation) {
      if (task.active_run_id === run.id) {
        await hooks.updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Evaluating delivery")
      }
      return
    }
    if (task.active_run_id !== run.id) return
    if (evaluation.status === "passed" && existingDelivery.status === "delivered") {
      await publishAcceptedDelivery(task, run, existingDelivery, hooks)
      return
    }
    if (evaluation.status === "passed" && existingDelivery.status !== "delivered") {
      await publishAcceptedDelivery(task, run, existingDelivery, hooks)
      return
    }
    if (evaluation.status !== "passed") {
      await handleEvaluationFailure(task, run, evaluation.summary, hooks, dispatchFn)
    }
    return
  }

  if (!run.session_id) throw new Error(`Run ${run.id} has no session`)
  const task = requireTask(run.task_id)
  const completedAt = Date.now()
  await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: completedAt }, "Run completed")
  await hooks.updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Evaluating delivery")
  const executor = ExecutorRegistry.require(run.executor)
  const delivery = await executor.delivery({
    sessionID: run.session_id,
    since: run.time_started ?? run.time_created,
  })
  const now = Date.now()
  const deliveryID = Identifier.ascending("delivery")
  const evaluationID = Identifier.ascending("evaluation")

  Database.transaction((db) => {
    db.insert(OrchestratorDeliveryTable)
      .values({
        id: deliveryID,
        task_id: task.id,
        run_id: run.id,
        status: "candidate",
        summary: delivery.summary,
        result: {
          summary: delivery.summary,
          changed_files: delivery.diffs.map((item) => item.file),
          diffs: delivery.diffs,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(OrchestratorArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: task.id,
        run_id: run.id,
        delivery_id: deliveryID,
        kind: "report",
        label: "assistant-summary",
        payload: { summary: delivery.summary },
        time_created: now,
        time_updated: now,
      })
      .run()
    if (delivery.diffs.length > 0) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: task.id,
          run_id: run.id,
          delivery_id: deliveryID,
          kind: "diff",
          label: "workspace-diff",
          payload: { diffs: delivery.diffs },
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    for (const item of delivery.diffs) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: task.id,
          run_id: run.id,
          delivery_id: deliveryID,
          kind: "changed_file",
          label: item.file,
          payload: item,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    Database.effect(() =>
      Bus.publish(Event.DeliveryReady, { taskID: task.id, runID: run.id, deliveryID, summary: delivery.summary }),
    )
  })

  await Plugin.trigger("delivery.ready", {
    taskID: task.id,
    runID: run.id,
    deliveryID,
    delivery: {
      summary: delivery.summary,
      changedFiles: delivery.diffs.map((item) => item.file),
      diffs: delivery.diffs,
    },
  }, { actions: [] }).catch(() => undefined)

  // Phase 1: Automated checks (build/test/lint)
  const result = await EvaluatorService.evaluate(
    {
      taskID: task.id,
      activeSpecVersionID: task.active_spec_version_id ?? undefined,
      request: task.request,
      metadata: {
        ...(task.metadata ?? {}),
        delivery_changed_files: delivery.diffs.map((item) => item.file),
      },
    },
    {
      summary: delivery.summary,
      diffs: delivery.diffs,
      changedFiles: delivery.diffs.map((item) => item.file),
    },
  )

  // Phase 2: Independent-context EvaluatorAgent analysis
  // Analyzes check results, investigates failures, assesses each goal, classifies failure type
  const goals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
  let analysis: EvaluatorAnalysisType
  let analysisError: string | undefined
  try {
    analysis = await EvaluatorService.analyzeDelivery({
      task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined },
      goals: goals.map((g) => ({
        description: g.description,
        criteria: g.criteria,
        priority: g.priority as "blocking" | "advisory",
        check_selector: selectorList(g.metadata) as string[],
      })),
      delivery: {
        summary: delivery.summary,
        changedFiles: delivery.diffs.map((d) => d.file),
        diffs: delivery.diffs,
      },
      checkResults: result.checks.map((c) => ({
        name: c.name,
        status: c.status,
        evidence: c.evidence,
      })),
    })
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err)
    log.error("evaluator agent analysis failed", { error: analysisError })
    analysis = fallbackAnalysis(result, goals, result.checks, analysisError)
  }

  // If Phase 1 evaluation failed (e.g. strict spec_check or build/test failures),
  // do not let Phase 2 EvaluatorAgent override the verdict
  const phase1Failed = result.status === "failed"
  const finalVerdict =
    phase1Failed
      ? "rejected"
      : analysisError && analysis.verdict !== "accepted"
        ? "rejected"
        : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysisError && analysis.verdict !== "accepted"
      ? `Evaluator failure: ${analysisError}. ${analysis.summary}`
      : analysis.summary

  Database.transaction((db) => {
    db.insert(OrchestratorEvaluationTable)
      .values({
        id: evaluationID,
        task_id: task.id,
        run_id: run.id,
        delivery_id: deliveryID,
        status: finalStatus,
        verdict: finalVerdict,
        summary: finalSummary,
        checks: result.checks,
        time_completed: Date.now(),
        time_created: now,
        time_updated: Date.now(),
      })
      .run()
    for (const artifact of result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: task.id,
          run_id: run.id,
          delivery_id: deliveryID,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
    }
    if (analysisError) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: task.id,
          run_id: run.id,
          delivery_id: deliveryID,
          kind: "report",
          label: "evaluator-agent-error",
          payload: { error: analysisError, fallback: true },
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
    }
    db.insert(OrchestratorArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: task.id,
        run_id: run.id,
        delivery_id: deliveryID,
        kind: "report",
        label: "evaluator-agent-analysis",
        payload: analysis as unknown as Record<string, unknown>,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
    // Update individual goal statuses from agent analysis (per-goal, not batch)
    if (goals.length > 0) {
      const now2 = Date.now()
      for (const gs of (Array.isArray(analysis.goal_statuses) ? analysis.goal_statuses : [])) {
        const goal = goals[gs.goal_index]
        if (!goal) continue
        let goalStatus = gs.status === "passed" ? "passed" as const : gs.status === "failed" ? "failed" as const : undefined
        // Enforce check_selector: agent cannot mark a goal "passed" if its
        // required checks did not actually pass in the automated results.
        if (goalStatus === "passed") {
          const selectors = selectorList(goal.metadata)
          if (selectors.length > 0) {
            const allSelectorsPassed = selectorsSatisfied(selectors, result.checks)
            if (!allSelectorsPassed) {
              goalStatus = undefined // keep goal pending — checks not satisfied
            }
          }
        }
        if (!goalStatus || goal.status === goalStatus) continue
        db.update(OrchestratorGoalTable)
          .set({ status: goalStatus, time_updated: now2 })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
        if (goalStatus === "passed") {
          Database.effect(() =>
            Bus.publish(Event.GoalPassed, { taskID: task.id, goalID: goal.id, summary: goal.description }),
          )
        } else if (goalStatus === "failed") {
          Database.effect(() =>
            Bus.publish(Event.GoalFailed, { taskID: task.id, goalID: goal.id, summary: `${goal.description}: ${gs.evidence}` }),
          )
        }
      }
      if (run.plan_version_id) {
        deriveMilestoneStatuses(db, task.id, run.plan_version_id, now2)
      }
    }
    // Update spec_item statuses based on evaluation outcome
    if (task.active_spec_version_id) {
      const specItems = findSpecItems(task.active_spec_version_id)
      const specCheckVerdict = result.checks.find((c) => c.name === "spec_check")
      const now3 = Date.now()
      if (specItems.length > 0) {
        const itemStatus = finalVerdict === "accepted" ? "done" as const : "failed" as const
        for (const item of specItems) {
          if (item.status === itemStatus) continue
          db.update(OrchestratorSpecItemTable)
            .set({ status: itemStatus, evidence: specCheckVerdict?.evidence ?? finalSummary, time_updated: now3 })
            .where(eq(OrchestratorSpecItemTable.id, item.id))
            .run()
        }
        // Mark spec snapshot as completed when all items pass
        if (finalVerdict === "accepted") {
          db.update(OrchestratorSpecSnapshotTable)
            .set({ status: "completed", time_updated: now3 })
            .where(eq(OrchestratorSpecSnapshotTable.id, task.active_spec_version_id))
            .run()
        }
      }
    }
    Database.effect(() =>
      Bus.publish(Event.EvaluationCompleted, {
        taskID: task.id,
        runID: run.id,
        evaluationID,
        status: finalStatus,
        verdict: finalVerdict,
        summary: finalSummary,
      }),
    )
  })

  if (finalStatus === "passed" || finalStatus === "inconclusive") {
    // "passed" = full LLM investigation confirmed acceptance
    // "inconclusive" = synthesis fallback or shallow investigation
    // In both cases, check individual goal statuses — goals with check_selectors
    // may have been verified mechanistically even without LLM investigation.
    // Only goals that were actually verified (status !== "pending") count.
    const allGoals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
    const pendingBlocking = allGoals.filter((g) => g.priority === "blocking" && g.status === "pending")

    if (pendingBlocking.length === 0) {
      const accepted = findDeliveryByRun(run.id)
      if (!accepted) {
        await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
        return
      }
      await publishAcceptedDelivery(task, run, accepted, hooks)
      return
    }
    const remaining = pendingBlocking.map((g) => g.description).join(", ")
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation ${finalStatus} but blocking goals still pending: ${remaining}`, hooks, dispatchFn, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, dispatchFn, analysis)
}

export async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    Database.use((db) =>
      db
        .insert(OrchestratorEvaluationTable)
        .values({
          id: Identifier.ascending("evaluation"),
          task_id: task.id,
          run_id: run.id,
          status: "failed",
          verdict: "rejected",
          summary: error,
          checks: [
            {
              name: "executor_completion",
              status: "failed",
              evidence: error,
            },
          ],
          time_completed: now,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  }
}

export async function publishAcceptedDelivery(task: TaskRow, run: RunRow, delivery: DeliveryRow, hooks: RuntimeHooks) {
  if (task.active_run_id !== run.id) return
  if (delivery.status === "delivered") {
    const current = requireTask(task.id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    const finalized = await OrchestratorGit.complete(current, plan, delivery)
    if (finalized.error) {
      await hooks.updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: Date.now() }, finalized.error)
      return
    }
    if (task.status !== "completed") {
      await hooks.updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
    }
    return
  }

  const now = Date.now()
  await hooks.updateRun(run, { phase: "deliver" }, "Publishing accepted delivery")
  await hooks.updateTask(task, { status: "delivering", blocking_reason: null, error: null }, "Publishing accepted delivery")
  Database.use((db) =>
    db
      .update(OrchestratorDeliveryTable)
      .set({
        status: "publishing",
        time_updated: now,
      })
      .where(eq(OrchestratorDeliveryTable.id, delivery.id))
      .run(),
  )

  const result = await DeliveryService.deliver({ task, run, delivery }).catch((error) => ({
    status: "failed" as const,
    summary: String(error),
    artifacts: [] as Array<{ kind: "patch" | "report" | "html_trace" | "link" | "git_ref"; label: string; payload: Record<string, unknown> }>,
    publish: {
      mode: "manual" as const,
      adapters: [{
        id: "delivery",
        status: "skipped" as const,
        summary: "Delivery export failed.",
        detail: String(error),
      }],
    },
  }))

  const completed = Date.now()
  Database.transaction((db) => {
    db.update(OrchestratorDeliveryTable)
      .set({
        status: result.status,
        summary: result.summary,
        result: {
          ...(delivery.result ?? {}),
          summary: result.summary,
          artifacts: result.artifacts.map((item) => ({
            kind: item.kind,
            label: item.label,
          })),
          publish: result.publish,
        },
        time_updated: completed,
      })
      .where(eq(OrchestratorDeliveryTable.id, delivery.id))
      .run()
    for (const artifact of result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: task.id,
          run_id: run.id,
          delivery_id: delivery.id,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: completed,
          time_updated: completed,
        })
        .run()
    }
  })

  if (result.status === "delivered") {
    const current = requireTask(task.id)
    const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    const published = findDeliveryByRun(run.id) ?? delivery
    const finalized = await OrchestratorGit.complete(current, currentPlan, published)
    if (finalized.error) {
      await hooks.updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
      return
    }
    await hooks.updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
    await hooks.updateRun(run, { phase: "deliver" }, "Delivery published")
    // Flush task learnings to memory (fire-and-forget)
    const evaluation = findEvaluationByRun(run.id)
    OrchestratorMemoryBridge.flushTaskLearnings({
      task,
      run,
      delivery,
      evaluation,
      plan: currentPlan,
    }).catch((err) => log.warn("failed to flush task learnings", { error: String(err) }))
    return
  }

  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
}

export async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, dispatchFn: DispatchFn, analysis?: EvaluatorAnalysisType) {
  if (task.active_run_id !== run.id) return

  // Build rich retry context from delivery + evaluation data
  const delivery = findDeliveryByRun(run.id)
  const evaluation = findEvaluationByRun(run.id)
  const retryContext: RetryContext = {
    deliverySummary: delivery?.summary ?? undefined,
    changedFiles: delivery?.result?.changed_files as string[] | undefined,
    checks: (evaluation?.checks as Array<{ name: string; status: string; evidence: string }>) ?? undefined,
    rootCause: analysis?.replan_guidance?.root_cause ?? undefined,
    avoidApproaches: analysis?.replan_guidance?.avoid_approaches ?? undefined,
    suggestedStrategy: analysis?.replan_guidance?.suggested_strategy ?? undefined,
    classification: analysis?.classification ?? undefined,
  }

  const next = await retryOrReplan(task, run, summary, hooks, dispatchFn, analysis, retryContext).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error("retry/replan failed", { taskID: task.id, runID: run.id, error: message })
    await hooks.updateTask(
      task,
      {
        status: "failed",
        blocking_reason: null,
        error: `Planner failure: ${message}`,
        time_completed: Date.now(),
      },
      `Planner failure: ${message}`,
    )
    return false
  })
  if (next) return
  await failGoals(run, summary)
  // Flush failure learnings (fire-and-forget)
  OrchestratorMemoryBridge.flushFailureLearnings({
    task,
    run,
    summary,
    retryContext,
  }).catch((err) => log.warn("failed to flush failure learnings", { error: String(err) }))
  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: summary, time_completed: Date.now() }, summary)
}

async function retryOrReplan(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, dispatchFn: DispatchFn, analysis?: EvaluatorAnalysisType, retryContext?: RetryContext) {
  const limits = {
    maxRuns: task.budget?.max_runs ?? DEFAULT_MAX_RUNS,
    maxReplans: task.budget?.max_replans ?? DEFAULT_MAX_REPLANS,
  }
  const totalRuns = findRuns(task.id).length
  if (totalRuns >= limits.maxRuns) return false

  const classification = analysis?.classification ?? "unknown"

  // Classification-based retry policy:
  // - transient: retry immediately (flaky test, network issue)
  // - input/permission: cannot fix automatically → fail
  // - strategy: skip retry, go straight to replan (fundamental approach wrong)
  // - evaluation/environment/unknown: try retry first, then replan

  if (classification === "input" || classification === "permission") {
    log.info("failure classified as non-retryable", { classification, taskID: task.id })
    return false
  }

  if (classification === "strategy") {
    // Strategy failure → skip retry, replan immediately with different approach
    log.info("failure classified as strategy → replanning", { classification, taskID: task.id })
    const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!currentPlan) return false
    const replans = findPlans(task.id).length - 1
    if (replans >= limits.maxReplans) return false
    const next = await createReplanRun(task, currentPlan, run, summary, analysis)
    if (!next.queued) return !!next.error
    if (!next.runID) return false
    await dispatchFn(next.runID, hooks)
    return true
  }

  // transient / evaluation / environment / unknown → retry first, then replan
  if (run.retry_count < SAME_PLAN_RETRY_LIMIT) {
    log.info("retrying current plan", { classification, retryCount: run.retry_count, taskID: task.id })
    const nextRunID = createRetryRun(task, run, summary, retryContext)
    await dispatchFn(nextRunID, hooks)
    return true
  }

  const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!currentPlan) return false
  const replans = findPlans(task.id).length - 1
  if (replans >= limits.maxReplans) return false
  log.info("retries exhausted, replanning", { classification, replans, taskID: task.id })
  const next = await createReplanRun(task, currentPlan, run, summary, analysis)
  if (!next.queued) return !!next.error
  if (!next.runID) return false
  await dispatchFn(next.runID, hooks)
  return true
}

export function createRetryRun(task: TaskRow, run: RunRow, summary: string, retryContext?: RetryContext) {
  const nextRunID = Identifier.ascending("run")
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(OrchestratorRunTable)
      .values({
        id: nextRunID,
        task_id: task.id,
        plan_version_id: run.plan_version_id,
        session_id: run.session_id,
        executor: run.executor,
        status: "queued",
        phase: "execute",
        retry_count: run.retry_count + 1,
        metadata: {
          previous_run_id: run.id,
          strategy: "retry_same_plan",
          prompt_override: buildRetryPrompt(summary, retryContext),
          retry_context: retryContext,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: nextRunID,
        status: "running",
        error: null,
        blocking_reason: null,
        time_completed: null,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: "Retrying current plan after evaluation failure",
        payload: {
          previousRunID: run.id,
          nextRunID,
          reason: summary,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: task.id,
        runID: nextRunID,
        status: "queued",
        summary: "Retrying current plan after evaluation failure",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: "running",
        summary: "Retrying current plan after evaluation failure",
      }),
    )
  })
  return nextRunID
}

export async function createReplanRun(task: TaskRow, plan: PlanRow, run: RunRow, summary: string, analysis?: EvaluatorAnalysisType) {
  const goals = listGoalsByPlan(plan.id)
  const routing =
    task.metadata?.routing && typeof task.metadata.routing === "object" && !Array.isArray(task.metadata.routing)
      ? task.metadata.routing as any
      : undefined
  const replanContext = buildReplanContext({
    analysis,
    goals,
    summary,
    previousSummary: plan.summary,
  })
  const now = Date.now()
  try {
    const compiled = await compileTransition({
      mode: "replan",
      taskID: task.id,
      now,
      title: task.title,
      request: task.request,
      goals: goals.map((goal) => ({
        description: goal.description,
        criteria: goal.criteria,
        priority: goal.priority,
        metadata: goal.metadata ?? undefined,
      })),
      executor: run.executor,
      routing,
      task,
      previousPlan: plan,
      previousRun: run,
      failureSummary: summary,
      replanContext,
    })
    return persistReplanTransition({
      task,
      previousPlan: plan,
      previousRun: run,
      nextPlanID: Identifier.ascending("plan"),
      nextRunID: Identifier.ascending("run"),
      now,
      summary,
      replanContext,
      compiled,
    })
  } catch (error) {
    if (!(error instanceof PlannerFailureError)) throw error
    return persistReplanTransitionFailure({
      task,
      now,
      error: `Planner failure: ${error.message}`,
    })
  }
}

export function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
  const nextRunID = Identifier.ascending("run")
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(OrchestratorRunTable)
      .values({
        id: nextRunID,
        task_id: task.id,
        plan_version_id: task.active_plan_version_id,
        session_id: run.session_id,
        executor: run.executor,
        status: "queued",
        phase: "execute",
        retry_count: 0,
        metadata: {
          previous_run_id: run.id,
          strategy: "operator_note",
          prompt_override: buildOperatorPrompt(note),
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: nextRunID,
        status: "running",
        error: null,
        blocking_reason: null,
        time_completed: null,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: task.id,
        runID: nextRunID,
        status: "queued",
        summary: "Run queued from operator note",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: "running",
        summary: "Operator note queued a follow-up run",
      }),
    )
  })
  return nextRunID
}
