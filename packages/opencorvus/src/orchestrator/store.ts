import { Instance } from "@/project/instance"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, NotFoundError, and, desc, eq, inArray, isNull, like, lt } from "@/storage/db"
import type { SQL } from "@/storage/db"
import { Snapshot } from "@/snapshot"
import { EvaluationCheck } from "./model"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorExecutorEventTable,
  OrchestratorExecutorSessionTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorGoalRunTable,
  OrchestratorGoalSnapshotTable,
  OrchestratorInteractionRequestTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanNodeTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRequirementTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorBudget,
  type OrchestratorExecutorRef,
  type OrchestratorGoalCheck,
} from "./orchestrator.sql"

export type TaskRow = typeof OrchestratorTaskTable.$inferSelect
export type PlanRow = typeof OrchestratorPlanVersionTable.$inferSelect
export type GoalRow = typeof OrchestratorGoalTable.$inferSelect
export type MilestoneRow = typeof OrchestratorMilestoneTable.$inferSelect
export type RunRow = typeof OrchestratorRunTable.$inferSelect
export type InteractionRow = typeof OrchestratorInteractionRequestTable.$inferSelect
export type DeliveryRow = typeof OrchestratorDeliveryTable.$inferSelect
export type ArtifactRow = typeof OrchestratorArtifactTable.$inferSelect
export type EvaluationRow = typeof OrchestratorEvaluationTable.$inferSelect
export type ProgressRow = typeof OrchestratorProgressSnapshotTable.$inferSelect
export type ExecutorSessionRow = typeof OrchestratorExecutorSessionTable.$inferSelect
export type RequirementRow = typeof OrchestratorRequirementTable.$inferSelect
export type GoalSnapshotRow = typeof OrchestratorGoalSnapshotTable.$inferSelect
export type GoalRunRow = typeof OrchestratorGoalRunTable.$inferSelect
export type PlanNodeRow = typeof OrchestratorPlanNodeTable.$inferSelect
export type ExecutorEventRow = typeof OrchestratorExecutorEventTable.$inferSelect
export type SpecSnapshotRow = typeof OrchestratorSpecSnapshotTable.$inferSelect
export type SpecItemRow = typeof OrchestratorSpecItemTable.$inferSelect
export type TaskProjectRow = {
  id: string
  name?: string
  worktree: string
}
export type TaskListRow = {
  task: TaskRow
  directory: string
  project: TaskProjectRow | null
}

export function requireTask(taskID: string) {
  const row = findTask(taskID)
  if (!row) throw new NotFoundError({ message: `Task not found: ${taskID}` })
  return row
}

export function requireRun(runID: string) {
  const row = findRun(runID)
  if (!row) throw new NotFoundError({ message: `Run not found: ${runID}` })
  return row
}

export function requireInteraction(interactionID: string) {
  const row = findInteraction(interactionID)
  if (!row) throw new NotFoundError({ message: `Interaction not found: ${interactionID}` })
  return row
}

export function findTask(taskID: string) {
  return Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())
}

export function findTaskByRequest(projectID: string, requestID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorTaskTable)
      .where(and(eq(OrchestratorTaskTable.project_id, projectID), eq(OrchestratorTaskTable.request_id, requestID)))
      .get(),
  )
}

export function findPlan(planID: string) {
  return Database.use((db) =>
    db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, planID)).get(),
  )
}

export function findPlans(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorPlanVersionTable)
      .where(eq(OrchestratorPlanVersionTable.task_id, taskID))
      .orderBy(OrchestratorPlanVersionTable.version)
      .all(),
  )
}

// ---------------------------------------------------------------------------
// Spec store functions
// ---------------------------------------------------------------------------

export function findSpecSnapshot(specID: string) {
  return Database.use((db) =>
    db.select().from(OrchestratorSpecSnapshotTable).where(eq(OrchestratorSpecSnapshotTable.id, specID)).get(),
  )
}

