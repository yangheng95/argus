import z from "zod"
import { Bus } from "@/bus"
import { discoverChecks } from "@/evaluator/discovery"
import { CheckRunner } from "@/evaluator/service"
import { ExecutorNotConfiguredError } from "@/executor/compat"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { writeGoalSnapshot, writePlanSnapshot, writePrdSnapshot } from "@/orchestrator/docs"
import { PermissionNext } from "@/permission/next"
import { type ReplanContext } from "@/planner/agent"
import { PlannerFailureError } from "@/planner/service"
import { configuredHeadlessModelRef } from "@/llm/headless"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorExecutorSessionTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalRunTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorInteractionStatus,
  type OrchestratorMetadata,
} from "./orchestrator.sql"
import {
  CreateTaskInput,
  Event,
  RejectInteractionInput,
  ReplyInteractionInput,
  TaskMessageInput,
  UpdateTaskChecksInput,
  UpdateTaskBudgetInput,
  UpdatePreferenceInput,
} from "./model"
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_RUNS,
  ORCHESTRATOR_POLL_INTERVAL_MS,
  SAME_PLAN_RETRY_LIMIT,
  budgetRow,
  buildOperatorPrompt,
  buildRetryPrompt,
  deriveTitle,
  orchestratorState,
  progressStatus,
} from "./helpers"
import { mergeTaskChecks, writeTaskChecks } from "./checks"
import { OrchestratorInteraction } from "./interaction"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun, updateTask } from "./state"
import {
  isPlannerClarification,
  markInteraction,
  rejectPlannerClarification,
  rejectProtocolInteraction,
  rejectReplanConfirmation,
} from "./interaction-actions"
import { cleanupGoalWorkspace, removeGoalRunSession } from "./goal-runner"
import {
  compileTransition,
  createReplanRun,
  ensureExecutorSession,
  insertGoalRows,
  insertPlanItems,
  persistInitialTaskDraft,
  insertSpecItems,
  persistInitialTransition,
  persistInitialTransitionFailure,
  resetPlanGoals,
  resolvePlanGoals,
  specDraftFromFailure,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
} from "./transition"
import {
  activeRunBySession,
  findArtifacts,
  findDeliveryByRun,
  findExecutorSession,
  findExecutorSessionByRun,
  findEvaluationByRun,
  findEvaluations,
  findGoalRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findPlans,
  findSpecSnapshot,
  findRun,
  findRuns,
  findTask,
  findTaskByRequest,
  goalRunQueueTaskID,
  listActiveGoalRunsByCoordinator,
  listGlobalTasks,
  listProjectTasks,
  listTaskRows,
  searchProjectTasks,
  listGoalsBySpec,
  listExecutorEvents as listExecutorProtocolEvents,
  listExecutorSessionsByRun,
  listGoalRunsByTask,
  listInteractions,
  listMilestones,
  listMilestonesByPlan,
  listPlanNodesByPlan,
  listSnapshots,
  requireInteraction,
  requireRun,
  requireTask,
  viewArtifact,
  viewDelivery,
  viewExecutorEvent,
  viewExecutorSession,
  viewEvaluation,
  viewGoal,
  viewGoalRun,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewPlanNode,
  viewRun,
  viewSnapshot,
  viewSpecSnapshot,
  viewTask,
  type GoalRow,
  type GoalRunRow,
  type TaskListRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
  type InteractionRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator" })

function initialTaskChecks(input: z.infer<typeof CreateTaskInput>["checks"]) {
  if (!input) return
  const checks = structuredClone(input)
  if (checks.build === false) delete checks.build
  if (checks.test === false) delete checks.test
  if (checks.lint === false) delete checks.lint
  if (checks.verify_cmd === false) delete checks.verify_cmd
  if (checks.named) {
    checks.named = Object.fromEntries(
      Object.entries(checks.named).map(([name, value]) => [
        name,
        {
          ...value,
          enabled: true,
        },
      ]),
    )
  }
  return checks
}

async function prepareProject(project?: string) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  if (!project) return
  if (project === Instance.project.id) return
  throw new Error(`project mismatch: expected ${Instance.project.id}, got ${project}`)
}

