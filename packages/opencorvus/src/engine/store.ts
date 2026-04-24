import { Instance } from "@/project/instance"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import { Database, NotFoundError, and, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, sql } from "@/storage/db"
import type { SQL } from "@/storage/db"
import { FileDiff as SnapshotFileDiff } from "@/snapshot/types"
import { EvaluationCheck } from "./model"
import {
  EngineArtifactTable,
  EngineDeliveryTable,
  EngineExecutorSessionTable,
  EngineEvaluationTable,
  EngineGoalTable,
  EngineGoalRunTable,
  EngineGoalSnapshotTable,
  EngineInteractionRequestTable,
  EngineMilestoneTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineProgressSnapshotTable,
  EngineRequirementTable,
  EngineRunTable,
  EngineSpecItemTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
  type EngineBudget,
  type EngineExecutorRef,
  type EngineEvaluationCheck,
} from "./engine.sql"
import { ACTIVE_GOAL_RUN_STATUSES, DISPATCHABLE_RUN_STATUSES, LIVE_EXECUTOR_SESSION_STATUSES, LIVE_GOAL_RUN_STATUSES, LIVE_RUN_STATUSES } from "./catalog"

export type TaskRow = typeof EngineTaskTable.$inferSelect
export type PlanRow = typeof EnginePlanVersionTable.$inferSelect
export type GoalRow = typeof EngineGoalTable.$inferSelect
export type MilestoneRow = typeof EngineMilestoneTable.$inferSelect
export type RunRow = typeof EngineRunTable.$inferSelect
export type InteractionRow = typeof EngineInteractionRequestTable.$inferSelect
export type DeliveryRow = typeof EngineDeliveryTable.$inferSelect
export type ArtifactRow = typeof EngineArtifactTable.$inferSelect
export type EvaluationRow = typeof EngineEvaluationTable.$inferSelect
export type ProgressRow = typeof EngineProgressSnapshotTable.$inferSelect
export type ExecutorSessionRow = typeof EngineExecutorSessionTable.$inferSelect
export type RequirementRow = typeof EngineRequirementTable.$inferSelect
export type GoalSnapshotRow = typeof EngineGoalSnapshotTable.$inferSelect
export type GoalRunRow = typeof EngineGoalRunTable.$inferSelect
export type PlanNodeRow = typeof EnginePlanNodeTable.$inferSelect
export type SpecSnapshotRow = typeof EngineSpecSnapshotTable.$inferSelect
export type SpecItemRow = typeof EngineSpecItemTable.$inferSelect
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
  return Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
}

export function findTaskByRequest(projectID: string, requestID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(and(eq(EngineTaskTable.project_id, projectID), eq(EngineTaskTable.request_id, requestID)))
      .get(),
  )
}

export function findPlan(planID: string) {
  return Database.use((db) =>
    db.select().from(EnginePlanVersionTable).where(eq(EnginePlanVersionTable.id, planID)).get(),
  )
}

export function findPlans(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EnginePlanVersionTable)
      .where(eq(EnginePlanVersionTable.task_id, taskID))
      .orderBy(EnginePlanVersionTable.version)
      .all(),
  )
}

// ---------------------------------------------------------------------------
// Spec store functions
// ---------------------------------------------------------------------------

export function findSpecSnapshot(specID: string) {
  return Database.use((db) =>
    db.select().from(EngineSpecSnapshotTable).where(eq(EngineSpecSnapshotTable.id, specID)).get(),
  )
}

export function findSpecSnapshots(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(eq(EngineSpecSnapshotTable.task_id, taskID))
      .orderBy(desc(EngineSpecSnapshotTable.version))
      .all(),
  )
}

export function findSpecItems(specSnapshotID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecItemTable)
      .where(eq(EngineSpecItemTable.spec_snapshot_id, specSnapshotID))
      .all(),
  )
}

export function findSpecItemsByTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecItemTable)
      .where(eq(EngineSpecItemTable.task_id, taskID))
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
  return Database.use((db) => db.select().from(EngineRunTable).where(eq(EngineRunTable.id, runID)).get())
}

export function findInteraction(interactionID: string) {
  return Database.use((db) =>
    db.select().from(EngineInteractionRequestTable).where(eq(EngineInteractionRequestTable.id, interactionID)).get(),
  )
}

