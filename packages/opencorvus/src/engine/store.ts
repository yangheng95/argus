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
  EngineExecutorSessionTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineMilestoneTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineProgressSnapshotTable,
  EngineRequirementTable,
  EngineSpecItemTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
  type DeliveryResult,
  type EngineBudget,
  type EngineDeliveryStatus,
  type EngineExecutorRef,
  type EngineEvaluationCheck,
  type EngineEvaluationScope,
  type EngineEvaluationStatus,
  type EngineEvaluationVerdict,
  type EngineGoalRunStatus,
  type EngineMetadata,
} from "./engine.sql"
import { ACTIVE_GOAL_RUN_STATUSES, DISPATCHABLE_RUN_STATUSES, LIVE_EXECUTOR_SESSION_STATUSES, LIVE_GOAL_RUN_STATUSES, LIVE_RUN_STATUSES } from "./catalog"
import { deriveTaskStatus } from "./task-status"

export type TaskRow = typeof EngineTaskTable.$inferSelect
export type PlanRow = typeof EnginePlanVersionTable.$inferSelect
export type GoalRow = typeof EngineGoalTable.$inferSelect
export type MilestoneRow = typeof EngineMilestoneTable.$inferSelect
/** Phase-6-e artifact-backed run shape. Was `typeof EngineRunTable.$inferSelect`
 *  until `engine_run` was deleted in favour of `engine_artifact` rows with
 *  kind="run". Field names stay snake_case so old consumers do not churn.
 *  Reconstructed via `artifactRowToRunRow()` below. Append-only: each status
 *  transition writes a new artifact row with the same logical run_id. */
export type RunRow = {
  id: string
  task_id: string
  plan_version_id: string | null
  session_id: string | null
  executor: import("./engine.sql").EngineExecutor
  status: import("./engine.sql").EngineRunStatus
  phase: import("./engine.sql").EngineRunPhase
  blocking_reason: string | null
  error: string | null
  retry_count: number
  executor_ref: import("./engine.sql").EngineExecutorRef | null
  metadata: EngineMetadata | null
  time_started: number | null
  time_completed: number | null
  time_created: number
  time_updated: number
}
export type InteractionRow = typeof EngineInteractionRequestTable.$inferSelect
/** Phase-6-c artifact-backed delivery shape. Was `typeof EngineDeliveryTable.$inferSelect`
 *  until `engine_delivery` was deleted in favour of `engine_artifact` rows with
 *  kind="delivery". Field names stay snake_case so old consumers do not churn.
 *  Reconstructed via `artifactRowToDeliveryRow()` below. */
export type DeliveryRow = {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string | null
  status: EngineDeliveryStatus
  summary: string
  result: DeliveryResult | null
  time_created: number
  time_updated: number
}
export type ArtifactRow = typeof EngineArtifactTable.$inferSelect
/** Phase-6 artifact-backed evaluation shape. Was `typeof EngineEvaluationTable.$inferSelect`
 *  until `engine_evaluation` was deleted in favour of `engine_artifact` rows with
 *  kind="verification-evidence". Field names stay snake_case so old consumers do
 *  not churn. Reconstructed via `artifactRowToEvaluationRow()` below. */
export type EvaluationRow = {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string | null
  delivery_id: string | null
  scope: EngineEvaluationScope
  status: EngineEvaluationStatus
  verdict: EngineEvaluationVerdict
  summary: string
  checks: EngineEvaluationCheck[] | null
  time_completed: number | null
  time_created: number
  time_updated: number
}
export type ProgressRow = typeof EngineProgressSnapshotTable.$inferSelect
export type ExecutorSessionRow = typeof EngineExecutorSessionTable.$inferSelect
export type RequirementRow = typeof EngineRequirementTable.$inferSelect
/** Phase-6-d artifact-backed goal_run shape. Was `typeof EngineGoalRunTable.$inferSelect`
 *  until `engine_goal_run` was deleted in favour of `engine_artifact` rows with
 *  kind="goal_run_attempt". Field names stay snake_case so old consumers do
 *  not churn. Reconstructed via `artifactRowToGoalRunRow()` below. Append-only:
 *  each status transition writes a new artifact row with the same logical
 *  `goal_run_id`; the latest row per logical id is authoritative. */