function taskSummary(rows: Array<{ time_started: number | null; time_completed: number | null; status: string }>) {
  const completed = rows
    .filter((row) => typeof row.time_started === "number" && typeof row.time_completed === "number")
    .map((row) => (row.time_completed ?? 0) - (row.time_started ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)

  return {
    total_tasks: rows.length,
    open_tasks: rows.filter((row) => !["completed", "failed", "cancelled"].includes(row.status)).length,
    running_tasks: rows.filter((row) => row.status === "running" || row.status === "evaluating").length,
    blocked_tasks: rows.filter((row) => row.status === "blocked").length,
    completed_tasks: rows.filter((row) => row.status === "completed").length,
    failed_tasks: rows.filter((row) => row.status === "failed").length,
    cancelled_tasks: rows.filter((row) => row.status === "cancelled").length,
    median_completion_ms:
      completed.length === 0 ? undefined : completed[Math.floor((completed.length - 1) / 2)],
  }
}

function taskItems(rows: TaskListRow[]) {
  return rows.map((item) => {
    const task = item.task
    const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const pendingInteractions = listInteractions(task.id).filter((entry) => entry.status === "pending").length
    return {
      task: viewTask(task, { directory: item.directory }),
      project: item.project,
      plan: plan ? viewPlan(plan) : undefined,
      run: run ? viewRun(run) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      pending_interactions: pendingInteractions,
      updated_at: task.time_updated,
    }
  })
}

function activeGoalRuns(run: RunRow) {
  return listActiveGoalRunsByCoordinator(run.id)
}

function interactionGoalRun(row: InteractionRow) {
  const goalRunID = typeof row.payload?.goal_run_id === "string" ? row.payload.goal_run_id : undefined
  if (goalRunID) {
    const goalRun = findGoalRun(goalRunID)
    if (goalRun) return goalRun
  }
  const executorSessionID = typeof row.payload?.executor_session_id === "string" ? row.payload.executor_session_id : undefined
  const executorSession = executorSessionID ? findExecutorSession(executorSessionID) : undefined
  const nextGoalRunID = executorSession?.goal_run_id ?? undefined
  return nextGoalRunID ? findGoalRun(nextGoalRunID) : undefined
}

function executionTarget(run: RunRow, row?: InteractionRow) {
  const goalRun = row ? interactionGoalRun(row) : undefined
  if (goalRun) {
    return {
      goalRun,
      sessionID: goalRun.session_id ?? undefined,
      queueTaskID: goalRunQueueTaskID(goalRun),
    }
  }
  const active = activeGoalRuns(run)
  const single = active.length === 1 ? active[0] : undefined
  return {
    goalRun: single,
    sessionID: single?.session_id ?? run.session_id ?? undefined,
    queueTaskID: goalRunQueueTaskID(single) ?? run.executor_ref?.queue_task_id,
  }
}

function executionTargets(run: RunRow) {
  const active = activeGoalRuns(run)
  if (active.length === 0) {
    return [{
      goalRun: undefined,
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
    }]
  }
  return active.map((goalRun) => ({
    goalRun,
    sessionID: goalRun.session_id ?? undefined,
    queueTaskID: goalRunQueueTaskID(goalRun),
  }))
}

async function supersedeRunForSpecRewrite(task: TaskRow, run: RunRow, summary: string) {
  const targets = executionTargets(run)
  const now = Date.now()
  const pending = findPendingInteractions(run.id)
  if (pending.length > 0) {
    Database.use((db) =>
      db.update(OrchestratorInteractionRequestTable)
        .set({
          status: "rejected",
          response: {
            superseded: true,
            message: summary,
          },
          time_resolved: now,
          time_updated: now,
        })
        .where(inArray(OrchestratorInteractionRequestTable.id, pending.map((item) => item.id)))
        .run(),
    )
  }
  for (const target of targets) {
    if (target.sessionID || target.queueTaskID) {
      OrchestratorRuntime.stopExecutorEventBridge(target.sessionID)
      await ExecutorRegistry.require(run.executor).abort({
        sessionID: target.sessionID,
        queueTaskID: target.queueTaskID,
      })
    }
    const goalRun = target.goalRun
    if (!goalRun) continue
    updateGoalRun(goalRun.id, {
      status: "aborted",
      error: summary,
      blocking_reason: null,
      time_completed: now,
    })
    updateGoalRunExecutorSessionStatus(goalRun.id, "aborted")
    await cleanupGoalWorkspace(goalRun.workspace_dir ?? undefined)
    await removeGoalRunSession(goalRun)
  }
  await updateRun(
    run,
    {
      status: "aborted",
      error: summary,
      blocking_reason: null,
      time_completed: now,
    },
    summary,
  )
  if (task.status === "blocked") {
    await updateTask(
      task,
      {
        status: "running",
        error: null,
        blocking_reason: null,
        time_completed: null,
      },
      "Superseding blocked run with a rewritten specification",
    )
  }
}

async function replanForSpecUpdate(taskID: string, note: string, reason: string) {
  const task = requireTask(taskID)
  if (task.status === "cancelled") {
    return { resumed: false, status: task.status }
  }
  const run = task.active_run_id ? findRun(task.active_run_id) : findRuns(task.id).at(-1)
  if (!run) {
    return { resumed: false, status: task.status }
  }
  const summary = `Spec rewrite requested after ${reason}: ${note.trim() || reason}`
  if (
    ["queued", "running", "blocked", "evaluating", "delivering"].includes(task.status) &&
    !["failed", "aborted"].includes(run.status)
  ) {
    await supersedeRunForSpecRewrite(task, run, summary)
  }
  const nextRunID = await OrchestratorRuntime.queueReplan(requireTask(taskID), run, summary, hooks())
  return {
    resumed: true,
    status: requireRun(nextRunID).status,
  }
}

async function appendTaskMessageTranscript(taskID: string, text: string) {
  const task = requireTask(taskID)
  if (!task.session_id) return
  const now = Date.now()
  const userMsg: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID: task.session_id,
    role: "user",
    time: { created: now },
    agent: "task_message",
    model: {
      providerID: "opencorvus",
      modelID: "task-message",
    },
    extra: {
      taskID,
    },
  }
  await Session.updateMessage(userMsg)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: userMsg.id,
    sessionID: task.session_id,
    type: "text",
    text,
    kind: "user_content",
    source: "user",
    audience: {
      model: false,
      ui: true,
      acp: false,
    },
  } satisfies MessageV2.TextPart)
}

function liveTaskMessage(taskID: string) {
  const task = requireTask(taskID)
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined
  if (!run) return false
  return ["accepted", "running"].includes(run.status)
}

async function continueTaskMessage(taskID: string, message: string) {
  if (liveTaskMessage(taskID)) {
    return {
      ...(await OrchestratorService.injectMessage(taskID, message)),
      live: true,
    }
  }
  return {
    ...(await OrchestratorService.recordOperatorNote(taskID, message)),
    live: false,
  }
}

export namespace OrchestratorService {
  async function settleTask(taskID: string) {
    let previous = ""
    let activeRunID = findTask(taskID)?.active_run_id
    let runChanges = 0
    for (const _ of [0, 1, 2, 3]) {
      await OrchestratorRuntime.syncTask(taskID, hooks())
      const task = findTask(taskID)
      if (!task) return
      const run = task.active_run_id ? findRun(task.active_run_id) : undefined
      if (task.active_run_id !== activeRunID) {
        activeRunID = task.active_run_id
        runChanges += 1
        if (runChanges >= 1) return
      }
      const signature = JSON.stringify({
        taskStatus: task.status,
        taskBlocking: task.blocking_reason,
        taskRun: task.active_run_id,
        runStatus: run?.status,
        runPhase: run?.phase,
        runBlocking: run?.blocking_reason,
        queueTaskID: run?.executor_ref?.queue_task_id,
      })
      if (signature === previous) return
      previous = signature
    }
  }

  export function init() {
    const current = orchestratorState()
    if (!current.booted) {
      current.unsubscribe?.()
      current.unsubscribe = OrchestratorInteraction.subscribe(hooks())
      current.booted = true
    }
    Scheduler.register({
      id: "orchestrator.poll",
      interval: ORCHESTRATOR_POLL_INTERVAL_MS,
      scope: "instance",
      run: () => OrchestratorRuntime.poll(hooks()),
    })
  }