export function findInteractionByExternal(externalID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineInteractionRequestTable)
      .where(eq(EngineInteractionRequestTable.external_id, externalID))
      .orderBy(desc(EngineInteractionRequestTable.time_created))
      .get(),
  )
}

export function findDeliveryByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryTable)
      .where(and(
        eq(EngineDeliveryTable.run_id, runID),
        isNull(EngineDeliveryTable.goal_run_id),
      ))
      .orderBy(desc(EngineDeliveryTable.time_created))
      .get(),
  )
}

/** Find the most recent delivery for a run, including goal-run deliveries. */
export function findLatestDeliveryForRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryTable)
      .where(eq(EngineDeliveryTable.run_id, runID))
      .orderBy(desc(EngineDeliveryTable.time_created))
      .get(),
  )
}

export function findDeliveriesForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryTable)
      .where(eq(EngineDeliveryTable.task_id, taskID))
      .orderBy(desc(EngineDeliveryTable.time_created))
      .all(),
  )
}

export function findDeliveryByGoalRun(goalRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineDeliveryTable)
      .where(eq(EngineDeliveryTable.goal_run_id, goalRunID))
      .orderBy(desc(EngineDeliveryTable.time_created))
      .get(),
  )
}

/** Latest evaluation row for a goal_run (newest first, single row). */
export function findLatestEvaluationForGoalRun(goalRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(eq(EngineEvaluationTable.goal_run_id, goalRunID))
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(1)
      .get(),
  )
}

export function listGoalRunsForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(eq(EngineGoalRunTable.task_id, taskID))
      .orderBy(desc(EngineGoalRunTable.time_created))
      .all(),
  )
}

export function listGoalRunsByGoal(goalID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(eq(EngineGoalRunTable.goal_id, goalID))
      .orderBy(desc(EngineGoalRunTable.time_created))
      .all(),
  )
}

/**
 * Latest goal_run for a goal that is itself a tip of the supersede chain —
 * i.e. no newer goal_run points at it via supersede_of. Callers planning a
 * retry should pass this row's id as the `supersedeOf` to createGoalRun.
 * Returns undefined when no goal_run exists for the goal yet.
 */
export function findLatestTipGoalRun(goalID: string) {
  const rows = listGoalRunsByGoal(goalID)
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(
    rows
      .map((r) => (r as { supersede_of?: string | null }).supersede_of)
      .filter((x): x is string => !!x),
  )
  // Rows are ordered by time_created desc, so the first tip is the newest.
  return rows.find((r) => !supersededIDs.has(r.id))
}

export function findEvaluationByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(eq(EngineEvaluationTable.run_id, runID))
      .orderBy(desc(EngineEvaluationTable.time_created))
      .get(),
  )
}

export function findExecutorSessionByRun(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.run_id, runID))
      .get(),
  )
}

export function findExecutorSession(executorSessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.id, executorSessionID))
      .get(),
  )
}

export function findGoal(goalID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalTable)
      .where(eq(EngineGoalTable.id, goalID))
      .get(),
  )
}

export function findGoalRun(goalRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(eq(EngineGoalRunTable.id, goalRunID))
      .get(),
  )
}

/**
 * Most recent delivery-agent verdict artifact for `taskID` whose verdict is
 * "rejected" and `time_created >= sinceMs`. Used by the orchestrator loop to
 * detect "the delivery tool just rejected" and wake the orchestrator with
 * structured feedback. Keyed on the artifact (first-class delivery output)
 * rather than on `goal_run.superseded_reason = "delivery_rework"` string
 * matching — per rule 23 (no state-machine enums / branching on enum labels).
 *
 * Returns undefined when no matching artifact exists in the window.
 */
export function findRecentDeliveryRejection(taskID: string, sinceMs: number) {
  const art = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, taskID),
        eq(EngineArtifactTable.label, "delivery-agent-verdict"),
        gte(EngineArtifactTable.time_created, sinceMs),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  if (!art) return undefined
  const payload = (art.payload ?? {}) as Record<string, unknown>
  if (payload.verdict !== "rejected") return undefined
  return art
}

/**
 * Latest verdict artifact written by the deliver tool for `taskID`. The
 * payload is the full DeliveryVerdict (summary, issues_found, rejection_details,
 * startup_verification, frontend_check). The orchestrator loop reads this when
 * a recent rework attempt is detected so it can hand structured feedback to
 * the orchestrator agent without piggy-backing on task.metadata.
 */
