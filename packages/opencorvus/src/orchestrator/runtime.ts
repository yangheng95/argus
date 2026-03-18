import { Bus } from "@/bus"
import { type GoalJudgmentType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { withKeyedLock } from "@/util/lock"
import { inactivityAgeMs } from "@/util/activity-timeout"
import { withTimeout } from "@/util/timeout"
import { OrchestratorRunActor } from "./run-actor"
import { DeliveryService } from "./delivery"
import {
  applyGoalDelivery,
  buildGoalPrompt,
  cleanupGoalWorkspace,
  cleanupStaleGoalWorkspaces,
  createGoalSession,
  currentGoal,
  deliveryFromSnapshot,
  evaluateGoal,
  evaluateTask,
  GOAL_RUN_RETENTION_MS,
  goalEvaluationOutcome,
  goalRunExpired,
  goalRunLocalSessionID,
  removeGoalRunSession,
} from "@/goal/runner"
import { pendingBlockingGoals, readyGoalNodes } from "@/goal/scheduler"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import { autoRejectInteraction } from "./interaction-actions"
import { UNATTENDED_AUTO_REPLY, unattendedProject } from "./unattended"
import {
  OrchestratorGoalRunTable,
  OrchestratorEvaluationTable,
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
  beginEvaluation,
  claimExecutorSessionLease,
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
  renewExecutorSessionLease,
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
  findExecutorSessionByGoalRun,
  findExecutorSessionByRun,
  findGoalRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findRun,
  findTask,
  goalRunQueueTaskID,
  latestExecutorEvent,
  latestGoalRunByCoordinator,
  listActiveGoalRunsByCoordinator,
  listGoalsForPlan,
  listGoalRunsByCoordinator,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type DeliveryRow,
  type GoalRow,
  type GoalRunRow,
  type InteractionRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"
import { StreamHub } from "@/protocol/stream-hub"
import { EXECUTOR_LEASE_MS, executorLeaseHeldByOther, executorLeaseOwner } from "./lease"
import { OrchestratorProtocol } from "./protocol"
import { registerGoalRunSession, unregisterGoalRunSession } from "@/server/routes/task-event"

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
const runAppliedFiles = new Map<string, Set<string>>() // runID → files applied by goal deliveries, for conflict detection
const goalRunFinalizeLocks = new Map<string, Promise<void>>()
const executorEventBridges = new Map<string, AbortController>()
const EVALUATING_STALE_MS = EVALUATION_HARD_TIMEOUT_MS + 60_000 // consider stale after hard timeout + 1 min buffer
const FOLLOWUP_RUN_SYNC_GRACE_MS = 250
const EXECUTOR_OUTPUT_FLUSH_MS = 100
const EXECUTOR_OUTPUT_FLUSH_CHARS = 1024

// Unattended-mode safeguards
const RUN_MAX_EXECUTION_MS = safeParseInt(process.env.OPENCORVUS_RUN_TIMEOUT_MS, 2 * 60 * 60 * 1000) // max run execution time (2h default)
function goalRunTimeoutMs() {
  return safeParseInt(process.env.OPENCORVUS_GOAL_RUN_TIMEOUT_MS, 60_000)
}
const EXECUTOR_STATUS_TIMEOUT_MS = safeParseInt(process.env.OPENCORVUS_EXECUTOR_STATUS_TIMEOUT_MS, 15_000)
// Set OPENCORVUS_REQUIRE_REPLAN_CONFIRM=1 to require user approval before spec rewrite.
// Default is off so automated pipelines continue without interruption.
const REQUIRE_REPLAN_CONFIRM = process.env.OPENCORVUS_REQUIRE_REPLAN_CONFIRM === "1"

function interactionStaleMs() {
  return safeParseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS, 60_000)
}

function goalsForRun(run: RunRow) {
  const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  return plan ? listGoalsForPlan(plan) : []
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

function activeGoalRuns(run: RunRow) {
  return listActiveGoalRunsByCoordinator(run.id)
}

function hasPendingGoalEvaluations(run: RunRow) {
  return listGoalRunsByCoordinator(run.id).some((goalRun) => {
    if (finalizingGoalRuns.has(goalRun.id)) return true
    if (goalRun.status !== "completed") return false
    const evaluation = findEvaluationByGoalRun(goalRun.id)
    return !evaluation || evaluation.status === "pending"
  })
}

function activeExecutorSession(run: RunRow, goalRun = activeGoalRun(run)) {
  return goalRun ? findExecutorSessionByGoalRun(goalRun.id) : findExecutorSessionByRun(run.id)
}

function executorLastActivityAt(executorSessionID: string | undefined) {
  if (!executorSessionID) return 0
  return latestExecutorEvent(executorSessionID)?.time_observed ?? 0
}

function goalRunLastActivityAt(run: RunRow, goalRun: GoalRunRow) {
  const executorSession = findExecutorSessionByGoalRun(goalRun.id)
  return Math.max(
    goalRun.time_updated ?? 0,
    goalRun.time_started ?? 0,
    run.time_updated ?? 0,
    run.time_started ?? 0,
    run.time_created ?? 0,
    executorLastActivityAt(executorSession?.id),
  )
}

function runLastActivityAt(run: RunRow) {
  const executorSession = findExecutorSessionByRun(run.id)
  return Math.max(
    run.time_updated ?? 0,
    run.time_started ?? 0,
    run.time_created ?? 0,
    executorLastActivityAt(executorSession?.id),
  )
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

function withGoalRunFinalizeLock<R>(runID: string, fn: () => Promise<R>) {
  return withKeyedLock(goalRunFinalizeLocks, runID, fn)
}

async function provideWorkspace<R>(directory: string | undefined, fn: () => Promise<R>) {
  if (!directory || directory === Instance.directory) return fn()
  return Instance.provide({ directory, fn })
}

function interactionAnswers(payload: Record<string, unknown> | null | undefined) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : []
  const items = questions.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const assumed =
      typeof row.default_assumption === "string" && row.default_assumption.trim()
        ? row.default_assumption.trim()
        : UNATTENDED_AUTO_REPLY
    return [[assumed]]
  })
  return items.length > 0 ? items : [[UNATTENDED_AUTO_REPLY]]
}