  export async function createTask(raw: z.input<typeof CreateTaskInput>) {
    const input = CreateTaskInput.parse(raw)
    await prepareProject(input.project)
    const requestID = input.requestID?.trim() || undefined
    if (requestID) {
      const existing = findTaskByRequest(Instance.project.id, requestID)
      if (existing) return existing.id
    }
    const title = input.title?.trim() || deriveTitle(input.request)
    const executor = input.executor ?? "opencode"
    if (executor !== "opencode" && !ExecutorRegistry.has(executor)) {
      await ExecutorBootstrap.autoRegister(true).catch((err) => {
        log.warn("executor auto-register failed", { executor, error: String(err) })
      })
    }
    ExecutorRegistry.require(executor)
    const session = await Session.create({ title })
    const checks = initialTaskChecks(input.checks)
    const [resolvedChecks, discoveredChecks] = await Promise.all([
      CheckRunner.resolveChecks(checks ? { checks } : undefined),
      discoverChecks(),
    ])
    const materializedChecks = {
      ...resolvedChecks,
      ...(discoveredChecks.lint.length > 0 ? { lint: discoveredChecks.lint.map((item) => item.command) } : {}),
    }
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const planID = Identifier.ascending("plan")
    const runID = Identifier.ascending("run")
    const taskModel = await configuredHeadlessModelRef()
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.routing ? { routing: input.routing } : {}),
      ...(Object.keys(materializedChecks).length > 0 ? { checks: materializedChecks } : {}),
      ...(taskModel ? { task_model: taskModel } : {}),
    }
    // Orchestrator-dispatched tasks: auto-approve common tools, ask for external/dangerous operations.
    // When a tool requires "ask" permission, an interaction popup is created for the user.
    // The user can click "Always Allow", "Allow Once", or "Reject" in the overlay.
    await Session.setPermission({
      sessionID: session.id,
      permission: [
        // Default: allow all standard tools (task execution needs to be smooth)
        { permission: "*", pattern: "*", action: "allow" },
        // Ask for external/potentially dangerous operations (popup interaction)
        { permission: "skill", pattern: "*", action: "ask" },
        { permission: "external_directory", pattern: "*", action: "ask" },
        { permission: "webfetch", pattern: "*", action: "ask" },
        { permission: "websearch", pattern: "*", action: "ask" },
        { permission: "task", pattern: "*", action: "ask" },
        { permission: "schedule", pattern: "*", action: "ask" },
      ],
    })
    try {
      persistInitialTaskDraft({
        taskID,
        sessionID: session.id,
        now,
        title,
        request: input.request,
        requestID,
        source: input.source,
        priority: input.priority,
        budget: input.budget,
        metadata,
        channelBinding: input.channelBinding,
        projectID: Instance.project.id,
      })
    } catch (error) {
      const existing = requestID ? recoverTaskByRequest(requestID, error) : undefined
      if (existing) return existing
      const bound = recoverTaskByChannelBinding(input.channelBinding, error)
      if (bound) return bound
      throw error
    }
    WorkbenchService.recordTaskRequest({
      taskID,
      content: input.request,
      source: input.source ?? "api",
      userID: slackUser(metadata),
    })
    const compiled = await compileTransition({
        mode: "initial",
        taskID,
        sessionID: session.id,
        now,
        title,
        request: input.request,
        goals: input.goals,
        executor,
        routing: input.routing,
        budget: input.budget,
        metadata,
      }).catch(async (error) => {
      if (!(error instanceof PlannerFailureError)) throw error
      try {
        persistInitialTransitionFailure({
          taskID,
          runID,
          sessionID: session.id,
          now,
          executor,
          title,
          request: input.request,
          requestID,
          source: input.source,
          priority: input.priority,
          budget: input.budget,
          metadata,
          channelBinding: input.channelBinding,
          projectID: Instance.project.id,
          error,
          specDraft: specDraftFromFailure(error),
        })
      } catch {
        // Best effort: planner failure should still surface even if persistence also fails.
      }
      throw error
    })

    try {
      persistInitialTransition({
        taskID,
        planID,
        runID,
        sessionID: session.id,
        now,
        executor,
        title,
        request: input.request,
        requestID,
        source: input.source,
        priority: input.priority,
        budget: input.budget,
        metadata,
        channelBinding: input.channelBinding,
        milestones: input.milestones,
        promptOverride: input.promptOverride,
        compiled,
        projectID: Instance.project.id,
      })
    } catch (error) {
      const existing = requestID ? recoverTaskByRequest(requestID, error) : undefined
      if (existing) return existing
      const bound = recoverTaskByChannelBinding(input.channelBinding, error)
      if (bound) return bound
      throw error
    }

    await OrchestratorRuntime.dispatch(runID, hooks())
    return taskID
  }

  export async function getTask(taskID: string) {
    await settleTask(taskID)
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    return viewTask(task, { directory: item?.directory })
  }

  export async function getProgress(taskID: string) {
    await settleTask(taskID)
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
    const spec = task.active_spec_version_id ? findSpecSnapshot(task.active_spec_version_id) : undefined
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    const delivery = run ? findDeliveryByRun(run.id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const milestones = plan ? listMilestonesByPlan(plan.id) : listMilestones(taskID)
    const specID = plan?.spec_snapshot_id ?? task.active_spec_version_id ?? undefined
    return {
      task: viewTask(task, { directory: item?.directory }),
      spec: spec ? viewSpecSnapshot(spec) : undefined,
      plan: plan ? viewPlan(plan) : undefined,
      goals: (specID ? listGoalsBySpec(specID) : []).map(viewGoal),
      planNodes: plan ? listPlanNodesByPlan(plan.id).map(viewPlanNode) : [],
      goalRuns: listGoalRunsByTask(taskID).map(viewGoalRun),
      milestones: milestones.length > 0 ? milestones.map(viewMilestone) : undefined,
      run: run ? viewRun(run) : undefined,
      pendingInteractions: listInteractions(taskID).filter((item) => item.status === "pending").map(viewInteraction),
      delivery: delivery ? viewDelivery(delivery) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      snapshots: listSnapshots(taskID).map(viewSnapshot),
    }
  }

  export async function listRuns(taskID: string) {
    await settleTask(taskID)
    requireTask(taskID)
    return findRuns(taskID).map(viewRun)
  }

  export async function getRun(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    return viewRun(requireRun(runID))
  }

  export async function getBrief(input: { taskID: string; runID?: string }) {
    if (input.runID) {
      await OrchestratorRuntime.syncRun(input.runID, hooks()).catch((err) => {
        log.warn("syncRun failed in getBrief", { runID: input.runID, error: String(err) })
      })
    } else {
      await OrchestratorRuntime.syncTask(input.taskID, hooks()).catch((err) => {
        log.warn("syncTask failed in getBrief", { taskID: input.taskID, error: String(err) })
      })
    }
    const task = requireTask(input.taskID)
    return WorkbenchService.compileBrief({
      taskID: task.id,
      runID: input.runID ?? task.active_run_id ?? undefined,
      planVersionID: task.active_plan_version_id ?? undefined,
      sessionID: task.session_id ?? undefined,
    })
  }

  export async function getBoard(taskID: string, input?: { sync?: boolean }) {
    if (input?.sync !== false) {
      await OrchestratorRuntime.syncTask(taskID, hooks()).catch((err) => {
        log.warn("syncTask failed in getBoard", { taskID, error: String(err) })
      })
    }
    return WorkbenchService.compileBoard({ taskID })
  }

  export async function getBoardTag(taskID: string, input?: { sync?: boolean }) {
    if (input?.sync !== false) {
      await OrchestratorRuntime.syncTask(taskID, hooks()).catch((err) => {
        log.warn("syncTask failed in getBoardTag", { taskID, error: String(err) })
      })
    }
    return WorkbenchService.boardTag({ taskID })
  }

  export async function getProjectBoard(opts?: { limit?: number; query?: string; status?: string }) {
    const project = Project.get(Instance.project.id) ?? Instance.project
    const limit = opts?.limit ?? 50
    const rows = (opts?.query || opts?.status)
      ? searchProjectTasks(Instance.project.id, { query: opts.query, status: opts.status, limit })
      : listProjectTasks(Instance.project.id, limit)
    const tasks = taskItems(listTaskRows(rows))

    return {
      project: {
        id: project.id,
        name: project.name,
        worktree: project.worktree,
      },
      summary: taskSummary(rows),
      tasks,
    }
  }

  export async function getGlobalTaskBoard(opts?: {
    limit?: number
    query?: string
    status?: string
    directory?: string
    cursor?: number
  }) {
    const rows = listGlobalTasks({
      directory: opts?.directory,
      cursor: opts?.cursor,
      query: opts?.query,
      status: opts?.status,
      limit: opts?.limit ?? 100,
    })
    return {
      summary: taskSummary(rows.map((item) => item.task)),
      tasks: taskItems(rows),
    }
  }

  export async function getDelivery(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    const delivery = findDeliveryByRun(runID)
    if (!delivery) throw new NotFoundError({ message: `Delivery not found for run ${runID}` })
    return viewDelivery(delivery)
  }

  export async function listArtifacts(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    requireRun(runID)
    return findArtifacts(runID).map(viewArtifact)
  }

  export async function listEvaluations(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    requireRun(runID)
    return findEvaluations(runID).map(viewEvaluation)
  }

  export async function getExecutorSession(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    requireRun(runID)
    const row = findExecutorSessionByRun(runID)
    if (!row) throw new NotFoundError({ message: `Executor session not found for run ${runID}` })
    return viewExecutorSession(row)
  }

  export async function listExecutorEvents(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    requireRun(runID)
    return listExecutorSessionsByRun(runID)
      .flatMap((row) => listExecutorProtocolEvents(row.id).map(viewExecutorEvent))
      .sort((a, b) =>
        (a.time.created - b.time.created) ||
        (a.time.observed - b.time.observed) ||
        (a.sequence - b.sequence) ||
        a.id.localeCompare(b.id),
      )
  }

  export async function listTaskInteractions(taskID: string) {
    await OrchestratorRuntime.syncTask(taskID, hooks())
    requireTask(taskID)
    return listInteractions(taskID).map(viewInteraction)
  }

  export async function selectTaskChecks(
    taskID: string,
    selection: Record<string, boolean>,
  ) {
    const task = requireTask(taskID)
    const next = mergeTaskChecks(task.metadata?.checks, selection)
    return writeTaskChecks(task, next)
  }

  export async function updateTaskChecks(taskID: string, raw: z.input<typeof UpdateTaskChecksInput>) {
    const { checks } = UpdateTaskChecksInput.parse(raw)
    return writeTaskChecks(requireTask(taskID), checks)
  }

  export async function updateTaskBudget(taskID: string, raw: z.input<typeof UpdateTaskBudgetInput>) {
    const task = requireTask(taskID)
    const input = UpdateTaskBudgetInput.parse(raw)
    const budget = budgetRow(input.budget ?? undefined)
    if (JSON.stringify(task.budget ?? null) === JSON.stringify(budget ?? null)) {
      return viewTask(task)
    }
    const now = Date.now()
    Database.transaction((db) => {
      db.update(OrchestratorTaskTable)
        .set({
          budget,
          time_updated: now,
        })
        .where(eq(OrchestratorTaskTable.id, task.id))
        .run()
      db.insert(OrchestratorProgressSnapshotTable)
        .values({
          id: Identifier.ascending("progress"),
          task_id: task.id,
          status: progressStatus(task.status),
          summary: "Task budget updated",
          payload: {
            budget: input.budget ?? null,
          },
          time_created: now,
          time_updated: now,
        })
        .run()
      Database.effect(() => Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: task.status,
        summary: "Task budget updated",
      }))
    })
    return viewTask(requireTask(task.id))
  }

  export async function updatePreference(preferenceID: string, input: z.input<typeof UpdatePreferenceInput>) {
    const body = UpdatePreferenceInput.parse(input)
    WorkbenchService.updatePreference({
      preferenceID,
      key: body.key,
      value: body.value,
    })
    return true
  }

  export async function deletePreference(preferenceID: string) {
    WorkbenchService.deletePreference(preferenceID)
    return true
  }
}

