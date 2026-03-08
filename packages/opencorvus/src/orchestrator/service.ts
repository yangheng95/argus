import z from "zod"
import { Bus } from "@/bus"
import { EvaluatorService } from "@/evaluator/service"
import { ExecutorNotConfiguredError } from "@/executor/compat"
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
    ExecutorRegistry.require(executor)
    const planDraft = await PlannerService.initial({
      title,
      request: input.request,
      goals: input.goals,
    })
    const session = await Session.create({ title })
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const planID = Identifier.ascending("plan")
    const runID = Identifier.ascending("run")
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.checks ? { checks: input.checks } : {}),
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
        const milestones = input.milestones ?? []
        let goalIndex = 0
        for (const [msIndex, ms] of milestones.entries()) {
          const msID = Identifier.ascending("milestone")
          db.insert(OrchestratorMilestoneTable)
            .values({
              id: msID,
              task_id: taskID,
              plan_version_id: planID,
              title: ms.title,
              description: ms.description ?? "",
              status: "pending",
              order_index: msIndex,
              time_created: now,
              time_updated: now,
            })
            .run()
          for (const goal of ms.goals) {
            db.insert(OrchestratorGoalTable)
              .values({
                id: Identifier.ascending("goal"),
                task_id: taskID,
                plan_version_id: planID,
                milestone_id: msID,
                description: goal.description,
                criteria: goal.criteria,
                metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
                priority: goal.priority ?? "blocking",
                status: "pending",
                order_index: goalIndex++,
                time_created: now,
                time_updated: now,
              })
              .run()
          }
        }
        // Create milestones from agent output if available
        const agentMilestones = (planDraft.metadata as Record<string, unknown>).milestones as
          | Array<{ title: string; description?: string; goal_indices: number[] }>
          | undefined
        const goalToMilestoneID = new Map<number, string>()
        if (agentMilestones && agentMilestones.length > 0 && milestones.length === 0) {
          for (const [msIdx, ms] of agentMilestones.entries()) {
            const msID = Identifier.ascending("milestone")
            db.insert(OrchestratorMilestoneTable)
              .values({
                id: msID,
                task_id: taskID,
                plan_version_id: planID,
                title: ms.title,
                description: ms.description ?? "",
                status: "pending",
                order_index: msIdx,
                time_created: now,
                time_updated: now,
              })
              .run()
            for (const goalIdx of ms.goal_indices) {
              goalToMilestoneID.set(goalIdx, msID)
            }
          }
        }

        for (const [index, goal] of planDraft.goals.entries()) {
          db.insert(OrchestratorGoalTable)
            .values({
              id: Identifier.ascending("goal"),
              task_id: taskID,
              plan_version_id: planID,
              milestone_id: goalToMilestoneID.get(index) ?? null,
              description: goal.description,
              criteria: goal.criteria,
              metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
              priority: goal.priority ?? "blocking",
              status: "pending",
              order_index: milestones.length > 0 ? goalIndex + index : index,
              time_created: now,
              time_updated: now,
            })
            .run()
        }
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

  export async function getProjectBoard(limit = 50) {
    const project = Project.get(Instance.project.id) ?? Instance.project
    const rows = listProjectTasks(Instance.project.id, limit)
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
      if (!input.answers) throw new Error("answers are required for question replies")
      await Question.reply({
        requestID: row.external_id,
        answers: input.answers,
      })
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
      await Question.reject(row.external_id)
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

function slackUser(metadata: Record<string, unknown>) {
  const slack = metadata.slack
  if (!slack || typeof slack !== "object") return undefined
  const user = (slack as Record<string, unknown>).user
  if (typeof user !== "string" || !user) return undefined
  return user
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
