import { Bus } from "@/bus"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { installRuntimeShims } from "@/runtime/shims"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import { DeliveryService } from "./delivery"
import {
  applyGoalDelivery,
  buildGoalPrompt,
  cleanupGoalWorkspace,
  cleanupStaleGoalWorkspaces,
  createGoalSession,
  createGoalWorkspace,
  currentGoal,
  deliveryFromSnapshot,
  evaluateGoal,
  evaluateTask,
  goalEvaluationOutcome,
} from "./goal-runner"
import { nextGoalNode, pendingBlockingGoals } from "./goal-scheduler"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import { autoRejectInteraction } from "./interaction-actions"
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
  createGoalRun,
  createReplanRun,
  createRetryRun,
  ensureExecutorSession,
  failGoals,
  finalizeDeliveryResult,
  markDeliveryPublishing,
  persistDelivery,
  persistEvaluation,
  persistFailedRunEvaluation,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
  updateExecutorSessionStatus,
} from "./transition"
import { buildRetryContext, decideRetryOrReplan } from "./strategy"
import {
  activeGoalRunByCoordinator,
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findEvaluationByGoalRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findRun,
  findTask,
  goalRunQueueTaskID,
  latestGoalRunByCoordinator,
  listGoalsBySpec,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type DeliveryRow,
  type GoalRunRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator-runtime" })

function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}
const EVALUATION_HARD_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes total for entire evaluation phase
const DELIVERY_SERVICE_TIMEOUT_MS = 60_000 // 60 seconds for DeliveryService.deliver()
const evaluatingRuns = new Map<string, number>() // runID → start timestamp, guards against concurrent re-evaluation
const finalizingRuns = new Set<string>() // guards against concurrent finalizeCoordinatorRun for the same run
const completingRuns = new Set<string>() // guards against concurrent completeRun for the same run
const finalizingGoalRuns = new Set<string>() // guards against concurrent finalizeGoalRun for the same goal run
const executorEventBridges = new Map<string, AbortController>()
const EVALUATING_STALE_MS = EVALUATION_HARD_TIMEOUT_MS + 60_000 // consider stale after hard timeout + 1 min buffer

// Unattended-mode safeguards
const INTERACTION_STALE_MS = safeParseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS, 30_000) // auto-reject stale interactions (30s default)
const RUN_MAX_EXECUTION_MS = safeParseInt(process.env.OPENCORVUS_RUN_TIMEOUT_MS, 2 * 60 * 60 * 1000) // max run execution time (2h default)
// Set OPENCORVUS_REQUIRE_REPLAN_CONFIRM=1 to require user approval before spec rewrite.
// Default is off so automated pipelines continue without interruption.
const REQUIRE_REPLAN_CONFIRM = process.env.OPENCORVUS_REQUIRE_REPLAN_CONFIRM === "1"

function goalsForRun(run: RunRow) {
  const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  return plan ? listGoalsBySpec(plan.spec_snapshot_id) : []
}

function planForRun(run: RunRow) {
  return run.plan_version_id ? findPlan(run.plan_version_id) : undefined
}

function taskBaselineRef(task: TaskRow) {
  const git = task.metadata?.git
  if (!git || typeof git !== "object" || Array.isArray(git)) return
  const baseline = (git as Record<string, unknown>).baseline
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return
  const snapshot = (baseline as Record<string, unknown>).snapshot
  return typeof snapshot === "string" && snapshot ? snapshot : undefined
}

function activeGoalRun(run: RunRow) {
  return activeGoalRunByCoordinator(run.id)
}

function latestGoalRun(run: RunRow) {
  return activeGoalRun(run) ?? latestGoalRunByCoordinator(run.id)
}

function runExecutionTarget(run: RunRow, goalRun = activeGoalRun(run)) {
  return {
    goalRun,
    sessionID: goalRun?.session_id ?? run.session_id ?? undefined,
    queueTaskID: goalRunQueueTaskID(goalRun) ?? run.executor_ref?.queue_task_id,
  }
}

async function provideWorkspace<R>(directory: string | undefined, fn: () => Promise<R>) {
  if (!directory || directory === Instance.directory) return fn()
  return Instance.provide({ directory, fn })
}