async function autoAnswerInteraction(row: InteractionRow) {
  if (row.request_type !== "question") return false
  const { replyInteractionInternal } = await import("./service")
  await replyInteractionInternal(row.id, {
    answers: interactionAnswers(row.payload as Record<string, unknown> | undefined),
    message: "Auto-answered with default assumptions for unattended execution",
  }, { sync: false })
  return true
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

function evaluationTimedOut(time: number | null | undefined) {
  const started = time ?? 0
  return started > 0 && (Date.now() - started) >= EVALUATION_HARD_TIMEOUT_MS
}

function stalledEvaluationSummary() {
  return `Evaluation stalled after ${Math.round(EVALUATION_HARD_TIMEOUT_MS / 60000)}min without completion`
}

function nodeMeta(node: ReturnType<typeof listPlanNodesByPlan>[number]) {
  return node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
    ? node.metadata as Record<string, unknown>
    : {}
}

async function queueGoalRun(
  task: TaskRow,
  run: RunRow,
  plan: PlanRow,
  next: ReturnType<typeof readyGoalNodes>[number],
  hooks: RuntimeHooks,
) {
  const startRef = taskBaselineRef(task)
  const baseRef = await Snapshot.track().catch(() => undefined)
  const workspaceDir = await taskDirectory(task)
  let session: Awaited<ReturnType<typeof createGoalSession>>
  try {
    session = await createGoalSession(task, next.goal, workspaceDir)
  } catch (err) {
    throw err
  }
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
  // Register goal run session so its bus events reach the task SSE stream directly.
  registerGoalRunSession(session.id, task.id)
  const prompt = buildGoalPrompt({
    plan: {
      ...plan,
      prompt: planPrompt(plan, run),
    },
    node: next.node,
    goal: next.goal,
    taskRequest: task.request,
  })
  const source: "planner" | "scheduler" | "system" = run.metadata?.strategy === "operator_note" ? "system" : "scheduler"
  const executor = ExecutorRegistry.require(run.executor)
  let submission: Awaited<ReturnType<typeof executor.submit>>
  try {
    submission = await provideWorkspace(workspaceDir, () =>
      executor.submit({
        sessionID: session.id,
        prompt,
        priority: task.priority,
        source,
      })
    )
  } catch (err) {
    updateGoalRun(goalRun.id, { status: "failed", error: String(err), time_completed: Date.now() })
    await removeGoalRunSession(goalRun).catch((e) => log.warn("cleanup session after submit failure", { error: String(e) }))
    throw err
  }
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
      phase: run.phase === "replan" || run.metadata?.strategy === "replan" ? "replan" : "dispatch",
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
  return goalRun
}

async function queueReadyGoalRuns(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
  if (activeGoalRuns(run).length > 0) return 0
  const nodes = listPlanNodesByPlan(plan.id)
  const ready = readyGoalNodes(nodes, listGoalsForPlan(plan))
  const next = ready[0]
  if (!next) return 0
  log.info("dispatching iterative goal stage", {
    runID: run.id,
    ready: ready.length,
    goal: next.goal.description,
    wave: typeof nodeMeta(next.node).wave_title === "string" ? nodeMeta(next.node).wave_title : undefined,
  })
  await queueGoalRun(task, run, plan, next, hooks)
  return 1
}

async function continueGoalPipeline(task: TaskRow, run: RunRow, hooks: RuntimeHooks) {
  const plan = planForRun(run)
  if (!plan) throw new Error(`Task ${task.id} has no plan`)
  const refreshedTask = requireTask(task.id)
  const refreshedRun = requireRun(run.id)
  if (hasPendingGoalEvaluations(refreshedRun)) return
  if (await queueReadyGoalRuns(refreshedTask, refreshedRun, plan, hooks)) return
  if (activeGoalRuns(refreshedRun).length > 0) return
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
  if (activeGoalRuns(run).length > 0) return
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
    runAppliedFiles.delete(run.id)
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
    if (evaluation.status === "pending") {
      if (!evaluationTimedOut(evaluation.time_updated ?? evaluation.time_created)) return
      const summary = stalledEvaluationSummary()
      const now = Date.now()
      Database.use((db) =>
        db
          .update(OrchestratorEvaluationTable)
          .set({
            status: "failed",
            verdict: "rejected",
            summary,
            checks: [{
              name: "evaluation_timeout",
              status: "failed",
              evidence: summary,
            }],
            time_completed: now,
            time_updated: now,
          })
          .where(eq(OrchestratorEvaluationTable.id, evaluation.id))
          .run(),
      )
      await hooks.updateRun(run, { status: "failed", error: summary, blocking_reason: null, time_completed: now }, summary)
      await hooks.updateTask(task, { status: "failed", error: summary, blocking_reason: null, time_completed: now }, summary)
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
  beginEvaluation({
    task,
    run,
    deliveryID,
    evaluationID,
    now: Date.now(),
    summary: "Evaluating task delivery",
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
  }, { actions: [] }).catch((err) => {
    log.warn("delivery.ready plugin trigger failed", { taskID: task.id, runID: run.id, deliveryID, error: String(err) })
  })
  const goals = goalsForRun(run)
  const { result, analysis, analysisError } = await evaluateTask({ task, goals, delivery })
  const finalVerdict = result.verdict
  const finalStatus = result.status
  const finalSummary = result.summary
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
    await withGoalRunFinalizeLock(run.id, () => _finalizeGoalRun(task, run, goalRun, hooks))
  } finally {
    finalizingGoalRuns.delete(goalRun.id)
  }
}

async function _finalizeGoalRun(task: TaskRow, run: RunRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
  OrchestratorRuntime.stopExecutorEventBridge(goalRun.session_id ?? undefined)
  if (goalRun.session_id) unregisterGoalRunSession(goalRun.session_id)
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
    if (existingEvaluation.status === "pending") {
      if (!evaluationTimedOut(existingEvaluation.time_updated ?? existingEvaluation.time_created)) return
      const summary = stalledEvaluationSummary()
      const now = Date.now()
      Database.use((db) =>
        db
          .update(OrchestratorEvaluationTable)
          .set({
            status: "failed",
            verdict: "rejected",
            summary,
            checks: [{
              name: "evaluation_timeout",
              status: "failed",
              evidence: summary,
            }],
            time_completed: now,
            time_updated: now,
          })
          .where(eq(OrchestratorEvaluationTable.id, existingEvaluation.id))
          .run(),
      )
      updateGoalRun(goalRun.id, { status: "failed", error: summary, blocking_reason: null, time_completed: now })
      if (goal.priority === "advisory") {
        await dispose().catch((err) => log.warn("dispose failed after advisory timeout", { error: String(err) }))
        await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
        return
      }
      await dispose().catch((err) => log.warn("dispose failed after evaluation timeout", { error: String(err) }))
      await handleEvaluationFailure(requireTask(task.id), run, summary, hooks)
      return
    }
    if (existingEvaluation.status === "passed" || goal.priority === "advisory") {
      await dispose().catch((err) => log.warn("dispose failed after passed evaluation", { error: String(err) }))
      await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
      return
    }
    await dispose().catch((err) => log.warn("dispose failed after failed evaluation", { error: String(err) }))
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
    beginEvaluation({
      task,
      run,
      goalRunID: goalRun.id,
      deliveryID,
      evaluationID,
      now: Date.now(),
      summary: `Evaluating goal delivery: ${goal.description}`,
    })
    const { result, analysis, analysisError } = await provideWorkspace(goalDir, () =>
      evaluateGoal({ task, goal, delivery: delivered })
    )
    const outcome = goalEvaluationOutcome(result, analysis)
    const runScopedAnalysis = remapGoalAnalysisToRunScope(analysis, goals, goal)
    persistEvaluation({
      task,
      run,
      goalRunID: goalRun.id,
      deliveryID,
      evaluationID,
      delivery: delivered,
      result,
      analysis: runScopedAnalysis,
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
      const appliedByRun = runAppliedFiles.get(run.id) ?? new Set<string>()
      const conflicts = delivered.diffs.filter((d) => d.status !== "deleted" && appliedByRun.has(d.file))
      if (conflicts.length > 0) {
        log.warn("goal delivery: file was already written by an earlier iterative stage in this run — later stage is overwriting it", {
          goal: goal.description,
          conflicts: conflicts.map((d) => d.file),
        })
      }
      for (const diff of delivered.diffs) {
        if (diff.status !== "deleted") appliedByRun.add(diff.file)
      }
      runAppliedFiles.set(run.id, appliedByRun)
      await provideWorkspace(await taskDirectory(task), () =>
        applyGoalDelivery({
          directory: Instance.directory,
          delivery: delivered,
        })
      )
    }
    if (outcome.status === "passed" || goal.priority === "advisory") {
      await continueGoalPipeline(requireTask(task.id), requireRun(run.id), hooks)
      return
    }
    await handleEvaluationFailure(requireTask(task.id), run, outcome.summary, hooks, runScopedAnalysis)
  } finally {
    await dispose().catch((err) => log.warn("dispose failed after goal run finalization", { error: String(err) }))
  }
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

function goalRunSyncState(goalRun: GoalRunRow) {
  if (goalRun.status === "running") return "running" as const
  if (goalRun.status === "blocked") return "blocked" as const
  return "accepted" as const
}

async function syncActiveGoalRun(task: TaskRow, run: RunRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
  const target = runExecutionTarget(run, goalRun)
  const queueTaskID = target.queueTaskID
  if (!queueTaskID) return goalRunSyncState(goalRun)
  let executorSession = activeExecutorSession(run, goalRun)
  if (executorSession?.status === "completed") {
    await finalizeGoalRun(task, run, findGoalRun(goalRun.id) ?? goalRun, hooks)
    return "handled" as const
  }
  const now = Date.now()
  if (executorSession?.status === "active") {
    const previousOwner = executorSession.lease_owner
    const claimed = claimExecutorSessionLease({
      executorSessionID: executorSession.id,
      now,
    })
    if (!claimed) {
      executorSession = activeExecutorSession(run, goalRun)
    } else {
      executorSession = claimed
    }
    if (executorLeaseHeldByOther(executorSession, now)) {
      log.info("skipping goal run sync because executor lease is owned by another runtime", {
        runID: run.id,
        goalRunID: goalRun.id,
        taskID: task.id,
        leaseOwner: executorSession?.lease_owner,
        leaseUntil: executorSession?.lease_until,
      })
      return goalRunSyncState(goalRun)
    }
    if (!claimed) {
      await handleExecutionFailure(
        run,
        `Executor lease expired after ${Math.round(EXECUTOR_LEASE_MS / 1000)}s without renewal`,
        hooks,
        goalRun,
      )
      return "handled" as const
    }
    if (previousOwner && previousOwner !== executorLeaseOwner() && previousOwner !== claimed.lease_owner) {
      log.info("claimed expired executor lease from another runtime", {
        runID: run.id,
        goalRunID: goalRun.id,
        taskID: task.id,
        previousOwner,
        leaseOwner: claimed.lease_owner,
      })
    }
  }
  const executor = ExecutorRegistry.require(run.executor)
  let queue
  try {
    queue = await withTimeout(executor.status(queueTaskID), EXECUTOR_STATUS_TIMEOUT_MS)
  } catch (error) {
    await handleExecutionFailure(run, `Executor status unavailable: ${String(error)}`, hooks, goalRun)
    return "handled" as const
  }
  if (executorSession?.id) {
    renewExecutorSessionLease({ executorSessionID: executorSession.id })
  }

  if (queue.status === "blocked") {
    if (goalRun.status !== "blocked") {
      updateGoalRun(goalRun.id, { status: "blocked", blocking_reason: "executor" })
    }
    return "blocked" as const
  }

  if (queue.status === "queued" || queue.status === "retrying") {
    if (goalRun.status === "blocked") {
      updateGoalRun(goalRun.id, { status: "accepted", blocking_reason: null })
    }
    return "accepted" as const
  }

  if (queue.status === "running") {
    const now = Date.now()
    const maxMs = goalRunTimeoutMs()
    const lastActivityAt = goalRunLastActivityAt(run, goalRun)
    const inactiveFor = inactivityAgeMs(now, lastActivityAt)
    if (lastActivityAt > 0 && inactiveFor > maxMs) {
      log.warn("goal run exceeded inactivity timeout", {
        runID: run.id,
        goalRunID: goalRun.id,
        maxMs,
        inactiveFor,
        lastActivityAt,
      })
      try {
        await executor.abort({
          sessionID: target.sessionID,
          queueTaskID,
        })
      } catch (abortErr) {
        log.warn("failed to abort stalled goal run executor", {
          runID: run.id,
          goalRunID: goalRun.id,
          error: String(abortErr),
        })
      }
      await handleExecutionFailure(
        run,
        `Goal run stalled after ${Math.round(maxMs / 60000)}min without execution activity`,
        hooks,
        goalRun,
      )
      return "handled" as const
    }
    if (goalRun.status !== "running") {
      updateGoalRun(goalRun.id, { status: "running", blocking_reason: null })
    }
    return "running" as const
  }

  if (queue.status === "failed") {
    await handleExecutionFailure(run, queue.error ?? "Executor run failed", hooks, goalRun)
    return "handled" as const
  }

  if (queue.status === "completed") {
    await finalizeGoalRun(task, run, goalRun, hooks)
    return "handled" as const
  }

  return goalRunSyncState(goalRun)
}

async function syncCoordinatorExecutor(task: TaskRow, run: RunRow, hooks: RuntimeHooks) {
  const target = runExecutionTarget(run, undefined)
  const queueTaskID = target.queueTaskID
  if (!queueTaskID) return false
  let executorSession = activeExecutorSession(run, undefined)
  const now = Date.now()
  if (executorSession?.status === "active") {
    const previousOwner = executorSession.lease_owner
    const claimed = claimExecutorSessionLease({
      executorSessionID: executorSession.id,
      now,
    })
    if (!claimed) {
      executorSession = activeExecutorSession(run, undefined)
    } else {
      executorSession = claimed
    }
    if (executorLeaseHeldByOther(executorSession, now)) {
      log.info("skipping coordinator executor sync because executor lease is owned by another runtime", {
        runID: run.id,
        taskID: task.id,
        leaseOwner: executorSession?.lease_owner,
        leaseUntil: executorSession?.lease_until,
      })
      return true
    }
    if (!claimed) {
      await handleExecutionFailure(
        run,
        `Executor lease expired after ${Math.round(EXECUTOR_LEASE_MS / 1000)}s without renewal`,
        hooks,
      )
      return true
    }
    if (previousOwner && previousOwner !== executorLeaseOwner() && previousOwner !== claimed.lease_owner) {
      log.info("claimed expired coordinator executor lease from another runtime", {
        runID: run.id,
        taskID: task.id,
        previousOwner,
        leaseOwner: claimed.lease_owner,
      })
    }
  }
  const executor = ExecutorRegistry.require(run.executor)
  let queue
  try {
    queue = await withTimeout(executor.status(queueTaskID), EXECUTOR_STATUS_TIMEOUT_MS)
  } catch (error) {
    await handleExecutionFailure(run, `Executor status unavailable: ${String(error)}`, hooks)
    return true
  }
  if (executorSession?.id) {
    renewExecutorSessionLease({ executorSessionID: executorSession.id })
  }

  if (queue.status === "blocked") {
    if (run.status !== "blocked") {
      await hooks.updateRun(run, { status: "blocked", blocking_reason: "executor" }, "Executor is awaiting input")
    }
    if (task.status !== "blocked") {
      await hooks.updateTask(task, { status: "blocked", blocking_reason: "executor" }, "Executor is awaiting input")
    }
    return true
  }

  if (queue.status === "queued" || queue.status === "retrying") {
    if (run.status === "blocked") {
      await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Run resumed")
    }
    if (task.status === "blocked") {
      await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run resumed")
    }
    return true
  }

  if (queue.status === "running") {
    const now = Date.now()
    const lastActivityAt = runLastActivityAt(run)
    const inactiveFor = inactivityAgeMs(now, lastActivityAt)
    if (lastActivityAt > 0 && inactiveFor > RUN_MAX_EXECUTION_MS) {
      log.warn("run exceeded inactivity timeout", {
        runID: run.id,
        maxMs: RUN_MAX_EXECUTION_MS,
        inactiveFor,
        lastActivityAt,
      })
      try {
        await executor.abort({
          sessionID: target.sessionID,
          queueTaskID,
        })
      } catch (abortErr) {
        log.warn("failed to abort stalled executor", { runID: run.id, error: String(abortErr) })
      }
      await handleExecutionFailure(
        run,
        `Run stalled after ${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min without execution activity`,
        hooks,
      )
      return true
    }
    if (run.status !== "running") {
      await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
    }
    if (task.status !== "running") {
      await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run executing")
    }
    return true
  }

  if (queue.status === "failed") {
    await handleExecutionFailure(run, queue.error ?? "Executor run failed", hooks)
    return true
  }

  if (queue.status === "completed") {
    await completeRun(run, hooks)
    return true
  }

  return true
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
      await pruneGoalRuns()
    } finally {
      current.syncing = false
    }
  }

  export async function dispatch(runID: string, hooks: RuntimeHooks) {
    await OrchestratorRunActor.submit(runID, async () => {
      const run = requireRun(runID)
      if (run.status !== "queued") return
      let task = requireTask(run.task_id)
      const plan = planForRun(run)
      if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
      if (!plan) throw new Error(`Task ${task.id} has no plan`)
      const prepared = await prepareRun(task, run, plan, hooks)
      if (!prepared) return
      task = prepared
      if (await queueReadyGoalRuns(task, run, plan, hooks)) return
      await finalizeCoordinatorRun(task, run, hooks)
    })
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    if (!task.active_run_id) return
    await syncRun(task.active_run_id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    await OrchestratorRunActor.submit(runID, async () => {
      let run = findRun(runID)
      if (!run) throw new Error(`Run not found: ${runID}`)
      let task = requireTask(run.task_id)
      const pending = findPendingInteractions(run.id)
      if (pending.length > 0) {
        const unattended = await unattendedProject()
        if (unattended) {
          for (const interaction of pending) {
            const answered = await autoAnswerInteraction(interaction).catch((error) => {
              log.warn("failed to auto-answer unattended interaction", { id: interaction.id, error: String(error) })
              return false
            })
            if (!answered) continue
          }
          run = requireRun(runID)
          task = requireTask(run.task_id)
          const now = Date.now()
          const timeout = interactionStaleMs()
          const stale = findPendingInteractions(run.id).filter((p) => (now - (p.time_created ?? 0)) > timeout)
          if (stale.length > 0) {
            for (const interaction of stale) {
              log.info("auto-rejecting stale interaction", {
                id: interaction.id,
                type: interaction.request_type,
                ageMs: now - (interaction.time_created ?? 0),
                timeoutMs: timeout,
              })
              await autoRejectInteraction(interaction, "Timed out waiting for operator response")
            }
            run = requireRun(runID)
            task = requireTask(run.task_id)
          }
        }
      }
      const interactionReason = findPendingInteractions(run.id)[0]?.request_type
      const recoverableGoalRuns = listGoalRunsByCoordinator(run.id)
        .filter((goalRun) => goalRun.status === "completed")
      for (const goalRun of recoverableGoalRuns) {
        await finalizeGoalRun(task, run, goalRun, hooks)
        run = requireRun(runID)
        task = requireTask(run.task_id)
        const delivery = findDeliveryByRun(run.id)
        if (run.status === "completed" && delivery) {
          await completeRun(run, hooks)
          return
        }
        if (run.status === "failed" || run.status === "aborted") {
          return
        }
      }
      const failedGoalRun = listGoalRunsByCoordinator(run.id)
        .find((goalRun) => goalRun.status === "failed")
      if (failedGoalRun && run.status !== "failed" && run.status !== "aborted") {
        const evaluation = findEvaluationByGoalRun(failedGoalRun.id)
        await handleEvaluationFailure(task, run, evaluation?.summary ?? failedGoalRun.error ?? "Goal run failed", hooks)
        return
      }
      const delivery = findDeliveryByRun(run.id)
      if (run.status === "completed" && delivery) {
        await completeRun(run, hooks)
        return
      }
      if (run.status === "failed" || run.status === "aborted") {
        return
      }
      if (run.status === "accepted" && typeof run.metadata?.previous_run_id === "string") {
        const started = run.time_started ?? run.time_created ?? 0
        if (activeGoalRuns(run).length === 0 && started > 0 && (Date.now() - started) < FOLLOWUP_RUN_SYNC_GRACE_MS) {
          return
        }
      }
      if (activeGoalRuns(run).length === 0 && await syncCoordinatorExecutor(task, run, hooks)) {
        return
      }
      for (const goalRun of activeGoalRuns(run)) {
        await syncActiveGoalRun(task, run, goalRun, hooks)
        run = requireRun(runID)
        task = requireTask(run.task_id)
        const nextDelivery = findDeliveryByRun(run.id)
        if (run.status === "completed" && nextDelivery) {
          await completeRun(run, hooks)
          return
        }
        if (run.status === "failed" || run.status === "aborted") {
          return
        }
      }

      run = requireRun(runID)
      task = requireTask(run.task_id)
      if (!interactionReason && !["failed", "aborted", "completed"].includes(run.status) && planForRun(run)) {
        await continueGoalPipeline(task, run, hooks)
        run = requireRun(runID)
        task = requireTask(run.task_id)
      }
      const nextDelivery = findDeliveryByRun(run.id)
      if (run.status === "completed" && nextDelivery) {
        await completeRun(run, hooks)
        return
      }
      if (run.status === "failed" || run.status === "aborted") {
        return
      }
      const active = activeGoalRuns(run)
      const hasRunning = active.some((goalRun) => goalRun.status === "running")
      const hasAccepted = active.some((goalRun) => goalRun.status === "accepted" || goalRun.status === "queued")
      const hasBlocked = active.some((goalRun) => goalRun.status === "blocked") || !!interactionReason

      if (hasRunning) {
        if (run.status !== "running") {
          await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
        }
        if (task.status !== "running") {
          await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run executing")
        }
        return
      }
      if (hasAccepted) {
        if (run.status !== "accepted" || run.blocking_reason) {
          await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Run resumed")
        }
        if (task.status !== "running" || task.blocking_reason) {
          await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run resumed")
        }
        return
      }
      if (hasBlocked) {
        if (run.status !== "blocked" || run.blocking_reason !== (interactionReason ?? "executor")) {
          await hooks.updateRun(run, { status: "blocked", blocking_reason: interactionReason ?? "executor" }, "Run blocked")
        }
        if (task.status !== "blocked" || task.blocking_reason !== (interactionReason ?? "executor")) {
          await hooks.updateTask(task, { status: "blocked", blocking_reason: interactionReason ?? "executor" }, "Awaiting user input")
        }
      }
    })
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
        OrchestratorProtocol.emit(Event.RunCreated, {
          taskID: task.id,
          runID: nextRunID,
          status: "queued",
          summary: "Run queued from operator note",
        }, { source: "runtime.operator_note" }),
      )
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.TaskUpdated, {
          taskID: task.id,
          status: "running",
          summary: "Operator note queued a follow-up run",
        }, { source: "runtime.operator_note" }),
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
  beginEvaluation({
    task,
    run,
    deliveryID,
    evaluationID,
    now: Date.now(),
    summary: "Evaluating task delivery",
  })
  const goals = goalsForRun(run)
  const { result, analysis, analysisError } = await evaluateTask({ task, goals, delivery })
  const finalVerdict = result.verdict
  const finalStatus = result.status
  const finalSummary = result.summary

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

async function pruneGoalRuns() {
  const now = Date.now()
  const rows = Database.use((db) =>
    db
      .select({ goalRun: OrchestratorGoalRunTable })
      .from(OrchestratorGoalRunTable)
      .innerJoin(OrchestratorTaskTable, eq(OrchestratorGoalRunTable.task_id, OrchestratorTaskTable.id))
      .where(
        and(
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorGoalRunTable.status, ["completed", "failed", "aborted", "superseded"]),
        ),
      )
      .all(),
  ).map((item) => item.goalRun)
  for (const goalRun of rows) {
    const id = goalRunLocalSessionID(goalRun)
    if (id) {
      OrchestratorRuntime.stopExecutorEventBridge(goalRun.session_id ?? id)
      if (goalRun.session_id && goalRun.session_id !== id) {
        OrchestratorRuntime.stopExecutorEventBridge(id)
      }
      await removeGoalRunSession(goalRun)
    }
    if (!goalRun.workspace_dir || !goalRunExpired(goalRun, now, GOAL_RUN_RETENTION_MS)) continue
    await cleanupGoalWorkspace(goalRun.workspace_dir)
  }
}

