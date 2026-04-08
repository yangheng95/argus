import z from "zod"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { discoverChecks, resolveConfig, resolvedChecks } from "@/evaluator/discovery"
import { ExecutorNotConfiguredError } from "@/executor/compat"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { PlannerFailureError } from "@/types/planner"
import { Provider } from "@/provider/provider"
import { ProtocolStore } from "@/protocol/store"
import { OrchestratorProtocol } from "./protocol"
import { ensureGitignore } from "./git"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorExecutorSessionTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
  type OrchestratorInteractionStatus,
  type OrchestratorMetadata,
} from "./orchestrator.sql"
import {
  Budget,
  CreateTaskInput,
  Event,
  RejectInteractionInput,
  ReplyInteractionInput,
  TaskMessageInput,
  CheckConfig,
  UpdateGoalInput,
  UpdateTaskChecksInput,
} from "./model"
import {
  DEFAULT_MAX_RUNS,
  DEFAULT_MAX_FIX_RUNS,
  ORCHESTRATOR_POLL_INTERVAL_MS,
  budgetRow,
  deriveTitle,
  orchestratorState,
  progressStatus,
} from "./helpers"
import { mergeTaskChecks, writeTaskChecks } from "./checks"
import { GoalService } from "./goal-service"
import { OrchestratorInteraction } from "./interaction"
import { AutoReply } from "./auto-reply"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun, updateTask } from "./state"
import { persistQueuedTask, abortTaskPipeline, awaitPipelineSettled } from "./pipeline"
import { TaskAgent } from "@/task-agent/agent"
import {
  activeRunBySession,
  findArtifacts,
  findDeliveryByRun,
  findLatestDeliveryForRun,
  findExecutorSessionByRun,
  findEvaluationByRun,
  findEvaluations,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findPlans,
  findRun,
  findRuns,
  findTask,
  findTaskByRequest,
  hasActiveTaskInProject,
  findNextQueuedTaskForProject,
  listGlobalTasks,
  listProjectTasks,
  listTaskRows,
  searchProjectTasks,
  listGoals,
  listGoalsByPlan,
  listInteractions,
  listMilestones,
  listMilestonesByPlan,
  listSnapshots,
  requireInteraction,
  requireRun,
  requireTask,
  viewArtifact,
  viewDelivery,
  viewExecutorSession,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
  type GoalRow,
  type TaskListRow,
  type TaskRow,
  type PlanRow,
  type RunRow,
  type InteractionRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "assistant" })

async function continueTaskMessage(taskID: string, text: string) {
  const task = requireTask(taskID)
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined

  // If executor is running and supports resume → inject directly
  const injected = run ? await injectRunningTaskMessage(task, run, text) : false
  if (injected) {
    return {
      mode: "injected" as const,
      resumed: true,
      status: "active" as const,
    }
  }

  // Always store the message in session history so Task Agent can see it later
  await appendTaskSessionMessage(task, text)

  // If task is in a terminal/blocked state → wake up Task Agent to handle the message
  if (["failed", "cancelled"].includes(task.status)) {
    await updateTask(task, { status: "queued", error: null, blocking_reason: null }, "User message received, re-queuing")
    import("@/orchestrator/task-loop").then(async ({ runTaskLoop }) => {
      const { hooks } = await import("@/orchestrator/state")
      runTaskLoop({
        taskID,
        trigger: { kind: "retry" },
        hooks: hooks(),
      }).catch((err) => {
        log.error("task loop failed on retry", { taskID, error: err instanceof Error ? err.message : String(err) })
      })
    })
    return {
      mode: "agent_retry" as const,
      resumed: true,
      status: "queued" as const,
    }
  }

  // Otherwise: executor is running but doesn't support inject, or task is in pipeline stages.
  // Queue the message — Task Agent will see it at the next decision point via operatorNotesSection.
  await OrchestratorService.recordOperatorNote(taskID, text)
  return {
    mode: "queued" as const,
    resumed: false,
    status: task.status as string,
  }
}