export function findSpecSnapshots(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorSpecSnapshotTable)
      .where(eq(OrchestratorSpecSnapshotTable.task_id, taskID))
      .orderBy(desc(OrchestratorSpecSnapshotTable.version))
      .all(),
  )
}

export function findSpecItems(specSnapshotID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorSpecItemTable)
      .where(eq(OrchestratorSpecItemTable.spec_snapshot_id, specSnapshotID))
      .all(),
  )
}

export function findSpecItemsByTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorSpecItemTable)
      .where(eq(OrchestratorSpecItemTable.task_id, taskID))
      .all(),
  )
}

export function viewSpecSnapshot(row: SpecSnapshotRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    version: row.version,
    status: row.status,
    summary: row.summary,
    content: row.content,
    scope: row.scope,
    outOfScope: row.out_of_scope ?? undefined,
    evidence: row.evidence ?? undefined,
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewSpecItem(row: SpecItemRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    specSnapshotID: row.spec_snapshot_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    checkSelector: row.check_selector ?? undefined,
    evidence: row.evidence ?? undefined,
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

// ---------------------------------------------------------------------------

export function findRun(runID: string) {
  return Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, runID)).get())
}

export function findInteraction(interactionID: string) {
  return Database.use((db) =>
    db.select().from(OrchestratorInteractionRequestTable).where(eq(OrchestratorInteractionRequestTable.id, interactionID)).get(),
  )
}

export function findInteractionByExternal(externalID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorInteractionRequestTable)
      .where(eq(OrchestratorInteractionRequestTable.external_id, externalID))
      .orderBy(desc(OrchestratorInteractionRequestTable.time_created))
      .get(),
  )
}

export function findDeliveryByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorDeliveryTable)
      .where(and(
        eq(OrchestratorDeliveryTable.run_id, runID),
        isNull(OrchestratorDeliveryTable.goal_run_id),
      ))
      .orderBy(desc(OrchestratorDeliveryTable.time_created))
      .get(),
  )
}

export function findDeliveryByGoalRun(goalRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorDeliveryTable)
      .where(eq(OrchestratorDeliveryTable.goal_run_id, goalRunID))
      .orderBy(desc(OrchestratorDeliveryTable.time_created))
      .get(),
  )
}

export function listGoalRunsByTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.task_id, taskID))
      .orderBy(desc(OrchestratorGoalRunTable.time_created))
      .all(),
  )
}

export function findEvaluationByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.run_id, runID))
      .orderBy(desc(OrchestratorEvaluationTable.time_created))
      .get(),
  )
}

export function findExecutorSessionByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
      .get(),
  )
}

export function findExecutorSession(executorSessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.id, executorSessionID))
      .get(),
  )
}

export function findGoalRun(goalRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.id, goalRunID))
      .get(),
  )
}

export function goalRunQueueTaskID(goalRun?: GoalRunRow) {
  if (!goalRun) return undefined
  const ref = goalRun.metadata as Record<string, unknown> | null
  const queueTaskID = typeof ref?.queue_task_id === "string" ? ref.queue_task_id : undefined
  return queueTaskID
}

export function listActiveGoalRunsByCoordinator(coordinatorRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(
        and(
          eq(OrchestratorGoalRunTable.coordinator_run_id, coordinatorRunID),
          inArray(OrchestratorGoalRunTable.status, ["queued", "accepted", "running", "blocked"]),
        ),
      )
      .all(),
  )
}

export function listGoalRunsByCoordinator(coordinatorRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.coordinator_run_id, coordinatorRunID))
      .orderBy(OrchestratorGoalRunTable.time_created)
      .all(),
  )
}

export function listExecutorEvents(executorSessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorEventTable)
      .where(eq(OrchestratorExecutorEventTable.executor_session_id, executorSessionID))
      .orderBy(OrchestratorExecutorEventTable.sequence)
      .all(),
  )
}

