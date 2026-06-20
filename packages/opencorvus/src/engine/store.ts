import { Instance } from "@/project/instance"
import type { GoalWorkloadResult } from "@/goal-workload-analyst/types"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { SessionStatus } from "@/session/status"
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import {
  Database,
  NotFoundError,
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  sql,
} from "@/storage/db"
import type { SQL } from "@/storage/db"
import { specSnapshotIDsForLineage, type SpecSnapshotLineage } from "@/integrity/replay-lineage"
import { AcceptanceDiffSummary, EvaluationCheck } from "./model"
import {
  EngineArtifactTable,
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
  type AcceptanceResult,
  type EngineBudget,
  type EngineAcceptanceStatus,
  type EngineExecutorRef,
  type EngineArtifactKind,
  type EngineEvaluationCheck,
  type EngineEvaluationScope,
  type EngineEvaluationStatus,
  type EngineEvaluationVerdict,
  type EngineGoalRunStatus,
  type EngineMetadata,
} from "./engine.sql"
import {
  ACTIVE_GOAL_RUN_STATUSES,
  DISPATCHABLE_RUN_STATUSES,
  LIVE_GOAL_RUN_STATUSES,
  LIVE_RUN_STATUSES,
} from "./catalog"
import { deriveTaskStatus } from "./task-status"
import { ArchitectContractGraphSchema, type ArchitectContractGraph } from "@/architect/contract-graph"
import {
  ResearchBriefSchema,
  validateResearchBriefIntegrity,
  validateResearchBriefTaskBoundary,
  type ResearchBrief,
} from "@/research/schema"

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
/** Phase-6-c artifact-backed acceptance shape. Was `typeof EngineAcceptanceTable.$inferSelect`
 *  until `engine_acceptance` was deleted in favour of `engine_artifact` rows with
 *  kind="acceptance". Field names stay snake_case so old consumers do not churn.
 *  Reconstructed via `artifactRowToAcceptanceRow()` below. */
export type AcceptanceRow = {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string | null
  status: EngineAcceptanceStatus
  summary: string
  result: AcceptanceResult | null
  time_created: number
  time_updated: number
}
export type ArtifactRow = typeof EngineArtifactTable.$inferSelect
export type ResearchBriefArtifactRow = ArtifactRow & { payload: ResearchBrief }
/** Phase-6 artifact-backed evaluation shape. Was `typeof EngineEvaluationTable.$inferSelect`
 *  until `engine_evaluation` was deleted in favour of `engine_artifact` rows with
 *  kind="verification-evidence". Field names stay snake_case so old consumers do
 *  not churn. Reconstructed via `artifactRowToEvaluationRow()` below. */