export type GoalRunRow = {
  id: string
  task_id: string
  goal_id: string
  plan_node_id: string | null
  coordinator_run_id: string
  session_id: string | null
  status: EngineGoalRunStatus
  retry_count: number
  blocking_reason: string | null
  error: string | null
  workspace_dir: string | null
  base_ref: string | null
  merge_ref: string | null
  supersede_of: string | null
  superseded_reason: string | null
  superseded_at: number | null
  metadata: EngineMetadata | null
  time_started: number | null
  time_completed: number | null
  time_created: number
  time_updated: number
}
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

/** Phase-6-f: return the single active plan version for a task, derived
 *  from `engine_plan_version.status = 'active'`. Replaces the
 *  `task.active_plan_version_id` cache column. Returns undefined when the
 *  task has no active plan. */
export function findActivePlanForTask(taskID: string): PlanRow | undefined {
  return Database.use((db) =>
    db
      .select()
      .from(EnginePlanVersionTable)
      .where(
        and(
          eq(EnginePlanVersionTable.task_id, taskID),
          eq(EnginePlanVersionTable.status, "active"),
        ),
      )
      .orderBy(desc(EnginePlanVersionTable.version))
      .get(),
  )
}

/** Phase-6-f-3: return the newest run for a task (by logical run_id
 *  time_created desc), derived from `engine_artifact` kind="run" stream.
 *  Replaces the `task.active_run_id` cache column. Returns undefined when
 *  the task has no runs yet. */
export function findActiveRunForTask(taskID: string): RunRow | undefined {
  return findRuns(taskID)[0]
}

/** Phase-6-f-5: return the single non-superseded spec snapshot for a task,
 *  derived from `engine_spec_snapshot.status != 'superseded'`. Replaces the
 *  `task.active_spec_version_id` cache column. Writers preserve the
 *  at-most-one invariant by marking the prior active spec superseded before
 *  inserting the new one. Returns undefined when the task has no specs. */
export function findActiveSpecForTask(taskID: string): SpecSnapshotRow | undefined {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(
        and(
          eq(EngineSpecSnapshotTable.task_id, taskID),
          sql`${EngineSpecSnapshotTable.status} != 'superseded'`,
        ),
      )
      .orderBy(desc(EngineSpecSnapshotTable.version))
      .get(),
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

// ---------------------------------------------------------------------------

export function findRun(runID: string): RunRow | undefined {
  // Phase-6-e: run rows are engine_artifact kind="run", append-only per
  // logical run_id. Tie-break on id so same-ms appends resolve deterministically.
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "run"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
  return row ? artifactRowToRunRow(row) : undefined
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

/** Task-level delivery (goal_run_id IS NULL) for a run. Reads `engine_artifact`
 *  kind="delivery" rows — append-only, so latest row per delivery_id wins. */
export function findDeliveryByRun(runID: string): DeliveryRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "delivery"),
          isNull(EngineArtifactTable.goal_run_id),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  const latest = latestPerDelivery(rows)[0]
  return latest ? artifactRowToDeliveryRow(latest) : undefined
}

/** Find the most recent delivery for a run, including goal-run deliveries. */
export function findLatestDeliveryForRun(runID: string): DeliveryRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "delivery"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  const latest = latestPerDelivery(rows)[0]
  return latest ? artifactRowToDeliveryRow(latest) : undefined
}

export function findDeliveriesForTask(taskID: string): DeliveryRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "delivery"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerDelivery(rows).map(artifactRowToDeliveryRow)
}

export function findDeliveryByGoalRun(goalRunID: string): DeliveryRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.goal_run_id, goalRunID),
          eq(EngineArtifactTable.kind, "delivery"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  const latest = latestPerDelivery(rows)[0]
  return latest ? artifactRowToDeliveryRow(latest) : undefined
}

/** Phase-6-c helper: collapse the append-only delivery artifact stream into
 *  one row per delivery_id (the newest, since input arrives `time_created desc`).
 *  Preserves input order so callers that want "latest delivery overall" just
 *  take [0]. */