export function findLatestDeliveryVerdictArtifact(taskID: string) {
  return Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, taskID),
        eq(EngineArtifactTable.label, "delivery-agent-verdict"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
}

export function goalRunQueueTaskID(goalRun?: GoalRunRow) {
  if (!goalRun) return undefined
  const ref = goalRun.metadata as Record<string, unknown> | null
  const queueTaskID = typeof ref?.queue_task_id === "string" ? ref.queue_task_id : undefined
  return queueTaskID
}

export function listGoalRunsForDispatch(taskID: string) {
  return listGoalRunsForTask(taskID)
}

export function listActiveGoalRunsForRun(coordinatorRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(
        and(
          eq(EngineGoalRunTable.coordinator_run_id, coordinatorRunID),
          inArray(EngineGoalRunTable.status, ACTIVE_GOAL_RUN_STATUSES),
        ),
      )
      .all(),
  )
}

export function listQueuedGoalRunsForRun(coordinatorRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(
        and(
          eq(EngineGoalRunTable.coordinator_run_id, coordinatorRunID),
          eq(EngineGoalRunTable.status, "queued"),
        ),
      )
      .orderBy(EngineGoalRunTable.time_created)
      .all(),
  )
}

export function listGoalRunsForRun(coordinatorRunID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(eq(EngineGoalRunTable.coordinator_run_id, coordinatorRunID))
      .orderBy(EngineGoalRunTable.time_created)
      .all(),
  )
}

/** @deprecated Use listGoalRunsForTask or listGoalRunsForDispatch. */
export const listGoalRunsByTask = listGoalRunsForTask

/** @deprecated Use listActiveGoalRunsForRun. */
export const listActiveGoalRunsByCoordinator = listActiveGoalRunsForRun

/** @deprecated Use listGoalRunsForRun. */
export const listGoalRunsByCoordinator = listGoalRunsForRun

export function listGoals(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalTable)
      .where(eq(EngineGoalTable.task_id, taskID))
      .orderBy(EngineGoalTable.order_index)
      .all(),
  )
}

export function listGoalsByPlan(planID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalTable)
      .where(eq(EngineGoalTable.plan_version_id, planID))
      .orderBy(EngineGoalTable.order_index)
      .all(),
  )
}

export function listMilestonesByPlan(planID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineMilestoneTable)
      .where(eq(EngineMilestoneTable.plan_version_id, planID))
      .orderBy(EngineMilestoneTable.order_index)
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
      .from(EnginePlanNodeTable)
      .where(eq(EnginePlanNodeTable.plan_version_id, planID))
      .orderBy(EnginePlanNodeTable.order_index)
      .all(),
  )
}

export function findGoalSnapshot(goalSnapshotID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineGoalSnapshotTable)
      .where(eq(EngineGoalSnapshotTable.id, goalSnapshotID))
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
      .from(EngineRequirementTable)
      .where(eq(EngineRequirementTable.spec_snapshot_id, specSnapshotID))
      .orderBy(EngineRequirementTable.order_index)
      .all(),
  )
}

export function listMilestones(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineMilestoneTable)
      .where(eq(EngineMilestoneTable.task_id, taskID))
      .orderBy(EngineMilestoneTable.order_index)
      .all(),
  )
}

export function findRuns(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineRunTable)
      .where(eq(EngineRunTable.task_id, taskID))
      .orderBy(desc(EngineRunTable.time_created))
      .all(),
  )
}

export function listLiveRunsForProject(projectID: string) {
  return Database.use((db) =>
    db
      .select({ run: EngineRunTable })
      .from(EngineRunTable)
      .innerJoin(EngineTaskTable, eq(EngineRunTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          inArray(EngineRunTable.status, LIVE_RUN_STATUSES),
        ),
      )
      .orderBy(desc(EngineRunTable.time_created))
      .all()
      .map((row) => row.run),
  )
}

export function listLiveGoalRunsForProject(projectID: string) {
  return Database.use((db) =>
    db
      .select({ goalRun: EngineGoalRunTable })
      .from(EngineGoalRunTable)
      .innerJoin(EngineTaskTable, eq(EngineGoalRunTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          inArray(EngineGoalRunTable.status, LIVE_GOAL_RUN_STATUSES),
        ),
      )
      .orderBy(desc(EngineGoalRunTable.time_created))
      .all()
      .map((row) => row.goalRun),
  )
}