export type EvaluationRow = {
  id: string
  task_id: string
  run_id: string
  goal_run_id: string | null
  acceptance_id: string | null
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
  /** Phase B (2026-05-05): branch checked out in workspace_dir. Was on
   *  engine_goal as the per-goal cache; now lives only on the per-attempt
   *  artifact, the single authoritative source. */
  workspace_branch: string | null
  /** Phase B (2026-05-05): goal-scoped Snapshot baseRef captured before the
   *  first attempt's executor ran. Reused across retries to keep "zero file
   *  changes" semantics anchored to the original scaffold rather than the
   *  post-prior-attempt state. Lives on every attempt artifact for this goal
   *  so cross-attempt readers don't need a separate column. */
  workspace_base_ref: string | null
  base_ref: string | null
  merge_ref: string | null
  supersede_of: string | null
  superseded_reason: string | null
  superseded_at: number | null
  metadata: EngineMetadata | null
  /** Process owner that drove this goal_run into a live status (processOwner()
   *  at dispatch). A live goal_run whose owner ≠ the current process owner is
   *  physically orphaned — the owning process restarted and the mid-stream turn
   *  cannot resume. Null for never-dispatched/queued rows. Spec:
   *  specs/new-arch/2026-05-29-goal-run-owner-orphan-liveness.md */
  owner: string | null
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

// Resolve a task into the set of session IDs that belong to it (root +
// orchestrator + every nested executor / sub-agent session). Memory rows are
// keyed by session_id, so to surface "task context" the panel must collect
// every session under the task tree. Returns an empty array when the task
// has no root session (deleted task / dangling FK), which collapses any
// downstream filter to "this task contributed nothing yet".
export function sessionIDsForTask(taskID: string): string[] {
  return Database.use((db) =>
    db
      .all<{ id: string }>(
        sql`
        WITH RECURSIVE session_tree(id) AS (
          SELECT session_id FROM engine_task WHERE id = ${taskID}
          UNION ALL
          SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id
        )
        SELECT id FROM session_tree WHERE id IS NOT NULL
      `,
      )
      .map((row) => row.id),
  )
}

// List direct child task IDs of `parentTaskID` — children are tasks whose
// `metadata.parent_task_id` matches. The relationship is currently only
// written by `propose_task` (orchestrator follow-up); both that and the
// mission dispatch path go through engine_task.metadata, so a JSON-extract
// scan is the only correct source. There is no FK column because the
// parentage is logical (mission lineage), not structural.
export function findChildrenOfTask(parentTaskID: string): string[] {
  return Database.use((db) =>
    db
      .all<{ id: string }>(
        sql`SELECT id FROM engine_task
            WHERE json_extract(metadata, '$.parent_task_id') = ${parentTaskID}
            ORDER BY time_created`,
      )
      .map((row) => row.id),
  )
}

export function listMissionTasks(input: { projectID: string; missionID: string; sessionID: string }): TaskRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(
        and(
          eq(EngineTaskTable.project_id, input.projectID),
          eq(EngineTaskTable.source, "mission"),
          sql`json_extract(${EngineTaskTable.metadata}, '$.actor') = 'mission'`,
          sql`json_extract(${EngineTaskTable.metadata}, '$.mission.id') = ${input.missionID}`,
          sql`json_extract(${EngineTaskTable.metadata}, '$.mission.session_id') = ${input.sessionID}`,
        ),
      )
      .orderBy(desc(EngineTaskTable.time_updated), desc(EngineTaskTable.id))
      .all(),
  )
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

export function findLatestArchitectContractGraph(taskID: string): ArchitectContractGraph | undefined {
  const row = findLatestArchitectContractGraphArtifact(taskID)
  return row ? ArchitectContractGraphSchema.parse(row.payload) : undefined
}

export function findLatestArchitectContractGraphArtifact(taskID: string): ArtifactRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "architect_contract_graph")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .get(),
  )
  return row
}

export function findLatestResearchBriefArtifact(taskID: string): ResearchBriefArtifactRow | undefined {
  return findLatestResearchBriefArtifactByKind(taskID, "research_brief")
}

export function findLatestFrontendResearchBriefArtifact(taskID: string): ResearchBriefArtifactRow | undefined {
  return findLatestResearchBriefArtifactByKind(taskID, "frontend_research_brief")
}

function findLatestResearchBriefArtifactByKind(
  taskID: string,
  kind: "research_brief" | "frontend_research_brief",
): ResearchBriefArtifactRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, kind),
          eq(EngineArtifactTable.label, "active"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const parsed = ResearchBriefSchema.safeParse(row.payload)
  if (!parsed.success) return undefined
  if (validateResearchBriefIntegrity(parsed.data)) return undefined
  if (validateResearchBriefTaskBoundary(parsed.data, taskID)) return undefined
  return { ...row, payload: parsed.data }
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
      .where(and(eq(EnginePlanVersionTable.task_id, taskID), eq(EnginePlanVersionTable.status, "active")))
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
      .where(and(eq(EngineSpecSnapshotTable.task_id, taskID), sql`${EngineSpecSnapshotTable.status} != 'superseded'`))
      .orderBy(desc(EngineSpecSnapshotTable.version))
      .get(),
  )
}

export function listSpecSnapshots(taskID: string): SpecSnapshotRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(eq(EngineSpecSnapshotTable.task_id, taskID))
      .orderBy(desc(EngineSpecSnapshotTable.version), desc(EngineSpecSnapshotTable.time_created))
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
      .where(and(eq(EngineArtifactTable.run_id, runID), eq(EngineArtifactTable.kind, "run")))
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

/** Task-level acceptance (goal_run_id IS NULL) for a run. Reads `engine_artifact`
 *  kind="acceptance" rows — append-only, so latest row per acceptance_id wins. */
export function findAcceptanceByRun(runID: string): AcceptanceRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.run_id, runID),
          eq(EngineArtifactTable.kind, "acceptance"),
          isNull(EngineArtifactTable.goal_run_id),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const latest = latestPerAcceptance(rows)[0]
  return latest ? artifactRowToAcceptanceRow(latest) : undefined
}

