import { Bus } from "@/bus"
import { EvaluatorService } from "@/evaluator/service"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { protocolInfo, type ProtocolCapabilitiesInfo, type ProtocolRefsInfo, type ProtocolSettingsInfo, ProtocolTransport } from "@/executor/protocol"
import { installRuntimeShims } from "@/runtime/shims"
import { Database, and, desc, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import { DeliveryService } from "./delivery"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import {
  OrchestratorArtifactTable,
  OrchestratorExecutorEventTable,
  OrchestratorExecutorSessionTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorMilestoneTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
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
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findPlans,
  findRun,
  findRuns,
  findSpecItems,
  findTask,
  listGoalsByPlan,
  listMilestonesByPlan,
  requireRun,
  requireTask,
  type GoalRow,
  type DeliveryRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator-runtime" })

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
    analysis = fallbackAnalysis(result, goals.length, analysisError)
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

async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType) {
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

  const next = await retryOrReplan(task, run, summary, hooks, analysis, retryContext).catch(async (error) => {
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

async function retryOrReplan(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType, retryContext?: RetryContext) {
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
    await OrchestratorRuntime.dispatch(next.runID, hooks)
    return true
  }

  // transient / evaluation / environment / unknown → retry first, then replan
  if (run.retry_count < SAME_PLAN_RETRY_LIMIT) {
    log.info("retrying current plan", { classification, retryCount: run.retry_count, taskID: task.id })
    const nextRunID = createRetryRun(task, run, summary, retryContext)
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
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
  await OrchestratorRuntime.dispatch(next.runID, hooks)
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

function selectorList(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).check_selector
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function selectorsSatisfied(selectors: string[], checks: Array<{ name: string; status: string }>) {
  const relevant = selectors.filter((selector) =>
    checks.some((check) => check.name === selector || check.name.startsWith(`${selector}#`)),
  )
  if (relevant.length === 0) return true
  return relevant.every((selector) =>
    checks.some(
      (check) =>
        (check.name === selector || check.name.startsWith(`${selector}#`)) && check.status === "passed",
    ),
  )
}

function createRetryRun(task: TaskRow, run: RunRow, summary: string, retryContext?: RetryContext) {
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

async function createReplanRun(task: TaskRow, plan: PlanRow, run: RunRow, summary: string, analysis?: EvaluatorAnalysisType) {
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

function ensureExecutorSession(input: {
  taskID: string
  runID: string
  provider: RunRow["executor"]
  refs?: ProtocolRefsInfo
  capabilities?: ProtocolCapabilitiesInfo
  settings?: ProtocolSettingsInfo
  started?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.run_id, input.runID))
      .get(),
  )
  const info = protocolInfo(input.provider)
  const now = Date.now()
  const refs = mergeRefs(existing?.refs ?? undefined, input.refs)
  const capabilities = input.capabilities ?? info.capabilities
  const settings = {
    ...(existing?.settings ?? {}),
    ...(input.settings ?? {}),
  }
  if (existing) {
    Database.use((db) =>
      db
        .update(OrchestratorExecutorSessionTable)
        .set({
          provider: input.provider,
          protocol: info.protocol,
          protocol_version: info.version,
          transport: ProtocolTransport.parse(info.transport).kind,
          status: "active",
          refs,
          capabilities,
          settings,
          time_started: existing.time_started ?? input.started ?? now,
          time_updated: now,
        })
        .where(eq(OrchestratorExecutorSessionTable.id, existing.id))
        .run(),
    )
    return Database.use((db) =>
      db
        .select()
        .from(OrchestratorExecutorSessionTable)
        .where(eq(OrchestratorExecutorSessionTable.id, existing.id))
        .get()!,
    )
  }
  const id = Identifier.ascending("executor_session")
  Database.use((db) =>
    db
      .insert(OrchestratorExecutorSessionTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        provider: input.provider,
        protocol: info.protocol,
        protocol_version: info.version,
        transport: ProtocolTransport.parse(info.transport).kind,
        status: "active",
        refs,
        capabilities,
        settings,
        time_started: input.started ?? now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.id, id))
      .get()!,
  )
}

function updateExecutorSessionStatus(runID: string, status: typeof OrchestratorExecutorSessionTable.$inferInsert.status) {
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
      .get(),
  )
  if (!row) return
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.id, row.id))
      .run(),
  )
}

function appendExecutorEvent(
  executorSessionID: string,
  taskID: string,
  runID: string,
  provider: RunRow["executor"],
  event: {
    provider: RunRow["executor"]
    kind: string
    summary?: string
    refs?: ProtocolRefsInfo
    payload?: Record<string, unknown>
    raw?: Record<string, unknown>
  },
) {
  const last = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorEventTable)
      .where(eq(OrchestratorExecutorEventTable.executor_session_id, executorSessionID))
      .orderBy(desc(OrchestratorExecutorEventTable.sequence))
      .get(),
  )
  const now = Date.now()
  const sequence = (last?.sequence ?? 0) + 1
  Database.use((db) =>
    db
      .insert(OrchestratorExecutorEventTable)
      .values({
        id: Identifier.ascending("executor_event"),
        executor_session_id: executorSessionID,
        task_id: taskID,
        run_id: runID,
        sequence,
        kind: event.kind,
        summary: event.summary ?? null,
        refs: event.refs,
        payload: {
          provider,
          ...(event.payload ?? {}),
        },
        raw: event.raw,
        time_observed: now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function mergeRefs(current?: ProtocolRefsInfo, next?: ProtocolRefsInfo) {
  if (!current && !next) return undefined
  const result = {
    ...(current ?? {}),
    ...(next ?? {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
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