function latestPerDelivery(
  rows: Array<typeof EngineArtifactTable.$inferSelect>,
): Array<typeof EngineArtifactTable.$inferSelect> {
  const seen = new Set<string>()
  const result: Array<typeof EngineArtifactTable.$inferSelect> = []
  for (const row of rows) {
    const key = row.delivery_id ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

function artifactRowToDeliveryRow(row: typeof EngineArtifactTable.$inferSelect): DeliveryRow {
  const payload = (row.payload ?? {}) as {
    status?: EngineDeliveryStatus
    summary?: string
    result?: DeliveryResult | null
  }
  return {
    id: row.delivery_id ?? row.id,
    task_id: row.task_id,
    // delivery-kind artifacts always have run_id set by writeDeliveryRow;
    // nullable column only used for kind="orchestrator-stream-error".
    run_id: row.run_id!,
    goal_run_id: row.goal_run_id ?? null,
    status: payload.status ?? "candidate",
    summary: payload.summary ?? "",
    result: payload.result ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** Latest evaluation row for a goal_run (newest first, single row).
 *  Reads `engine_artifact` rows with kind="verification-evidence" + scope="goal_run". */
export function findLatestEvaluationForGoalRun(goalRunID: string): EvaluationRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.goal_run_id, goalRunID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .get(),
  )
  return row ? artifactRowToEvaluationRow(row) : undefined
}

export function listGoalRunsForTask(taskID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerGoalRun(rows).map(artifactRowToGoalRunRow)
}

export function listGoalRunsByGoal(goalID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.goal_id') = ${goalID}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerGoalRun(rows).map(artifactRowToGoalRunRow)
}

/**
 * Latest goal_run for a goal that is itself a tip of the supersede chain —
 * i.e. no newer goal_run points at it via supersede_of. Callers planning a
 * retry should pass this row's id as the `supersedeOf` to createGoalRun.
 * Returns undefined when no goal_run exists for the goal yet.
 */
export function findLatestTipGoalRun(goalID: string): GoalRunRow | undefined {
  const rows = listGoalRunsByGoal(goalID)
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(
    rows.map((r) => r.supersede_of).filter((x): x is string => !!x),
  )
  return rows.find((r) => !supersededIDs.has(r.id))
}

export function findEvaluationByRun(runID: string): EvaluationRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row ? artifactRowToEvaluationRow(row) : undefined
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

export function findGoalRun(goalRunID: string): GoalRunRow | undefined {
  // Tie-break by id (ascending identifier) so ties on time_created resolve
  // to the latest writer deterministically. Two appends in the same ms
  // otherwise give undefined ordering.
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.goal_run_id, goalRunID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
  return row ? artifactRowToGoalRunRow(row) : undefined
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
 * Most recent orchestrator stream-error artifact for `taskID` whose
 * `time_created >= sinceMs`. Used by the orchestrator loop to detect
 * "the orchestrator's own LLM stream aborted (idle / provider onError)"
 * and re-wake itself so the LLM gets a fresh decision turn instead of
 * silently giving up on transient network hangs (e.g. alibaba-coding-plan-cn
 * stream idle > 180s). Per rule 23 stream abort is a fact recorded as an
 * artifact, not a state-machine transition; the LLM decides whether to
 * retry or fail_task on next wake.
 *
 * Returns undefined when no matching artifact exists in the window.
 */
export function findRecentOrchestratorStreamError(taskID: string, sinceMs: number) {
  return Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, taskID),
        eq(EngineArtifactTable.kind, "orchestrator-stream-error"),
        gte(EngineArtifactTable.time_created, sinceMs),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
}

/**
 * Latest verdict artifact written by the deliver tool for `taskID`. The
 * payload is the full DeliveryVerdict (summary, issues_found, rejection_details,
 * startup_verification, frontend_check). The orchestrator loop reads this when
 * a recent rework attempt is detected so it can hand structured feedback to
 * the orchestrator agent without piggy-backing on task.metadata.
 */
/**
 * Most recent `goal_run_attempt` artifact for `taskID` whose `time_created >= sinceMs`.
 * Used by the orchestrator loop to detect "a build batch just settled" so it can
 * fire a `deliverPending` re-wake when the orchestrator's previous decision turn
 * ended without dispatching `deliver`. Watermarking by artifact time prevents
 * the same batch from re-triggering — once we wake, lastReworkSeenAt advances
 * past this artifact and only a NEW build attempt can fire it again. Per rule
 * 23 the LLM decides what to call (deliver / modify_goal / fail_task); this
 * helper only surfaces the fact "build settled, no delivery yet".
 */
export function findRecentBuildSettlement(taskID: string, sinceMs: number) {
  return Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, taskID),
        eq(EngineArtifactTable.kind, "goal_run_attempt"),
        gte(EngineArtifactTable.time_created, sinceMs),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
}

/**
 * True when the task has a `delivery-agent-verdict` artifact newer than
 * `sinceMs` (any verdict — accepted / rejected / continue). Used together
 * with `findRecentBuildSettlement` to gate the deliverPending wake: only fire
 * when builds settled but no fresh deliver verdict followed.
 */
export function hasDeliveryVerdictSince(taskID: string, sinceMs: number): boolean {
  const row = Database.use((db) =>
    db.select({ id: EngineArtifactTable.id }).from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, taskID),
        eq(EngineArtifactTable.label, "delivery-agent-verdict"),
        gte(EngineArtifactTable.time_created, sinceMs),
      ))
      .limit(1)
      .get(),
  )
  return !!row
}

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