/** Find the most recent acceptance for a run, including goal-run deliveries. */
export function findLatestAcceptanceForRun(runID: string): AcceptanceRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.run_id, runID), eq(EngineArtifactTable.kind, "acceptance")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const latest = latestPerAcceptance(rows)[0]
  return latest ? artifactRowToAcceptanceRow(latest) : undefined
}

export function findDeliveriesForTask(taskID: string): AcceptanceRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "acceptance")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  return latestPerAcceptance(rows).map(artifactRowToAcceptanceRow)
}

export function findAcceptanceByGoalRun(goalRunID: string): AcceptanceRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.goal_run_id, goalRunID), eq(EngineArtifactTable.kind, "acceptance")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const latest = latestPerAcceptance(rows)[0]
  return latest ? artifactRowToAcceptanceRow(latest) : undefined
}

/** Phase-6-c helper: collapse the append-only acceptance artifact stream into
 *  one row per acceptance_id (the newest, since input arrives `time_created desc,
 *  id desc`).
 *  Preserves input order so callers that want "latest acceptance overall" just
 *  take [0]. */
function latestPerAcceptance(
  rows: Array<typeof EngineArtifactTable.$inferSelect>,
): Array<typeof EngineArtifactTable.$inferSelect> {
  const seen = new Set<string>()
  const result: Array<typeof EngineArtifactTable.$inferSelect> = []
  for (const row of rows) {
    const key = row.acceptance_id ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

function artifactRowToAcceptanceRow(row: typeof EngineArtifactTable.$inferSelect): AcceptanceRow {
  const payload = (row.payload ?? {}) as {
    status?: EngineAcceptanceStatus
    summary?: string
    result?: AcceptanceResult | null
  }
  return {
    id: row.acceptance_id ?? row.id,
    task_id: row.task_id,
    // acceptance-kind artifacts always have run_id set by writeAcceptanceRow;
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
      .where(and(eq(EngineArtifactTable.goal_run_id, goalRunID), eq(EngineArtifactTable.kind, "verification-evidence")))
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
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
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
 * Phase B (2026-05-05): single source for "the persistent worktree this goal
 * occupies right now". Replaces the engine_goal.workspace_dir / branch /
 * base_ref columns. Reads the live tip (newest goal_run that is not
 * superseded by another goal_run); supersede-state artifacts on retired
 * tips don't shadow the live attempt's pointer.
 *
 * Returns null when the goal has no attempts yet OR when the live tip
 * recorded workspace_dir = null (terminal cleanup, resetWorkspace, etc.).
 *
 * The columns are gone (rule 8: no dual source), so every read in the build
 * dispatch path, the cleanup path, and the board view comes through this
 * helper. The live tip's payload IS the persistent state.
 */
export function findGoalLatestWorkspace(goalID: string): {
  directory: string | null
  branch: string | null
  baseRef: string | null
  status: EngineGoalRunStatus | null
  goalRunID: string | null
} {
  const tip = findLatestTipGoalRun(goalID)
  if (!tip) return { directory: null, branch: null, baseRef: null, status: null, goalRunID: null }
  return {
    directory: tip.workspace_dir,
    branch: tip.workspace_branch,
    baseRef: tip.workspace_base_ref,
    status: tip.status,
    goalRunID: tip.id,
  }
}

/**
 * Phase E (2026-05-05): single source for the goal-level retry counter
 * (V label, integrity tracing). Pre-fix engine_goal.retry_count duplicated
 * the value already stored on every goal_run_attempt artifact's payload —
 * two writers, two readers, kept in sync only by convention. Rule 8 forbids
 * the duplicate; the column is gone now.
 *
 * Returns "the V number the next attempt will carry":
 *
 *   - No attempts yet → 0 (first attempt is V1 = 0+1).
 *   - Live tip (status active, no superseded_reason) → tip.retry_count
 *     (this IS the live attempt's V number, no bump).
 *   - Superseded tip (startNewAttempt patched superseded_reason but no
 *     new attempt artifact has been written yet) → tip.retry_count + 1.
 *     The bump can't ride on a separate column anymore (Phase E retired
 *     engine_goal.retry_count); it has to be derived from the supersede
 *     state, otherwise the gap between startNewAttempt and the next
 *     beginBuildAttempt reports the retired attempt's V number and the
 *     overlay shows a stale label.
 */
export function getGoalRetryCount(goalID: string): number {
  const tip = findLatestTipGoalRun(goalID)
  if (!tip) return 0
  return tip.retry_count + (tip.superseded_reason ? 1 : 0)
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
  const supersededIDs = new Set(rows.map((r) => r.supersede_of).filter((x): x is string => !!x))
  return rows.find((r) => !supersededIDs.has(r.id))
}

/**
 * Most recent goal_run that produced a acceptance artifact for the goal,
 * regardless of supersede status.
 *
 * Distinct semantic from {@link findLatestTipGoalRun}: the tip is "what is
 * the live attempt right now" (could be a fresh pending row created by
 * resetTaskGoalsToPending after a acceptance rejection). This helper answers
 * "what files have been merged / accepted into master for this goal so far"
 * — i.e. the most recent goal_run row whose acceptance row is non-null. The
 * tip and the latest-delivered run can diverge: a acceptance rejection
 * supersedes the previous tip with a new pending row; that new pending row
 * has no acceptance yet, but the prior superseded row's acceptance (and the
 * files it merged) are still the canonical "built" state.
 *
 * Overlay panels that show "files changed for this goal" must use this
 * helper, not findLatestTipGoalRun — otherwise post-rejection workflow
 * cards drop their changedFiles list and the overlay's Files panel
 * silently hides the goal even though the merge_back commit is still on
 * master.
 */
export function findLatestDeliveredGoalRun(goalID: string): GoalRunRow | undefined {
  return latestDeliveredGoalRunFromRows(listGoalRunsByGoal(goalID), (id) => findAcceptanceByGoalRun(id) !== undefined)
}

/**
 * Pure-function variant of {@link findLatestDeliveredGoalRun} for unit tests.
 * `rows` MUST be ordered newest-first (the same shape `listGoalRunsByGoal`
 * returns). `hasAcceptance` is invoked at most once per row, in newest-first
 * order, so callers can stub a small lookup map without a DB.
 */
export function latestDeliveredGoalRunFromRows<T extends { id: string }>(
  rows: T[],
  hasAcceptance: (goalRunID: string) => boolean,
): T | undefined {
  for (const row of rows) {
    if (hasAcceptance(row.id)) return row
  }
  return undefined
}

export function findEvaluationByRun(runID: string): EvaluationRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.run_id, runID), eq(EngineArtifactTable.kind, "verification-evidence")))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row ? artifactRowToEvaluationRow(row) : undefined
}