export function listGoals(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalTable)
      .where(eq(OrchestratorGoalTable.task_id, taskID))
      .orderBy(OrchestratorGoalTable.order_index)
      .all(),
  )
}

export function listGoalsByPlan(planID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalTable)
      .where(eq(OrchestratorGoalTable.plan_version_id, planID))
      .orderBy(OrchestratorGoalTable.order_index)
      .all(),
  )
}

export function listMilestonesByPlan(planID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorMilestoneTable)
      .where(eq(OrchestratorMilestoneTable.plan_version_id, planID))
      .orderBy(OrchestratorMilestoneTable.order_index)
      .all(),
  )
}

export function listGoalsForPlan(plan: Pick<PlanRow, "id">) {
  return listGoalsByPlan(plan.id)
}

export function listPlanNodesByPlan(planID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorPlanNodeTable)
      .where(eq(OrchestratorPlanNodeTable.plan_version_id, planID))
      .orderBy(OrchestratorPlanNodeTable.order_index)
      .all(),
  )
}

export function findGoalSnapshot(goalSnapshotID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalSnapshotTable)
      .where(eq(OrchestratorGoalSnapshotTable.id, goalSnapshotID))
      .get(),
  )
}

export function goalSnapshotIDOfPlan(plan: PlanRow) {
  const metadata = plan.metadata as Record<string, unknown> | null
  return typeof metadata?.goal_snapshot_id === "string" ? metadata.goal_snapshot_id : undefined
}

export function findRequirements(specSnapshotID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorRequirementTable)
      .where(eq(OrchestratorRequirementTable.spec_snapshot_id, specSnapshotID))
      .orderBy(OrchestratorRequirementTable.order_index)
      .all(),
  )
}

export function listMilestones(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorMilestoneTable)
      .where(eq(OrchestratorMilestoneTable.task_id, taskID))
      .orderBy(OrchestratorMilestoneTable.order_index)
      .all(),
  )
}

export function findRuns(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorRunTable)
      .where(eq(OrchestratorRunTable.task_id, taskID))
      .orderBy(desc(OrchestratorRunTable.time_created))
      .all(),
  )
}

function taskRows(rows: TaskRow[]) {
  const sessionIDs = [...new Set(rows.map((row) => row.session_id).filter((item): item is string => !!item))]
  const projectIDs = [...new Set(rows.map((row) => row.project_id))]
  const sessions = new Map<string, string>()
  const projects = new Map<string, TaskProjectRow>()

  if (sessionIDs.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: SessionTable.id, directory: SessionTable.directory })
        .from(SessionTable)
        .where(inArray(SessionTable.id, sessionIDs))
        .all(),
    )
    for (const item of items) {
      sessions.set(item.id, item.directory)
    }
  }

  if (projectIDs.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(inArray(ProjectTable.id, projectIDs))
        .all(),
    )
    for (const item of items) {
      projects.set(item.id, {
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
      })
    }
  }

  return rows.map((task) => {
    const project = projects.get(task.project_id) ?? null
    return {
      task,
      directory: sessions.get(task.session_id ?? "") ?? project?.worktree ?? "",
      project,
    }
  })
}

export function listTaskRows(rows: TaskRow[]) {
  return taskRows(rows)
}

export function listProjectTasks(projectID: string, limit = 50) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.project_id, projectID))
      .orderBy(desc(OrchestratorTaskTable.time_updated))
      .limit(limit)
      .all(),
  )
}

/** 按关键词和/或状态搜索 project 内的 task */
export function searchProjectTasks(
  projectID: string,
  opts: { query?: string; status?: string; limit?: number },
) {
  const conditions = [eq(OrchestratorTaskTable.project_id, projectID)]
  if (opts.status) {
    conditions.push(eq(OrchestratorTaskTable.status, opts.status as typeof OrchestratorTaskTable.$inferSelect.status))
  }
  if (opts.query) {
    conditions.push(like(OrchestratorTaskTable.title, `%${opts.query}%`))
  }
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorTaskTable)
      .where(and(...conditions))
      .orderBy(desc(OrchestratorTaskTable.time_updated))
      .limit(opts.limit ?? 50)
      .all(),
  )
}