async function injectRunningTaskMessage(task: TaskRow, run: RunRow, message: string) {
  if (!["accepted", "running"].includes(run.status)) return false
  if (!run.session_id) return false
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.capabilities().resume) return false

  const submission = await executor.resume({
    sessionID: run.session_id,
    message,
  })
  if (run.executor !== "opencode") {
    await appendTaskSessionMessage(task, message)
  }
  if (submission.queueTaskID !== run.executor_ref?.queue_task_id) {
    await updateRun(
      run,
      {
        executor_ref: {
          session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
      },
      "Message injected into running session",
    )
  }
  await OrchestratorProtocol.emit(Event.MessageInjected, {
    taskID: task.id,
    runID: run.id,
    text: message,
    summary: "Operator message injected into running session",
  }, { taskID: task.id, runID: run.id, source: "service.inject" })
  return true
}

async function appendTaskSessionMessage(task: TaskRow, text: string) {
  if (!task.session_id) return
  const ctx = await messageContext(task.session_id)
  if (!ctx) return
  const msg = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: task.session_id,
    time: {
      created: Date.now(),
    },
    agent: ctx.agent,
    model: ctx.model,
  } satisfies Message.User)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID: task.session_id,
    type: "text",
    text,
    kind: "user_content",
  } satisfies Message.TextPart)
  await Session.touch(task.session_id)
}

async function messageContext(sessionID: string) {
  const rows = await Session.messages({ sessionID, limit: 20 }).catch(() => [])
  const user = rows.findLast((item) => item.info.role === "user")
  if (user?.info.role === "user") {
    return {
      agent: user.info.agent,
      model: user.info.model,
    }
  }
  const assistant = rows.findLast((item) => item.info.role === "assistant")
  if (assistant?.info.role === "assistant") {
    return {
      agent: assistant.info.agent,
      model: {
        providerID: assistant.info.providerID,
        modelID: assistant.info.modelID,
      },
    }
  }
  const name = await Agent.defaultAgent().catch(() => undefined)
  const agent = name ? await Agent.get(name).catch(() => undefined) : undefined
  const model = agent?.model ?? await Provider.defaultModel().catch(() => undefined)
  if (!agent || !model) return
  return {
    agent: agent.name,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
  }
}

async function prepareProject(project?: string) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  // Create .gitignore before executor starts so the agent's own commits never include node_modules/dist etc.
  await ensureGitignore()
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
    running_tasks: rows.filter((row) => row.status === "active").length,
    blocked_tasks: 0,
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

async function taskChecks(checks?: z.input<typeof CheckConfig>) {
  const found = await discoverChecks()
  const next = structuredClone(
    resolvedChecks(await resolveConfig(checks ? { checks } : undefined), found),
  )

  if (found.lint.length > 0 && next.lint === false) {
    next.lint = found.lint.map((item) => item.command)
  }

  const current = next.named?.typecheck
  const typecheck = found.named.typecheck
  if (current || typecheck) {
    next.named = {
      ...(next.named ?? {}),
      typecheck: {
        label: current?.label ?? typecheck?.label ?? "Type Check",
        family: current?.family ?? typecheck?.family ?? "lint",
        commands: current?.commands ?? typecheck?.commands.map((item) => item.command) ?? [],
        enabled: true,
        ...(current?.cwd ? { cwd: current.cwd } : {}),
      },
    }
  }

  next.spec_check = {
    ...(next.spec_check ?? {}),
    enabled: true,
    mode: next.spec_check?.mode ?? "strict",
  }

  return CheckConfig.parse(next)
}