export function findGoal(goalID: string) {
  return Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get())
}

export function findGoalRun(goalRunID: string): GoalRunRow | undefined {
  // Tie-break by id (ascending identifier) so ties on time_created resolve
  // to the latest writer deterministically. Two appends in the same ms
  // otherwise give undefined ordering.
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.goal_run_id, goalRunID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
  return row ? artifactRowToGoalRunRow(row) : undefined
}

/**
 * Latest acceptance verdict artifact for `taskID`. The payload is the full
 * AcceptanceVerdict (summary, issues_found, rejection_details,
 * startup_verification, frontend_check). Surfaced by `buildSystemParts` into
 * the orchestrator prompt so the LLM sees historical acceptance evidence on
 * its next decision turn — a snapshot read, not a workflow gate.
 */
export function findLatestAcceptanceVerdictArtifact(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.label, "acceptance-review-verdict")))
      // id is a monotonic ascending id — the secondary key breaks same-ms ties
      // deterministically now that raw/host/final artifacts are written in the
      // same Date.now() batch (specs/acceptance-fresh-eyes-decoupling-2026-05-18.md §2.4).
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
}

export type IntegrityAttemptArtifactQuery = {
  taskID: string
  lineage: SpecSnapshotLineage
  /** Filter by recorded `phase` ("pre_build" | "post_build"). Omit to match
   *  any phase. The acceptance freshness gate uses `phase: "post_build"` so a
   *  pre-build review cannot satisfy the post-build completion requirement. */
  phase?: "pre_build" | "post_build"
}

export type LatestIntegrityAttemptArtifactQuery = {
  taskID: string
  specSnapshotID: string
  phase?: "pre_build" | "post_build"
}

export type IntegrityAttemptArtifactRow = ArtifactRow & {
  artifactID: string
  taskID: string
  specSnapshotID: string
  timeCreated: number
}

