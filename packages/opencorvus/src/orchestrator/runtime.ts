import { Bus } from "@/bus"
import { selectorList } from "@/check/policy"
import { EvaluatorService } from "@/evaluator/service"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { installRuntimeShims } from "@/runtime/shims"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import { DeliveryService } from "./delivery"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import {
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { Event } from "./model"
import {
  buildOperatorPrompt,
  orchestratorState,
} from "./helpers"
import {
  appendExecutorEvent,
  createReplanRun,
  createRetryRun,
  ensureExecutorSession,
  failGoals,
  finalizeDeliveryResult,
  markDeliveryPublishing,
  persistDelivery,
  persistEvaluation,
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
} from "./transition"
import { buildRetryContext, decideRetryOrReplan } from "./strategy"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findRun,
  findTask,
  listGoalsByPlan,
  requireRun,
  requireTask,
  type DeliveryRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator-runtime" })
const EVALUATION_HARD_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes total for entire evaluation phase
const evaluatingRuns = new Set<string>() // in-memory guard against concurrent re-evaluation

async function prepareRun(task: TaskRow, run: RunRow, plan: PlanRow | undefined, hooks: RuntimeHooks) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  if (task.time_started) return task
  const prepared = await OrchestratorGit.prepare(task, plan)
  if (!prepared.error) return prepared.task
  const now = Date.now()
  await hooks.updateRun(run, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  }
  return
}

export namespace OrchestratorRuntime {
  export async function poll(hooks: RuntimeHooks) {
    const current = orchestratorState()
    if (current.syncing) return
    current.syncing = true
    try {
      const rows = Database.use((db) =>
        db
          .select({ id: OrchestratorRunTable.id })
          .from(OrchestratorRunTable)
          .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
          .where(
            and(
              eq(OrchestratorTaskTable.project_id, Instance.project.id),
              inArray(OrchestratorRunTable.status, ["accepted", "running", "blocked", "completed"]),
            ),
          )
          .all(),
      )
      for (const row of rows) {
        await syncRun(row.id, hooks)
      }
    } finally {
      current.syncing = false
    }
  }

  export async function dispatch(runID: string, hooks: RuntimeHooks) {
    installRuntimeShims()
    const run = requireRun(runID)
    if (run.status !== "queued") return
    let task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)
    const base = typeof run.metadata?.prompt_override === "string" ? run.metadata.prompt_override : plan.prompt
    const brief = WorkbenchService.compileBrief({
      taskID: task.id,
      runID: run.id,
      planVersionID: plan.id,
      sessionID: task.session_id,
    })
    const prompt = [brief.content, base].join("\n\n")
    const strategy = run.metadata?.strategy as string | undefined
    const source: "planner" | "scheduler" | "system" =
      strategy === "operator_note" ? "system" : strategy === "retry_same_plan" ? "scheduler" : "planner"
    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)
    const executor = ExecutorRegistry.require(run.executor)
    const submission = await executor.submit({
      sessionID,
      prompt,
      priority: task.priority,
      source,
    })
    const now = Date.now()
    await hooks.updateRun(
      run,
      {
        status: "accepted",
        executor_ref: {
          session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
        time_started: now,
      },
      "Run accepted by executor",
    )
    await hooks.updateTask(
      task,
      {
        status: "running",
        time_started: task.time_started ?? now,
      },
      "Run dispatched",
    )
    const session = ensureExecutorSession({
      taskID: task.id,
      runID: run.id,
      provider: run.executor,
      refs: {
        provider_session_id: submission.sessionID,
        queue_task_id: submission.queueTaskID,
      },
      settings: {
        cwd: Instance.directory,
      },
      started: now,
    })
    appendExecutorEvent(session.id, task.id, run.id, run.executor, {
      provider: run.executor,
      kind: "lifecycle",
      summary: "Run accepted by executor",
      refs: session.refs ?? undefined,
      payload: {
        queue_task_id: submission.queueTaskID,
        provider_session_id: submission.sessionID,
      },
    })
    // Start executor event bridge (fire-and-forget background coroutine)
    consumeExecutorEvents(task.id, run.id, run.executor, sessionID, session.id)
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    if (!task.active_run_id) return
    await syncRun(task.active_run_id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    const task = requireTask(run.task_id)
    const delivery = findDeliveryByRun(run.id)
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      if (run.status !== "blocked") {
        await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
      }
      if (task.status !== "blocked") {
        await hooks.updateTask(task, { status: "blocked", blocking_reason: pending[0].request_type }, "Awaiting user input")
      }
      return
    }

    if (run.status === "completed" && delivery) {
      await completeRun(run, hooks)
      return
    }

    if (run.status === "failed" || run.status === "aborted") {
      return
    }

    const queueTaskID = run.executor_ref?.queue_task_id
    if (!queueTaskID) return
    const executor = ExecutorRegistry.require(run.executor)
    const queue = await executor.status(queueTaskID)

    if (queue.status === "queued" || queue.status === "retrying") {
      if (run.status === "blocked") {
        await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Run resumed")
      }
      if (task.status === "blocked") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run resumed")
      }
      return
    }

    if (queue.status === "running") {
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (task.status !== "running") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      await completeRun(run, hooks)
    }
  }

  export async function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
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

  export async function queueRetry(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks) {
    const nextRunID = createRetryRun(task, run, summary)
    await dispatch(nextRunID, hooks)
    return nextRunID
  }

  export async function queueReplan(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks) {
    const planID = task.active_plan_version_id ?? run.plan_version_id
    if (!planID) throw new Error(`Task ${task.id} has no plan to replan`)
    const plan = findPlan(planID)
    if (!plan) throw new Error(`Plan not found: ${planID}`)
    const next = await createReplanRun(task, plan, run, summary)
    if (!next.queued || !next.runID) throw new PlannerFailureError(next.error ?? "replan failed")
    await dispatch(next.runID, hooks)
    return next.runID
  }
}

