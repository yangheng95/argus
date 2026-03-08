import { Bus } from "@/bus"
import { EvaluatorService } from "@/evaluator/service"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { type ReplanContext } from "@/planner/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerService } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
  type OrchestratorMetadata,
  type OrchestratorMilestoneStatus,
} from "./orchestrator.sql"
import { Event } from "./model"
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_RUNS,
  ORCHESTRATOR_POLL_INTERVAL_MS,
  SAME_PLAN_RETRY_LIMIT,
  buildOperatorPrompt,
  buildRetryPrompt,
  orchestratorState,
  progressStatus,
} from "./helpers"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPendingInteractions,
  findPlan,
  findPlans,
  findRun,
  findRuns,
  findTask,
  listGoalsByPlan,
  listMilestonesByPlan,
  requireRun,
  requireTask,
  type GoalRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator-runtime" })

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
              inArray(OrchestratorRunTable.status, ["accepted", "running", "blocked"]),
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
    const run = requireRun(runID)
    if (run.status !== "queued") return
    const task = requireTask(run.task_id)
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
    const executor = ExecutorRegistry.require(run.executor)
    const submission = await executor.submit({
      sessionID: task.session_id,
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
    const nextRunID = await createReplanRun(task, plan, run, summary)
    await dispatch(nextRunID, hooks)
    return nextRunID
  }
}

