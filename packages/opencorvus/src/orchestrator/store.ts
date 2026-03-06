import { Instance } from "@/project/instance"
import { Database, NotFoundError, and, desc, eq, inArray } from "@/storage/db"
import { Snapshot } from "@/snapshot"
import { EvaluationCheck } from "./model"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
  type OrchestratorBudget,
  type OrchestratorExecutorRef,
  type OrchestratorGoalCheck,
} from "./orchestrator.sql"

export type TaskRow = typeof OrchestratorTaskTable.$inferSelect
export type PlanRow = typeof OrchestratorPlanVersionTable.$inferSelect
export type GoalRow = typeof OrchestratorGoalTable.$inferSelect
export type RunRow = typeof OrchestratorRunTable.$inferSelect
export type InteractionRow = typeof OrchestratorInteractionRequestTable.$inferSelect
export type DeliveryRow = typeof OrchestratorDeliveryTable.$inferSelect
export type ArtifactRow = typeof OrchestratorArtifactTable.$inferSelect
export type EvaluationRow = typeof OrchestratorEvaluationTable.$inferSelect
export type ProgressRow = typeof OrchestratorProgressSnapshotTable.$inferSelect

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
      .where(eq(OrchestratorDeliveryTable.run_id, runID))
      .orderBy(desc(OrchestratorDeliveryTable.time_created))
      .get(),
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

export function viewTask(row: TaskRow) {
  return {
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
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

export function viewRun(row: RunRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    planVersionID: row.plan_version_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    executor: "opencode" as const,
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
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    status: row.status,
    summary: row.summary,
    result: {
      summary: String(row.result?.summary ?? row.summary),
      changedFiles: arrayOfStrings(row.result?.changed_files),
      diffs: arrayOfDiffs(row.result?.diffs),
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