function recoverTaskByRequest(requestID: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("UNIQUE constraint failed")) return
  if (!message.includes("orchestrator_task.project_id, orchestrator_task.request_id")) return
  return findTaskByRequest(Instance.project.id, requestID)?.id
}

function recoverTaskByChannelBinding(
  binding: {
    platform: string
    channel: string
    thread: string
  } | undefined,
  error: unknown,
) {
  if (!binding) return
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("UNIQUE constraint failed")) return
  if (!message.includes("orchestrator_channel_binding")) return
  return Database.use((db) =>
    db
      .select({ task_id: OrchestratorChannelBindingTable.task_id })
      .from(OrchestratorChannelBindingTable)
      .where(
        and(
          eq(OrchestratorChannelBindingTable.platform, binding.platform),
          eq(OrchestratorChannelBindingTable.channel, binding.channel),
          eq(OrchestratorChannelBindingTable.thread, binding.thread),
        ),
      )
      .get()?.task_id,
  )
}

export namespace OrchestratorService {
  export async function replyInteraction(interactionID: string, raw: z.input<typeof ReplyInteractionInput>) {
    const input = ReplyInteractionInput.parse(raw)
    const row = requireInteraction(interactionID)
    if (row.payload?.protocol_request === true) {
      await resolveProtocolInteraction(row, input)
      await OrchestratorRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteraction(interactionID))
    }
    // Replan confirmation: user approved the spec rewrite → proceed with actual replan
    if (row.payload?.replan_confirm === true) {
      const task = requireTask(row.task_id)
      const run = requireRun(row.run_id)
      const planID = typeof row.payload?.plan_id === "string" ? row.payload.plan_id : run.plan_version_id
      const plan = planID ? findPlan(planID) : undefined
      if (!plan) throw new Error(`Plan not found for replan confirmation: ${planID}`)
      const failureSummary = typeof row.payload?.failure_summary === "string" ? row.payload.failure_summary : "Evaluation failed"
      Database.use((db) =>
        db.update(OrchestratorInteractionRequestTable)
          .set({ status: "answered", response: { approved: true }, time_resolved: Date.now(), time_updated: Date.now() })
          .where(eq(OrchestratorInteractionRequestTable.id, interactionID))
          .run(),
      )
      const next = await createReplanRun(task, plan, run, failureSummary, row.payload?.analysis as never)
      if (next.queued && next.runID) {
        await OrchestratorRuntime.dispatch(next.runID, hooks())
      }
      return viewInteraction(requireInteraction(interactionID))
    }
    if (row.request_type === "permission") {
      await PermissionNext.reply({
        requestID: row.external_id,
        reply: input.reply ?? "once",
        message: input.message,
      })
    }
    if (row.request_type === "question") {
      const answers = input.answers ?? answersFromMessage(input.message)
      if (!answers) throw new Error("answers or message are required for question replies")
      if (isPlannerClarification(row)) {
        await answerPlannerClarification(row, answers)
      } else {
        await Question.reply({
          requestID: row.external_id,
          answers,
        })
      }
    }
    await OrchestratorRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteraction(interactionID))
  }

  export async function rejectInteraction(interactionID: string, raw?: z.input<typeof RejectInteractionInput>) {
    const input = RejectInteractionInput.parse(raw ?? {})
    const row = requireInteraction(interactionID)
    if (row.payload?.protocol_request === true) {
      await rejectProtocolInteraction(row, input.message)
      await OrchestratorRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteraction(interactionID))
    }
    // Replan confirmation: user rejected the spec rewrite → fail the task
    if (row.payload?.replan_confirm === true) {
      await rejectReplanConfirmation(row, input.message)
      return viewInteraction(requireInteraction(interactionID))
    }
    if (row.request_type === "permission") {
      await PermissionNext.reply({
        requestID: row.external_id,
        reply: "reject",
        message: input.message,
      })
    }
    if (row.request_type === "question") {
      if (isPlannerClarification(row)) {
        await rejectPlannerClarification(row, input.message)
      } else {
        await Question.reject(row.external_id)
      }
    }
    await OrchestratorRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteraction(interactionID))
  }

  export async function cancelTask(taskID: string) {
    const task = requireTask(taskID)
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    if (run) {
      for (const target of executionTargets(run)) {
        if (target.sessionID || target.queueTaskID) {
          OrchestratorRuntime.stopExecutorEventBridge(target.sessionID)
          await ExecutorRegistry.require(run.executor).abort({
            sessionID: target.sessionID,
            queueTaskID: target.queueTaskID,
          })
        }
        if (!target.goalRun) continue
        updateGoalRun(target.goalRun.id, {
          status: "aborted",
          error: "task cancelled",
          blocking_reason: null,
          time_completed: Date.now(),
        })
        updateGoalRunExecutorSessionStatus(target.goalRun.id, "aborted")
        await cleanupGoalWorkspace(target.goalRun.workspace_dir ?? undefined)
        await removeGoalRunSession(target.goalRun)
      }
    }
    if (run) {
      await updateRun(
        run,
        {
          status: "aborted",
          error: "task cancelled",
          blocking_reason: null,
          time_completed: Date.now(),
        },
        "Run aborted",
      )
    }
    await updateTask(
      task,
      {
        status: "cancelled",
        error: "task cancelled",
        blocking_reason: null,
        time_completed: Date.now(),
      },
      "Task cancelled",
    )
    // Clean up channel bindings so the thread is not reused
    Database.use((db) =>
      db
        .delete(OrchestratorChannelBindingTable)
        .where(eq(OrchestratorChannelBindingTable.task_id, taskID))
        .run(),
    )
    return true
  }

  export async function deleteSession(sessionID: string, input?: { deleteTasks?: boolean }) {
    const ids = await sessionTree(sessionID)
    for (const id of ids) {
      OrchestratorRuntime.stopExecutorEventBridge(id)
    }
    const dirs = Database.use((db) =>
      db
        .select({ dir: OrchestratorGoalRunTable.workspace_dir })
        .from(OrchestratorGoalRunTable)
        .where(inArray(OrchestratorGoalRunTable.session_id, ids))
        .all(),
    )
      .flatMap((item) => typeof item.dir === "string" && item.dir ? [item.dir] : [])
      .filter((item, index, all) => all.indexOf(item) === index)
    if (input?.deleteTasks) {
      const tasks = Database.use((db) =>
        db
          .select({ id: OrchestratorTaskTable.id, status: OrchestratorTaskTable.status })
          .from(OrchestratorTaskTable)
          .where(
            and(
              eq(OrchestratorTaskTable.project_id, Instance.project.id),
              inArray(OrchestratorTaskTable.session_id, ids),
            ),
          )
          .all(),
      )
      for (const item of tasks) {
        if (["completed", "failed", "cancelled"].includes(item.status)) continue
        await cancelTask(item.id)
      }
      Database.use((db) =>
        db
          .delete(OrchestratorTaskTable)
          .where(
            and(
              eq(OrchestratorTaskTable.project_id, Instance.project.id),
              inArray(OrchestratorTaskTable.session_id, ids),
            ),
          )
          .run(),
      )
    }
    for (const dir of dirs) {
      await cleanupGoalWorkspace(dir)
    }
    await Session.remove(sessionID)
    return true
  }

  export async function deleteTask(taskID: string) {
    const task = requireTask(taskID)
    if (task.session_id) {
      await deleteSession(task.session_id, { deleteTasks: true })
      return true
    }
    if (!["completed", "failed", "cancelled"].includes(task.status)) {
      await cancelTask(taskID)
    }
    Database.use((db) =>
      db
        .delete(OrchestratorChannelBindingTable)
        .where(eq(OrchestratorChannelBindingTable.task_id, taskID))
        .run(),
    )
    Database.use((db) =>
      db
        .delete(OrchestratorTaskTable)
        .where(and(eq(OrchestratorTaskTable.project_id, Instance.project.id), eq(OrchestratorTaskTable.id, taskID)))
        .run(),
    )
    return true
  }

  export async function retryTask(taskID: string) {
    const task = requireTask(taskID)
    if (["queued", "planning", "running", "evaluating"].includes(task.status)) {
      throw new Error(`task ${taskID} is already active`)
    }
    const run = task.active_run_id ? findRun(task.active_run_id) : findRuns(task.id).at(-1)
    if (!run) throw new NotFoundError({ message: `Run not found for task ${taskID}` })
    const summary = task.error ?? findEvaluationByRun(run.id)?.summary ?? "Retry requested by operator."
    const nextRunID = await OrchestratorRuntime.queueRetry(task, run, summary, hooks())
    return viewRun(requireRun(nextRunID))
  }

  export async function replanTask(taskID: string) {
    const task = requireTask(taskID)
    if (["queued", "planning", "running", "evaluating"].includes(task.status)) {
      throw new Error(`task ${taskID} is already active`)
    }
    const run = task.active_run_id ? findRun(task.active_run_id) : findRuns(task.id).at(-1)
    if (!run) throw new NotFoundError({ message: `Run not found for task ${taskID}` })
    const summary = task.error ?? findEvaluationByRun(run.id)?.summary ?? "Replan requested by operator."
    const nextRunID = await OrchestratorRuntime.queueReplan(task, run, summary, hooks())
    return viewRun(requireRun(nextRunID))
  }

  export async function recordOperatorNote(taskID: string, note: string) {
    const task = requireTask(taskID)
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(OrchestratorProgressSnapshotTable)
        .values({
          id: Identifier.ascending("progress"),
          task_id: task.id,
          status: progressStatus(task.status),
          summary: "Operator note recorded",
          payload: {
            note,
            activeRunID: run?.id,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    if (!run) {
      return { resumed: false, status: task.status }
    }
    if (task.status === "cancelled") {
      return { resumed: false, status: task.status }
    }
    if (
      ["queued", "planning", "running", "blocked", "evaluating", "delivering"].includes(task.status) &&
      ["accepted", "running"].includes(run.status)
    ) {
      return { resumed: false, status: run.status }
    }
    const nextRunID = await OrchestratorRuntime.createOperatorRun(task, run, note)
    await OrchestratorRuntime.dispatch(nextRunID, hooks())
    return { resumed: true, status: "running" as const }
  }

  export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInput>) {
    const input = TaskMessageInput.parse(raw)
    await appendTaskMessageTranscript(taskID, input.text)
    const result = await WorkbenchService.ingestTaskMessage({
      taskID,
      text: input.text,
      source: input.source ?? "user_message",
      userID: input.user_id,
    })
    await Bus.publish(Event.TaskMessageRecorded, {
      taskID,
      kind: result.kind,
      source: input.source ?? "user_message",
      text: input.text,
      summary: result.message,
    })
    if (!result.should_resume) {
      return result
    }
    if (result.kind === "goal" || result.kind === "spec") {
      const replan = await replanForSpecUpdate(
        taskID,
        input.text,
        result.kind === "goal" ? "goal update" : "spec update",
      )
      return {
        ...result,
        message: replan.resumed
          ? result.kind === "goal"
            ? "Recorded goal update. Queued a spec rewrite and replan."
            : "Recorded spec update. Queued a spec rewrite and replan."
          : result.message,
      }
    }
    const note = await continueTaskMessage(taskID, input.text)
    return {
      ...result,
      message:
        result.kind === "plan" && note.live && note.resumed
          ? "Plan hint recorded and forwarded to the active run."
          : result.kind === "plan" && note.live && !note.resumed
            ? "Plan hint recorded. Active run cannot absorb it directly; it will apply on the next run."
            : result.kind === "plan" && note.resumed
              ? "Plan hint recorded. Queued a follow-up run."
              : result.kind === "note" && note.live && note.resumed
                ? "Operator note recorded and forwarded to the active run."
                : result.kind === "note" && note.live && !note.resumed
                  ? "Operator note recorded. Active run cannot absorb it directly; it will apply on the next run."
                  : result.kind === "note" && note.resumed
                    ? "Operator note recorded. Queued a follow-up run."
                    : result.message,
    }
  }

  /**
   * 向正在运行的 task 注入消息。
   * 如果当前 run 正在执行且 executor 支持 resume，直接注入到 session；
   * 否则退化为 operator note（创建新 run）。
   */
  export async function injectMessage(taskID: string, message: string) {
    const task = requireTask(taskID)
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    if (!run) throw new Error(`No active run for task ${taskID}`)
    const target = executionTarget(run)

    // 只有运行中的 run 才能注入
    if (!["accepted", "running"].includes(run.status)) {
      return recordOperatorNote(taskID, message)
    }
    if (!target.sessionID) {
      return recordOperatorNote(taskID, message)
    }

    const executor = ExecutorRegistry.require(run.executor)
    if (!executor.capabilities().resume) {
      return recordOperatorNote(taskID, message)
    }

    const submission = await (
      target.goalRun?.workspace_dir && target.goalRun.workspace_dir !== Instance.directory
        ? Instance.provide({
            directory: target.goalRun.workspace_dir,
            fn: () =>
              executor.resume({
                sessionID: target.sessionID!,
                message,
              }),
          })
        : executor.resume({
            sessionID: target.sessionID,
            message,
          })
    )

    ensureExecutorSession({
      taskID: task.id,
      runID: run.id,
      goalRunID: target.goalRun?.id,
      provider: run.executor,
      refs: {
        provider_session_id: submission.sessionID,
        queue_task_id: submission.queueTaskID,
      },
      settings: target.goalRun?.workspace_dir
        ? {
            cwd: target.goalRun.workspace_dir,
          }
        : undefined,
    })

    // 更新 executor ref（queueTaskID 可能变化）
    if (target.goalRun) {
      if (submission.queueTaskID !== target.queueTaskID || submission.sessionID !== target.sessionID) {
        updateGoalRun(target.goalRun.id, {
          session_id: submission.sessionID,
          metadata: {
            ...(target.goalRun.metadata ?? {}),
            queue_task_id: submission.queueTaskID,
            provider_session_id: submission.sessionID,
          },
        })
      }
    } else if (submission.queueTaskID !== run.executor_ref?.queue_task_id || submission.sessionID !== run.session_id) {
      await updateRun(
        run,
        {
          session_id: submission.sessionID,
          executor_ref: {
            session_id: submission.sessionID,
            queue_task_id: submission.queueTaskID,
          },
        },
        "Message injected into running session",
      )
    }

    await Bus.publish(Event.MessageInjected, {
      taskID: task.id,
      runID: run.id,
      text: message,
      summary: "Operator message injected into running session",
    })

    return { resumed: true, status: "running" as const }
  }

  export async function abortRun(runID: string) {
    const run = requireRun(runID)
    for (const target of executionTargets(run)) {
      if (target.sessionID || target.queueTaskID) {
        await ExecutorRegistry.require(run.executor).abort({
          sessionID: target.sessionID,
          queueTaskID: target.queueTaskID,
        })
      }
      if (!target.goalRun) continue
      updateGoalRun(target.goalRun.id, {
        status: "aborted",
        error: "run aborted",
        blocking_reason: null,
        time_completed: Date.now(),
      })
      updateGoalRunExecutorSessionStatus(target.goalRun.id, "aborted")
      await cleanupGoalWorkspace(target.goalRun.workspace_dir ?? undefined)
      await removeGoalRunSession(target.goalRun)
    }
    await updateRun(
      run,
      {
        status: "aborted",
        error: "run aborted",
        blocking_reason: null,
        time_completed: Date.now(),
      },
      "Run aborted",
    )
    Database.use((db) =>
      db
        .update(OrchestratorExecutorSessionTable)
        .set({
          status: "aborted",
          time_completed: Date.now(),
          time_updated: Date.now(),
        })
        .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
        .run(),
    )
    const task = requireTask(run.task_id)
    if (task.active_run_id === run.id) {
      await updateTask(task, { status: "failed", error: "run aborted", blocking_reason: null, time_completed: Date.now() }, "Run aborted")
    }
    return true
  }
}

export { ExecutorNotConfiguredError, PlannerFailureError }

function slackUser(metadata: Record<string, unknown>) {
  const channel = metadata.channel
  if (channel && typeof channel === "object") {
    const user = (channel as Record<string, unknown>).user_id
    if (typeof user === "string" && user) return user
  }
  const slack = metadata.slack
  if (!slack || typeof slack !== "object") return undefined
  const user = (slack as Record<string, unknown>).user
  if (typeof user !== "string" || !user) return undefined
  return user
}

function answersFromMessage(message?: string) {
  const text = message?.trim()
  if (!text) return
  return [[text]]
}

async function resolveProtocolInteraction(row: InteractionRow, input: z.infer<typeof ReplyInteractionInput>) {
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()
  const target = executionTarget(run, row)

  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: target.sessionID,
      queueTaskID: target.queueTaskID,
      requestID,
      kind: "approval",
      response: {
        decision: input.reply === "always" ? "acceptForSession" : "accept",
      },
    })
    markInteraction(row, "answered", {
      reply: input.reply ?? "once",
      message: input.message,
    }, now)
    return
  }

  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const next = item as Record<string, unknown>
        if (typeof next.id !== "string" || !next.id) return []
        return [next.id]
      })
    : []
  const answers = input.answers ?? answersFromMessage(input.message)
  if (!answers) throw new Error("answers or message are required for protocol input replies")
  const response = Object.fromEntries(
    questions.map((id, index) => [id, { answers: answers[index] ?? answers[0] ?? [] }]),
  )
  await executor.resolve({
    sessionID: target.sessionID,
    queueTaskID: target.queueTaskID,
    requestID,
    kind: "input",
    response: {
      answers: response,
    },
  })
  markInteraction(row, "answered", {
    answers: response,
    message: input.message,
  }, now)
}