export function listIntegrityAttemptArtifacts(input: IntegrityAttemptArtifactQuery): IntegrityAttemptArtifactRow[] {
  if (input.taskID !== input.lineage.taskID) {
    throw new Error(
      `Integrity attempt query taskID ${input.taskID} does not match lineage taskID ${input.lineage.taskID}.`,
    )
  }
  return selectIntegrityAttemptArtifacts({
    taskID: input.taskID,
    specSnapshotIDs: specSnapshotIDsForLineage(input.lineage),
    phase: input.phase,
  })
}

export function findLatestIntegrityAttemptArtifact(input: LatestIntegrityAttemptArtifactQuery) {
  return selectIntegrityAttemptArtifacts({
    taskID: input.taskID,
    specSnapshotIDs: [input.specSnapshotID],
    phase: input.phase,
  })[0]
}

function selectIntegrityAttemptArtifacts(input: {
  taskID: string
  specSnapshotIDs: string[]
  phase?: "pre_build" | "post_build"
}): IntegrityAttemptArtifactRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "integrity_attempt"),
          input.specSnapshotIDs.length === 1
            ? sql`json_extract(${EngineArtifactTable.payload}, '$.spec_snapshot_id') = ${input.specSnapshotIDs[0]}`
            : inArray(sql`json_extract(${EngineArtifactTable.payload}, '$.spec_snapshot_id')`, input.specSnapshotIDs),
          input.phase ? sql`json_extract(${EngineArtifactTable.payload}, '$.phase') = ${input.phase}` : sql`1 = 1`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all()
      .map(toIntegrityAttemptArtifactRow),
  )
}

export function integrityAttemptVerdict(row: ArtifactRow | undefined | null) {
  const payload = row?.payload as { verdict?: unknown } | null | undefined
  const verdict = payload?.verdict
  return verdict === "pass" || verdict === "concerns" || verdict === "needs_correction" ? verdict : undefined
}

export type IntegrityArtifactMissingSessionStatus = {
  sessionID: string
  emittedAt: number
  error?: string
}