async function completeRun(run: RunRow, hooks: RuntimeHooks) {
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
    if (evaluation.status === "passed" && task.status !== "completed") {
      await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
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

  Database.transaction((db) => {
    db.insert(OrchestratorDeliveryTable)
      .values({
        id: deliveryID,
        task_id: task.id,
        run_id: run.id,
        status: "ready",
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
  let analysis: EvaluatorAnalysisType | undefined
  try {
    analysis = await EvaluatorService.analyzeDelivery({
      task: { title: task.title, request: task.request },
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
    log.warn("evaluator agent analysis failed, using automated results only", { error: String(err) })
  }

  // Use agent verdict when available, fall back to automated results
  const finalVerdict = analysis?.verdict ?? result.verdict
  const finalStatus = analysis
    ? (analysis.verdict === "accepted" ? "passed" : analysis.verdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
    : result.status
  const finalSummary = analysis?.summary ?? result.summary

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
    // Store agent analysis as artifact for traceability
    if (analysis) {
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
    }
    // Update individual goal statuses from agent analysis (per-goal, not batch)
    if (analysis && goals.length > 0) {
      const now2 = Date.now()
      for (const gs of analysis.goal_statuses) {
        const goal = goals[gs.goal_index]
        if (!goal) continue
        const goalStatus = gs.status === "passed" ? "passed" : gs.status === "failed" ? "failed" : undefined
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
    } else if (finalStatus === "passed") {
      // Fallback: batch goal update when agent analysis is unavailable
      const now2 = Date.now()
      const matched = goals.filter((goal) => goalMatchesChecks(goal, result.checks))
      for (const goal of matched) {
        db.update(OrchestratorGoalTable)
          .set({ status: "passed", time_updated: now2 })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
      }
      for (const goal of matched) {
        Database.effect(() =>
          Bus.publish(Event.GoalPassed, { taskID: task.id, goalID: goal.id, summary: goal.description }),
        )
      }
      if (run.plan_version_id) {
        deriveMilestoneStatuses(db, task.id, run.plan_version_id, now2)
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

  if (finalStatus === "passed") {
    const allGoals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
    const pendingBlocking = allGoals.filter((g) => g.priority === "blocking" && g.status === "pending")

    if (pendingBlocking.length === 0) {
      await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
      return
    }
    const remaining = pendingBlocking.map((g) => g.description).join(", ")
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation passed but blocking goals still pending: ${remaining}`, hooks, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
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

async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType) {
  if (task.active_run_id !== run.id) return
  const next = await retryOrReplan(task, run, summary, hooks, analysis)
  if (next) return
  await failGoals(run, summary)
  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: summary, time_completed: Date.now() }, summary)
}

async function retryOrReplan(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType) {
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
    const nextRunID = await createReplanRun(task, currentPlan, run, summary, analysis)
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
    return true
  }

  // transient / evaluation / environment / unknown → retry first, then replan
  if (run.retry_count < SAME_PLAN_RETRY_LIMIT) {
    log.info("retrying current plan", { classification, retryCount: run.retry_count, taskID: task.id })
    const nextRunID = createRetryRun(task, run, summary)
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
    return true
  }

  const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!currentPlan) return false
  const replans = findPlans(task.id).length - 1
  if (replans >= limits.maxReplans) return false
  log.info("retries exhausted, replanning", { classification, replans, taskID: task.id })
  const nextRunID = await createReplanRun(task, currentPlan, run, summary, analysis)
  await OrchestratorRuntime.dispatch(nextRunID, hooks)
  return true
}

async function failGoals(run: RunRow, summary: string) {
  const planVersionID = run.plan_version_id
  if (!planVersionID) return
  const goals = listGoalsByPlan(planVersionID)
  if (goals.length === 0) return
  const now = Date.now()
  Database.use((db) =>
    db
      .update(OrchestratorGoalTable)
      .set({
        status: "failed",
        time_updated: now,
      })
      .where(eq(OrchestratorGoalTable.plan_version_id, planVersionID))
      .run(),
  )
  for (const goal of goals) {
    await Bus.publish(Event.GoalFailed, {
      taskID: run.task_id,
      goalID: goal.id,
      summary: `${goal.description}: ${summary}`,
    })
  }
}

function deriveMilestoneStatuses(db: Parameters<Parameters<typeof Database.transaction>[0]>[0], taskID: string, planVersionID: string, now: number) {
  const milestones = listMilestonesByPlan(planVersionID)
  if (milestones.length === 0) return
  const goals = listGoalsByPlan(planVersionID)
  for (const ms of milestones) {
    const msGoals = goals.filter((g) => g.milestone_id === ms.id)
    const next = deriveMilestoneStatus(msGoals)
    if (next === ms.status) continue
    db.update(OrchestratorMilestoneTable)
      .set({ status: next, time_updated: now })
      .where(eq(OrchestratorMilestoneTable.id, ms.id))
      .run()
    if (next === "passed") {
      Database.effect(() => Bus.publish(Event.MilestonePassed, { taskID, milestoneID: ms.id, summary: ms.title }))
    } else if (next === "failed") {
      Database.effect(() => Bus.publish(Event.MilestoneFailed, { taskID, milestoneID: ms.id, summary: ms.title }))
    } else if (next === "active") {
      Database.effect(() => Bus.publish(Event.MilestoneActivated, { taskID, milestoneID: ms.id, summary: ms.title }))
    }
  }
}

function deriveMilestoneStatus(goals: GoalRow[]): OrchestratorMilestoneStatus {
  if (goals.length === 0) return "passed"
  const blocking = goals.filter((g) => g.priority === "blocking")
  if (blocking.some((g) => g.status === "failed")) return "failed"
  if (blocking.every((g) => g.status === "passed")) return "passed"
  if (goals.some((g) => g.status === "passed")) return "active"
  return "pending"
}

function goalMatchesChecks(goal: { description: string; criteria: string; metadata: unknown }, checks: Array<{ name: string }>) {
  const selectors = selectorList(goal.metadata)
  if (selectors.length === 0) return true
  return checks.some((check) => selectors.some((selector) => check.name === selector || check.name.startsWith(`${selector}#`)))
}

function selectorList(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).check_selector
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function createRetryRun(task: TaskRow, run: RunRow, summary: string) {
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
          prompt_override: buildRetryPrompt(summary),
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

async function createReplanRun(task: TaskRow, plan: PlanRow, run: RunRow, summary: string, analysis?: EvaluatorAnalysisType) {
  const nextPlanID = Identifier.ascending("plan")
  const nextRunID = Identifier.ascending("run")
  const now = Date.now()
  const nextVersion = plan.version + 1
  const goals = listGoalsByPlan(plan.id)

  // Build structured ReplanContext from EvaluatorAgent analysis
  const replanContext: ReplanContext | undefined = analysis ? {
    previousSummary: plan.summary,
    failureAnalysis: {
      classification: analysis.classification,
      summary: analysis.summary,
      rootCause: analysis.replan_guidance?.root_cause ?? summary,
      suggestedStrategy: analysis.replan_guidance?.suggested_strategy ?? "",
      avoidApproaches: analysis.replan_guidance?.avoid_approaches ?? [],
    },
    previousGoalStatuses: analysis.goal_statuses.map((gs) => {
      const goal = goals[gs.goal_index]
      return {
        description: goal?.description ?? `Goal ${gs.goal_index}`,
        status: gs.status,
        evidence: gs.evidence,
      }
    }),
  } : undefined

  const nextPlan = await PlannerService.replan({
    title: task.title,
    request: task.request,
    goals: goals.map((goal) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority,
    })),
    previousPrompt: plan.prompt,
    previousPlanID: plan.id,
    failureSummary: summary,
    replanContext,
  })
  Database.transaction((db) => {
    db.update(OrchestratorPlanVersionTable)
      .set({
        status: "superseded",
        time_updated: now,
      })
      .where(eq(OrchestratorPlanVersionTable.id, plan.id))
      .run()
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: nextPlanID,
        task_id: task.id,
        version: nextVersion,
        status: "active",
        summary: nextPlan.summary,
        prompt: nextPlan.prompt,
        metadata: {
          previous_run_id: run.id,
          ...nextPlan.metadata,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    // Create milestones from agent output if available
    const agentMilestones = (nextPlan.metadata as Record<string, unknown>).milestones as
      | Array<{ title: string; description?: string; goal_indices: number[] }>
      | undefined
    const goalToMsID = new Map<number, string>()
    if (agentMilestones && agentMilestones.length > 0) {
      for (const [msIdx, ms] of agentMilestones.entries()) {
        const msID = Identifier.ascending("milestone")
        db.insert(OrchestratorMilestoneTable)
          .values({
            id: msID,
            task_id: task.id,
            plan_version_id: nextPlanID,
            title: ms.title,
            description: ms.description ?? "",
            status: "pending",
            order_index: msIdx,
            time_created: now,
            time_updated: now,
          })
          .run()
        for (const goalIdx of ms.goal_indices) {
          goalToMsID.set(goalIdx, msID)
        }
      }
    }
    for (const [index, goal] of nextPlan.goals.entries()) {
      db.insert(OrchestratorGoalTable)
        .values({
          id: Identifier.ascending("goal"),
          task_id: task.id,
          plan_version_id: nextPlanID,
          milestone_id: goalToMsID.get(index) ?? null,
          description: goal.description,
          criteria: goal.criteria,
          metadata: (goal as { metadata?: OrchestratorMetadata }).metadata ?? null,
          priority: goal.priority ?? "blocking",
          status: "pending",
          order_index: index,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    db.insert(OrchestratorRunTable)
      .values({
        id: nextRunID,
        task_id: task.id,
        plan_version_id: nextPlanID,
        session_id: run.session_id,
        executor: run.executor,
        status: "queued",
        phase: "replan",
        retry_count: 0,
        metadata: {
          previous_run_id: run.id,
          strategy: "replan",
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_plan_version_id: nextPlanID,
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
        summary: "Replanning after evaluation failure",
        payload: {
          previousPlanID: plan.id,
          nextPlanID,
          previousRunID: run.id,
          nextRunID,
          reason: summary,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.PlanCreated, {
        taskID: task.id,
        planID: nextPlanID,
        summary: nextPlan.summary,
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.PlanActivated, {
        taskID: task.id,
        planID: nextPlanID,
        summary: "Replanned version activated",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: task.id,
        runID: nextRunID,
        status: "queued",
        summary: "Run queued after replan",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: "running",
        summary: "Replanning after evaluation failure",
      }),
    )
  })
  return nextRunID
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