async function answerPlannerClarification(row: InteractionRow, answers: string[][]) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const clarifiedRequest = appendClarification(task.request, row.payload?.questions, answers)
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {}
  const provisional = payload.provisional_plan && typeof payload.provisional_plan === "object" && !Array.isArray(payload.provisional_plan)
    ? payload.provisional_plan as Record<string, unknown>
    : {}
  const provisionalMeta = provisional.metadata && typeof provisional.metadata === "object" && !Array.isArray(provisional.metadata)
    ? provisional.metadata as Record<string, unknown>
    : {}
  const routing =
    task.metadata?.routing && typeof task.metadata.routing === "object" && !Array.isArray(task.metadata.routing)
      ? task.metadata.routing as z.infer<typeof CreateTaskInput>["routing"]
      : undefined
  const isReplan = run.phase === "replan" || provisionalMeta.strategy === "replan"
  const previousPlanID = task.active_plan_version_id ?? run.plan_version_id
  const previousPlan = isReplan && previousPlanID ? findPlan(previousPlanID) : undefined
  if (isReplan && !previousPlan) throw new Error(`Previous plan not found for task ${task.id}`)
  const goals =
    previousPlan
      ? listGoalsBySpec(previousPlan.spec_snapshot_id).map((goal) => ({
          description: goal.description,
          criteria: goal.criteria,
          priority: goal.priority,
          metadata: goal.metadata ?? undefined,
        }))
      : undefined
  const replanContext =
    provisionalMeta.replan_context && typeof provisionalMeta.replan_context === "object" && !Array.isArray(provisionalMeta.replan_context)
      ? provisionalMeta.replan_context as ReplanContext
      : run.metadata?.replan_context && typeof run.metadata.replan_context === "object" && !Array.isArray(run.metadata.replan_context)
        ? run.metadata.replan_context as ReplanContext
        : undefined
  const failureSummary =
    typeof provisionalMeta.failure_summary === "string"
      ? provisionalMeta.failure_summary
      : typeof run.metadata?.failure_summary === "string"
        ? run.metadata.failure_summary
        : task.error ?? "Replan requested after clarification."
  const now = Date.now()
  const compiled = await (
    isReplan
      ? (() => {
          if (!previousPlan) {
            throw new Error(`Previous plan missing for replan request on task ${task.id}`)
          }
          return compileTransition({
            mode: "replan",
            taskID: task.id,
            now,
            title: task.title,
            request: clarifiedRequest,
            goals: goals ?? [],
            executor: run.executor,
            routing,
            task,
            previousPlan,
            previousRun: run,
            failureSummary,
            replanContext,
          })
        })()
      : compileTransition({
          mode: "initial",
          taskID: task.id,
          sessionID: task.session_id ?? undefined,
          now,
          title: task.title,
          request: clarifiedRequest,
          goals,
          executor: run.executor,
          routing,
          budget: task.budget ? { maxWallTimeMs: task.budget.max_wall_time_ms } : undefined,
          metadata: task.metadata ?? {},
        })
  )
  const planDraft = compiled.planDraft
  const specDraft = compiled.specDraft
  const planID = Identifier.ascending("plan")
  const specSnapshotID = isReplan && previousPlan ? previousPlan.spec_snapshot_id : Identifier.ascending("spec")
  const taskMetadata = {
    ...compiled.taskMetadata,
    planner_clarification: false,
    clarified_request: clarifiedRequest,
  }
  const previousRunID =
    typeof run.metadata?.previous_run_id === "string"
      ? run.metadata.previous_run_id
      : run.id
  const planMetadata = {
    ...compiled.planMetadata,
    ...(isReplan ? { previous_run_id: previousRunID } : {}),
    clarified_request: clarifiedRequest,
  }
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "answered",
        response: {
          answers,
          clarified_request: clarifiedRequest,
        },
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    if (isReplan) {
      if (!previousPlan) {
        throw new Error(`Previous plan missing for replan request on task ${task.id}`)
      }
      db.update(OrchestratorPlanVersionTable)
        .set({
          status: "superseded",
          time_updated: now,
        })
        .where(eq(OrchestratorPlanVersionTable.id, previousPlan.id))
        .run()
    }
    const goals = isReplan
      ? (() => {
          const next = resolvePlanGoals(specSnapshotID, specDraft.goals ?? [])
          resetPlanGoals(db, next, now)
          return next
        })()
      : (() => {
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specSnapshotID,
              task_id: task.id,
              version: 1,
              status: "ready",
              summary: specDraft.summary,
              content: specDraft.content,
              scope:
                typeof (specDraft as { scope?: unknown }).scope === "string"
                  ? (specDraft as { scope?: string }).scope ?? ""
                  : "",
              out_of_scope:
                typeof (specDraft as { out_of_scope?: unknown }).out_of_scope === "string"
                  ? (specDraft as { out_of_scope?: string }).out_of_scope
                  : undefined,
              evidence: specDraft.evidence_sources.length > 0 ? specDraft.evidence_sources : undefined,
              metadata: {
                assumptions: specDraft.assumptions,
                risks: specDraft.risks,
                unresolved_questions: specDraft.unresolved_questions,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          insertSpecItems(db, {
            taskID: task.id,
            specSnapshotID,
            specItems: specDraft.spec_items ?? [],
            now,
          })
          return insertGoalRows(db, {
            taskID: task.id,
            specSnapshotID,
            goals: specDraft.goals ?? [],
            now,
          })
        })()
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: planID,
        task_id: task.id,
        spec_snapshot_id: specSnapshotID,
        version: isReplan && previousPlan ? previousPlan.version + 1 : 1,
        status: "active",
        summary: planDraft.summary,
        prompt: planDraft.prompt,
        metadata: planMetadata,
        time_created: now,
        time_updated: now,
      })
      .run()
    insertPlanItems(db, {
      taskID: task.id,
      planID,
      goals,
      planDraft,
      now,
      milestones: [],
    })
    db.update(OrchestratorRunTable)
      .set({
        plan_version_id: planID,
        status: "queued",
        phase: isReplan ? "replan" : "dispatch",
        blocking_reason: null,
        metadata: {
          ...(run.metadata ?? {}),
          strategy: "clarification_resolved",
          ...(planDraft.metadata?.stage_sources ? { stage_sources: planDraft.metadata.stage_sources } : {}),
          ...(planDraft.metadata?.spec_analysis ? { spec_analysis: planDraft.metadata.spec_analysis } : {}),
          clarified_request: clarifiedRequest,
          clarification_answers: answers,
        },
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, run.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_plan_version_id: planID,
        active_run_id: run.id,
        active_spec_version_id: specSnapshotID,
        status: "queued",
        blocking_reason: null,
        error: null,
        metadata: taskMetadata,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: isReplan ? "Clarification answered; replanning resumed" : "Clarification answered; planning resumed",
        payload: {
          clarified_request: clarifiedRequest,
          answers,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: task.id,
        runID: run.id,
        interactionID: row.id,
        status: "answered",
        summary: "Clarification answered",
      }),
    )
    Database.effect(() => Bus.publish(Event.PlanCreated, { taskID: task.id, planID, summary: planDraft.summary }))
    Database.effect(() =>
      Bus.publish(Event.PlanActivated, {
        taskID: task.id,
        planID,
        summary: isReplan ? "Replanned version activated after clarification" : "Plan activated after clarification",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.RunUpdated, {
        taskID: task.id,
        runID: run.id,
        status: "queued",
        summary: isReplan ? "Replanned run queued after clarification" : "Run queued after clarification",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: "queued",
        summary: isReplan ? "Clarification resolved; replanned task queued" : "Clarification resolved; task queued",
      }),
    )
  })
  writePrdSnapshot({
    task,
    plan: {
      id: planID,
      version: isReplan && previousPlan ? previousPlan.version + 1 : 1,
      summary: planDraft.summary,
      metadata: planMetadata,
    },
    createdAt: now,
  })
  writePlanSnapshot({
    task,
    plan: {
      id: planID,
      version: isReplan && previousPlan ? previousPlan.version + 1 : 1,
      summary: planDraft.summary,
      prompt: planDraft.prompt,
      metadata: planMetadata,
    },
    createdAt: now,
  })
  writeGoalSnapshot({
    task,
    plan: {
      id: planID,
      version: isReplan && previousPlan ? previousPlan.version + 1 : 1,
      summary: planDraft.summary,
    },
    goals: listGoalsBySpec(specSnapshotID),
    milestones: listMilestonesByPlan(planID),
    createdAt: now,
  })
  await OrchestratorRuntime.dispatch(run.id, hooks())
}

function appendClarification(request: string, rawQuestions: unknown, answers: string[][]) {
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        if (typeof row.question !== "string" || !row.question.trim()) return []
        return [{
          question: row.question,
          default_assumption:
            typeof row.default_assumption === "string" && row.default_assumption.trim()
              ? row.default_assumption
              : undefined,
        }]
      })
    : []
  const sections = [request.trim(), "", "Clarifications:"]
  if (questions.length === 0) {
    sections.push(...answers.map((item, index) => `Answer ${index + 1}: ${item.join(", ")}`))
    return sections.join("\n")
  }
  for (const [index, question] of questions.entries()) {
    sections.push(`Q${index + 1}: ${question.question}`)
    sections.push(`A${index + 1}: ${answers[index]?.join(", ") || question.default_assumption || "No answer provided"}`)
  }
  return sections.join("\n")
}

async function sessionTree(sessionID: string): Promise<string[]> {
  const children = await Session.children(sessionID)
  const nested = await Promise.all(children.map((item) => sessionTree(item.id)))
  return [sessionID, ...nested.flat()]
}
