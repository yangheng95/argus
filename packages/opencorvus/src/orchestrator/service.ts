import z from "zod"
import { Bus } from "@/bus"
import { EvaluatorService } from "@/evaluator/service"
import { ExecutorNotConfiguredError } from "@/executor/compat"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { PlannerService } from "@/planner/service"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Question } from "@/question"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
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
  UpdateGoalInput,
  UpdateTaskChecksInput,
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
import { OrchestratorInteraction } from "./interaction"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun, updateTask } from "./state"
import {
  activeRunBySession,
  findArtifacts,
  findDeliveryByRun,
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
  listProjectTasks,
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
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
  type GoalRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
  type InteractionRow,
} from "./store"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "orchestrator" })

export namespace OrchestratorService {
  export function init() {
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
    if (input.project && input.project !== Instance.project.id) {
      throw new Error(`project mismatch: expected ${Instance.project.id}, got ${input.project}`)
    }
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
    const planDraft = await PlannerService.initial({
      title,
      request: input.request,
      goals: input.goals,
    })
    const session = await Session.create({ title })
    // Orchestrator-dispatched tasks run headless — auto-approve all tool permissions
    await Session.setPermission({
      sessionID: session.id,
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const planID = Identifier.ascending("plan")
    const runID = Identifier.ascending("run")
    const interactionID = Identifier.ascending("interaction")
    const questionID = Identifier.ascending("question")
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.checks ? { checks: input.checks } : {}),
    }
    const clarification = plannerClarification(planDraft)

    if (clarification) {
      try {
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              active_run_id: runID,
              request_id: requestID,
              source: input.source ?? "api",
              title,
              request: input.request,
              status: "blocked",
              priority: input.priority ?? "normal",
              budget: budgetRow(input.budget),
              metadata: {
                ...metadata,
                planner_clarification: true,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              session_id: session.id,
              executor,
              status: "blocked",
              phase: "plan",
              retry_count: 0,
              blocking_reason: "clarification",
              metadata: {
                strategy: "clarification",
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              session_id: session.id,
              external_id: questionID,
              request_type: "question",
              status: "pending",
              title: clarification.questions[0]?.header || "Clarification required",
              body: clarification.questions
                .map((item) => [item.question, item.context].filter(Boolean).join("\n\n"))
                .join("\n\n"),
              payload: {
                planner_clarification: true,
                reason: clarification.reason,
                questions: clarification.questions,
                provisional_plan: {
                  summary: planDraft.summary,
                  goals: planDraft.goals,
                  metadata: planDraft.metadata,
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          if (input.channelBinding) {
            db.insert(OrchestratorChannelBindingTable)
              .values({
                id: Identifier.ascending("binding"),
                task_id: taskID,
                platform: input.channelBinding.platform,
                channel: input.channelBinding.channel,
                thread: input.channelBinding.thread,
                payload: input.channelBinding.payload ?? {},
                time_created: now,
                time_updated: now,
              })
              .run()
          }
          db.insert(OrchestratorProgressSnapshotTable)
            .values({
              id: Identifier.ascending("progress"),
              task_id: taskID,
              status: "blocked",
              summary: "Clarification requested before planning",
              payload: {
                sessionID: session.id,
                reason: clarification.reason,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          Database.effect(() => Bus.publish(Event.TaskCreated, { taskID, status: "blocked", summary: "Task created" }))
          Database.effect(() => Bus.publish(Event.RunCreated, { taskID, runID, status: "blocked", summary: "Planning is waiting on clarification" }))
          Database.effect(() =>
            Bus.publish(Event.InteractionRequested, {
              taskID,
              runID,
              interactionID,
              requestType: "question",
              summary: clarification.questions[0]?.header || "Clarification required",
            }),
          )
          Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID, status: "blocked", summary: "Clarification required before planning" }))
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
      return taskID
    }

    try {
      Database.transaction((db) => {
        db.insert(OrchestratorTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            active_plan_version_id: planID,
            active_run_id: runID,
            request_id: requestID,
            source: input.source ?? "api",
            title,
            request: input.request,
            status: "queued",
            priority: input.priority ?? "normal",
            budget: budgetRow(input.budget),
            metadata,
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(OrchestratorPlanVersionTable)
          .values({
            id: planID,
            task_id: taskID,
            version: 1,
            status: "active",
            summary: planDraft.summary,
            prompt: planDraft.prompt,
            metadata: {
              ...metadata,
              ...planDraft.metadata,
            },
            time_created: now,
            time_updated: now,
          })
          .run()
        insertPlanItems(db, {
          taskID,
          planID,
          planDraft,
          now,
          milestones: input.milestones ?? [],
        })
        db.insert(OrchestratorRunTable)
          .values({
            id: runID,
            task_id: taskID,
            plan_version_id: planID,
            session_id: session.id,
            executor,
            status: "queued",
            phase: "execute",
            retry_count: 0,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
        if (input.channelBinding) {
          db.insert(OrchestratorChannelBindingTable)
            .values({
              id: Identifier.ascending("binding"),
              task_id: taskID,
              platform: input.channelBinding.platform,
              channel: input.channelBinding.channel,
              thread: input.channelBinding.thread,
              payload: input.channelBinding.payload ?? {},
              time_created: now,
              time_updated: now,
            })
            .run()
        }
        db.insert(OrchestratorProgressSnapshotTable)
          .values({
            id: Identifier.ascending("progress"),
            task_id: taskID,
            status: "created",
            summary: "Task created",
            payload: { sessionID: session.id },
            time_created: now,
            time_updated: now,
          })
          .run()
        Database.effect(() => Bus.publish(Event.TaskCreated, { taskID, status: "queued", summary: "Task created" }))
        Database.effect(() => Bus.publish(Event.PlanCreated, { taskID, planID, summary: planDraft.summary }))
        Database.effect(() => Bus.publish(Event.PlanActivated, { taskID, planID, summary: "Initial plan activated" }))
        Database.effect(() => Bus.publish(Event.RunCreated, { taskID, runID, status: "queued", summary: "Run queued" }))
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

  export async function listRuns(taskID: string) {
    await OrchestratorRuntime.syncTask(taskID, hooks())
    requireTask(taskID)
    return findRuns(taskID).map(viewRun)
  }

  export async function getRun(runID: string) {
    await OrchestratorRuntime.syncRun(runID, hooks())
    return viewRun(requireRun(runID))
  }

  export async function getBrief(input: { taskID: string; runID?: string }) {
    if (input.runID) {
      await OrchestratorRuntime.syncRun(input.runID, hooks()).catch(() => undefined)
    } else {
      await OrchestratorRuntime.syncTask(input.taskID, hooks()).catch(() => undefined)
    }
    const task = requireTask(input.taskID)
    return WorkbenchService.compileBrief({
      taskID: task.id,
      runID: input.runID ?? task.active_run_id ?? undefined,
      planVersionID: task.active_plan_version_id ?? undefined,
      sessionID: task.session_id ?? undefined,
    })
  }

  export async function getBoard(taskID: string) {
    await OrchestratorRuntime.syncTask(taskID, hooks()).catch(() => undefined)
    return WorkbenchService.compileBoard({ taskID })
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

  export async function listTaskInteractions(taskID: string) {
    await OrchestratorRuntime.syncTask(taskID, hooks())
    requireTask(taskID)
    return listInteractions(taskID).map(viewInteraction)
  }

  export async function selectTaskChecks(
    taskID: string,
    selection: Partial<Record<"lint" | "build" | "test" | "code_quality" | "code_review" | "judge", boolean>>,
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
    Database.use((db) =>
      db
        .update(OrchestratorGoalTable)
        .set({
          description: body.description,
          criteria: body.criteria,
          metadata: inferGoalMetadata(body.description, body.criteria),
          time_updated: Date.now(),
        })
        .where(eq(OrchestratorGoalTable.id, goalID))
        .run(),
    )
    return true
  }

  export async function deleteGoal(goalID: string) {
    const row = Database.use((db) =>
      db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
    Database.use((db) =>
      db.delete(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).run(),
    )
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
    await OrchestratorRuntime.dispatch(nextRunID, hooks())
    return { resumed: true, status: "running" as const }
  }

  export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInput>) {
    const input = TaskMessageInput.parse(raw)
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
    const note = await OrchestratorService.recordOperatorNote(taskID, input.text)
    return {
      ...result,
      message: result.kind === "note" && note.resumed
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

    // 只有运行中的 run 才能注入
    if (!["accepted", "running"].includes(run.status)) {
      return recordOperatorNote(taskID, message)
    }
    if (!run.session_id) throw new Error(`Run ${run.id} has no session`)

    const executor = ExecutorRegistry.require(run.executor)
    if (!executor.capabilities().resume) {
      return recordOperatorNote(taskID, message)
    }

    const submission = await executor.resume({
      sessionID: run.session_id,
      message,
    })

    // 更新 executor ref（queueTaskID 可能变化）
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
    const task = requireTask(run.task_id)
    if (task.active_run_id === run.id) {
      await updateTask(task, { status: "failed", error: "run aborted", blocking_reason: null, time_completed: Date.now() }, "Run aborted")
    }
    return true
  }
}

export { ExecutorNotConfiguredError }

function writeTaskChecks(task: TaskRow, checks: Record<string, unknown> | undefined) {
  const metadata = {
    ...(task.metadata ?? {}),
    ...(checks ? { checks } : {}),
  }
  if (!checks) delete metadata.checks
  Database.use((db) =>
    db
      .update(OrchestratorTaskTable)
      .set({
        metadata,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run(),
  )
  return viewTask(requireTask(task.id))
}

function mergeTaskChecks(
  raw: unknown,
  selection: Partial<Record<"lint" | "build" | "test" | "code_quality" | "code_review" | "judge", boolean>>,
) {
  const checks =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? structuredClone(raw as Record<string, unknown>)
      : {}

  for (const key of ["lint", "build", "test"] as const) {
    if (selection[key] === true) {
      if (checks[key] === false) delete checks[key]
      continue
    }
    if (selection[key] === false) checks[key] = false
  }

  // The panel only edits enablement for review-style checks; preserve existing detail.
  for (const key of ["code_quality", "code_review", "judge"] as const) {
    if (selection[key] === true) {
      const current = checks[key]
      checks[key] =
        current && typeof current === "object" && !Array.isArray(current)
          ? { ...current, enabled: true }
          : { enabled: true }
      continue
    }
    if (selection[key] === false) delete checks[key]
  }

  return Object.keys(checks).length > 0 ? checks : undefined
}

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

function plannerClarification(planDraft: {
  metadata?: Record<string, unknown>
}) {
  const clarification = planDraft.metadata?.clarification
  if (!clarification || typeof clarification !== "object") return
  const meta = clarification as Record<string, unknown>
  const reason = typeof meta.reason === "string" ? meta.reason : "Clarification required before planning."
  const raw = meta.questions
  const questions = Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        if (typeof row.question !== "string" || !row.question.trim()) return []
        return [{
          header: typeof row.header === "string" && row.header.trim() ? row.header : "Clarification",
          question: row.question,
          context: typeof row.context === "string" && row.context.trim() ? row.context : undefined,
          default_assumption:
            typeof row.default_assumption === "string" && row.default_assumption.trim()
              ? row.default_assumption
              : undefined,
        }]
      })
    : []
  if (questions.length === 0) return
  return {
    reason,
    questions: [questions[0]!],
  }
}

function insertPlanItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    planID: string
    planDraft: {
      goals: Array<{
        description: string
        criteria: string
        priority?: "blocking" | "advisory"
        metadata?: Record<string, unknown>
      }>
      metadata?: Record<string, unknown>
    }
    now: number
    milestones: Array<{
      title: string
      description?: string
      goals: Array<{
        description: string
        criteria: string
        priority?: "blocking" | "advisory"
        metadata?: Record<string, unknown>
      }>
    }>
  },
) {
  const milestones = input.milestones
  let goalIndex = 0
  for (const [msIndex, ms] of milestones.entries()) {
    const msID = Identifier.ascending("milestone")
    db.insert(OrchestratorMilestoneTable)
      .values({
        id: msID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        title: ms.title,
        description: ms.description ?? "",
        status: "pending",
        order_index: msIndex,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    for (const goal of ms.goals) {
      db.insert(OrchestratorGoalTable)
        .values({
          id: Identifier.ascending("goal"),
          task_id: input.taskID,
          plan_version_id: input.planID,
          milestone_id: msID,
          description: goal.description,
          criteria: goal.criteria,
          metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
          priority: goal.priority ?? "blocking",
          status: "pending",
          order_index: goalIndex++,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
  }
  const agentMilestones = input.planDraft.metadata?.milestones as
    | Array<{ title: string; description?: string; goal_indices: number[] }>
    | undefined
  const goalToMilestoneID = new Map<number, string>()
  if (agentMilestones && agentMilestones.length > 0 && milestones.length === 0) {
    for (const [msIdx, ms] of agentMilestones.entries()) {
      const msID = Identifier.ascending("milestone")
      db.insert(OrchestratorMilestoneTable)
        .values({
          id: msID,
          task_id: input.taskID,
          plan_version_id: input.planID,
          title: ms.title,
          description: ms.description ?? "",
          status: "pending",
          order_index: msIdx,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
      for (const goalIdx of ms.goal_indices) {
        goalToMilestoneID.set(goalIdx, msID)
      }
    }
  }

  for (const [index, goal] of input.planDraft.goals.entries()) {
    db.insert(OrchestratorGoalTable)
      .values({
        id: Identifier.ascending("goal"),
        task_id: input.taskID,
        plan_version_id: input.planID,
        milestone_id: goalToMilestoneID.get(index) ?? null,
        description: goal.description,
        criteria: goal.criteria,
        metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
        priority: goal.priority ?? "blocking",
        status: "pending",
        order_index: milestones.length > 0 ? goalIndex + index : index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}

function answersFromMessage(message?: string) {
  const text = message?.trim()
  if (!text) return
  return [[text]]
}

function isPlannerClarification(row: InteractionRow) {
  return row.payload?.planner_clarification === true
}

async function answerPlannerClarification(row: InteractionRow, answers: string[][]) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const clarifiedRequest = appendClarification(task.request, row.payload?.questions, answers)
  const planDraft = await PlannerService.initial({
    title: task.title,
    request: clarifiedRequest,
    allowClarification: false,
  })
  const planID = Identifier.ascending("plan")
  const now = Date.now()
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
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: planID,
        task_id: task.id,
        version: 1,
        status: "active",
        summary: planDraft.summary,
        prompt: planDraft.prompt,
        metadata: {
          ...(task.metadata ?? {}),
          ...planDraft.metadata,
          clarified_request: clarifiedRequest,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    insertPlanItems(db, {
      taskID: task.id,
      planID,
      planDraft,
      now,
      milestones: [],
    })
    db.update(OrchestratorRunTable)
      .set({
        plan_version_id: planID,
        status: "queued",
        phase: "execute",
        blocking_reason: null,
        metadata: {
          ...(run.metadata ?? {}),
          strategy: "clarification_resolved",
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
        status: "queued",
        blocking_reason: null,
        error: null,
        metadata: {
          ...(task.metadata ?? {}),
          clarified_request: clarifiedRequest,
        },
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: "Clarification answered; planning resumed",
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
    Database.effect(() => Bus.publish(Event.PlanActivated, { taskID: task.id, planID, summary: "Plan activated after clarification" }))
    Database.effect(() => Bus.publish(Event.RunUpdated, { taskID: task.id, runID: run.id, status: "queued", summary: "Run queued after clarification" }))
    Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID: task.id, status: "queued", summary: "Clarification resolved; task queued" }))
  })
  await OrchestratorRuntime.dispatch(run.id, hooks())
}

async function rejectPlannerClarification(row: InteractionRow, message?: string) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const now = Date.now()
  const error = message?.trim() || "Planning clarification was rejected"
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "rejected",
        response: message?.trim() ? { message: message.trim() } : {},
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    db.update(OrchestratorRunTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, run.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "failed",
        summary: "Clarification rejected; task stopped",
        payload: {
          message: message?.trim() || undefined,
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
        status: "rejected",
        summary: "Clarification rejected",
      }),
    )
    Database.effect(() => Bus.publish(Event.RunUpdated, { taskID: task.id, runID: run.id, status: "failed", summary: error }))
    Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID: task.id, status: "failed", summary: error }))
  })
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

function inferGoalMetadata(description: string, criteria: string) {
  const text = `${description} ${criteria}`.toLowerCase()
  const selectors = new Set<string>()
  if (text.includes("build")) selectors.add("build")
  if (text.includes("test")) selectors.add("test")
  if (text.includes("lint")) selectors.add("lint")
  if (text.includes("verify")) selectors.add("verify_cmd")
  if (/(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(text)) selectors.add("ui_review")
  if (/(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(text)) selectors.add("code_quality")
  if (/\bcr\b|code review|审查|代码评审|review finding|review comment/.test(text)) selectors.add("code_review")
  if (/(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(text)) selectors.add("dead_code_review")
  if (/(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(text)) selectors.add("startup")
  if (selectors.size === 0) return undefined
  return {
    check_selector: [...selectors],
  }
}