async function taskDirectory(task: TaskRow) {
  if (!task.session_id) return Instance.directory
  const session = await Session.get(task.session_id).catch((err) => {
    log.warn("failed to get session for task directory", { taskID: task.id, sessionID: task.session_id, error: String(err) })
    return undefined
  })
  return session?.directory ?? Instance.directory
}

function storedDiffs(delivery: DeliveryRow) {
  const result = delivery.result
  const diffs = result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>).diffs
    : undefined
  if (!Array.isArray(diffs)) return []
  return diffs.flatMap((item) => {
    const parsed = Snapshot.FileDiff.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function planPrompt(plan: PlanRow, run: RunRow) {
  const override = typeof run.metadata?.prompt_override === "string" ? run.metadata.prompt_override.trim() : ""
  if (!override) return plan.prompt
  return [plan.prompt, "## Run Context", override].join("\n\n")
}

async function queueNextGoalRun(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
  const goals = listGoalsBySpec(plan.spec_snapshot_id)
  const next = nextGoalNode(listPlanNodesByPlan(plan.id), goals)
  if (!next) return false
  const brief = WorkbenchService.compileBrief({
    taskID: task.id,
    runID: run.id,
    planVersionID: plan.id,
    sessionID: task.session_id ?? undefined,
  })
  const startRef = taskBaselineRef(task)
  const baseRef = await Snapshot.track()
  const workspaceDir = await createGoalWorkspace({
    task,
    goal: next.goal,
    snapshot: baseRef,
  })
  const session = await createGoalSession(task, next.goal, workspaceDir)
  const goalRun = createGoalRun({
    taskID: task.id,
    goalID: next.goal.id,
    planNodeID: next.node.id,
    coordinatorRunID: run.id,
    sessionID: session.id,
    executor: run.executor,
    workspaceDir,
    baseRef,
    metadata: {
      title: next.goal.description,
      selectors: next.goal.metadata?.check_selector,
    },
  })
  const prompt = buildGoalPrompt({
    brief: brief.content,
    plan: {
      ...plan,
      prompt: planPrompt(plan, run),
    },
    goal: next.goal,
  })
  const source: "planner" | "scheduler" | "system" = run.metadata?.strategy === "operator_note" ? "system" : "scheduler"
  const executor = ExecutorRegistry.require(run.executor)
  const submission = await provideWorkspace(workspaceDir, () =>
    executor.submit({
      sessionID: session.id,
      prompt,
      priority: task.priority,
      source,
    })
  )
  const now = Date.now()
  updateGoalRun(goalRun.id, {
    session_id: submission.sessionID,
    status: "accepted",
    time_started: now,
    metadata: {
      ...(goalRun.metadata ?? {}),
      queue_task_id: submission.queueTaskID,
      provider_session_id: submission.sessionID,
      task_base_ref: startRef,
    },
  })
  await hooks.updateRun(
    run,
    {
      status: "accepted",
      phase: run.phase === "replan" ? "replan" : "dispatch",
      time_started: run.time_started ?? now,
    },
    `Goal queued: ${next.goal.description}`,
  )
  await hooks.updateTask(
    task,
    {
      status: "running",
      time_started: task.time_started ?? now,
    },
    `Running goal: ${next.goal.description}`,
  )
  const executorSession = ensureExecutorSession({
    taskID: task.id,
    runID: run.id,
    goalRunID: goalRun.id,
    provider: run.executor,
    refs: {
      provider_session_id: submission.sessionID,
      queue_task_id: submission.queueTaskID,
    },
    settings: {
      cwd: workspaceDir,
    },
    started: now,
  })
  appendExecutorEvent(executorSession.id, task.id, run.id, run.executor, goalRun.id, {
    provider: run.executor,
    kind: "lifecycle",
    summary: "Goal accepted by executor",
    refs: executorSession.refs ?? undefined,
    payload: {
      goal_id: next.goal.id,
      goal_run_id: goalRun.id,
      queue_task_id: submission.queueTaskID,
      provider_session_id: submission.sessionID,
    },
  })
  consumeExecutorEvents(task.id, run.id, goalRun.id, run.executor, submission.sessionID, executorSession.id)
  return true
}

async function continueGoalPipeline(task: TaskRow, run: RunRow, hooks: RuntimeHooks) {
  const plan = planForRun(run)
  if (!plan) throw new Error(`Task ${task.id} has no plan`)
  const refreshedTask = requireTask(task.id)
  const refreshedRun = requireRun(run.id)
  if (await queueNextGoalRun(refreshedTask, refreshedRun, plan, hooks)) return
  const pending = pendingBlockingGoals(goalsForRun(refreshedRun))
  if (pending.length > 0) {
    await handleEvaluationFailure(
      refreshedTask,
      refreshedRun,
      `No ready blocking goals remain for dispatch: ${pending.map((goal) => goal.description).join(", ")}`,
      hooks,
    )
    return
  }
  await finalizeCoordinatorRun(requireTask(task.id), requireRun(run.id), hooks)
}

async function finalizeCoordinatorRun(task: TaskRow, run: RunRow, hooks: RuntimeHooks) {
  if (finalizingRuns.has(run.id)) {
    log.info("already finalizing run, skipping concurrent call", { runID: run.id })
    return
  }
  finalizingRuns.add(run.id)
  evaluatingRuns.set(run.id, Date.now())
  try {
    await _finalizeCoordinatorRun(task, run, hooks)
  } finally {
    finalizingRuns.delete(run.id)
    evaluatingRuns.delete(run.id)
  }
}

async function _finalizeCoordinatorRun(task: TaskRow, run: RunRow, hooks: RuntimeHooks) {
  const existingDelivery = findDeliveryByRun(run.id)
  if (existingDelivery) {
    const evaluation = findEvaluationByRun(run.id)
    if (!evaluation) {
      await runEvaluation(task, run, existingDelivery, hooks)
      return
    }
    if (evaluation.status === "passed") {
      await publishAcceptedDelivery(task, run, existingDelivery, hooks)
      return
    }
    await handleEvaluationFailure(task, run, evaluation.summary, hooks)
    return
  }
  const baseRef = taskBaselineRef(task)
  if (!baseRef) throw new Error(`Task ${task.id} has no baseline snapshot`)
  const completedAt = Date.now()
  await hooks.updateRun(run, { status: "completed", phase: "evaluate", blocking_reason: null, error: null, time_completed: completedAt }, "All goals executed")
  await hooks.updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Evaluating final delivery")
  const { delivery } = await deliveryFromSnapshot(baseRef, "Task delivery")
  const deliveryID = Identifier.ascending("delivery")
  const evaluationID = Identifier.ascending("evaluation")
  persistDelivery({ task, run, deliveryID, delivery, now: Date.now() })
  await Plugin.trigger("delivery.ready", {
    taskID: task.id,
    runID: run.id,
    deliveryID,
    delivery: {
      summary: delivery.summary,
      changedFiles: delivery.diffs.map((item) => item.file),
      diffs: delivery.diffs,
    },
  }, { actions: [] }).catch((err) => {
    log.warn("delivery.ready plugin trigger failed", { taskID: task.id, runID: run.id, deliveryID, error: String(err) })
  })
  const goals = goalsForRun(run)
  const { result, analysis, analysisError } = await evaluateTask({ task, goals, delivery })
  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus = (finalVerdict === "accepted" ? "passed" : "failed") as typeof result.status
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
    finalVerdict,
    finalStatus,
    finalSummary,
    goals,
    analysisError,
  })
  if (finalStatus === "passed") {
    if (pendingBlockingGoals(goalsForRun(run)).length === 0) {
      const accepted = findDeliveryByRun(run.id)
      if (!accepted) {
        await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
        return
      }
      await publishAcceptedDelivery(task, run, accepted, hooks)
      return
    }
  }
  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

async function finalizeGoalRun(task: TaskRow, run: RunRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
  if (finalizingGoalRuns.has(goalRun.id)) {
    log.info("already finalizing goal run, skipping concurrent call", { goalRunID: goalRun.id })
    return
  }
  finalizingGoalRuns.add(goalRun.id)
  try {
    await _finalizeGoalRun(task, run, goalRun, hooks)
  } finally {
    finalizingGoalRuns.delete(goalRun.id)
  }
}

async function _finalizeGoalRun(task: TaskRow, run: RunRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
  OrchestratorRuntime.stopExecutorEventBridge(goalRun.session_id ?? undefined)
  const goals = goalsForRun(run)
  const goal = currentGoal(goalRun, goals)
  if (!goal) throw new Error(`Goal ${goalRun.goal_id} not found for run ${run.id}`)
  const workspaceDir = goalRun.workspace_dir ?? undefined
  const existingDelivery = findDeliveryByGoalRun(goalRun.id)
  const existingEvaluation = findEvaluationByGoalRun(goalRun.id)
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await cleanupGoalWorkspace(workspaceDir)
    await removeGoalRunSession(goalRun)
  }
  if (existingEvaluation) {
    if (existingEvaluation.status === "passed" || goal.priority === "advisory") {
      await dispose()
      await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
      return
    }
    await dispose()
    await handleEvaluationFailure(requireTask(task.id), run, existingEvaluation.summary, hooks)
    return
  }
  try {
    const deliveryID = existingDelivery?.id ?? Identifier.ascending("delivery")
    const evaluationID = Identifier.ascending("evaluation")
    const goalDir = workspaceDir ?? Instance.directory
    const deliveredInfo = existingDelivery
      ? {
          mergeRef: goalRun.merge_ref,
          delivery: {
            summary: existingDelivery.summary,
            diffs: storedDiffs(existingDelivery),
          },
        }
      : await provideWorkspace(goalDir, () =>
          deliveryFromSnapshot(goalRun.base_ref ?? undefined, `Goal delivery: ${goal.description}`)
        )
    const delivered = deliveredInfo.delivery
    if (!existingDelivery) {
      persistDelivery({ task, run, goalRunID: goalRun.id, deliveryID, delivery: delivered, now: Date.now() })
    }
    const { result, analysis, analysisError } = await provideWorkspace(goalDir, () =>
      evaluateGoal({ task, goal, delivery: delivered })
    )
    const outcome = goalEvaluationOutcome(result, analysis)
    persistEvaluation({
      task,
      run,
      goalRunID: goalRun.id,
      deliveryID,
      evaluationID,
      delivery: delivered,
      result,
      analysis,
      finalVerdict: outcome.verdict,
      finalStatus: outcome.status,
      finalSummary: outcome.summary,
      goals: [goal],
      finalizeSpec: false,
      analysisError,
    })
    updateGoalRun(goalRun.id, {
      status: outcome.status === "passed" ? "completed" : "failed",
      error: outcome.status === "passed" ? null : outcome.summary,
      blocking_reason: null,
      merge_ref: deliveredInfo.mergeRef ?? goalRun.merge_ref,
      time_completed: Date.now(),
    })
    if (outcome.status === "passed" || (goal.priority === "advisory" && delivered.diffs.length > 0)) {
      await provideWorkspace(await taskDirectory(task), () =>
        applyGoalDelivery({
          directory: Instance.directory,
          delivery: delivered,
        })
      )
    }
    if (outcome.status === "passed" || goal.priority === "advisory") {
      await hooks.updateRun(run, { status: "queued", executor_ref: null, session_id: null, blocking_reason: null }, `Goal finished: ${goal.description}`)
      await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
      return
    }
    await handleEvaluationFailure(requireTask(task.id), run, outcome.summary, hooks, analysis)
  } finally {
    await dispose()
  }
}