async function abortActiveGoalRuns(run: RunRow, summary: string, exceptGoalRunID?: string) {
  const executor = ExecutorRegistry.require(run.executor)
  for (const goalRun of activeGoalRuns(run).filter((item) => item.id !== exceptGoalRunID)) {
    const target = runExecutionTarget(run, goalRun)
    OrchestratorRuntime.stopExecutorEventBridge(target.sessionID)
    if (target.sessionID || target.queueTaskID) {
      await withTimeout(
        executor.abort({
          sessionID: target.sessionID,
          queueTaskID: target.queueTaskID,
        }),
        5_000,
      ).catch((error) => {
        log.warn("failed to abort active goal run", {
          runID: run.id,
          goalRunID: goalRun.id,
          error: String(error),
        })
        return false
      })
    }
    updateGoalRun(goalRun.id, {
      status: "aborted",
      error: summary,
      blocking_reason: null,
      time_completed: Date.now(),
    })
    updateGoalRunExecutorSessionStatus(goalRun.id, "aborted")
    await cleanupGoalWorkspace(goalRun.workspace_dir ?? undefined)
    await removeGoalRunSession(goalRun)
  }
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks, goalRun = activeGoalRun(run)) {
  const task = requireTask(run.task_id)
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

async function handleExecutionFailure(run: RunRow, summary: string, hooks: RuntimeHooks, goalRun = activeGoalRun(run)) {
  const task = requireTask(run.task_id)
  const goal = goalRun ? currentGoal(goalRun, goalsForRun(run)) : undefined
  const target = runExecutionTarget(run, goalRun)
  try {
    const executor = ExecutorRegistry.require(run.executor)
    await withTimeout(
      executor.abort({
        sessionID: target.sessionID,
        queueTaskID: target.queueTaskID,
      }),
      5_000,
    ).catch(() => false)
  } catch (error) {
    log.warn("failed to abort executor after execution failure", { runID: run.id, error: String(error) })
  }
  await failRun(run, summary, hooks, goalRun)
  if (goal?.priority === "advisory") return
  await abortActiveGoalRuns(requireRun(run.id), summary, goalRun?.id)
  const failedTask = requireTask(task.id)
  const failedRun = requireRun(run.id)
  const retryContext = buildRetryContext(failedRun, summary)
  const decision = decideRetryOrReplan(failedTask, failedRun, summary, undefined, retryContext)
  await executeDecision(failedTask, failedRun, decision, hooks)
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

async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: GoalJudgmentType) {
  if (task.active_run_id !== run.id) return

  await abortActiveGoalRuns(run, summary)
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

export function remapGoalAnalysisToRunScope(
  analysis: GoalJudgmentType | undefined,
  goals: GoalRow[],
  currentGoal: GoalRow,
) {
  if (!analysis) return analysis
  const statuses = Array.isArray(analysis.goal_statuses) ? analysis.goal_statuses : []
  if (statuses.length !== 1) return analysis
  const goalIndex = goals.findIndex((item) => item.id === currentGoal.id)
  if (goalIndex < 0 || statuses[0]?.goal_index === goalIndex) return analysis
  return {
    ...analysis,
    goal_statuses: statuses.map((item) => ({
      ...item,
      goal_index: goalIndex,
    })),
  } satisfies GoalJudgmentType
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
    OrchestratorProtocol.emit(Event.InteractionRequested, {
      taskID: task.id,
      runID: run.id,
      interactionID,
      requestType: "question",
      summary: "Confirm replan",
    }, { source: "runtime.replan_confirmation" }),
  )
  return true
}

function completeGoalRunFromIdle(goalRunID: string | undefined) {
  if (!goalRunID) return
  const goalRun = findGoalRun(goalRunID)
  if (!goalRun) return
  if (!["queued", "accepted", "running", "blocked"].includes(goalRun.status)) return
  updateGoalRun(goalRunID, {
    status: "completed",
    blocking_reason: null,
    error: null,
    time_completed: Date.now(),
  })
  updateGoalRunExecutorSessionStatus(goalRunID, "completed")
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
  const active = new Map<string, ReturnType<typeof executorSource>>()
  const outputs = new Map<string, { text: string; at: number; source: NonNullable<ReturnType<typeof executorSource>> }>()
  const flushOutput = (id?: string) => {
    const ids = id ? [id] : [...outputs.keys()]
    for (const key of ids) {
      const item = outputs.get(key)
      if (!item?.text) continue
      const payload = {
        sourceID: item.source.id,
        sourceKind: item.source.kind,
        sourceLabel: item.source.label,
        status: item.source.status,
        text: item.text,
        goalRunID,
        executorSessionID,
      }
      appendExecutorEvent(executorSessionID, taskID, runID, executorName, goalRunID, {
        provider: executorName,
        kind: "message_delta",
        summary: item.source.label,
        payload,
        raw: {
          type: "message.part.delta",
          summary: item.source.label,
          payload,
        },
      })
      OrchestratorProtocol.emit(Event.RunOutput, {
        taskID,
        runID,
        goalRunID,
        executorSessionID,
        type: "text_delta",
        text: item.text,
        summary: item.source.label,
        sourceID: item.source.id,
        sourceKind: item.source.kind,
        sourceLabel: item.source.label,
        status: item.source.status,
        payload,
      }, { source: "runtime.executor_output", executorSessionID })
      const streamChunk = {
        streamID: StreamHub.id({
          taskID,
          runID,
          goalRunID,
          sessionID,
          executorSessionID,
          sourceID: item.source.id,
        }),
        kind: "text_delta" as const,
        text: item.text,
        taskID,
        runID,
        goalRunID,
        sessionID,
        payload,
      }
      StreamHub.append(streamChunk).catch(async (error) => {
        log.warn("protocol stream chunk append failed, retrying", { taskID, runID, error: String(error) })
        StreamHub.append(streamChunk).catch((retryError) => {
          log.error("protocol stream chunk append failed after retry", { taskID, runID, error: String(retryError) })
        })
      })
      outputs.set(key, {
        ...item,
        text: "",
        at: Date.now(),
      })
    }
  }
  // 异步消费 — 不阻塞 dispatch 返回
  ;(async () => {
    try {
      for await (const event of executor.events({ sessionID, signal: controller.signal })) {
        try {
          const source = executorSource(event, active)
          if (event.type === "message.part.delta") {
            const delta = typeof event.payload?.delta === "string" ? event.payload.delta : event.summary ?? ""
            if (delta) {
              const next = source ?? {
                id: "assistant",
                kind: "assistant",
                label: "Assistant",
                status: "running",
              }
              const now = Date.now()
              const current = outputs.get(next.id) ?? {
                text: "",
                at: now,
                source: next,
              }
              outputs.set(next.id, {
                text: current.text + delta,
                at: current.at,
                source: next,
              })
              if (current.text.length + delta.length >= EXECUTOR_OUTPUT_FLUSH_CHARS || now - current.at >= EXECUTOR_OUTPUT_FLUSH_MS) {
                flushOutput(next.id)
              }
            }
            continue
          }

          flushOutput()
          syncExecutorSource(active, source)
          const payload = executorProgressPayload(event, source)
          upsertExecutorInteraction(taskID, runID, goalRunID, sessionID, executorSessionID, executorName, event)
          if (shouldPersistExecutorEvent(event.type)) {
            appendExecutorEvent(executorSessionID, taskID, runID, executorName, goalRunID, {
              provider: executorName,
              kind: protocolEventKind(event.type),
              summary: event.summary ?? event.type,
              payload,
              raw: {
                type: event.type,
                summary: event.summary,
                payload,
              },
            })
          }
          if (shouldPublishExecutorProgress(event.type)) {
            OrchestratorProtocol.emit(Event.RunProgress, {
              taskID,
              runID,
              goalRunID,
              executorSessionID,
              type: event.type,
              summary: event.summary ?? event.type,
              sourceID: source?.id,
              sourceKind: source?.kind,
              sourceLabel: source?.label,
              status: source?.status,
              payload,
            }, { source: "runtime.executor_progress", executorSessionID })
          }
          if (event.type === "session.idle") completeGoalRunFromIdle(goalRunID)
        } catch (eventErr) {
          log.warn("executor event handler failed, continuing", { taskID, runID, error: String(eventErr) })
        }
      }
    } catch (err) {
      log.warn("executor event bridge ended", { taskID, runID, error: String(err) })
    } finally {
      flushOutput()
      if (executorEventBridges.get(sessionID) === controller) {
        executorEventBridges.delete(sessionID)
      }
    }
  })().catch((err) => log.error("executor event bridge crashed", { taskID, runID, error: String(err) }))
}

function executorProgressPayload(
  event: {
    type: string
    summary?: string
    payload?: Record<string, unknown>
  },
  source?: {
    id: string
    kind: string
    label: string
    status: string
  },
) {
  if (!source) return event.payload
  return {
    ...(event.payload ?? {}),
    sourceID: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    status: source.status,
  }
}

function executorSource(
  event: {
    type: string
    summary?: string
    payload?: Record<string, unknown>
  },
  active = new Map<string, { id: string; kind: string; label: string; status: string } | undefined>(),
) {
  const payload = event.payload ?? {}
  if (event.type === "message.part.delta") {
    const live = Array.from(active.values()).pop()
    if (live) return live
    const partID = typeof payload.partID === "string" && payload.partID
      ? payload.partID
      : typeof payload.messageID === "string" && payload.messageID
        ? payload.messageID
        : "assistant"
    return {
      id: `assistant:${partID}`,
      kind: "assistant",
      label: "Assistant",
      status: "running",
    }
  }
  const kind = executorSourceKind(event.type)
  const id = executorSourceID(kind, payload)
  if (!id) return
  return {
    id,
    kind,
    label: executorSourceLabel(kind, event.summary, payload),
    status: executorSourceStatus(event.type, event.summary, payload),
  }
}

function executorSourceKind(type: string) {
  const text = type.toLowerCase()
  if (text.includes("command")) return "command"
  if (text.includes("tool")) return "tool"
  if (text.includes("approval")) return "approval"
  if (text.includes("input")) return "input"
  if (text.includes("mcp")) return "mcp"
  if (text.includes("error")) return "error"
  if (text.includes("reason")) return "assistant"
  if (text.includes("message")) return "assistant"
  return "status"
}

function executorSourceID(kind: string, payload: Record<string, unknown>) {
  for (const key of ["sourceID", "id", "itemID", "item_id", "callID", "call_id", "requestID", "request_id"]) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  const command = executorSourceCommand(payload)
  if (kind === "command" && command) return `command:${command}`
  if (kind === "tool" && typeof payload.name === "string" && payload.name.trim()) return `tool:${payload.name.trim()}`
  if (kind === "mcp" && typeof payload.serverName === "string" && payload.serverName.trim()) return `mcp:${payload.serverName.trim()}`
  if (kind === "approval" && typeof payload.approval === "string" && payload.approval.trim()) {
    return `approval:${payload.approval.trim()}`
  }
  return ""
}

function executorSourceLabel(kind: string, summary: string | undefined, payload: Record<string, unknown>) {
  const command = executorSourceCommand(payload)
  if (kind === "command" && command) return command
  if (kind === "tool" && typeof payload.name === "string" && payload.name.trim()) return payload.name.trim()
  if (kind === "approval" && typeof payload.approval === "string" && payload.approval.trim()) return payload.approval.trim()
  if (kind === "mcp" && typeof payload.serverName === "string" && payload.serverName.trim()) return payload.serverName.trim()
  if (typeof summary === "string" && summary.trim()) return summary.trim()
  return kind
}

function executorSourceStatus(type: string, summary: string | undefined, payload: Record<string, unknown>) {
  const state = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : ""
  if (state.includes("fail") || state.includes("error")) return "failed"
  if (state.includes("complete") || state.includes("done")) return "completed"
  if (state.includes("block")) return "blocked"
  if (state.includes("queue") || state.includes("pending")) return "queued"
  if (state.includes("run") || state.includes("start")) return "running"
  const text = `${type} ${summary ?? ""}`.toLowerCase()
  if (text.includes("fail") || text.includes("error")) return "failed"
  if (text.includes("complete") || text.includes("done") || text.includes("result")) return "completed"
  if (text.includes("block")) return "blocked"
  if (text.includes("queue") || text.includes("pending")) return "queued"
  return "running"
}

function executorSourceCommand(payload: Record<string, unknown>) {
  const value = payload.command ?? payload.argv ?? payload.cmd
  if (typeof value === "string") return value.trim()
  if (!Array.isArray(value)) return ""
  return value
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    .join(" ")
    .trim()
}

function syncExecutorSource(
  active: Map<string, { id: string; kind: string; label: string; status: string } | undefined>,
  source?: {
    id: string
    kind: string
    label: string
    status: string
  },
) {
  if (!source || source.kind === "assistant" || source.kind === "status") return
  active.delete(source.id)
  if (source.status === "completed" || source.status === "failed") return
  active.set(source.id, source)
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

export function shouldPersistExecutorEvent(type: string) {
  return type !== "message.part.delta" &&
    type !== "protocol.raw" &&
    type !== "usage.updated" &&
    type !== "executor.status"
}

export function shouldPublishExecutorProgress(type: string) {
  // message.* events are already forwarded to the UI via the direct session bus event
  // mechanism (Bus.subscribeAll in the task SSE endpoint). Publishing them as RunProgress
  // events causes the UI to misclassify them as "message_delta" kind and display their
  // summary strings ("Part updated: text", "Message updated: user") as assistant message text.
  if (type.startsWith("message.")) return false
  return type !== "protocol.raw" &&
    type !== "usage.updated" &&
    type !== "executor.status"
}

function upsertExecutorInteraction(
  taskID: string,
  runID: string,
  goalRunID: string | undefined,
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
          goal_run_id: goalRunID,
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
      OrchestratorProtocol.emit(Event.InteractionRequested, {
        taskID,
        runID,
        interactionID,
        requestType: event.type === "approval_request" ? "permission" : "question",
        summary: title,
      }, { source: "runtime.executor_interaction", executorSessionID }),
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