export function listGoalWorkspacesForProject(projectID: string) {
  return Database.use((db) =>
    db
      .select({ goal: EngineGoalTable })
      .from(EngineGoalTable)
      .innerJoin(EngineTaskTable, eq(EngineGoalTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          sql`${EngineGoalTable.workspace_dir} IS NOT NULL`,
        ),
      )
      .orderBy(desc(EngineGoalTable.time_updated))
      .all()
      .map((row) => row.goal),
  )
}

/**
 * Sessions that produced a protocol event for this task within the last
 * `windowMs` milliseconds. This is the describe-layer view of "what agents
 * are currently working" — it covers pre-plan sessions (requirements /
 * architect / fidelity / design-analyst) which `goals` and `run` miss
 * entirely because they're gated on `active_plan_version_id`.
 *
 * Source: protocol_event is the append-only truth for agent activity; we do
 * not gate on `status` columns (rule 23: no state machine). Join with
 * SessionTable only to surface `kind` / `goal_id` for UI labelling.
 */
export function listActiveSessionsForTask(taskID: string, windowMs = 60_000) {
  const threshold = Date.now() - windowMs
  return Database.use((db) =>
    db
      .select({
        sessionID: ProtocolEventTable.session_id,
        kind: SessionTable.kind,
        goalID: SessionTable.goal_id,
        lastActivityMs: sql<number>`MAX(${ProtocolEventTable.emitted_at})`.as("last_activity_ms"),
      })
      .from(ProtocolEventTable)
      .innerJoin(SessionTable, eq(SessionTable.id, ProtocolEventTable.session_id))
      .where(
        and(
          eq(ProtocolEventTable.task_id, taskID),
          isNotNull(ProtocolEventTable.session_id),
          gt(ProtocolEventTable.emitted_at, threshold),
        ),
      )
      .groupBy(ProtocolEventTable.session_id)
      .orderBy(desc(sql`last_activity_ms`))
      .all()
      .flatMap((row) =>
        row.sessionID
          ? [{
              sessionID: row.sessionID,
              kind: row.kind as string,
              goalID: row.goalID,
              lastActivityMs: row.lastActivityMs,
            }]
          : [],
      ),
  )
}

export function listLiveExecutorSessionsForProject(projectID: string) {
  return Database.use((db) =>
    db
      .select({ session: EngineExecutorSessionTable })
      .from(EngineExecutorSessionTable)
      .innerJoin(EngineTaskTable, eq(EngineExecutorSessionTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          inArray(EngineExecutorSessionTable.status, LIVE_EXECUTOR_SESSION_STATUSES),
        ),
      )
      .orderBy(desc(EngineExecutorSessionTable.time_created))
      .all()
      .map((row) => row.session),
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
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.project_id, projectID))
      .orderBy(desc(EngineTaskTable.time_updated))
      .limit(limit)
      .all(),
  )
}

/** 按关键词和/或状态搜索 project 内的 task */
export function searchProjectTasks(
  projectID: string,
  opts: { query?: string; status?: string; limit?: number },
) {
  const conditions = [eq(EngineTaskTable.project_id, projectID)]
  if (opts.status) {
    conditions.push(eq(EngineTaskTable.status, opts.status as typeof EngineTaskTable.$inferSelect.status))
  }
  if (opts.query) {
    conditions.push(like(EngineTaskTable.title, `%${opts.query}%`))
  }
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(and(...conditions))
      .orderBy(desc(EngineTaskTable.time_updated))
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
    conditions.push(lt(EngineTaskTable.time_updated, input.cursor))
  }
  if (input?.status) {
    conditions.push(eq(EngineTaskTable.status, input.status as typeof EngineTaskTable.$inferSelect.status))
  }
  if (input?.query) {
    conditions.push(like(EngineTaskTable.title, `%${input.query}%`))
  }

  const rows = Database.use((db) => {
    const query = db
      .select({ task: EngineTaskTable })
      .from(EngineTaskTable)
      .leftJoin(SessionTable, eq(EngineTaskTable.session_id, SessionTable.id))
    return (conditions.length > 0 ? query.where(and(...conditions)) : query)
      .orderBy(desc(EngineTaskTable.time_updated), desc(EngineTaskTable.id))
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
      .from(EngineInteractionRequestTable)
      .where(eq(EngineInteractionRequestTable.task_id, taskID))
      .orderBy(desc(EngineInteractionRequestTable.time_created))
      .all(),
  )
}