async function removeGoalRunSession(goalRun: GoalRunRow) {
  if (!goalRun.session_id) return
  await Session.remove(goalRun.session_id).catch((err) => {
    log.warn("failed to remove goal run session", { sessionID: goalRun.session_id, error: String(err) })
  })
}

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
  export function stopExecutorEventBridge(sessionID?: string) {
    if (!sessionID) return
    const controller = executorEventBridges.get(sessionID)
    if (!controller) return
    executorEventBridges.delete(sessionID)
    controller.abort()
  }

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
      // Startup recovery: recover tasks stuck in transient states from a previous server instance
      // Tasks in "evaluating" or "delivering" with no active in-memory evaluation are stranded
      recoverStrandedTasks(hooks)
    } finally {
      current.syncing = false
    }
  }

  export async function dispatch(runID: string, hooks: RuntimeHooks) {
    installRuntimeShims()
    const run = requireRun(runID)
    if (run.status !== "queued") return
    let task = requireTask(run.task_id)
    const plan = planForRun(run)
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)
    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared
    if (await queueNextGoalRun(task, run, plan, hooks)) return
    await finalizeCoordinatorRun(task, run, hooks)
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    if (!task.active_run_id) return
    await syncRun(task.active_run_id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    let run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    let task = requireTask(run.task_id)
    const delivery = findDeliveryByRun(run.id)
    const goalRun = activeGoalRun(run)
    const latest = goalRun ?? latestGoalRun(run)
    const goalDelivery = latest ? findDeliveryByGoalRun(latest.id) : undefined
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      // Auto-reject stale interactions for unattended operation
      const now = Date.now()
      const stale = pending.filter((p) => (now - (p.time_created ?? 0)) > INTERACTION_STALE_MS)
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", { id: interaction.id, type: interaction.request_type, ageMs: now - (interaction.time_created ?? 0) })
          await autoRejectInteraction(interaction, "Timed out waiting for operator response")
        }
        run = requireRun(runID)
        task = requireTask(run.task_id)
        // Re-check after auto-rejection
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          // Fall through to continue sync
        } else {
          if (run.status !== "blocked") {
            await hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked")
          }
          if (task.status !== "blocked") {
            await hooks.updateTask(task, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Awaiting user input")
          }
          return
        }
      } else {
        if (run.status !== "blocked") {
          await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
        }
        if (task.status !== "blocked") {
          await hooks.updateTask(task, { status: "blocked", blocking_reason: pending[0].request_type }, "Awaiting user input")
        }
        return
      }
    }

    if (!delivery && latest?.status === "completed" && goalDelivery) {
      await finalizeGoalRun(task, run, latest, hooks)
      return
    }

    if (run.status === "completed" && delivery) {
      await completeRun(run, hooks)
      return
    }

    if (run.status === "failed" || run.status === "aborted") {
      return
    }

    const target = runExecutionTarget(run, goalRun)
    const queueTaskID = target.queueTaskID
    if (!queueTaskID) return
    const executor = ExecutorRegistry.require(run.executor)
    const queue = await executor.status(queueTaskID)

    if (queue.status === "blocked") {
      if (run.status !== "blocked") {
        await hooks.updateRun(run, { status: "blocked", blocking_reason: "executor" }, "Executor is awaiting input")
      }
      if (task.status !== "blocked") {
        await hooks.updateTask(task, { status: "blocked", blocking_reason: "executor" }, "Executor is awaiting input")
      }
      return
    }

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
      // Run execution timeout — fail runs that have been running too long
      const started = run.time_started ?? run.time_created
      if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
        log.warn("run exceeded max execution time", { runID: run.id, maxMs: RUN_MAX_EXECUTION_MS, elapsedMs: Date.now() - started })
        try { await executor.abort({ sessionID: target.sessionID, queueTaskID }) } catch (abortErr) {
          log.warn("failed to abort timed-out executor", { runID: run.id, error: String(abortErr) })
        }
        await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (goalRun && goalRun.status !== "running") {
        updateGoalRun(goalRun.id, { status: "running", blocking_reason: null })
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
      if (goalRun) {
        await finalizeGoalRun(task, run, goalRun, hooks)
        return
      }
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
          session_id: task.session_id,
          executor: run.executor,
          status: "queued",
          phase: "dispatch",
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
  if (completingRuns.has(run.id)) {
    log.info("already completing run, skipping concurrent call", { runID: run.id })
    return
  }
  completingRuns.add(run.id)
  try {
    await _completeRun(run, hooks)
  } finally {
    completingRuns.delete(run.id)
  }
}