export function listGlobalTasks(input?: {
  directory?: string
  cursor?: number
  query?: string
  status?: string
  limit?: number
}) {
  const conditions: SQL[] = []

  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.cursor) {
    conditions.push(lt(OrchestratorTaskTable.time_updated, input.cursor))
  }
  if (input?.status) {
    conditions.push(eq(OrchestratorTaskTable.status, input.status as typeof OrchestratorTaskTable.$inferSelect.status))
  }
  if (input?.query) {
    conditions.push(like(OrchestratorTaskTable.title, `%${input.query}%`))
  }

  const rows = Database.use((db) => {
    const query = db
      .select({ task: OrchestratorTaskTable })
      .from(OrchestratorTaskTable)
      .leftJoin(SessionTable, eq(OrchestratorTaskTable.session_id, SessionTable.id))
    return (conditions.length > 0 ? query.where(and(...conditions)) : query)
      .orderBy(desc(OrchestratorTaskTable.time_updated), desc(OrchestratorTaskTable.id))
      .limit(input?.limit ?? 100)
      .all()
      .map((item) => item.task)
  })

  return taskRows(rows)
}

export function listInteractions(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorInteractionRequestTable)
      .where(eq(OrchestratorInteractionRequestTable.task_id, taskID))
      .orderBy(desc(OrchestratorInteractionRequestTable.time_created))
      .all(),
  )
}

export function findPendingInteractions(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorInteractionRequestTable)
      .where(
        and(
          eq(OrchestratorInteractionRequestTable.run_id, runID),
          eq(OrchestratorInteractionRequestTable.status, "pending"),
        ),
      )
      .orderBy(desc(OrchestratorInteractionRequestTable.time_created))
      .all(),
  )
}

export function findArtifacts(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorArtifactTable)
      .where(eq(OrchestratorArtifactTable.run_id, runID))
      .orderBy(desc(OrchestratorArtifactTable.time_created))
      .all(),
  )
}

export function findEvaluations(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.run_id, runID))
      .orderBy(desc(OrchestratorEvaluationTable.time_created))
      .all(),
  )
}

export function listSnapshots(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorProgressSnapshotTable)
      .where(eq(OrchestratorProgressSnapshotTable.task_id, taskID))
      .orderBy(desc(OrchestratorProgressSnapshotTable.time_created))
      .limit(20)
      .all(),
  )
}

export function activeRunBySession(sessionID: string) {
  const row = Database.use((db) =>
    db
      .select({ run: OrchestratorRunTable })
      .from(OrchestratorRunTable)
      .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
      .where(
        and(
          eq(OrchestratorRunTable.session_id, sessionID),
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorRunTable.status, ["accepted", "running", "blocked"]),
        ),
      )
      .orderBy(desc(OrchestratorRunTable.time_created))
      .get(),
  )
  return row?.run
}

export function viewTask(row: TaskRow, input?: { directory?: string }) {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: input?.directory,
    sessionID: row.session_id ?? undefined,
    activeSpecVersionID: row.active_spec_version_id ?? undefined,
    activePlanVersionID: row.active_plan_version_id ?? undefined,
    activeRunID: row.active_run_id ?? undefined,
    requestID: row.request_id ?? undefined,
    source: row.source,
    title: row.title,
    request: row.request,
    status: row.status,
    priority: row.priority,
    blockingReason: row.blocking_reason ?? undefined,
    error: row.error ?? undefined,
    budget: budgetModel(row.budget),
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }
}