export function findPendingInteractions(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineInteractionRequestTable)
      .where(
        and(
          eq(EngineInteractionRequestTable.run_id, runID),
          eq(EngineInteractionRequestTable.status, "pending"),
        ),
      )
      .orderBy(desc(EngineInteractionRequestTable.time_created))
      .all(),
  )
}

export function findArtifacts(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(eq(EngineArtifactTable.run_id, runID))
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
}

export function findEvaluations(runID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(eq(EngineEvaluationTable.run_id, runID))
      .orderBy(desc(EngineEvaluationTable.time_created))
      .all(),
  )
}

export function findEvaluationsByTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineEvaluationTable)
      .where(eq(EngineEvaluationTable.task_id, taskID))
      .orderBy(desc(EngineEvaluationTable.time_created))
      .all(),
  )
}

/** Returns the most recent rejected evaluation for a given goal (across all goal runs). */
export function findLatestFailedEvalForGoal(goalID: string) {
  return Database.use((db) =>
    db
      .select({
        verdict: EngineEvaluationTable.verdict,
        summary: EngineEvaluationTable.summary,
        checks: EngineEvaluationTable.checks,
      })
      .from(EngineEvaluationTable)
      .innerJoin(EngineGoalRunTable, eq(EngineEvaluationTable.goal_run_id, EngineGoalRunTable.id))
      .where(
        and(
          eq(EngineGoalRunTable.goal_id, goalID),
          eq(EngineEvaluationTable.verdict, "rejected"),
        ),
      )
      .orderBy(desc(EngineEvaluationTable.time_created))
      .limit(1)
      .all(),
  )
}

export function listSnapshots(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineProgressSnapshotTable)
      .where(eq(EngineProgressSnapshotTable.task_id, taskID))
      .orderBy(desc(EngineProgressSnapshotTable.time_created))
      .limit(20)
      .all(),
  )
}

export function activeRunBySession(sessionID: string) {
  const row = Database.use((db) =>
    db
      .select({ run: EngineRunTable })
      .from(EngineRunTable)
      .innerJoin(EngineTaskTable, eq(EngineRunTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineRunTable.session_id, sessionID),
          eq(EngineTaskTable.project_id, Instance.project.id),
          inArray(EngineRunTable.status, DISPATCHABLE_RUN_STATUSES),
        ),
      )
      .orderBy(desc(EngineRunTable.time_created))
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
    kind: row.kind ?? "workflow",
    blockingReason: row.blocking_reason ?? undefined,
    error: row.error ?? undefined,
    budget: budgetModel(row.budget),
    metadata: row.metadata ?? undefined,
    attachments: row.attachments ?? undefined,
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

// Pure row → DTO mapping. The derived `status` field is NOT included here;
// callers compose it in from describe.ts::goalStatusByID. Keeping this layer
// free of describe/* imports avoids a circular dependency that broke
// `bun build --compile` (require() cannot pull a transitive top-level await).
export function viewGoal(row: GoalRow) {
  return {
    id: row.id,
    taskID: row.task_id,
    planVersionID: row.plan_version_id,
    milestoneID: row.milestone_id ?? undefined,
    title: row.title,
    objective: row.objective,
    acceptance_specs: row.acceptance_specs,
    owned_paths: row.owned_paths,
    depends_on: row.depends_on,
    exports: row.exports,
    imports: row.imports,
    kind: row.kind,
    requirement_ids: row.requirement_ids,
    priority: row.priority,
    retryCount: row.retry_count,
    workspaceDir: row.workspace_dir ?? undefined,
    workspaceBranch: row.workspace_branch ?? undefined,
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

function budgetModel(input?: EngineBudget | null) {
  if (!input) return undefined
  return {
    maxRuns: input.max_runs,
    maxExecutorGroups: input.max_executor_groups,
  }
}

function executorRefModel(input?: EngineExecutorRef | null) {
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
    const parsed = SnapshotFileDiff.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function arrayOfChecks(input: unknown): EngineEvaluationCheck[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = EvaluationCheck.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}
