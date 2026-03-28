import z from "zod"
import { EvaluatorService } from "@/evaluator/service"
import { ExecutorNotConfiguredError } from "@/executor/compat"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorChannelBindingTable,
  OrchestratorGoalTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import {
  CreateTaskInput,
  UpdateTaskChecksInput,
  UpdatePreferenceInput,
  UpdateGoalInput,
} from "./model"
import {
  ORCHESTRATOR_POLL_INTERVAL_MS,
  deriveTitle,
  orchestratorState,
} from "./helpers"
import { mergeTaskChecks, writeTaskChecks } from "./checks"
import { GoalService } from "./goal-service"
import { OrchestratorInteraction } from "./interaction"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun, updateTask } from "./state"
import {
  compileTransition,
  persistInitialTransition,
  persistInitialTransitionFailure,
  specDraftFromFailure,
} from "./transition"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRun,
  findRuns,
  findTaskByRequest,
  listProjectTasks,
  searchProjectTasks,
  listGoals,
  listGoalsByPlan,
  listInteractions,
  listMilestones,
  listMilestonesByPlan,
  listSnapshots,
  requireRun,
  requireTask,
  viewDelivery,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
} from "./store"

async function prepareProject(project?: string) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  if (!project) return
  if (project === Instance.project.id) return
  throw new Error(`project mismatch: expected ${Instance.project.id}, got ${project}`)
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

export function slackUser(metadata: Record<string, unknown>) {
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

async function sessionTree(sessionID: string): Promise<string[]> {
  const children = await Session.children(sessionID)
  const nested = await Promise.all(children.map((item) => sessionTree(item.id)))
  return [sessionID, ...nested.flat()]
}

export function taskInit() {
  const current = orchestratorState()
  if (!current.booted) {
    OrchestratorInteraction.subscribe(hooks())
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
    await ExecutorBootstrap.autoRegister(true).catch(() => undefined)
  }
  ExecutorRegistry.require(executor)
  const session = await Session.create({ title })
  const resolvedChecks = await EvaluatorService.resolveChecks(input.checks ? { checks: input.checks } : undefined)
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const planID = Identifier.ascending("plan")
  const runID = Identifier.ascending("run")
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.routing ? { routing: input.routing } : {}),
    ...(Object.keys(resolvedChecks).length > 0 ? { checks: resolvedChecks } : {}),
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
  const compiled = await compileTransition({
      mode: "initial",
      taskID,
      now,
      title,
      request: input.request,
      goals: input.goals,
      executor,
      routing: input.routing,
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
    WorkbenchService.recordTaskRequest({
      taskID,
      content: input.request,
      source: input.source ?? "api",
      userID: slackUser(metadata),
    })
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
  WorkbenchService.recordTaskRequest({
    taskID,
    content: input.request,
    source: input.source ?? "api",
    userID: slackUser(metadata),
  })

  await OrchestratorRuntime.dispatch(runID, hooks())
  return taskID
}

export async function getTask(taskID: string) {
  await OrchestratorRuntime.syncTask(taskID, hooks())
  return viewTask(requireTask(taskID))
}

export async function getProgress(taskID: string) {
  await OrchestratorRuntime.syncTask(taskID, hooks())
  const task = requireTask(taskID)
  const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined
  const delivery = run ? findDeliveryByRun(run.id) : undefined
  const evaluation = run ? findEvaluationByRun(run.id) : undefined
  const milestones = plan ? listMilestonesByPlan(plan.id) : listMilestones(taskID)
  return {
    task: viewTask(task),
    plan: plan ? viewPlan(plan) : undefined,
    goals: (plan ? listGoalsByPlan(plan.id) : listGoals(taskID)).map(viewGoal),
    milestones: milestones.length > 0 ? milestones.map(viewMilestone) : undefined,
    run: run ? viewRun(run) : undefined,
    pendingInteractions: listInteractions(taskID).filter((item) => item.status === "pending").map(viewInteraction),
    delivery: delivery ? viewDelivery(delivery) : undefined,
    evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
    snapshots: listSnapshots(taskID).map(viewSnapshot),
  }
}

export async function getProjectBoard(opts?: { limit?: number; query?: string; status?: string }) {
  const project = Project.get(Instance.project.id) ?? Instance.project
  const limit = opts?.limit ?? 50
  const rows = (opts?.query || opts?.status)
    ? searchProjectTasks(Instance.project.id, { query: opts.query, status: opts.status, limit })
    : listProjectTasks(Instance.project.id, limit)
  const tasks = rows.map((task) => {
    const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const pendingInteractions = listInteractions(task.id).filter((item) => item.status === "pending").length
    return {
      task: viewTask(task),
      plan: plan ? viewPlan(plan) : undefined,
      run: run ? viewRun(run) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      pending_interactions: pendingInteractions,
      updated_at: task.time_updated,
    }
  })
  const completed = rows
    .filter((task) => typeof task.time_started === "number" && typeof task.time_completed === "number")
    .map((task) => (task.time_completed ?? 0) - (task.time_started ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)

  return {
    project: {
      id: project.id,
      name: project.name,
      worktree: project.worktree,
    },
    summary: {
      total_tasks: rows.length,
      open_tasks: rows.filter((task) => !["completed", "failed", "cancelled"].includes(task.status)).length,
      running_tasks: rows.filter((task) => task.status === "running" || task.status === "evaluating").length,
      blocked_tasks: rows.filter((task) => task.status === "blocked").length,
      completed_tasks: rows.filter((task) => task.status === "completed").length,
      failed_tasks: rows.filter((task) => task.status === "failed").length,
      cancelled_tasks: rows.filter((task) => task.status === "cancelled").length,
      median_completion_ms:
        completed.length === 0 ? undefined : completed[Math.floor((completed.length - 1) / 2)],
    },
    tasks,
  }
}

export async function cancelTask(taskID: string) {
  const task = requireTask(taskID)
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined
  if (run) {
    await ExecutorRegistry.require(run.executor).abort({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
    })
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
  await Session.remove(sessionID)
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

export async function updateGoal(goalID: string, input: z.input<typeof UpdateGoalInput>) {
  const body = UpdateGoalInput.parse(input)
  const row = Database.use((db) =>
    db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).get(),
  )
  if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
  GoalService.updateGoal({
    goalID,
    description: body.description,
    criteria: body.criteria,
  })
  return true
}

export async function deleteGoal(goalID: string) {
  const row = Database.use((db) =>
    db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).get(),
  )
  if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
  GoalService.deleteGoal(goalID)
  return true
}

// Re-export for use by other modules that were imported from service.ts
import { PlannerFailureError } from "@/planner/service"
export { ExecutorNotConfiguredError, PlannerFailureError }