async function completeRun(run: RunRow, hooks: RuntimeHooks) {
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
      // Re-run evaluation for this existing delivery (evaluation was interrupted by prior restart)
      const canReEval = task.active_run_id === run.id && run.session_id && !evaluatingRuns.has(run.id)
      console.log(`[completeRun] no evaluation for run ${run.id}, canReEval=${canReEval}, activeRunMatch=${task.active_run_id === run.id}, sessionId=${!!run.session_id}, alreadyEvaluating=${evaluatingRuns.has(run.id)}`)
      if (canReEval) {
        evaluatingRuns.add(run.id)
        console.log(`[completeRun] starting runEvaluation for ${run.id}`)
        try {
          await runEvaluation(task, run, existingDelivery, hooks)
        } finally {
          evaluatingRuns.delete(run.id)
          console.log(`[completeRun] runEvaluation finished for ${run.id}`)
        }
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
      await handleEvaluationFailure(task, run, evaluation.summary, hooks)
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

  persistDelivery({ task, run, deliveryID, delivery, now })

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

  const evaluationDeadline = AbortSignal.timeout(EVALUATION_HARD_TIMEOUT_MS)

  let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
  try {
    result = await EvaluatorService.evaluate(
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
  } catch (evalErr) {
    const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
    log.error("Phase 1 evaluate() threw", { error: msg })
    const errorSummary = `Evaluator Phase 1 failure: ${msg}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery,
      result: { status: "failed", verdict: "rejected", summary: errorSummary, checks: [], artifacts: [] },
      analysis: fallbackAnalysis({ verdict: "rejected", summary: errorSummary }, 0, msg),
      analysisError: msg,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals: [],
    })
    updateExecutorSessionStatus(run.id, "failed")
    const failNow = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    }
    return
  }

  if (evaluationDeadline.aborted) {
    log.error("evaluation hard timeout reached after Phase 1")
  }

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
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  // If evaluator analysis threw, treat as a fatal evaluation failure
  if (analysisError) {
    const errorSummary = `Evaluator failure: ${analysisError}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery, result,
      analysis, analysisError,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals,
    })
    updateExecutorSessionStatus(run.id, "failed")
    const now = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: now }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: now }, errorSummary)
    }
    return
  }

  // If Phase 1 evaluation failed (e.g. strict spec_check or build/test failures),
  // do not let Phase 2 EvaluatorAgent override the verdict
  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary

  persistEvaluation({
    task,
    run,
    deliveryID,
    evaluationID,
    delivery,
    result,
    analysis,
    analysisError,
    finalVerdict,
    finalStatus,
    finalSummary,
    goals,
  })

  if (finalStatus === "passed" || finalStatus === "inconclusive") {
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
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation ${finalStatus} but blocking goals still pending: ${remaining}`, hooks, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

async function runEvaluation(task: TaskRow, run: RunRow, existingDelivery: DeliveryRow, hooks: RuntimeHooks) {
  console.log(`[runEvaluation] START for run ${run.id}, task ${task.id}`)
  if (!run.session_id) { console.log(`[runEvaluation] no session_id, skipping`); return }

  const executor = ExecutorRegistry.require(run.executor)
  let delivery: Awaited<ReturnType<typeof executor.delivery>>
  try {
    delivery = await executor.delivery({
      sessionID: run.session_id,
      since: run.time_started ?? run.time_created,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("re-evaluation: failed to fetch delivery from executor", { error: msg })
    // Use minimal delivery from DB row
    delivery = {
      summary: existingDelivery.summary,
      diffs: [],
    }
  }

  const deliveryID = existingDelivery.id
  const evaluationID = Identifier.ascending("evaluation")

  const evaluationDeadline = AbortSignal.timeout(EVALUATION_HARD_TIMEOUT_MS)

  let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
  try {
    result = await EvaluatorService.evaluate(
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
  } catch (evalErr) {
    const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
    log.error("re-evaluation Phase 1 failed", { error: msg })
    const errorSummary = `Evaluator Phase 1 failure: ${msg}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery,
      result: { status: "failed", verdict: "rejected", summary: errorSummary, checks: [], artifacts: [] },
      analysis: fallbackAnalysis({ verdict: "rejected", summary: errorSummary }, 0, msg),
      analysisError: msg,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals: [],
    })
    updateExecutorSessionStatus(run.id, "failed")
    const failNow = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    }
    return
  }

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
    log.error("re-evaluation agent analysis failed", { error: analysisError })
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  if (analysisError) {
    const errorSummary = `Evaluator failure: ${analysisError}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery, result,
      analysis, analysisError,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals,
    })
    updateExecutorSessionStatus(run.id, "failed")
    const now = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: now }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: now }, errorSummary)
    }
    return
  }

  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary

  persistEvaluation({
    task, run, deliveryID, evaluationID, delivery, result,
    analysis, analysisError, finalVerdict, finalStatus, finalSummary, goals,
  })

  if (finalStatus === "passed" || finalStatus === "inconclusive") {
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
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation ${finalStatus} but blocking goals still pending: ${remaining}`, hooks, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  }
}