export function viewPlan(row: PlanRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    version: row.version,
    status: row.status,
    summary: row.summary,
    prompt: row.prompt,
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewGoal(row: GoalRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    planVersionID: row.plan_version_id,
    milestoneID: row.milestone_id ?? undefined,
    description: row.description,
    criteria: row.criteria,
    priority: row.priority,
    status: row.status,
    orderIndex: row.order_index,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewMilestone(row: MilestoneRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    planVersionID: row.plan_version_id,
    title: row.title,
    description: row.description,
    status: row.status,
    orderIndex: row.order_index,
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewRun(row: RunRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    planVersionID: row.plan_version_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    executor: row.executor,
    status: row.status,
    phase: row.phase,
    blockingReason: row.blocking_reason ?? undefined,
    error: row.error ?? undefined,
    retryCount: row.retry_count,
    executorRef: executorRefModel(row.executor_ref),
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }
}

export function viewInteraction(row: InteractionRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    sessionID: row.session_id ?? undefined,
    externalID: row.external_id,
    type: row.request_type,
    status: row.status,
    title: row.title,
    body: row.body,
    payload: row.payload ?? undefined,
    response: row.response ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      resolved: row.time_resolved ?? undefined,
    },
  }
}

export function viewArtifact(row: ArtifactRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    deliveryID: row.delivery_id ?? undefined,
    kind: row.kind,
    label: row.label,
    payload: row.payload ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewDelivery(row: DeliveryRow) {
  const result = (row.result ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    status: row.status,
    summary: row.summary,
    result: {
      summary: String(result.summary ?? row.summary),
      changedFiles: arrayOfStrings(result.changed_files),
      diffs: arrayOfDiffs(result.diffs),
      artifacts: Array.isArray(result.artifacts)
        ? result.artifacts.filter((item): item is { kind: string; label: string; payload?: Record<string, unknown> } =>
            !!item && typeof item === "object" && typeof (item as Record<string, unknown>).kind === "string" && typeof (item as Record<string, unknown>).label === "string",
          )
        : [],
      publish: result.publish && typeof result.publish === "object" ? result.publish as Record<string, unknown> : undefined,
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewEvaluation(row: EvaluationRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    deliveryID: row.delivery_id ?? undefined,
    status: row.status,
    verdict: row.verdict,
    summary: row.summary,
    checks: arrayOfChecks(row.checks),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  }
}

export function viewSnapshot(row: ProgressRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    status: row.status,
    summary: row.summary,
    payload: row.payload ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewExecutorSession(row: ExecutorSessionRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    provider: row.provider,
    protocol: row.protocol,
    protocolVersion: row.protocol_version,
    transport: row.transport,
    status: row.status,
    refs: row.refs ?? undefined,
    capabilities: row.capabilities ?? undefined,
    settings: row.settings ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }
}

export function viewExecutorEvent(row: ExecutorEventRow) {
  return {
    id: row.id,
    executorSessionID: row.executor_session_id,
    taskID: row.task_id,
    runID: row.run_id,
    sequence: row.sequence,
    kind: row.kind,
    summary: row.summary ?? undefined,
    refs: row.refs ?? undefined,
    payload: row.payload ?? undefined,
    raw: row.raw ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      observed: row.time_observed,
    },
  }
}

function budgetModel(input?: OrchestratorBudget | null) {
  if (!input) return undefined
  return {
    maxRuns: input.max_runs,
    maxReplans: input.max_replans,
    maxEvaluations: input.max_evaluations,
    maxWallTimeMs: input.max_wall_time_ms,
  }
}

function executorRefModel(input?: OrchestratorExecutorRef | null) {
  if (!input) return undefined
  return {
    sessionID: input.session_id,
    queueTaskID: input.queue_task_id,
  }
}

function arrayOfStrings(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is string => typeof item === "string")
}

function arrayOfDiffs(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = Snapshot.FileDiff.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function arrayOfChecks(input: unknown): OrchestratorGoalCheck[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = EvaluationCheck.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}