export function listActiveGoalRunsForRun(coordinatorRunID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, coordinatorRunID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerGoalRun(rows)
    .map(artifactRowToGoalRunRow)
    .filter((r) => (ACTIVE_GOAL_RUN_STATUSES as readonly string[]).includes(r.status))
}

export function listQueuedGoalRunsForRun(coordinatorRunID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, coordinatorRunID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerGoalRun(rows)
    .map(artifactRowToGoalRunRow)
    .filter((r) => r.status === "queued")
    .reverse()
}

export function listGoalRunsForRun(coordinatorRunID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, coordinatorRunID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return latestPerGoalRun(rows).map(artifactRowToGoalRunRow).reverse()
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

export function findRuns(taskID: string): RunRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "run"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  return latestPerRun(rows).map(artifactRowToRunRow)
}

export function listLiveRunsForProject(projectID: string): RunRow[] {
  const rows = Database.use((db) =>
    db
      .select({ artifact: EngineArtifactTable })
      .from(EngineArtifactTable)
      .innerJoin(EngineTaskTable, eq(EngineArtifactTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          eq(EngineArtifactTable.kind, "run"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all()
      .map((row) => row.artifact),
  )
  return latestPerRun(rows)
    .map(artifactRowToRunRow)
    .filter((r) => (LIVE_RUN_STATUSES as readonly string[]).includes(r.status))
}

export function listLiveGoalRunsForProject(projectID: string): GoalRunRow[] {
  const rows = Database.use((db) =>
    db
      .select({ artifact: EngineArtifactTable })
      .from(EngineArtifactTable)
      .innerJoin(EngineTaskTable, eq(EngineArtifactTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all()
      .map((row) => row.artifact),
  )
  return latestPerGoalRun(rows)
    .map(artifactRowToGoalRunRow)
    .filter((r) => (LIVE_GOAL_RUN_STATUSES as readonly string[]).includes(r.status))
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
 * architect / integrity / design-analyst) which `goals` and `run` miss
 * entirely because they're gated on `active_plan_version_id`.
 *
 * Source: protocol_event is the append-only truth for agent activity; we do
 * not gate on `status` columns (rule 23: no state machine). Join with
 * SessionTable only to surface `kind` / `goal_id` for UI labelling.
 *
 * Sessions that have already emitted a phase-terminal event
 * (`*.completed` per the EngineEvent naming contract — requirements.completed,
 * architect.completed, design_analysis.completed, integrity.completed,
 * build.completed, delivery.completed, intent_analysis.completed) are
 * excluded so the overlay's spinner stops the moment the inner runner
 * concludes — without waiting for the orchestrator's next LLM step. The
 * exclusion looks at the same protocol_event table; no parallel state
 * column is introduced (rule 22 single source).
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
          sql`NOT EXISTS (
            SELECT 1 FROM protocol_event AS pe_done
            WHERE pe_done.session_id = ${ProtocolEventTable.session_id}
              AND pe_done.type LIKE '%.completed'
          )`,
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
    conditions.push(taskStatusCondition(opts.status))
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

/**
 * Translate a logical task-status filter (queued / active / completed /
 * failed / cancelled) into a fact-field SQL condition now that the status
 * column is gone. Unknown statuses resolve to `1=0` so a caller's typo
 * returns zero rows rather than all rows.
 */
function taskStatusCondition(status: string): SQL {
  const cancelledMark = sql`json_extract(${EngineTaskTable.metadata}, '$.cancelled') = 1`
  switch (status) {
    case "queued":
      return and(
        isNull(EngineTaskTable.time_started),
        isNull(EngineTaskTable.time_completed),
      )!
    case "active":
      return and(
        isNotNull(EngineTaskTable.time_started),
        isNull(EngineTaskTable.time_completed),
      )!
    case "completed":
      return and(
        isNotNull(EngineTaskTable.time_completed),
        isNull(EngineTaskTable.error),
        sql`(${cancelledMark}) IS NOT TRUE`,
      )!
    case "failed":
      return and(
        isNotNull(EngineTaskTable.time_completed),
        isNotNull(EngineTaskTable.error),
        sql`(${cancelledMark}) IS NOT TRUE`,
      )!
    case "cancelled":
      return cancelledMark
    default:
      return sql`1 = 0`
  }
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
    conditions.push(taskStatusCondition(input.status))
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

export function findEvaluations(runID: string): EvaluationRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map(artifactRowToEvaluationRow)
}

export function findEvaluationsByTask(taskID: string): EvaluationRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map(artifactRowToEvaluationRow)
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

export function activeRunBySession(sessionID: string): RunRow | undefined {
  // Phase-6-e: run rows live in engine_artifact (kind="run"). Filter to
  // artifacts whose payload.session_id matches, then pick the latest per
  // logical run_id in a DISPATCHABLE_RUN_STATUSES state.
  const rows = Database.use((db) =>
    db
      .select({ artifact: EngineArtifactTable })
      .from(EngineArtifactTable)
      .innerJoin(EngineTaskTable, eq(EngineArtifactTable.task_id, EngineTaskTable.id))
      .where(
        and(
          eq(EngineTaskTable.project_id, Instance.project.id),
          eq(EngineArtifactTable.kind, "run"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.session_id') = ${sessionID}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all()
      .map((row) => row.artifact),
  )
  const collapsed = latestPerRun(rows).map(artifactRowToRunRow)
  return collapsed.find((r) =>
    (DISPATCHABLE_RUN_STATUSES as readonly string[]).includes(r.status),
  )
}

export function viewTask(row: TaskRow, input?: { directory?: string }) {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: input?.directory,
    sessionID: row.session_id ?? undefined,
    /** Phase-6-f-5: derived live from engine_spec_snapshot.status != 'superseded'
     *  (was a cache column on engine_task). */
    activeSpecVersionID: findActiveSpecForTask(row.id)?.id,
    /** Phase-6-f: derived live from engine_plan_version.status = 'active'
     *  (was a cache column on engine_task). */
    activePlanVersionID: findActivePlanForTask(row.id)?.id,
    /** Phase-6-f-3: derived live from engine_artifact kind="run" stream
     *  (was a cache column on engine_task). */
    activeRunID: findActiveRunForTask(row.id)?.id,
    requestID: row.request_id ?? undefined,
    source: row.source,
    title: row.title,
    request: row.request,
    status: deriveTaskStatus(row),
    priority: row.priority,
    kind: row.kind ?? "workflow",
    // Phase-6-f-4: task.blocking_reason cache removed; derive from the active
    // run when rendering.
    blockingReason: findActiveRunForTask(row.id)?.blocking_reason ?? undefined,
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

/** Phase-6-e helper: collapse the append-only run artifact stream into
 *  one row per logical run_id (the newest). Input must arrive sorted
 *  `time_created desc, id desc` so first-seen = newest. */
function latestPerRun(
  rows: Array<typeof EngineArtifactTable.$inferSelect>,
): Array<typeof EngineArtifactTable.$inferSelect> {
  const seen = new Set<string>()
  const result: Array<typeof EngineArtifactTable.$inferSelect> = []
  for (const row of rows) {
    // run-kind artifacts: first row self-references (id === run_id), follow-ups
    // explicitly set run_id. row.run_id is null only for stream-error kind,
    // never input here (callers filter by kind="run").
    const key = row.run_id ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

/** Reconstruct a `RunRow` from an `engine_artifact` row with kind="run". */
function artifactRowToRunRow(row: typeof EngineArtifactTable.$inferSelect): RunRow {
  const payload = (row.payload ?? {}) as {
    plan_version_id?: string | null
    session_id?: string | null
    executor?: import("./engine.sql").EngineExecutor
    status?: import("./engine.sql").EngineRunStatus
    phase?: import("./engine.sql").EngineRunPhase
    blocking_reason?: string | null
    error?: string | null
    retry_count?: number
    executor_ref?: import("./engine.sql").EngineExecutorRef | null
    metadata?: EngineMetadata | null
    time_started?: number | null
    time_completed?: number | null
  }
  return {
    // run-kind artifact: id === run_id (self-reference) on first row; both
    // are filled for follow-ups. Fallback to row.id covers the self-ref case
    // where run_id may not yet be persisted (defensive).
    id: row.run_id ?? row.id,
    task_id: row.task_id,
    plan_version_id: payload.plan_version_id ?? null,
    session_id: payload.session_id ?? null,
    executor: payload.executor ?? "opencode",
    status: payload.status ?? "queued",
    phase: payload.phase ?? "dispatch",
    blocking_reason: payload.blocking_reason ?? null,
    error: payload.error ?? null,
    retry_count: payload.retry_count ?? 0,
    executor_ref: payload.executor_ref ?? null,
    metadata: payload.metadata ?? null,
    time_started: payload.time_started ?? null,
    time_completed: payload.time_completed ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** Phase-6-d helper: collapse the append-only goal_run artifact stream into
 *  one row per logical goal_run_id (the newest, since input arrives
 *  `time_created desc`). Preserves input order so "latest overall" = [0]. */
function latestPerGoalRun(
  rows: Array<typeof EngineArtifactTable.$inferSelect>,
): Array<typeof EngineArtifactTable.$inferSelect> {
  const seen = new Set<string>()
  const result: Array<typeof EngineArtifactTable.$inferSelect> = []
  for (const row of rows) {
    const key = row.goal_run_id ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

/** Reconstruct a `GoalRunRow` from an `engine_artifact` row whose
 *  `kind === "goal_run_attempt"`. The payload carries all goal_run-specific
 *  state; only id/task_id/run_id/goal_run_id/timestamps come from columns. */
function artifactRowToGoalRunRow(row: typeof EngineArtifactTable.$inferSelect): GoalRunRow {
  const payload = (row.payload ?? {}) as {
    goal_id?: string
    plan_node_id?: string | null
    session_id?: string | null
    status?: EngineGoalRunStatus
    retry_count?: number
    blocking_reason?: string | null
    error?: string | null
    workspace_dir?: string | null
    base_ref?: string | null
    merge_ref?: string | null
    supersede_of?: string | null
    superseded_reason?: string | null
    superseded_at?: number | null
    metadata?: EngineMetadata | null
    time_started?: number | null
    time_completed?: number | null
  }
  return {
    id: row.goal_run_id ?? row.id,
    task_id: row.task_id,
    goal_id: payload.goal_id ?? "",
    plan_node_id: payload.plan_node_id ?? null,
    // goal_run_attempt artifacts always carry the coordinating run_id.
    coordinator_run_id: row.run_id!,
    session_id: payload.session_id ?? null,
    status: payload.status ?? "queued",
    retry_count: payload.retry_count ?? 0,
    blocking_reason: payload.blocking_reason ?? null,
    error: payload.error ?? null,
    workspace_dir: payload.workspace_dir ?? null,
    base_ref: payload.base_ref ?? null,
    merge_ref: payload.merge_ref ?? null,
    supersede_of: payload.supersede_of ?? null,
    superseded_reason: payload.superseded_reason ?? null,
    superseded_at: payload.superseded_at ?? null,
    metadata: payload.metadata ?? null,
    time_started: payload.time_started ?? null,
    time_completed: payload.time_completed ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** Reconstruct an `EvaluationRow` (historical `engine_evaluation` shape) from an
 *  `engine_artifact` row whose `kind === "verification-evidence"`. The payload
 *  written by `verification/persist.ts` carries scope/status/verdict/summary/checks
 *  plus time_completed; everything else (task_id, run_id, goal_run_id, delivery_id,
 *  timestamps) comes from the artifact columns. */
function artifactRowToEvaluationRow(row: typeof EngineArtifactTable.$inferSelect): EvaluationRow {
  const payload = (row.payload ?? {}) as {
    scope?: EngineEvaluationScope
    status?: EngineEvaluationStatus
    verdict?: EngineEvaluationVerdict
    summary?: string
    checks?: EngineEvaluationCheck[]
    time_completed?: number | null
  }
  return {
    id: row.id,
    task_id: row.task_id,
    // verification-evidence artifacts always carry run_id (writer enforces it).
    run_id: row.run_id!,
    goal_run_id: row.goal_run_id ?? null,
    delivery_id: row.delivery_id ?? null,
    scope: payload.scope ?? "delivery",
    status: payload.status ?? "pending",
    verdict: payload.verdict ?? "inconclusive",
    summary: payload.summary ?? "",
    checks: Array.isArray(payload.checks) ? payload.checks : null,
    time_completed: payload.time_completed ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}