async function _completeRun(run: RunRow, hooks: RuntimeHooks) {
  installRuntimeShims()
  const task = requireTask(run.task_id)
  const goalRun = latestGoalRun(run)
  OrchestratorRuntime.stopExecutorEventBridge(goalRun?.session_id ?? run.session_id ?? undefined)
  if (goalRun?.status === "completed" && !findDeliveryByRun(run.id)) {
    updateGoalRunExecutorSessionStatus(goalRun.id, "completed")
    await finalizeGoalRun(task, run, goalRun, hooks)
    return
  }
  updateExecutorSessionStatus(run.id, "completed")
  await finalizeCoordinatorRun(task, run, hooks)
}

async function runEvaluation(task: TaskRow, run: RunRow, existingDelivery: DeliveryRow, hooks: RuntimeHooks) {
  const delivery = {
    summary: existingDelivery.summary,
    diffs: storedDiffs(existingDelivery),
  }
  const deliveryID = existingDelivery.id
  const evaluationID = Identifier.ascending("evaluation")
  const goals = goalsForRun(run)
  const { result, analysis, analysisError } = await evaluateTask({ task, goals, delivery })
  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus = (finalVerdict === "accepted" ? "passed" : "failed") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary

  persistEvaluation({
    task, run, deliveryID, evaluationID, delivery, result,
    analysis, finalVerdict, finalStatus, finalSummary, goals, analysisError,
  })

  if (finalStatus === "passed") {
    const allGoals = goalsForRun(run)
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

function recoverStrandedTasks(hooks: RuntimeHooks) {
  // Find tasks stuck in transient states (evaluating/delivering) with no active in-memory evaluation
  const strandedTasks = Database.use((db) =>
    db
      .select()
      .from(OrchestratorTaskTable)
      .where(
        and(
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorTaskTable.status, ["evaluating", "delivering"]),
        ),
      )
      .all(),
  )
  const now = Date.now()
  for (const task of strandedTasks) {
    // Only recover if task has been in this state longer than the evaluation hard timeout
    const updated = task.time_updated ?? task.time_created ?? 0
    const age = now - updated
    if (age < EVALUATING_STALE_MS) continue
    // Check if this task has an active in-memory evaluation
    if (task.active_run_id && (evaluatingRuns.has(task.active_run_id) || completingRuns.has(task.active_run_id))) continue
    log.warn("recovering stranded task", { taskID: task.id, status: task.status, ageMs: age })
    const error = `Task was stranded in '${task.status}' state for ${Math.round(age / 60000)}min (server restart recovery)`
    hooks.updateTask(task, {
      status: "failed",
      error,
      blocking_reason: null,
      time_completed: now,
    }, error).catch((err) => log.error("failed to recover stranded task", { taskID: task.id, error: String(err) }))
    cleanupStaleGoalWorkspaces(task.id).catch((err) =>
      log.warn("failed to clean up stale goal workspaces", { taskID: task.id, error: String(err) }),
    )
  }
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  const task = requireTask(run.task_id)
  const goalRun = activeGoalRun(run)
  OrchestratorRuntime.stopExecutorEventBridge(goalRun?.session_id ?? run.session_id ?? undefined)
  const now = Date.now()
  if (goalRun) {
    updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
    if (!findEvaluationByGoalRun(goalRun.id)) {
      persistFailedRunEvaluation({ task, run, goalRunID: goalRun.id, error, now })
    }
    updateGoalRun(goalRun.id, { status: "failed", error, blocking_reason: null, time_completed: now })
    await cleanupGoalWorkspace(goalRun.workspace_dir ?? undefined)
    await removeGoalRunSession(goalRun)
    const goal = currentGoal(goalRun, goalsForRun(run))
    if (goal?.priority === "advisory") {
      await hooks.updateRun(run, { status: "queued", executor_ref: null, session_id: null, blocking_reason: null }, error)
      await continueGoalPipeline(task, requireRun(run.id), hooks)
      return
    }
  } else {
    updateExecutorSessionStatus(run.id, "failed")
    if (!findEvaluationByRun(run.id)) {
      persistFailedRunEvaluation({ task, run, error, now })
    }
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

  let deliveryTimer: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    DeliveryService.deliver({ task, run, delivery }).finally(() => clearTimeout(deliveryTimer)),
    new Promise<never>((_, reject) => {
      deliveryTimer = setTimeout(() => reject(new Error("DeliveryService.deliver() timeout")), DELIVERY_SERVICE_TIMEOUT_MS)
    }),
  ]).catch((error) => ({
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
  await hooks.updateRun(
    run,
    {
      status: run.status === "completed" ? "completed" : "failed",
      error: summary,
      blocking_reason: null,
      time_completed: Date.now(),
    },
    summary,
  )
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
    await hooks.updateRun(
      run,
      {
        status: "failed",
        error: decision.summary,
        blocking_reason: null,
        time_completed: Date.now(),
      },
      decision.summary,
    )
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
    return true
  }

  const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!currentPlan) return false

  // Before rewriting the spec, ask user to confirm (only when OPENCORVUS_REQUIRE_REPLAN_CONFIRM=1).
  // Spec rewrite silently overwrites the original requirements, so confirmation protects user intent.
  if (!REQUIRE_REPLAN_CONFIRM) {
    const next = await createReplanRun(task, currentPlan, run, decision.summary, decision.analysis)
    if (!next.queued) return false
    if (!next.runID) return false
    await hooks.updateRun(
      run,
      {
        status: "failed",
        error: decision.summary,
        blocking_reason: null,
        time_completed: Date.now(),
      },
      decision.summary,
    )
    await OrchestratorRuntime.dispatch(next.runID, hooks)
    return true
  }
  const interactionID = Identifier.ascending("interaction")
  const guidance = decision.analysis?.replan_guidance
  const rootCause = guidance?.root_cause ?? decision.summary
  const strategy = guidance?.suggested_strategy ?? "Rewrite the spec and retry with an updated plan."
  const body = [
    `**Evaluation failed** — the plan requires a rewrite before retrying.`,
    ``,
    `**Root cause:** ${rootCause}`,
    `**Suggested strategy:** ${strategy}`,
    ``,
    `Approve to proceed with spec rewrite, or reject to fail the task.`,
  ].join("\n")
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: task.id,
        run_id: run.id,
        external_id: interactionID,
        request_type: "question",
        status: "pending",
        title: "Confirm replan",
        body,
        payload: {
          replan_confirm: true,
          failure_summary: decision.summary,
          plan_id: currentPlan.id,
          analysis: decision.analysis ?? null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  await hooks.updateRun(run, { status: "blocked", blocking_reason: "pending_replan" }, "Waiting for replan confirmation")
  await hooks.updateTask(task, { status: "blocked", blocking_reason: "pending_replan" }, "Waiting for replan confirmation")
  Database.effect(() =>
    Bus.publish(Event.InteractionRequested, {
      taskID: task.id,
      runID: run.id,
      interactionID,
      requestType: "question",
      summary: "Confirm replan",
    }),
  )
  return true
}



/** 将 executor 的实时事件桥接到 Bus，供 SSE 转发给前端 */
function consumeExecutorEvents(
  taskID: string,
  runID: string,
  goalRunID: string | undefined,
  executorName: Parameters<typeof ExecutorRegistry.require>[0],
  sessionID: string,
  executorSessionID: string,
) {
  const executor = ExecutorRegistry.require(executorName)
  if (!executor.capabilities().events) return
  OrchestratorRuntime.stopExecutorEventBridge(sessionID)
  const controller = new AbortController()
  executorEventBridges.set(sessionID, controller)
  // 异步消费 — 不阻塞 dispatch 返回
  ;(async () => {
    try {
      for await (const event of executor.events({ sessionID, signal: controller.signal })) {
        try {
          upsertExecutorInteraction(taskID, runID, sessionID, executorSessionID, executorName, event)
          appendExecutorEvent(executorSessionID, taskID, runID, executorName, goalRunID, {
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
        } catch (eventErr) {
          log.warn("executor event handler failed, continuing", { taskID, runID, error: String(eventErr) })
        }
      }
    } catch (err) {
      log.warn("executor event bridge ended", { taskID, runID, error: String(err) })
    } finally {
      if (executorEventBridges.get(sessionID) === controller) {
        executorEventBridges.delete(sessionID)
      }
    }
  })().catch((err) => log.error("executor event bridge crashed", { taskID, runID, error: String(err) }))
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