export function findLatestIntegrityArtifactMissingStatus(
  taskID: string,
): IntegrityArtifactMissingSessionStatus | undefined {
  const row = Database.use((db) =>
    db
      .select({
        sessionID: ProtocolEventTable.session_id,
        emittedAt: ProtocolEventTable.emitted_at,
        error: sql<string | null>`json_extract(${ProtocolEventTable.payload}, '$.status.error')`,
      })
      .from(ProtocolEventTable)
      .innerJoin(SessionTable, eq(SessionTable.id, ProtocolEventTable.session_id))
      .where(
        and(
          eq(ProtocolEventTable.task_id, taskID),
          eq(ProtocolEventTable.type, "session.status"),
          eq(SessionTable.kind, "integrity"),
          sql`json_extract(${ProtocolEventTable.payload}, '$.status.reason') = 'artifact_missing'`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${ProtocolEventTable} pe_newer
            WHERE pe_newer.session_id = ${ProtocolEventTable.session_id}
              AND pe_newer.type = 'session.status'
              AND (
                pe_newer.emitted_at > ${ProtocolEventTable.emitted_at}
                OR (
                  pe_newer.emitted_at = ${ProtocolEventTable.emitted_at}
                  AND pe_newer.seq > ${ProtocolEventTable.seq}
                )
              )
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${EngineArtifactTable} ea
            WHERE ea.task_id = ${taskID}
              AND ea.kind = 'integrity_attempt'
              AND json_extract(ea.payload, '$.session_id') = ${ProtocolEventTable.session_id}
              AND ea.time_created >= ${ProtocolEventTable.emitted_at}
          )`,
        ),
      )
      .orderBy(desc(ProtocolEventTable.emitted_at), desc(ProtocolEventTable.seq))
      .get(),
  )
  const sessionID = row?.sessionID
  if (!sessionID) return undefined
  return {
    sessionID,
    emittedAt: row.emittedAt,
    error: row.error ?? undefined,
  }
}

function toIntegrityAttemptArtifactRow(row: ArtifactRow): IntegrityAttemptArtifactRow {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}
  const specSnapshotID = typeof payload.spec_snapshot_id === "string" ? payload.spec_snapshot_id : ""
  return {
    ...row,
    artifactID: row.id,
    taskID: row.task_id,
    specSnapshotID,
    timeCreated: row.time_created,
  }
}

/** Latest acceptance-review-verdict artifact bound to a specific acceptance row.
 *  Used by the board view to render acceptance.status from the agent verdict
 *  rather than from the candidate-acceptance row's lifecycle status (which
 *  can stay "candidate" until explicit post-acceptance export, regardless of verdict). */
export function findLatestAcceptanceVerdictArtifactForAcceptance(acceptanceID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.acceptance_id, acceptanceID),
          eq(EngineArtifactTable.label, "acceptance-review-verdict"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
}

/**
 * Recent orchestrator-stream-error artifacts for a task, newest first.
 *
 * Each row marks a wake whose LLM stream aborted (provider onError, idle
 * watchdog, mid-stream protocol violation) before the orchestrator could
 * make any decision. `recordOrchestratorStreamError` (engine/persist.ts)
 * is the single writer; `describe.ts` is the single reader, surfacing
 * the rows into the orchestrator prompt so the LLM can decide
 * retry_task / restart_from_stage / fail_task on its next wake.
 *
 * Filtered by `time_created >= sinceMs` so a long-running task's old
 * incidents don't follow it forever; the bench / orchestrator pass
 * `task.time_started ?? task.time_created` as the floor.
 */
export function listOrchestratorStreamErrorArtifacts(taskID: string, sinceMs: number, limit: number) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "orchestrator-stream-error"),
          sql`${EngineArtifactTable.time_created} >= ${sinceMs}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(limit)
      .all(),
  )
}

export function listToolExecuteErrorArtifacts(taskID: string, sinceMs: number, limit: number) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "tool-execute-error"),
          sql`${EngineArtifactTable.time_created} >= ${sinceMs}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(limit)
      .all(),
  )
}

export function listGoalRefillNotificationArtifacts(taskID: string, limit: number) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "goal_refill_notification" as EngineArtifactKind),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(limit)
      .all(),
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
      .where(and(eq(EngineArtifactTable.run_id, coordinatorRunID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
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
      .where(and(eq(EngineArtifactTable.run_id, coordinatorRunID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
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
      .where(and(eq(EngineArtifactTable.run_id, coordinatorRunID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
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

/**
 * Latest active `goal_workload` artifact for a task (Goal Workload Analyst
 * output). Latest-wins by time_created; undefined when the analyst has not run.
 * Readers compare `spec_snapshot_id` against the active architect snapshot to
 * detect staleness (spec 2026-05-29-goal-workload-analyst §5).
 */
export function findLatestGoalWorkloadArtifact(taskID: string): GoalWorkloadResult | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "goal_workload"),
          eq(EngineArtifactTable.label, "active"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .limit(1)
      .all(),
  )[0]
  return row?.payload as GoalWorkloadResult | undefined
}

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
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "run")))
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
      .where(and(eq(EngineTaskTable.project_id, projectID), eq(EngineArtifactTable.kind, "run")))
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
      .where(and(eq(EngineTaskTable.project_id, projectID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
      .orderBy(desc(EngineArtifactTable.time_created))
      .all()
      .map((row) => row.artifact),
  )
  return latestPerGoalRun(rows)
    .map(artifactRowToGoalRunRow)
    .filter((r) => (LIVE_GOAL_RUN_STATUSES as readonly string[]).includes(r.status))
}

/**
 * Phase B: list goals that currently hold a live worktree on disk for a
 * project. Reads the goal_run_attempt artifact stream (latest row per goal),
 * filters to those whose payload still names a workspace_dir. Replaces the
 * direct EngineGoalTable read whose column source has been deleted.
 *
 * Returns the GoalRow for each match plus the workspace pointer. Cleanup
 * paths consume both: the goal id keys the cleanup invocation, the directory
 * is the path to delete on disk.
 */
export function listGoalWorkspacesForProject(projectID: string): Array<{
  goal: GoalRow
  workspaceDir: string
  status: EngineGoalRunStatus
}> {
  const artifactRows = Database.use((db) =>
    db
      .select({ artifact: EngineArtifactTable })
      .from(EngineArtifactTable)
      .innerJoin(EngineTaskTable, eq(EngineArtifactTable.task_id, EngineTaskTable.id))
      .where(and(eq(EngineTaskTable.project_id, projectID), eq(EngineArtifactTable.kind, "goal_run_attempt")))
      .orderBy(desc(EngineArtifactTable.time_created))
      .all()
      .map((row) => row.artifact),
  )
  const seen = new Set<string>()
  const out: Array<{ goal: GoalRow; workspaceDir: string; status: EngineGoalRunStatus }> = []
  for (const row of artifactRows) {
    const goalRun = artifactRowToGoalRunRow(row)
    if (seen.has(goalRun.goal_id)) continue
    seen.add(goalRun.goal_id)
    if (!goalRun.workspace_dir) continue
    const goal = findGoal(goalRun.goal_id)
    if (!goal) continue
    out.push({ goal, workspaceDir: goalRun.workspace_dir, status: goalRun.status })
  }
  return out
}

/**
 * Sessions whose latest durable `session.status` event is still active and
 * whose current process-owned SessionStatus latch is still active.
 * This is the describe-layer view of "what agents are currently working" —
 * it covers pre-plan sessions (requirements / architect / integrity /
 * frontend-design) which `goals` and `run` miss entirely because they're
 * gated on `active_plan_version_id`.
 *
 * Source: durable `session.status` supplies task/goal attribution and the
 * latest published lifecycle status. The process-owned SessionStatus latch
 * supplies live ownership. A recent-activity window is the wrong source: a
 * legitimate LLM turn can be silent until the activity idle gate fires. But
 * durable history alone is also wrong after process restart: a killed process
 * cannot finish its last `streaming` session, so the restarted sidecar must
 * not render that old row as currently active.
 */
export function listActiveSessionsForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select({
        sessionID: ProtocolEventTable.session_id,
        kind: SessionTable.kind,
        goalID: SessionTable.goal_id,
        lastActivityMs: ProtocolEventTable.emitted_at,
      })
      .from(ProtocolEventTable)
      .innerJoin(SessionTable, eq(SessionTable.id, ProtocolEventTable.session_id))
      .where(
        and(
          eq(ProtocolEventTable.task_id, taskID),
          eq(ProtocolEventTable.type, "session.status"),
          isNotNull(ProtocolEventTable.session_id),
          sql`json_extract(${ProtocolEventTable.payload}, '$.status.type') IN ('streaming', 'retry')`,
          sql`NOT EXISTS (
            SELECT 1 FROM protocol_event AS pe_newer
            WHERE pe_newer.session_id = ${ProtocolEventTable.session_id}
              AND pe_newer.type = 'session.status'
              AND (
                pe_newer.emitted_at > ${ProtocolEventTable.emitted_at}
                OR (
                  pe_newer.emitted_at = ${ProtocolEventTable.emitted_at}
                  AND pe_newer.seq > ${ProtocolEventTable.seq}
                )
              )
          )`,
        ),
      )
      .orderBy(desc(ProtocolEventTable.emitted_at))
      .all()
      .flatMap((row) =>
        row.sessionID && isSessionActiveInCurrentProcess(row.sessionID)
          ? [
              {
                sessionID: row.sessionID,
                kind: row.kind as string,
                goalID: row.goalID,
                lastActivityMs: row.lastActivityMs,
              },
            ]
          : [],
      ),
  )
}

function isSessionActiveInCurrentProcess(sessionID: string) {
  const status = SessionStatus.get(sessionID)
  return status.type === "streaming" || status.type === "retry"
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
export function searchProjectTasks(projectID: string, opts: { query?: string; status?: string; limit?: number }) {
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
      return and(isNull(EngineTaskTable.time_started), isNull(EngineTaskTable.time_completed))!
    case "active":
      return and(isNotNull(EngineTaskTable.time_started), isNull(EngineTaskTable.time_completed))!
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
  cursorTaskID?: string
  query?: string
  status?: string
  limit?: number
}) {
  const conditions: SQL[] = []

  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.cursor && input.cursorTaskID) {
    conditions.push(sql`(
      ${EngineTaskTable.time_updated} < ${input.cursor}
      OR (${EngineTaskTable.time_updated} = ${input.cursor} AND ${EngineTaskTable.id} < ${input.cursorTaskID})
    )`)
  } else if (input?.cursor) {
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
      .where(and(eq(EngineInteractionRequestTable.run_id, runID), eq(EngineInteractionRequestTable.status, "pending")))
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

export function listSpecSnapshotsForTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(eq(EngineSpecSnapshotTable.task_id, taskID))
      .orderBy(desc(EngineSpecSnapshotTable.version), desc(EngineSpecSnapshotTable.time_created))
      .all(),
  )
}

export function findEvaluations(runID: string): EvaluationRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.run_id, runID), eq(EngineArtifactTable.kind, "verification-evidence")))
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
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "verification-evidence")))
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
  return collapsed.find((r) => (DISPATCHABLE_RUN_STATUSES as readonly string[]).includes(r.status))
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
    parentTaskID:
      ((row.metadata as Record<string, unknown> | null | undefined)?.parent_task_id as string | undefined) ?? undefined,
    source: row.source,
    title: row.title,
    request: row.request,
    status: deriveTaskStatus(row),
    priority: row.priority,
    queue: {
      order: row.queue_order,
      revision: undefined as string | undefined,
    },
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

export function viewTaskListTask(row: TaskRow, input?: { directory?: string; queueRevision?: string }) {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: input?.directory,
    sessionID: row.session_id ?? undefined,
    requestID: row.request_id ?? undefined,
    parentTaskID:
      ((row.metadata as Record<string, unknown> | null | undefined)?.parent_task_id as string | undefined) ?? undefined,
    source: row.source,
    title: row.title,
    status: deriveTaskStatus(row),
    priority: row.priority,
    queue: {
      order: row.queue_order,
      revision: input?.queueRevision,
    },
    kind: row.kind ?? "workflow",
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
    specSnapshotID: row.spec_snapshot_id,
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
    kind: row.kind,
    requirement_ids: row.requirement_ids,
    priority: row.priority,
    // Phase E (2026-05-05): retry_count is no longer a goal column; derive
    // from the latest goal_run_attempt artifact via getGoalRetryCount.
    retryCount: getGoalRetryCount(row.id),
    // Phase B: workspaceDir / workspaceBranch are no longer goal columns;
    // callers that need them call findGoalLatestWorkspace(row.id) directly.
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
    acceptanceID: row.acceptance_id ?? undefined,
    kind: row.kind,
    label: row.label,
    payload: row.payload ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function viewAcceptance(row: AcceptanceRow) {
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
        ? result.artifacts.filter(
            (item): item is { kind: string; label: string; payload?: Record<string, unknown> } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).kind === "string" &&
              typeof (item as Record<string, unknown>).label === "string",
          )
        : [],
      publish:
        result.publish && typeof result.publish === "object" ? (result.publish as Record<string, unknown>) : undefined,
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
    acceptanceID: row.acceptance_id ?? undefined,
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

function budgetModel(input?: EngineBudget | null) {
  if (!input) return undefined
  return {
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
    const parsed = AcceptanceDiffSummary.safeParse(item)
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
    executor: payload.executor ?? "opencorvus",
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
    workspace_branch?: string | null
    workspace_base_ref?: string | null
    base_ref?: string | null
    merge_ref?: string | null
    supersede_of?: string | null
    superseded_reason?: string | null
    superseded_at?: number | null
    metadata?: EngineMetadata | null
    owner?: string | null
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
    workspace_branch: payload.workspace_branch ?? null,
    workspace_base_ref: payload.workspace_base_ref ?? null,
    base_ref: payload.base_ref ?? null,
    merge_ref: payload.merge_ref ?? null,
    supersede_of: payload.supersede_of ?? null,
    superseded_reason: payload.superseded_reason ?? null,
    superseded_at: payload.superseded_at ?? null,
    metadata: payload.metadata ?? null,
    owner: payload.owner ?? null,
    time_started: payload.time_started ?? null,
    time_completed: payload.time_completed ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

/** Reconstruct an `EvaluationRow` (historical `engine_evaluation` shape) from an
 *  `engine_artifact` row whose `kind === "verification-evidence"`. The payload
 *  written by `verification/persist.ts` carries scope/status/verdict/summary/checks
 *  plus time_completed; everything else (task_id, run_id, goal_run_id, acceptance_id,
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
    acceptance_id: row.acceptance_id ?? null,
    scope: payload.scope ?? "acceptance",
    status: payload.status ?? "pending",
    verdict: payload.verdict ?? "inconclusive",
    summary: payload.summary ?? "",
    checks: Array.isArray(payload.checks) ? payload.checks : null,
    time_completed: payload.time_completed ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}