async function publishAcceptedDelivery(task: TaskRow, run: RunRow, delivery: DeliveryRow, hooks: RuntimeHooks) {
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
  markDeliveryPublishing(delivery.id, now)

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
  finalizeDeliveryResult({
    deliveryId: delivery.id,
    taskId: task.id,
    runId: run.id,
    delivery,
    result,
    now: completed,
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

async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType) {
  if (task.active_run_id !== run.id) return

  const retryContext = buildRetryContext(run, summary, analysis)
  const decision = decideRetryOrReplan(task, run, summary, analysis, retryContext)

  const executed = await executeDecision(task, run, decision, hooks).catch(async (error) => {
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
  if (executed) return
  failGoals(run, summary)
  OrchestratorMemoryBridge.flushFailureLearnings({
    task,
    run,
    summary,
    retryContext,
  }).catch((err) => log.warn("failed to flush failure learnings", { error: String(err) }))
  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: summary, time_completed: Date.now() }, summary)
}

async function executeDecision(
  task: TaskRow,
  run: RunRow,
  decision: import("./strategy").StrategyDecision,
  hooks: RuntimeHooks,
): Promise<boolean> {
  if (decision.action === "fail") return false

  if (decision.action === "retry") {
    const nextRunID = createRetryRun(task, run, decision.summary, decision.retryContext)
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
    return true
  }

  const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!currentPlan) return false
  const next = await createReplanRun(task, currentPlan, run, decision.summary, decision.analysis)
  if (!next.queued) return !!next.error
  if (!next.runID) return false
  await OrchestratorRuntime.dispatch(next.runID, hooks)
  return true
}

function fallbackAnalysis(
  result: {
    verdict: "accepted" | "rejected" | "inconclusive"
    summary: string
  },
  goalCount: number,
  message: string,
): EvaluatorAnalysisType {
  const goalStatus =
    result.verdict === "accepted"
      ? "passed"
      : result.verdict === "rejected"
        ? "failed"
        : "inconclusive"
  const summary =
    result.verdict === "accepted"
      ? result.summary
      : `${result.summary} Evaluator agent unavailable: ${message}`
  const reasoning =
    result.verdict === "accepted"
      ? "Automated evaluator checks passed; fell back because evaluator agent analysis was unavailable."
      : `Fell back to automated evaluator result because evaluator agent analysis failed: ${message}`
  return {
    verdict: result.verdict,
    classification: "evaluation",
    summary,
    goal_statuses: Array.from({ length: goalCount }, (_, goal_index) => ({
      goal_index,
      status: goalStatus,
      evidence: summary,
      reasoning,
    })),
    replan_guidance: result.verdict === "rejected"
      ? {
          root_cause: `Evaluator agent unavailable: ${message}`,
          what_failed: result.summary,
          suggested_strategy: "Fix the failing automated checks and retry the current plan.",
          avoid_approaches: [],
        }
      : null,
  }
}


/** 将 executor 的实时事件桥接到 Bus，供 SSE 转发给前端 */
function consumeExecutorEvents(
  taskID: string,
  runID: string,
  executorName: Parameters<typeof ExecutorRegistry.require>[0],
  sessionID: string,
  executorSessionID: string,
) {
  const executor = ExecutorRegistry.require(executorName)
  if (!executor.capabilities().events) return
  // 异步消费 — 不阻塞 dispatch 返回
  ;(async () => {
    try {
      for await (const event of executor.events({ sessionID })) {
        upsertExecutorInteraction(taskID, runID, sessionID, executorSessionID, executorName, event)
        appendExecutorEvent(executorSessionID, taskID, runID, executorName, {
          provider: executorName,
          kind: protocolEventKind(event.type),
          summary: event.summary ?? event.type,
          payload: event.payload,
          raw: {
            type: event.type,
            summary: event.summary,
            payload: event.payload,
          },
        })
        if (event.type === "text_delta") {
          Bus.publish(Event.RunOutput, {
            taskID,
            runID,
            type: "text_delta",
            text: event.summary ?? "",
          })
        } else {
          Bus.publish(Event.RunProgress, {
            taskID,
            runID,
            type: event.type,
            summary: event.summary ?? event.type,
            payload: event.payload,
          })
        }
      }
    } catch (err) {
      log.warn("executor event bridge ended", { taskID, runID, error: String(err) })
    }
  })()
}

type RuntimeHooks = {
  updateTask: (
    row: TaskRow,
    values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<typeof OrchestratorRunTable.$inferInsert>,
    summary: string,
  ) => Promise<RunRow>
}

function protocolEventKind(type: string) {
  if (type.includes("tool")) return type.includes("result") ? "tool_result" : "tool_call"
  if (type.includes("reason")) return "reasoning_delta"
  if (type.includes("plan")) return "plan_delta"
  if (type.includes("diff")) return "diff_delta"
  if (type.includes("approval")) return "approval_request"
  if (type.includes("input")) return "input_request"
  if (type.includes("mcp")) return "mcp"
  if (type.includes("command")) return "command"
  if (type.includes("error")) return "error"
  if (type.includes("done") || type.includes("completed")) return "done"
  if (type.includes("delta") || type.includes("message")) return "message_delta"
  return "status"
}

function upsertExecutorInteraction(
  taskID: string,
  runID: string,
  sessionID: string,
  executorSessionID: string,
  provider: RunRow["executor"],
  event: {
    type: string
    summary?: string
    payload?: Record<string, unknown>
  },
) {
  if (event.type !== "approval_request" && event.type !== "input_request") return
  const rawID = event.payload?.id
  const requestID = typeof rawID === "string" || typeof rawID === "number" ? String(rawID) : undefined
  if (!requestID) return
  const externalID = `protocol:${executorSessionID}:${requestID}`
  if (findInteractionByExternal(externalID)) return
  const now = Date.now()
  const interactionID = Identifier.ascending("interaction")
  const title =
    event.type === "approval_request"
      ? `Executor approval: ${String(event.payload?.approval ?? "request")}`
      : firstQuestionHeader(event.payload?.questions) ?? "Executor input required"
  const body =
    event.type === "approval_request"
      ? String(event.summary ?? event.payload?.approval ?? "Approval requested")
      : questionBody(event.payload?.questions) || "The executor requested additional input."
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: taskID,
        run_id: runID,
        session_id: sessionID,
        external_id: externalID,
        request_type: event.type === "approval_request" ? "permission" : "question",
        status: "pending",
        title,
        body,
        payload: {
          protocol_request: true,
          provider,
          executor_session_id: executorSessionID,
          request_id: requestID,
          request_kind: event.type,
          ...(event.payload ?? {}),
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionRequested, {
        taskID,
        runID,
        interactionID,
        requestType: event.type === "approval_request" ? "permission" : "question",
        summary: title,
      }),
    )
  })
}

function firstQuestionHeader(input: unknown) {
  if (!Array.isArray(input)) return
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const next = item as Record<string, unknown>
    if (typeof next.header === "string" && next.header) return next.header
  }
}

function questionBody(input: unknown) {
  if (!Array.isArray(input)) return ""
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const next = item as Record<string, unknown>
    if (typeof next.question !== "string" || !next.question) return []
    return [next.question]
  }).join("\n\n")
}