export namespace OrchestratorService {
  export function init() {
    const current = orchestratorState()
    if (!current.booted) {
      OrchestratorInteraction.subscribe(hooks())
      AutoReply.subscribe()
      current.booted = true
    }
    // Monitor active runs (executor status) — no pipeline advancement.
    // Pipeline advancement is now driven by the Task Agent.
    Scheduler.register({
      id: "orchestrator.poll",
      interval: ORCHESTRATOR_POLL_INTERVAL_MS,
      scope: "instance",
      run: () => OrchestratorRuntime.monitorRuns(hooks()),
    })
    // Serial queue recovery: if the process was restarted while a task was
    // running, the "active" task may be stuck (its loop is gone). Find it,
    // reset it to "queued", then kick off the queue from the front.
    // We do this after a short delay to allow other init code to finish.
    // Note: extracted into a named async function because Bun does not support
    // await inside setTimeout(async () => {...}) in bundled output.
    async function recoverSerialQueue() {
      const projectID = Instance.project.id
      // Reset "active" tasks that have no running loop (orphaned by restart).
      // CRITICAL: check isTaskLoopActive() — tasks with an active loop are NOT orphaned.
      const { isTaskLoopActive } = await import("@/orchestrator/task-loop")
      const orphaned = searchProjectTasks(projectID, { status: "active" })
      for (const task of orphaned) {
        if (isTaskLoopActive(task.id)) continue
        log.warn("serial queue recovery: resetting orphaned active task to queued", { taskID: task.id })
        const { updateTask: ut } = await import("@/orchestrator/state")
        await ut(task, { status: "queued", error: null, blocking_reason: null }, "Requeued after process restart")
      }
      // Start the queue if there's anything waiting
      if (!hasActiveTaskInProject(projectID)) {
        const next = findNextQueuedTaskForProject(projectID)
        if (next) {
          log.info("serial queue recovery: starting queued task", { taskID: next.id })
          import("@/orchestrator/task-loop").then(async ({ runTaskLoop }) => {
            const { hooks: h } = await import("@/orchestrator/state")
            runTaskLoop({ taskID: next.id, trigger: { kind: "restart-recovery" }, hooks: h() }).catch((err) => {
              log.error("serial queue recovery: task loop failed", { taskID: next.id, error: err instanceof Error ? err.message : String(err) })
            })
          })
        }
      }
    }
    setTimeout(() => {
      recoverSerialQueue().catch((err) => {
        log.error("serial queue recovery failed", { error: err instanceof Error ? err.message : String(err) })
      })
    }, 500)
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
    const resolvedChecks = await taskChecks(input.checks)
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.routing ? { routing: input.routing } : {}),
      ...(Object.keys(resolvedChecks).length > 0 ? { checks: resolvedChecks } : {}),
    }
    await Session.setPermission({
      sessionID: session.id,
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "skill", pattern: "*", action: "ask" },
        { permission: "external_directory", pattern: "*", action: "ask" },
        { permission: "webfetch", pattern: "*", action: "ask" },
        { permission: "websearch", pattern: "*", action: (metadata as any)?.web_search === true ? "allow" : "ask" },
        { permission: "task", pattern: "*", action: "ask" },
        { permission: "schedule", pattern: "*", action: "ask" },
      ],
    })
    // Async pipeline: persist task immediately, run stages in background
    try {
      persistQueuedTask({
        taskID, sessionID: session.id, now, executor, title,
        request: input.request, attachments: input.attachments,
        requestID, source: input.source,
        priority: input.priority, budget: input.budget, metadata,
        channelBinding: input.channelBinding, milestones: input.milestones,
        goals: input.goals, routing: input.routing,
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
      taskID, content: input.request,
      source: input.source ?? "api", userID: slackUser(metadata),
    })
    // Serial queue: only start the loop immediately if no other task is active.
    // If a task is already running, this task stays in "queued" state and will
    // be picked up by the serial queue trigger when the active task finishes.
    if (!hasActiveTaskInProject(Instance.project.id)) {
      import("@/orchestrator/task-loop").then(async ({ runTaskLoop }) => {
        const { hooks } = await import("@/orchestrator/state")
        runTaskLoop({
          taskID,
          trigger: { kind: "created" },
          hooks: hooks(),
        }).catch((err) => {
          log.error("task loop failed", { taskID, error: err instanceof Error ? err.message : String(err) })
        })
      })
    } else {
      log.info("task queued (serial): another task is active", { taskID, projectID: Instance.project.id })
    }
    return taskID
  }

  export async function getTask(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    return viewTask(task, { directory: item?.directory })
  }

  export async function getProgress(taskID: string) {
    // Do NOT call syncTask here — it triggers synchronous evaluation inside the GET request,
    // which blocks for minutes and causes request timeouts. The poll loop drives state advancement.
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
    const run = task.active_run_id ? findRun(task.active_run_id) : undefined
    const delivery = run ? findDeliveryByRun(run.id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const milestones = plan ? listMilestonesByPlan(plan.id) : listMilestones(taskID)
    return {
      task: viewTask(task, { directory: item?.directory }),
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

  export async function listRuns(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTask(taskID)
    return findRuns(taskID).map(viewRun)
  }

  export async function getRun(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    return viewRun(requireRun(runID))
  }

  export async function getBrief(input: { taskID: string; runID?: string }) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTask(input.taskID)
    return WorkbenchService.compileBrief({
      taskID: task.id,
      runID: input.runID ?? task.active_run_id ?? undefined,
      planVersionID: task.active_plan_version_id ?? undefined,
      sessionID: task.session_id ?? undefined,
    })
  }

  export async function getBoard(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
    return WorkbenchService.compileBoard({ taskID })
  }

  export async function getBoardTag(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
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
    // Read-only — poll loop handles state advancement asynchronously.
    // Prefer task-level delivery (goal_run_id IS NULL); fall back to any delivery for this run
    // so that goal-run deliveries (shown in the board) are also previewable.
    const delivery = findDeliveryByRun(runID) ?? findLatestDeliveryForRun(runID)
    if (!delivery) throw new NotFoundError({ message: `Delivery not found for run ${runID}` })
    return viewDelivery(delivery)
  }

  export async function listArtifacts(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    return findArtifacts(runID).map(viewArtifact)
  }

  export async function listEvaluations(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    return findEvaluations(runID).map(viewEvaluation)
  }

  export async function getExecutorSession(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    const row = findExecutorSessionByRun(runID)
    if (!row) throw new NotFoundError({ message: `Executor session not found for run ${runID}` })
    return viewExecutorSession(row)
  }

  export async function listProtocolEvents(taskID: string) {
    // Read-only — protocol_event is the persisted task event source.
    requireTask(taskID)
    return ProtocolStore.listTaskEvents(taskID)
  }

  export async function listTaskInteractions(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
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
    const { checks, selection } = UpdateTaskChecksInput.parse(raw)
    if (selection && Object.keys(selection).length > 0) {
      return selectTaskChecks(taskID, selection)
    }
    return writeTaskChecks(requireTask(taskID), checks)
  }

  export async function updateGoal(goalID: string, input: z.input<typeof UpdateGoalInput>) {
    const body = UpdateGoalInput.parse(input)
    const row = Database.use((db) =>
      db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
    GoalService.updateGoal({
      goalID,
      title: body.description,
      done_definition: body.criteria,
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

  export async function deleteTask(taskID: string) {
    const task = requireTask(taskID)
    // Cancel if still active
    if (!["completed", "failed", "cancelled"].includes(task.status)) {
      await cancelTask(taskID)
    }
    // Wait for any in-progress pipeline stage to settle after abort
    await awaitPipelineSettled(taskID)
    // Delete session tree (CASCADE handles plans, goals, runs, etc.)
    if (task.session_id) {
      await Session.remove(task.session_id)
    }
    // Delete the task row itself (CASCADE handles plans, goals, runs, artifacts, etc.)
    Database.use((db) =>
      db.delete(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).run(),
    )
    return true
  }

  export async function updateTaskBudget(taskID: string, budget: z.input<typeof Budget> | null) {
    const task = requireTask(taskID)
    const parsed = budget ? budgetRow(budget) : null
    Database.use((db) =>
      db
        .update(OrchestratorTaskTable)
        .set({ budget: parsed })
        .where(eq(OrchestratorTaskTable.id, taskID))
        .run(),
    )
    await Bus.publish(Event.TaskUpdated, {
      taskID,
      status: task.status,
      summary: "Task budget updated",
    })
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
      // Legacy planner clarifications are no longer supported — the Task Agent
      // handles all planning decisions directly.
      if (row.payload?.planner_clarification === true) {
        throw new Error("Planner clarifications are no longer supported in the new architecture")
      }
      await Question.reply({
        requestID: row.external_id,
        answers,
      })
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
    if (row.request_type === "permission") {
      await PermissionNext.reply({
        requestID: row.external_id,
        reply: "reject",
        message: input.message,
      })
    }
    if (row.request_type === "question") {
      if (row.payload?.planner_clarification === true) {
        throw new Error("Planner clarifications are no longer supported in the new architecture")
      }
      await Question.reject(row.external_id)
    }
    await OrchestratorRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteraction(interactionID))
  }

  export async function cancelTask(taskID: string) {
    const task = requireTask(taskID)
    // Abort Task Agent and any in-progress pipeline stage
    TaskAgent.abort(taskID)
    abortTaskPipeline(taskID)
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
    if (["queued", "active"].includes(task.status)) {
      throw new Error(`task ${taskID} is already active`)
    }
    // Reset to queued and start the task loop
    await updateTask(task, { status: "queued", error: null, blocking_reason: null }, "Retry requested by operator")
    import("@/orchestrator/task-loop").then(async ({ runTaskLoop }) => {
      const { hooks } = await import("@/orchestrator/state")
      runTaskLoop({
        taskID,
        trigger: { kind: "retry" },
        hooks: hooks(),
      }).catch((err) => {
        log.error("task loop failed on retry", { taskID, error: err instanceof Error ? err.message : String(err) })
      })
    })
    return viewTask(requireTask(taskID))
  }

  /** @deprecated Replan is no longer supported. Use retryTask instead. */
  export async function replanTask(taskID: string) {
    return retryTask(taskID)
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
    if (["completed", "cancelled"].includes(task.status)) {
      return { resumed: false, status: task.status }
    }
    if (["accepted", "running"].includes(run.status)) {
      return { resumed: false, status: run.status }
    }
    const nextRunID = await OrchestratorRuntime.createOperatorRun(task, run, note)
    // Start task loop — it handles dispatch via GoalPool
    import("@/orchestrator/task-loop").then(({ runTaskLoop }) => {
      runTaskLoop({
        taskID: task.id,
        trigger: { kind: "retry", runID: nextRunID },
        hooks: hooks(),
      }).catch(() => {})
    })
    return { resumed: true, status: "active" as const }
  }

  export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInput>) {
    const input = TaskMessageInput.parse(raw)

    // Fast-path: cancelled/failed tasks skip LLM intent classification.
    // Any message to a stopped task is an unambiguous restart signal.
    const task = requireTask(taskID)
    if (task.status === "cancelled" || task.status === "failed") {
      await OrchestratorProtocol.emit(Event.TaskMessageRecorded, {
        taskID,
        kind: "note",
        source: input.source ?? "user_message",
        text: input.text,
        summary: "User message on stopped task",
      }, { taskID, source: "service.message" })
      const note = await continueTaskMessage(taskID, input.text)
      return {
        kind: "note" as const,
        message: note.resumed
          ? "Task restarted with your message."
          : "Message recorded.",
        should_resume: note.resumed,
      }
    }

    const result = await WorkbenchService.ingestTaskMessage({
      taskID,
      text: input.text,
      source: input.source ?? "user_message",
      userID: input.user_id,
    })
    await OrchestratorProtocol.emit(Event.TaskMessageRecorded, {
      taskID,
      kind: result.kind,
      source: input.source ?? "user_message",
      text: input.text,
      summary: result.message,
    }, { taskID, source: "service.message" })
    if (!result.should_resume) {
      return result
    }
    const note = await continueTaskMessage(taskID, input.text)
    return {
      ...result,
      message: result.kind === "note"
        ? note.mode === "injected"
          ? "Operator message injected into the running task."
          : note.resumed
            ? "Operator note recorded. Queued a follow-up run."
            : "Operator note recorded."
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
    const resumed = await injectRunningTaskMessage(task, run, message)
    if (resumed) return { resumed: true, status: "active" as const }
    await appendTaskSessionMessage(task, message)
    return recordOperatorNote(taskID, message)
  }

  export async function abortRun(runID: string) {
    const run = requireRun(runID)
    await ExecutorRegistry.require(run.executor).abort({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
    })
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

  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: input.reply === "always" ? "acceptForSession" : "accept",
      },
    })
    markProtocolInteraction(row, "answered", {
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
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    response: {
      answers: response,
    },
  })
  markProtocolInteraction(row, "answered", {
    answers: response,
    message: input.message,
  }, now)
}

async function rejectProtocolInteraction(row: InteractionRow, message?: string) {
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()
  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: "decline",
      },
    })
    markProtocolInteraction(row, "rejected", { message }, now)
    return
  }
  await executor.resolve({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    error: {
      code: -32000,
      message: message?.trim() || "Rejected by operator",
    },
  })
  markProtocolInteraction(row, "rejected", { message }, now)
}

function markProtocolInteraction(
  row: InteractionRow,
  status: OrchestratorInteractionStatus,
  response: Record<string, unknown>,
  now: number,
) {
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.InteractionResolved, {
        taskID: row.task_id,
        runID: row.run_id,
        interactionID: row.id,
        status,
        summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
      }, { taskID: row.task_id, runID: row.run_id, interactionID: row.id, source: "service.interaction" }),
    )
  })
}

async function sessionTree(sessionID: string): Promise<string[]> {
  const children = await Session.children(sessionID)
  const nested = await Promise.all(children.map((item) => sessionTree(item.id)))
  return [sessionID, ...nested.flat()]
}
