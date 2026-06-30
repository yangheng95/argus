import { Identifier } from "@/id/id"
import { processOwner } from "./lease"

/** Input shape for persisting a requirement extracted by the Requirements agent into
 *  engine_requirement. Mirrors the table columns plus an optional
 *  check_selector stored inside metadata. */
export interface Requirement {
  id: string
  title: string
  description: string
  acceptance: string[]
  evidence_refs: string[]
  non_goals?: string[]
  priority?: "blocking" | "advisory"
  check_selector?: string[]
  metadata?: Record<string, unknown>
}
import { writeEvaluationSnapshot } from "@/engine/docs"
import { Database, and, desc, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { Event, type AcceptanceDiffSummary } from "./model"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRequirementTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
  type EngineAcceptanceStatus,
  type EngineArtifactKind,
  type EngineGoalRunStatus,
} from "./engine.sql"
import { persistEvidence } from "@/verification/persist"
import type { ToolFailureCause } from "@/session/tool-failure-cause"
import type { SpecSnapshotLineage } from "@/integrity/replay-lineage"
import { doesGoalRunStatusImplyStarted, isLiveGoalRunStatus, isTerminalGoalRunStatus } from "./catalog"
import { isGoalRunOrphaned } from "./orphan"
import { findLiveBuildOwnershipByGoal } from "./tool-ownership"
import { SessionStatus } from "@/session/status"
import { EngineProtocol } from "./protocol"
import {
  findGoal,
  findGoalLatestWorkspace,
  findGoalRun,
  findLatestTipGoalRun,
  findPlan,
  listIntegrityAttemptArtifacts,
  listGoalRunsByGoal,
  listGoals,
  listGoalsForPlan,
  listOrchestratorStreamErrorArtifacts,
  requireTask,
  type GoalRow,
  type GoalRunRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { updateTask } from "./state"
import { isTaskTerminal } from "./task-status"
import { syncGoalStatus } from "./goal-status"
import { createDecisionLog } from "@/decision-log"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { ArchitectContractGraphSchema, type ArchitectContractGraph } from "@/architect/contract-graph"
import type { WorkloadBrief } from "@/goal-workload-analyst/types"
import {
  ResearchBriefSchema,
  validateResearchBriefIntegrity,
  validateResearchBriefTaskBoundary,
  type ResearchBrief,
} from "@/research/schema"
import { renderSpecsAsText } from "@/acceptance/types"

type EngineDatabaseConnection = Parameters<Parameters<typeof Database.transaction>[0]>[0]

const log = Log.create({ service: "engine-transition" })

function activeSessionStatus(sessionID: string): SessionStatus.Info | undefined {
  const status = SessionStatus.get(sessionID)
  return status.type === "streaming" || status.type === "retry" ? status : undefined
}

function liveGoalRunControlBlocker(input: { taskID: string; goalID: string; goalRun: GoalRunRow }): string | undefined {
  const liveOwner = findLiveBuildOwnershipByGoal({ taskID: input.taskID, goalID: input.goalID })
  if (liveOwner) {
    return (
      `goal ${input.goalID} is owned by live build tool ${liveOwner.payload.tool_part_id} ` +
      `(session ${liveOwner.payload.child_session_id}, ownership ${liveOwner.ownershipID})`
    )
  }
  if (input.goalRun.session_id) {
    const status = activeSessionStatus(input.goalRun.session_id)
    if (status) {
      return (
        `goal ${input.goalID} has active build session ${input.goalRun.session_id} ` +
        `(${status.type}) on goal_run ${input.goalRun.id}`
      )
    }
  }
  if (
    isLiveGoalRunStatus(input.goalRun.status) &&
    input.goalRun.owner &&
    input.goalRun.owner !== processOwner() &&
    !isGoalRunOrphaned(input.goalRun)
  ) {
    return `goal ${input.goalID} has goal_run ${input.goalRun.id} owned by live process ${input.goalRun.owner}`
  }
  return undefined
}

function retireLiveGoalRunWithoutControl(input: { goalRun: GoalRunRow; reason: string; now: number }): void {
  updateGoalRun(input.goalRun.id, {
    status: "aborted",
    error: input.reason,
    blocking_reason: null,
    time_completed: input.now,
  })
  recordAbortedBuildAttemptOutcome({
    goalRunID: input.goalRun.id,
    reason: input.reason,
    now: input.now,
  })
}

function latestBuildReportForGoal(taskID: string, goalID: string): string | undefined {
  const entry = createDecisionLog(taskID)
    .readByPhase("build")
    .filter((item) => item.goalID === goalID && item.key === "build_report_for_architecture_review")
    .at(-1)
  if (!entry) return undefined
  const parsed = JSON.parse(entry.value) as {
    status?: unknown
    summary?: unknown
    error?: unknown
    commit_ref?: unknown
  }
  const lines = [
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? `Report summary: ${parsed.summary.trim()}`
      : undefined,
    typeof parsed.error === "string" && parsed.error.length > 0 ? `Report error: ${parsed.error.trim()}` : undefined,
  ].filter((line): line is string => Boolean(line))
  if (lines.length === 0) {
    throw new Error(`latestBuildReportForGoal: malformed empty build report ${entry.id} for goal ${goalID}`)
  }
  return lines.join("\n")
}

function retryFeedbackValueFromGoalRun(input: { taskID: string; goalID: string; priorRun: GoalRunRow }): string {
  const lines: string[] = []
  if (input.priorRun.error && input.priorRun.error.trim().length > 0) {
    lines.push(
      `Previous goal_run ${input.priorRun.id} terminal error (status=${input.priorRun.status}): ${input.priorRun.error.trim()}`,
    )
  }
  const report = latestBuildReportForGoal(input.taskID, input.goalID)
  if (report) {
    lines.push(report)
  }
  if (lines.length === 0)
    lines.push(
      `Previous build attempt ${input.priorRun.id} recorded no terminal error; status=${input.priorRun.status}.`,
    )
  return lines.join("\n")
}

function appendRetryFeedbackOnce(input: {
  taskID: string
  goalID: string
  key: string
  value: string
  reason: string
}): boolean {
  const decisionLog = createDecisionLog(input.taskID)
  const existing = decisionLog.readByKey(input.key)
  if (existing?.value === input.value) return false
  decisionLog.append({
    goalID: input.goalID,
    phase: "retry",
    key: input.key,
    value: input.value,
    reason: existing ? `${input.reason}; supersedes decision_log ${existing.id}` : input.reason,
  })
  return true
}

function appendBuildRetryFeedbackForPriorRun(input: {
  taskID: string
  goalID: string
  priorRun: GoalRunRow
  source: string
}): boolean {
  if (!isTerminalGoalRunStatus(input.priorRun.status)) return false
  return appendRetryFeedbackOnce({
    taskID: input.taskID,
    goalID: input.goalID,
    key: `build_retry_previous_${input.priorRun.id}`,
    value: retryFeedbackValueFromGoalRun(input),
    reason:
      `${input.source}: superseding previous goal_run ${input.priorRun.id} ` +
      `status=${input.priorRun.status}${input.priorRun.error ? ` error=${input.priorRun.error.trim()}` : ""}`,
  })
}

export function ensureBuildRetryFeedbackForGoal(input: { taskID: string; goalID: string; source: string }): boolean {
  const tip = findLatestTipGoalRun(input.goalID)
  if (!tip) return false
  return appendBuildRetryFeedbackForPriorRun({
    taskID: input.taskID,
    goalID: input.goalID,
    priorRun: tip,
    source: input.source,
  })
}

/**
 * Derive a human-readable slug from a goal title. Display-only — goal_id
 * remains the sole identity. Immutable once set.
 */
export function goalSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "goal"
  )
}

interface GoalRowInput {
  goalID?: string
  title: string
  objective: string
  acceptance_specs: import("@/acceptance/types").AcceptanceSpec[]
  owned_paths?: string[]
  depends_on?: string[]
  kind?: string
  requirement_ids?: string[]
  priority?: "blocking" | "advisory"
  source?: "spec" | "system"
  metadata?: Record<string, unknown>
}

export type AppendGoalToActiveGraphInput = {
  taskID: string
  specSnapshotID: string
  planVersionID?: string | null
  goal: GoalRowInput
  now: number
}

export type AppendGoalToActiveGraphResult = {
  id: string
  title: string
  orderIndex: number
  planNodeID?: string
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function metadataWithDependsOnGoalIDs(metadata: unknown, dependsOn: string[]): Record<string, unknown> | null {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  if (dependsOn.length > 0) {
    base.depends_on_goal_ids = dependsOn
  } else {
    delete base.depends_on_goal_ids
  }
  return Object.keys(base).length > 0 ? base : null
}

function pruneGoalDependenciesForDeletedGoals(
  db: Database.TxOrDb,
  input: {
    taskID: string
    deletedGoalIDs: string[]
  },
): number {
  const deleted = new Set(input.deletedGoalIDs)
  if (deleted.size === 0) return 0

  let refsPruned = 0
  const rows = db
    .select({
      id: EngineGoalTable.id,
      depends_on: EngineGoalTable.depends_on,
      metadata: EngineGoalTable.metadata,
    })
    .from(EngineGoalTable)
    .where(eq(EngineGoalTable.task_id, input.taskID))
    .all()

  for (const row of rows) {
    if (deleted.has(row.id)) continue
    const dependsOn = stringArray(row.depends_on)
    const nextDependsOn = dependsOn.filter((depID) => !deleted.has(depID))
    const pruned = dependsOn.length - nextDependsOn.length
    const nextMetadata = metadataWithDependsOnGoalIDs(row.metadata, nextDependsOn)
    const metadataChanged = JSON.stringify(row.metadata ?? null) !== JSON.stringify(nextMetadata)
    if (pruned === 0 && !metadataChanged) continue
    refsPruned += pruned
    db.update(EngineGoalTable)
      .set({
        depends_on: nextDependsOn,
        metadata: nextMetadata,
        time_updated: Date.now(),
      })
      .where(eq(EngineGoalTable.id, row.id))
      .run()
  }

  return refsPruned
}

function prunePlanNodeDependenciesForDeletedNodes(
  db: Database.TxOrDb,
  input: {
    taskID: string
    deletedPlanNodeIDs: string[]
  },
): number {
  const deleted = new Set(input.deletedPlanNodeIDs)
  if (deleted.size === 0) return 0

  let refsPruned = 0
  const rows = db
    .select({
      id: EnginePlanNodeTable.id,
      depends_on_ids: EnginePlanNodeTable.depends_on_ids,
    })
    .from(EnginePlanNodeTable)
    .where(eq(EnginePlanNodeTable.task_id, input.taskID))
    .all()

  for (const row of rows) {
    if (deleted.has(row.id)) continue
    const dependsOn = stringArray(row.depends_on_ids)
    const nextDependsOn = dependsOn.filter((depID) => !deleted.has(depID))
    const pruned = dependsOn.length - nextDependsOn.length
    if (pruned === 0) continue
    refsPruned += pruned
    db.update(EnginePlanNodeTable)
      .set({
        depends_on_ids: nextDependsOn.length > 0 ? nextDependsOn : null,
        time_updated: Date.now(),
      })
      .where(eq(EnginePlanNodeTable.id, row.id))
      .run()
  }

  return refsPruned
}

export function deleteGoalRowsForTask(
  db: Database.TxOrDb,
  input: {
    taskID: string
    goalIDs: string[]
  },
): {
  deletedGoals: number
  deletedPlanNodes: number
  prunedGoalDependencyRefs: number
  prunedPlanNodeDependencyRefs: number
} {
  const goalIDs = [...new Set(input.goalIDs.filter(Boolean))]
  if (goalIDs.length === 0) {
    return {
      deletedGoals: 0,
      deletedPlanNodes: 0,
      prunedGoalDependencyRefs: 0,
      prunedPlanNodeDependencyRefs: 0,
    }
  }

  const goalRows = db
    .select({ id: EngineGoalTable.id })
    .from(EngineGoalTable)
    .where(and(eq(EngineGoalTable.task_id, input.taskID), inArray(EngineGoalTable.id, goalIDs)))
    .all()
  const existingGoalIDs = goalRows.map((row) => row.id)
  if (existingGoalIDs.length === 0) {
    return {
      deletedGoals: 0,
      deletedPlanNodes: 0,
      prunedGoalDependencyRefs: 0,
      prunedPlanNodeDependencyRefs: 0,
    }
  }

  const planNodeRows = db
    .select({ id: EnginePlanNodeTable.id })
    .from(EnginePlanNodeTable)
    .where(and(eq(EnginePlanNodeTable.task_id, input.taskID), inArray(EnginePlanNodeTable.goal_id, existingGoalIDs)))
    .all()
  const planNodeIDs = planNodeRows.map((row) => row.id)

  const prunedGoalDependencyRefs = pruneGoalDependenciesForDeletedGoals(db, {
    taskID: input.taskID,
    deletedGoalIDs: existingGoalIDs,
  })
  const prunedPlanNodeDependencyRefs = prunePlanNodeDependenciesForDeletedNodes(db, {
    taskID: input.taskID,
    deletedPlanNodeIDs: planNodeIDs,
  })

  if (planNodeIDs.length > 0) {
    db.delete(EnginePlanNodeTable).where(inArray(EnginePlanNodeTable.id, planNodeIDs)).run()
  }
  db.delete(EngineGoalTable).where(inArray(EngineGoalTable.id, existingGoalIDs)).run()

  return {
    deletedGoals: existingGoalIDs.length,
    deletedPlanNodes: planNodeIDs.length,
    prunedGoalDependencyRefs,
    prunedPlanNodeDependencyRefs,
  }
}

export function deleteTaskGoals(db: Database.TxOrDb, taskID: string) {
  const rows = db
    .select({ id: EngineGoalTable.id })
    .from(EngineGoalTable)
    .where(eq(EngineGoalTable.task_id, taskID))
    .all()
  return deleteGoalRowsForTask(db, {
    taskID,
    goalIDs: rows.map((row) => row.id),
  })
}

export function insertGoalRows(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    planVersionID?: string
    goals: GoalRowInput[]
    now: number
  },
) {
  return input.goals.map((goal, index) => {
    const goalID = goal.goalID ?? Identifier.ascending("goal")
    const deps = goal.depends_on ?? []
    const metadata =
      goal.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata) ? goal.metadata : undefined
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: input.taskID,
        plan_version_id: input.planVersionID ?? null,
        spec_snapshot_id: input.specSnapshotID,
        title: goal.title,
        slug: goalSlug(goal.title),
        objective: goal.objective,
        acceptance_specs: goal.acceptance_specs,
        owned_paths: goal.owned_paths ?? [],
        depends_on: deps,
        kind: goal.kind ?? "feature",
        requirement_ids: goal.requirement_ids ?? [],
        metadata: {
          ...metadata,
          depends_on_goal_ids: deps.length > 0 ? deps : undefined,
        },
        priority: goal.priority ?? "blocking",
        source: goal.source ?? "spec",
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: goalID,
      title: goal.title,
      objective: goal.objective,
      acceptance_specs: goal.acceptance_specs,
      priority: goal.priority,
      metadata,
    }
  })
}

/**
 * Append one Orchestrator-owned goal to the current graph. This is the single
 * writer for follow-up operator instructions that add one concrete buildable
 * surface without asking Architect to regenerate the full graph.
 */
export function appendGoalToActiveGraph(
  db: Database.TxOrDb,
  input: AppendGoalToActiveGraphInput,
): AppendGoalToActiveGraphResult {
  const existingGoals = db
    .select({
      id: EngineGoalTable.id,
      order_index: EngineGoalTable.order_index,
    })
    .from(EngineGoalTable)
    .where(eq(EngineGoalTable.task_id, input.taskID))
    .all()
  const existingGoalIDs = new Set(existingGoals.map((goal) => goal.id))
  const deps = input.goal.depends_on ?? []
  for (const dep of deps) {
    if (!existingGoalIDs.has(dep)) {
      throw new Error(`appendGoalToActiveGraph: depends_on references unknown goal ${dep}`)
    }
  }

  const goalID = input.goal.goalID ?? Identifier.ascending("goal")
  if (existingGoalIDs.has(goalID)) {
    throw new Error(`appendGoalToActiveGraph: goal id already exists: ${goalID}`)
  }
  const orderIndex = existingGoals.reduce((max, goal) => Math.max(max, goal.order_index), -1) + 1
  const metadata =
    input.goal.metadata && typeof input.goal.metadata === "object" && !Array.isArray(input.goal.metadata)
      ? input.goal.metadata
      : undefined

  db.insert(EngineGoalTable)
    .values({
      id: goalID,
      task_id: input.taskID,
      plan_version_id: input.planVersionID ?? null,
      spec_snapshot_id: input.specSnapshotID,
      title: input.goal.title,
      slug: goalSlug(input.goal.title),
      objective: input.goal.objective,
      acceptance_specs: input.goal.acceptance_specs,
      owned_paths: input.goal.owned_paths ?? [],
      depends_on: deps,
      kind: input.goal.kind ?? "feature",
      requirement_ids: input.goal.requirement_ids ?? [],
      metadata: {
        ...metadata,
        source: "operator_add_goal",
        depends_on_goal_ids: deps.length > 0 ? deps : undefined,
      },
      priority: input.goal.priority ?? "blocking",
      source: input.goal.source ?? "system",
      order_index: orderIndex,
      time_created: input.now,
      time_updated: input.now,
    })
    .run()

  let planNodeID: string | undefined
  if (input.planVersionID) {
    const planNodes = db
      .select({
        id: EnginePlanNodeTable.id,
        goal_id: EnginePlanNodeTable.goal_id,
      })
      .from(EnginePlanNodeTable)
      .where(
        and(
          eq(EnginePlanNodeTable.task_id, input.taskID),
          eq(EnginePlanNodeTable.plan_version_id, input.planVersionID),
        ),
      )
      .all()
    const nodeByGoal = new Map(planNodes.map((node) => [node.goal_id, node.id]))
    const dependsOnNodeIDs = deps.map((dep) => {
      const nodeID = nodeByGoal.get(dep)
      if (!nodeID) {
        throw new Error(`appendGoalToActiveGraph: active plan ${input.planVersionID} has no node for dependency ${dep}`)
      }
      return nodeID
    })
    planNodeID = Identifier.ascending("plan_node")
    db.insert(EnginePlanNodeTable)
      .values({
        id: planNodeID,
        task_id: input.taskID,
        plan_version_id: input.planVersionID,
        kind: "goal",
        goal_id: goalID,
        title: input.goal.title,
        brief: renderSpecsAsText(input.goal.acceptance_specs),
        depends_on_ids: dependsOnNodeIDs.length > 0 ? dependsOnNodeIDs : undefined,
        order_index: orderIndex,
        metadata: {
          source: "operator_add_goal",
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.update(EnginePlanVersionTable)
      .set({
        summary: `${planNodes.length + 1} goals`,
        time_updated: input.now,
      })
      .where(eq(EnginePlanVersionTable.id, input.planVersionID))
      .run()
  }

  return {
    id: goalID,
    title: input.goal.title,
    orderIndex,
    ...(planNodeID ? { planNodeID } : {}),
  }
}

/**
 * Architect-driven goal upsert.
 *
 * Sole persistence path from the Architect's goal set into engine_goal. Computes
 * a diff against the existing rows for the task and applies INSERT / UPDATE /
 * DELETE atomically:
 *
 *   • id matches an existing row                       → UPDATE contract fields
 *   • id is not in DB and not in `removedLLMIDs`       → INSERT as new goal
 *   • existing row whose id is in `removedLLMIDs`      → DELETE row
 *   • existing row not referenced at all               → kept as-is
 *
 * The Architect emits a mix of DB ids (seeded from the current row set) and
 * fresh LLM ids (for newly registered goals). `depends_on` may point at either,
 * so we build an LLM-id → DB-id map once and rewrite deps before each write.
 *
 * Returns the final goal set as DB rows plus the id translation map (empty
 * values for pure identity mappings).
 */
export function upsertGoalsFromArchitect(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    architectGoals: Array<GoalRowInput & { llmID: string }>
    removedLLMIDs: string[]
    now: number
  },
): {
  persisted: Array<{
    id: string
    title: string
    llmID: string
    depends_on: string[]
    acceptance_specs: GoalRowInput["acceptance_specs"]
  }>
  llmToDBID: Map<string, string>
  deletedIDs: string[]
} {
  const existing = listGoals(input.taskID)
  const existingByID = new Map(existing.map((g) => [g.id, g]))
  const maxExistingOrderIndex = existing.reduce((max, goal) => Math.max(max, goal.order_index), -1)
  let nextNewOrderIndex = maxExistingOrderIndex + 1

  for (const goal of input.architectGoals) {
    const internalRuntimePaths = ProjectRuntimePaths.internalRuntimeRelativePaths(goal.owned_paths ?? [])
    if (internalRuntimePaths.length > 0) {
      throw new Error(
        `upsertGoalsFromArchitect: goal ${goal.llmID} owned_paths include internal OpenCorvus runtime path(s): ` +
          `${internalRuntimePaths.join(", ")}. Runtime evidence under .opencorvus/r/ is read-only input; ` +
          `durable build deliverables must be planned under project source/docs paths.`,
      )
    }
  }

  // First pass: assign DB ids for every goal in the Architect output. Existing
  // ids stay the same; fresh LLM ids get a new DB id. Builds the id map that
  // the second pass consults when rewriting depends_on.
  const llmToDBID = new Map<string, string>()
  const plan: Array<{ llmID: string; dbID: string; isNew: boolean; goal: GoalRowInput }> = []
  for (const goal of input.architectGoals) {
    if (existingByID.has(goal.llmID)) {
      llmToDBID.set(goal.llmID, goal.llmID)
      plan.push({ llmID: goal.llmID, dbID: goal.llmID, isNew: false, goal })
    } else {
      const dbID = Identifier.ascending("goal")
      llmToDBID.set(goal.llmID, dbID)
      plan.push({ llmID: goal.llmID, dbID, isNew: true, goal })
    }
  }

  // DELETE: rows whose ids the Architect explicitly removed. Removing a goal
  // also removes every dependent edge that points at it; otherwise a re-run
  // that splits a goal can leave "depends_on not registered" blockers behind
  // and trap Architect in a repair loop.
  const deletedIDs: string[] = []
  const removedDepIDs = new Set(input.removedLLMIDs)
  for (const llmID of input.removedLLMIDs) {
    const dbID = llmToDBID.get(llmID) ?? (existingByID.has(llmID) ? llmID : undefined)
    if (!dbID) continue
    removedDepIDs.add(dbID)
    deletedIDs.push(dbID)
  }
  if (deletedIDs.length > 0) {
    deleteGoalRowsForTask(db, {
      taskID: input.taskID,
      goalIDs: deletedIDs,
    })
  }

  const persisted: Array<{
    id: string
    title: string
    llmID: string
    depends_on: string[]
    acceptance_specs: GoalRowInput["acceptance_specs"]
  }> = []
  for (let index = 0; index < plan.length; index++) {
    const { llmID, dbID, isNew, goal } = plan[index]
    const orderIndex = isNew ? nextNewOrderIndex++ : (existingByID.get(dbID)?.order_index ?? index)
    const deps = (goal.depends_on ?? []).flatMap((dep) => {
      if (removedDepIDs.has(dep)) return []
      const mapped = llmToDBID.get(dep)
      if (mapped) return removedDepIDs.has(mapped) ? [] : [mapped]
      if (existingByID.has(dep) && !removedDepIDs.has(dep)) return [dep]
      throw new Error(`upsertGoalsFromArchitect: goal ${dbID} depends_on references unknown id ${dep}`)
    })
    const priorMetadata =
      existingByID.get(dbID)?.metadata && typeof existingByID.get(dbID)!.metadata === "object"
        ? (existingByID.get(dbID)!.metadata as Record<string, unknown>)
        : {}
    const metadata = {
      ...priorMetadata,
      ...(goal.metadata ?? {}),
      architect_llm_id: llmID,
      depends_on_goal_ids: deps.length > 0 ? deps : undefined,
    }

    if (isNew) {
      db.insert(EngineGoalTable)
        .values({
          id: dbID,
          task_id: input.taskID,
          plan_version_id: null,
          spec_snapshot_id: input.specSnapshotID,
          title: goal.title,
          slug: goalSlug(goal.title),
          objective: goal.objective,
          acceptance_specs: goal.acceptance_specs,
          owned_paths: goal.owned_paths ?? [],
          depends_on: deps,
          kind: goal.kind ?? "feature",
          requirement_ids: goal.requirement_ids ?? [],
          metadata,
          priority: goal.priority ?? "blocking",
          source: goal.source ?? "spec",
          order_index: orderIndex,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    } else {
      db.update(EngineGoalTable)
        .set({
          spec_snapshot_id: input.specSnapshotID,
          title: goal.title,
          objective: goal.objective,
          acceptance_specs: goal.acceptance_specs,
          owned_paths: goal.owned_paths ?? [],
          depends_on: deps,
          kind: goal.kind ?? "feature",
          requirement_ids: goal.requirement_ids ?? [],
          metadata,
          priority: goal.priority ?? "blocking",
          order_index: orderIndex,
          time_updated: input.now,
        })
        .where(eq(EngineGoalTable.id, dbID))
        .run()
    }
    persisted.push({ id: dbID, title: goal.title, llmID, depends_on: deps, acceptance_specs: goal.acceptance_specs })
  }

  return { persisted, llmToDBID, deletedIDs }
}

export function persistArchitectContractGraph(
  db: Database.TxOrDb,
  input: {
    taskID: string
    graph: ArchitectContractGraph
    now: number
  },
) {
  const graph = ArchitectContractGraphSchema.parse(input.graph)
  const id = Identifier.ascending("artifact")
  db.insert(EngineArtifactTable)
    .values({
      id,
      task_id: input.taskID,
      run_id: null,
      goal_run_id: null,
      acceptance_id: null,
      kind: "architect_contract_graph",
      label: "active",
      payload: graph,
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  return id
}

/**
 * Persist a Goal Workload Analyst run as a single task-level `goal_workload`
 * artifact (latest-wins; mirrors `persistArchitectContractGraph`). The payload
 * is a `GoalWorkloadResult` whose `spec_snapshot_id` binds the briefs to the
 * architect snapshot they were computed against — readers (architect re-run
 * input / build injection / describe) only accept briefs matching the active
 * snapshot, so a newer architect snapshot auto-stales old briefs without a
 * delete (spec 2026-05-29-goal-workload-analyst §5).
 */
export function persistGoalWorkload(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    briefs: WorkloadBrief[]
    summary: string
    now: number
  },
) {
  const id = Identifier.ascending("artifact")
  db.insert(EngineArtifactTable)
    .values({
      id,
      task_id: input.taskID,
      run_id: null,
      goal_run_id: null,
      acceptance_id: null,
      kind: "goal_workload",
      label: "active",
      payload: {
        briefs: input.briefs,
        spec_snapshot_id: input.specSnapshotID,
        summary: input.summary,
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  return id
}

export function persistResearchBrief(
  db: Database.TxOrDb,
  input: {
    taskID: string
    brief: ResearchBrief
    now: number
  },
) {
  return persistResearchBriefArtifact(db, {
    ...input,
    kind: "research_brief",
  })
}

export function persistFrontendResearchBrief(
  db: Database.TxOrDb,
  input: {
    taskID: string
    brief: ResearchBrief
    now: number
  },
) {
  return persistResearchBriefArtifact(db, {
    ...input,
    kind: "frontend_research_brief",
  })
}

function persistResearchBriefArtifact(
  db: Database.TxOrDb,
  input: {
    taskID: string
    brief: ResearchBrief
    now: number
    kind: "research_brief" | "frontend_research_brief"
  },
) {
  const brief = ResearchBriefSchema.parse(input.brief)
  const integrityError = validateResearchBriefIntegrity(brief)
  if (integrityError) {
    throw new Error(`${input.kind}: ${integrityError}`)
  }
  const boundaryError = validateResearchBriefTaskBoundary(brief, input.taskID)
  if (boundaryError) {
    throw new Error(`${input.kind}: ${boundaryError}`)
  }
  const id = Identifier.ascending("artifact")
  db.insert(EngineArtifactTable)
    .values({
      id,
      task_id: input.taskID,
      run_id: null,
      goal_run_id: null,
      acceptance_id: null,
      kind: input.kind,
      label: "active",
      payload: brief,
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  return id
}

export function persistTaskResearchBrief(input: { taskID: string; brief: ResearchBrief; now?: number }) {
  return Database.use((db) =>
    persistResearchBrief(db, {
      taskID: input.taskID,
      brief: input.brief,
      now: input.now ?? Date.now(),
    }),
  )
}

export function persistTaskFrontendResearchBrief(input: { taskID: string; brief: ResearchBrief; now?: number }) {
  return Database.use((db) =>
    persistFrontendResearchBrief(db, {
      taskID: input.taskID,
      brief: input.brief,
      now: input.now ?? Date.now(),
    }),
  )
}

export function persistTaskArchitectContractGraph(input: {
  taskID: string
  graph: ArchitectContractGraph
  now?: number
}) {
  return Database.use((db) =>
    persistArchitectContractGraph(db, {
      taskID: input.taskID,
      graph: input.graph,
      now: input.now ?? Date.now(),
    }),
  )
}

export function insertRequirements(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    requirements: Requirement[]
    now: number
  },
) {
  return input.requirements.map((requirement, index) => {
    const requestedID = typeof requirement.id === "string" ? requirement.id.trim() : ""
    const requirementID = Identifier.ascending("requirement")
    db.insert(EngineRequirementTable)
      .values({
        id: requirementID,
        task_id: input.taskID,
        spec_snapshot_id: input.specSnapshotID,
        title: requirement.title,
        description: requirement.description,
        status: "pending",
        priority: requirement.priority === "advisory" ? "advisory" : "blocking",
        acceptance: Array.isArray(requirement.acceptance)
          ? JSON.stringify(requirement.acceptance)
          : requirement.acceptance,
        evidence_refs: requirement.evidence_refs.length > 0 ? requirement.evidence_refs : null,
        non_goals: requirement.non_goals && requirement.non_goals.length > 0 ? requirement.non_goals : null,
        metadata: {
          ...(requirement.metadata ?? {}),
          ...(requestedID ? { source_requirement_id: requestedID } : {}),
        },
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: requirementID,
      sourceRequirementID: requestedID || requirementID,
      title: requirement.title,
      priority: requirement.priority === "advisory" ? ("advisory" as const) : ("blocking" as const),
    }
  })
}

export function copyRequirementsToSpecSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    fromSpecSnapshotID: string
    toSpecSnapshotID: string
    now: number
  },
) {
  if (input.fromSpecSnapshotID === input.toSpecSnapshotID) {
    throw new Error(
      `copyRequirementsToSpecSnapshot: source and target spec are identical (${input.fromSpecSnapshotID})`,
    )
  }

  const existingTargetRows = db
    .select({ id: EngineRequirementTable.id })
    .from(EngineRequirementTable)
    .where(eq(EngineRequirementTable.spec_snapshot_id, input.toSpecSnapshotID))
    .all()
  if (existingTargetRows.length > 0) {
    throw new Error(
      `copyRequirementsToSpecSnapshot: target spec ${input.toSpecSnapshotID} already has ` +
        `${existingTargetRows.length} requirement row(s)`,
    )
  }

  const sourceRows = db
    .select()
    .from(EngineRequirementTable)
    .where(
      and(
        eq(EngineRequirementTable.task_id, input.taskID),
        eq(EngineRequirementTable.spec_snapshot_id, input.fromSpecSnapshotID),
      ),
    )
    .orderBy(EngineRequirementTable.order_index)
    .all()

  for (const row of sourceRows) {
    db.insert(EngineRequirementTable)
      .values({
        id: Identifier.ascending("requirement"),
        task_id: input.taskID,
        spec_snapshot_id: input.toSpecSnapshotID,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        acceptance: row.acceptance,
        evidence_refs: row.evidence_refs,
        non_goals: row.non_goals,
        metadata: row.metadata,
        order_index: row.order_index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }

  return sourceRows.length
}

export function createGoalRun(input: {
  taskID: string
  goalID: string
  planNodeID?: string
  coordinatorRunID: string
  sessionID?: string
  retryCount?: number
  blockingReason?: string | null
  error?: string | null
  workspaceDir?: string
  /** Phase B (2026-05-05): persistent worktree branch checked out in
   *  workspaceDir. Was on engine_goal until the column-vs-payload duplicate
   *  was retired; now lives only on the per-attempt artifact payload. */
  workspaceBranch?: string
  /** Phase B (2026-05-05): goal-scoped Snapshot baseRef captured before the
   *  first attempt's executor ran. Reused across retries via
   *  findGoalLatestWorkspace. */
  workspaceBaseRef?: string
  baseRef?: string
  mergeRef?: string
  metadata?: Record<string, unknown>
  /** When set, this new goal_run supersedes the referenced prior row.
   *  Used by retry flows to re-dispatch a goal whose prior run is in a
   *  terminal (completed/failed/aborted) status without mutating the
   *  goal_run FSM. Readiness / dispatch / satisfies-dep filters walk the
   *  supersede chain and only honour the tip. */
  supersedeOf?: string
  now?: number
}) {
  // Phase-6-d: goal_run is an append-only `engine_artifact` row stream with
  // kind="goal_run_attempt". First insert uses the same id for both the
  // artifact row id and the logical goal_run_id so downstream pointers
  // (evidence.goal_run_id, metric.goal_run_id, protocol_event.goal_run_id)
  // resolve. Updates append new rows sharing the same logical goal_run_id.
  //
  // Live-run dedup: re-use any existing LIVE row for the same (coordinator,
  // goal, plan_node) triple. Superseding a live row is invalid because the
  // executor behind it can still report and merge; ignoring it here creates
  // multiple live build sessions for one goal.
  const liveTips = listGoalRunsByGoal(input.goalID).filter(
    (r) =>
      r.coordinator_run_id === input.coordinatorRunID &&
      (input.planNodeID ? r.plan_node_id === input.planNodeID : r.plan_node_id === null) &&
      isLiveGoalRunStatus(r.status),
  )
  if (liveTips.length > 0) {
    return liveTips[0]!
  }
  const id = Identifier.uuid4First8()
  const now = input.now ?? Date.now()
  const payload = {
    goal_id: input.goalID,
    plan_node_id: input.planNodeID ?? null,
    session_id: input.sessionID ?? null,
    status: "queued" as const,
    retry_count: input.retryCount ?? 0,
    blocking_reason: input.blockingReason ?? null,
    error: input.error ?? null,
    workspace_dir: input.workspaceDir ?? null,
    workspace_branch: input.workspaceBranch ?? null,
    workspace_base_ref: input.workspaceBaseRef ?? null,
    base_ref: input.baseRef ?? null,
    merge_ref: input.mergeRef ?? null,
    supersede_of: input.supersedeOf ?? null,
    superseded_reason: null,
    superseded_at: null,
    metadata:
      input.metadata || input.sessionID
        ? {
            ...(input.metadata ?? {}),
            ...(input.sessionID ? { local_session_id: input.sessionID } : {}),
          }
        : null,
    time_started: null,
    time_completed: null,
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.coordinatorRunID,
        goal_run_id: id,
        kind: "goal_run_attempt",
        label: "attempt-queued",
        payload,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const row = findGoalRun(id)
  if (!row) throw new Error(`createGoalRun: inserted goal run ${id} not found after insert`)
  syncGoalStatus(input.goalID, "createGoalRun")
  return row
}

/**
 * Record that a prior terminal goal_run is being superseded by a retry.
 * Returns the new goal_run id (the caller calls createGoalRun immediately
 * after with supersedeOf set). Separated from createGoalRun so that callers
 * which know the old run id can keep the intent explicit; the actual
 * supersede link is set by createGoalRun via supersedeOf.
 */
// RETIRED in the LLM-autonomous redesign:
//   - writeCascadeState()
//   - updateGoalCascadeFailed()
//   - updateGoalVerificationOutcome()
//
// These all wrote to engine_goal.cascade_state, a cached "deps permanently
// failed / verification outcome" projection that was read by the dispatch
// branch. Both the cache column and the dispatch branch are gone. Dep-failure
// handling is the LLM's call (it reads each goal's depends_on + describe
// layer flags and chooses build({ goalID }) / modify_goal / fail_task).
// Verification-goal outcome is recorded on the goal's goal_run chain.

/**
 * Phase B (2026-05-05): rewrite to act on the per-attempt artifact payload
 * exclusively. Pre-fix the function wrote engine_goal.workspace_dir / branch
 * / base_ref as a sibling cache to the artifact payload; rejecting a
 * dispatch left the column smeared while no attempt artifact existed —
 * board view said "in flight", runtime said "pending forever". The columns
 * are gone (rule 8: no dual source) so this writer now patches the latest
 * goal_run_attempt artifact.
 *
 * Behaviour (no fallback, rule 7):
 *   - When the goal has no attempts yet: record the workspace claim as a
 *     `queued` attempt artifact. The next beginBuildAttempt finds it via
 *     findLatestTipGoalRun and treats it as the parent tip.
 *   - When the latest attempt is non-terminal (`queued` / `running` / etc.):
 *     append a patch through updateGoalRun. The collapse step keeps
 *     workspace_dir/branch/base_ref on the newest payload.
 *   - When the latest attempt is terminal (`completed` / `failed` /
 *     `aborted`): caller is recording a cleanup or recovery; append a
 *     cleanup-labelled patch via updateGoalRun so findGoalLatestWorkspace
 *     reflects the new pointer.
 */
export function updateGoalWorkspace(input: {
  goalID: string
  workspaceDir: string | null
  workspaceBranch: string | null
  /** Optional — only written when explicitly provided. Leave `undefined`
   *  to preserve the existing baseRef across retries; pass `null` to
   *  clear it at terminal cleanup. */
  workspaceBaseRef?: string | null
  now?: number
}) {
  const goal = findGoal(input.goalID)
  if (!goal) {
    throw new Error(`updateGoalWorkspace: goal ${input.goalID} not found`)
  }
  const tip = findLatestTipGoalRun(input.goalID)
  if (!tip) {
    // Phase G (2026-05-05): no fallback (rule 7). The pre-fix branch
    // synthesised a queued artifact with coordinatorRunID="synthetic" —
    // a fake run pointer that polluted the run reference graph. The only
    // legitimate callers that reach this state are post-finalize cleanup
    // (writer.ts:cleanupGoalWorkspaceForGoal already gates on
    // findGoalLatestWorkspace, so a non-null directory implies a tip
    // exists) and the post-build-success workspace patch (the attempt
    // artifact created by beginBuildAttempt is the tip). If no tip exists
    // here, an upstream caller is using the workspace writer as an
    // attempt-creation backdoor — that's a contract violation, not a
    // recoverable case.
    throw new Error(
      `updateGoalWorkspace: goal ${input.goalID} has no goal_run_attempt artifact; ` +
        `workspace pointers ride the per-attempt payload — open an attempt via ` +
        `beginBuildAttempt before recording the workspace.`,
    )
  }
  const patch: Partial<import("./store").GoalRunRow> = {
    workspace_dir: input.workspaceDir,
    workspace_branch: input.workspaceBranch,
  }
  if (input.workspaceBaseRef !== undefined) {
    patch.workspace_base_ref = input.workspaceBaseRef
  }
  updateGoalRun(tip.id, patch)
}

/**
 * Mark every active plan_version for a task as superseded and discard the
 * plan_node rows that belonged to them. Single-source enforcement of the
 * "at most one active plan per task" invariant — the read side
 * (findActivePlanForTask) returns ORDER BY version DESC LIMIT 1, which
 * silently picks an arbitrary row if two share the same version, so any
 * code path that promotes a fresh plan must run this first to retire
 * predecessors atomically.
 *
 * plan_node FK to plan_version is ON DELETE CASCADE, but we keep retired
 * plan_version rows for history (status flip rather than physical DELETE),
 * so the cascade never fires. Without an explicit DELETE the orphan
 * plan_node rows survive supersede and the board's per-goal lookups
 * (which only filter by goal_id, not plan) end up rendering every
 * acceptance spec twice.
 *
 * Intended for use inside an existing Database.transaction so the
 * supersede + plan_node delete + new plan insert land as one unit.
 */
export function supersedePriorActivePlansForTask(db: Database.TxOrDb, input: { taskID: string; now: number }): void {
  const targets = db
    .select({ id: EnginePlanVersionTable.id })
    .from(EnginePlanVersionTable)
    .where(and(eq(EnginePlanVersionTable.task_id, input.taskID), eq(EnginePlanVersionTable.status, "active")))
    .all()
  if (targets.length === 0) return
  const ids = targets.map((t) => t.id)
  db.delete(EnginePlanNodeTable).where(inArray(EnginePlanNodeTable.plan_version_id, ids)).run()
  db.update(EnginePlanVersionTable)
    .set({ status: "superseded", time_updated: input.now })
    .where(inArray(EnginePlanVersionTable.id, ids))
    .run()
}

/**
 * Internal helper: mark a terminal goal_run as superseded and trigger
 * status re-derivation. EXTERNAL CALLERS MUST USE startNewAttempt — it
 * unifies supersede + workspace reset + cascade clear + event emission
 * into one atomic intent. Direct supersedeGoalRun calls bypass the
 * GoalAttemptOpened event and skip the resetWorkspace/clearCascade
 * options that several upstream sites used to inline.
 *
 * Sets superseded_reason / superseded_at as first-class columns on the
 * old row. The FSM-status of the old row stays in its terminal state
 * (history is immutable). deriveGoalStatus reads the column and projects
 * the goal back to `pending` so the dispatch loop can pick it up.
 */
function supersedeGoalRun(input: { oldGoalRunID: string; reason: string; now?: number }) {
  const now = input.now ?? Date.now()
  const existing = findGoalRun(input.oldGoalRunID)
  if (!existing) {
    throw new Error(`supersedeGoalRun: goal_run ${input.oldGoalRunID} not found`)
  }
  appendGoalRunArtifact({
    goalRunID: input.oldGoalRunID,
    existing,
    patch: {
      superseded_reason: input.reason,
      superseded_at: now,
    },
    label: `attempt-${existing.status}`,
    now,
  })
  syncGoalStatus(existing.goal_id, `supersedeGoalRun:${input.reason}`)
  return existing
}

/** Phase-6-d shared writer: append a new `goal_run_attempt` artifact row
 *  carrying the merged state. The logical goal_run_id stays stable; queries
 *  collapse the stream to the newest row per id via `latestPerGoalRun`. */
function appendGoalRunArtifact(input: {
  goalRunID: string
  existing: import("./store").GoalRunRow
  patch: Partial<import("./store").GoalRunRow>
  label: string
  now: number
  db?: EngineDatabaseConnection
}) {
  const merged = { ...input.existing, ...input.patch }
  const payload = {
    goal_id: merged.goal_id,
    plan_node_id: merged.plan_node_id,
    session_id: merged.session_id,
    status: merged.status,
    retry_count: merged.retry_count,
    blocking_reason: merged.blocking_reason,
    error: merged.error,
    workspace_dir: merged.workspace_dir,
    workspace_branch: merged.workspace_branch,
    workspace_base_ref: merged.workspace_base_ref,
    base_ref: merged.base_ref,
    merge_ref: merged.merge_ref,
    supersede_of: merged.supersede_of,
    superseded_reason: merged.superseded_reason,
    superseded_at: merged.superseded_at,
    metadata: merged.metadata,
    // Owner-stamp orphan liveness: preserve the existing owner; if this append
    // moves a previously owner-less row into a live status, stamp the current
    // process owner (the process driving it live owns it). Terminal/queued rows
    // without an owner stay null. Spec 2026-05-29-goal-run-owner-orphan-liveness.
    owner:
      merged.owner ?? (isLiveGoalRunStatus(merged.status) ? processOwner() : null),
    time_started: merged.time_started,
    time_completed: merged.time_completed,
  }
  // Guarantee strict wall-clock monotonicity across appends to the same
  // logical goal_run. Without this, two appends that land in the same
  // millisecond (e.g. double-supersede in tight sequence) would have
  // identical time_created and no deterministic ordering; latest-wins
  // selection then flips under load. Bumping to max(existing + 1, now)
  // keeps each append strictly newer regardless of wall-clock resolution.
  const effectiveNow = Math.max(input.existing.time_updated + 1, input.now)
  const insert = (db: EngineDatabaseConnection) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.uuid4First8(),
        task_id: merged.task_id,
        run_id: merged.coordinator_run_id,
        goal_run_id: input.goalRunID,
        kind: "goal_run_attempt",
        label: input.label,
        payload,
        time_created: effectiveNow,
        time_updated: effectiveNow,
      })
      .run()
  if (input.db) {
    insert(input.db)
  } else {
    Database.use(insert)
  }
}

/**
 * Open a new attempt for a goal — single entry-point for "this goal must
 * re-dispatch under a fresh attempt." Replaces the four ad-hoc paths
 * (build_retry / modify_goal / acceptance_rework)
 * that all expanded to the same supersede + sync sequence and drifted apart
 * over time.
 *
 * Atomic intent:
 *   1. Supersede the terminal tip (if any) with `reason` as a typed enum.
 *      Idempotent — already-superseded tips are a no-op.
 *   2. Optionally reset the goal's persistent workspace pointer
 *      (engine_artifact[goal_run_attempt].payload.workspace_*; pre-Phase B
 *      this lived on engine_goal columns) — clears when the new attempt
 *      must not inherit the prior worktree, e.g. modify_contract on a
 *      structurally different acceptance set.
 *   3. syncGoalStatus → emits transition events via the in-memory
 *      lastEmittedStatus map. No cache write; current state is live-
 *      derived by every reader via goalStatusByID.
 *
 * No-op when the tip is non-terminal — supersede has no meaning on a
 * live row.
 */
export function startNewAttempt(input: {
  goalID: string
  reason: string
  now?: number
  resetWorkspace?: boolean
  /** Retry analysis to persist for the executor's next prompt. When supplied,
   *  writes a `decision_log.phase="retry"` entry scoped to this goal; the
   *  executor's `buildRetryFeedbackSection` reads those entries on the next
   *  run and surfaces them above the goal contract. `value` is the concrete
   *  directive (what to change); `reason` is the root cause. Omit only when
   *  the caller genuinely has no actionable analysis — the executor will then
   *  re-run with the original prompt (uninformed retry). */
  feedback?: { value: string; reason: string }
}): { supersededTipID?: string; resetWorkspace: boolean; retryCount: number } {
  const now = input.now ?? Date.now()
  const goal = findGoal(input.goalID)
  if (!goal) {
    throw new Error(`startNewAttempt: goal ${input.goalID} not found`)
  }
  const { supersededTipID, retryCount } = openGoalImplementationVersion({
    goal,
    reason: input.reason,
    now,
  })
  let resetWorkspace = false
  if (input.resetWorkspace) {
    const latest = findGoalLatestWorkspace(input.goalID)
    if (latest.directory) {
      // Phase B + E (2026-05-05): both workspace pointer and retry_count
      // live on the latest attempt artifact, not on engine_goal. Clearing
      // the workspace appends a patch that nulls the workspace fields;
      // findGoalLatestWorkspace then returns null and the next dispatch
      // falls into the create-new-worktree branch. The retry counter is
      // already bumped on the new artifact `openGoalImplementationVersion`
      // produced (or, for non-supersede cases, stays at the prior tip's
      // value); no engine_goal write is required either way.
      const tip = findLatestTipGoalRun(input.goalID)
      if (tip) {
        updateGoalRun(tip.id, {
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
        })
      }
      resetWorkspace = true
    }
  }
  // Retry feedback writes route through appendRetryFeedbackOnce so direct
  // build retries and explicit rework retries share one decision_log shape.
  // Build prompts read `phase="retry"` filtered by goalID. Previously the
  // `feedback` parameter existed on the signature but was dropped silently;
  // executors on acceptance_rework/modify_contract rework cycles ran with no
  // rejection context — i.e. blind retries.
  if (input.feedback) {
    appendRetryFeedbackOnce({
      taskID: goal.task_id,
      goalID: input.goalID,
      key: `retry_analysis_${input.goalID}_${supersededTipID ?? "no_terminal_tip"}`,
      value: input.feedback.value,
      reason: input.feedback.reason,
    })
  }
  // Event sourcing: the goal_run row itself IS the event — tip's
  // superseded_reason column + superseded_at timestamp is the persistent
  // log of "a new attempt opened under reason X at time T." The orchestrator
  // reads it on the next decision turn via describe; no Bus event needed.
  syncGoalStatus(input.goalID, `startNewAttempt:${input.reason}`)
  return { supersededTipID, resetWorkspace, retryCount }
}

function openGoalImplementationVersion(input: { goal: GoalRow; reason: string; now: number }): {
  supersededTipID?: string
  retryCount: number
} {
  const tip = findLatestTipGoalRun(input.goal.id)
  // Phase E (2026-05-05): retry_count is no longer a goal column; derive
  // from the artifact tip. The new attempt's payload carries the bumped
  // value (beginBuildAttempt / createGoalRun take the returned retryCount
  // and write it into payload.retry_count). No engine_goal write needed.
  const currentCount = tip?.retry_count ?? 0

  // Pre-supersede states never bump:
  //   - no tip yet: retry_count starts at 0.
  //   - tip is non-terminal: there's nothing to supersede, the live attempt
  //     keeps its count.
  if (!tip || (tip.status !== "failed" && tip.status !== "aborted" && tip.status !== "completed")) {
    return { retryCount: currentCount }
  }

  // Idempotent already-superseded path: a prior `startNewAttempt` (or
  // earlier openGoalImplementationVersion call) marked this terminal tip
  // with `superseded_reason`. The next attempt's V label is `currentCount
  // + 1`. Returning `currentCount` here was the Phase E miss — the tip's
  // retry_count is the SUPERSEDED attempt's count, never the upcoming one.
  // Pre-Phase-E this lookup went through engine_goal.retry_count which
  // startNewAttempt had bumped synchronously; the column is gone now, so
  // the bump has to happen here.
  if (tip.superseded_reason) {
    return { retryCount: currentCount + 1 }
  }

  supersedeGoalRun({ oldGoalRunID: tip.id, reason: input.reason, now: input.now })
  return { supersededTipID: tip.id, retryCount: currentCount + 1 }
}

// Phase-6-d-0: `stampGoalRunProgress` deleted with goal-run-watchdog. The
// `last_progress_at` column's only reader was the watchdog — no caller now.
// The column stays until 6-d-3 table deletion cleans it up in one sweep.

function buildGoalRunPatch(
  row: import("./store").GoalRunRow,
  values: Partial<import("./store").GoalRunRow>,
  now: number,
): { nextStatus: EngineGoalRunStatus; statusChanged: boolean; patch: Partial<import("./store").GoalRunRow> } {
  const nextStatus = values.status ?? row.status
  const statusChanged = nextStatus !== row.status
  const patch: Partial<import("./store").GoalRunRow> = {
    ...values,
    ...(nextStatus !== "blocked" && values.blocking_reason === undefined ? { blocking_reason: null } : {}),
    ...(!row.time_started &&
    doesGoalRunStatusImplyStarted(nextStatus) &&
    values.time_started === undefined
      ? { time_started: now }
      : {}),
    ...(isTerminalGoalRunStatus(nextStatus) && values.time_completed === undefined
      ? { time_completed: now }
      : {}),
  }
  return { nextStatus, statusChanged, patch }
}

function emitGoalRunStatusChanged(input: {
  row: import("./store").GoalRunRow
  nextStatus: EngineGoalRunStatus
  previousStatus: EngineGoalRunStatus
  source: string
}) {
  syncGoalStatus(input.row.goal_id, `${input.source} ${input.previousStatus}→${input.nextStatus}`)
  Database.effect(() =>
    EngineProtocol.emit(
      Event.GoalRunUpdated,
      {
        taskID: input.row.task_id,
        goalRunID: input.row.id,
        goalID: input.row.goal_id,
        status: input.nextStatus,
        previousStatus: input.previousStatus,
        summary: `goal_run ${input.previousStatus}→${input.nextStatus}`,
      },
      { source: input.source },
    ),
  )
}

export function updateGoalRun(goalRunID: string, values: Partial<import("./store").GoalRunRow>) {
  const row = findGoalRun(goalRunID)
  if (!row) return undefined
  // Rule 23: no state-machine transition boundary. LLM / orchestrator may drive
  // goal_run.status to any value at any time; timestamp heuristics below are
  // informational, not blocking.
  const now = Date.now()
  const { nextStatus, statusChanged, patch } = buildGoalRunPatch(row, values, now)
  Database.transaction(() => {
    appendGoalRunArtifact({
      goalRunID,
      existing: row,
      patch,
      label: `attempt-${nextStatus}`,
      now,
    })
  })
  if (statusChanged) {
    emitGoalRunStatusChanged({
      row,
      nextStatus,
      previousStatus: row.status,
      source: "persist.updateGoalRun",
    })
  }
  return findGoalRun(goalRunID)
}

type EvaluationStatus = "passed" | "failed" | "pending"
type EvaluationVerdict = "accepted" | "rejected"

// `beginEvaluation` and `persistEvaluation` were part of the old `transition.ts`
// pipeline. With per-goal dispatch + acceptance/checks they have no callers; the
// evaluation row is now created by `persistTaskAcceptance()` (1:1 with the
// task-level acceptance) and updated by `updateEvaluationFromAcceptanceVerdict()`.
// Do not re-add conditional evaluation inserts — they break the
// task-acceptance↔evaluation invariant. Per-goal deliveries do NOT create an
// evaluation row: goal_run status is driven by the executor directly, and the
// acceptance-agent's checks cover per-goal verdicts — a per-goal evaluation row
// would be a dummy with no consumer.

type AcceptanceInput = {
  summary: string
  commitRef?: string
  diffs: Array<{ file: string; [key: string]: unknown }>
  report?: import("@/acceptance/checks").GoalReportClaim
}

function summarizeAcceptanceDiffs(diffs: Array<{ file: string; [key: string]: unknown }>): AcceptanceDiffSummary[] {
  return diffs.map((diff) => {
    const status =
      diff.status === "added" || diff.status === "deleted" || diff.status === "modified" ? diff.status : undefined
    return {
      file: diff.file,
      ...(status ? { status } : {}),
      ...(typeof diff.additions === "number" ? { additions: diff.additions } : {}),
      ...(typeof diff.deletions === "number" ? { deletions: diff.deletions } : {}),
    }
  })
}

function acceptanceDiffStats(diffs: AcceptanceDiffSummary[]) {
  return diffs.reduce(
    (acc, diff) => {
      acc.additions += diff.additions ?? 0
      acc.deletions += diff.deletions ?? 0
      return acc
    },
    { additions: 0, deletions: 0 },
  )
}

// Diff-stat reduction + artifact inserts for the task-level acceptance path.
// Per-goal deliveries are written inline by `finalizeBuildAttempt`; only
// `persistTaskAcceptance` calls this helper now.
function writeAcceptanceRow(
  db: Parameters<Parameters<typeof Database.transaction>[0]>[0],
  input: {
    task: TaskRow
    run: RunRow
    goalRunID?: string
    acceptanceID: string
    acceptance: AcceptanceInput
    now: number
  },
) {
  const acceptanceDiffs = summarizeAcceptanceDiffs(input.acceptance.diffs)
  const stats = acceptanceDiffStats(acceptanceDiffs)
  // Phase-6-c: the acceptance row itself is now an `engine_artifact` with
  // kind="acceptance" + label="acceptance-<scope>" (task vs goal_run). Payload
  // carries the full AcceptanceRow shape so the read-model can reconstruct it
  // without a JOIN. `acceptanceID` is the artifact row id — consumers that
  // reference `acceptance_id` on other artifact rows still point at a valid id.
  db.insert(EngineArtifactTable)
    .values({
      id: input.acceptanceID,
      task_id: input.task.id,
      run_id: input.run.id,
      goal_run_id: input.goalRunID,
      acceptance_id: input.acceptanceID,
      kind: "acceptance",
      label: input.goalRunID ? "acceptance-goal_run" : "acceptance-task",
      payload: {
        status: "candidate",
        summary: input.acceptance.summary,
        result: {
          summary: input.acceptance.summary,
          commit_ref: input.acceptance.commitRef,
          changed_files: acceptanceDiffs.map((item) => item.file),
          diffs: acceptanceDiffs,
          stats,
          report: input.acceptance.report,
        },
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  db.insert(EngineArtifactTable)
    .values({
      id: Identifier.ascending("artifact"),
      task_id: input.task.id,
      run_id: input.run.id,
      goal_run_id: input.goalRunID,
      acceptance_id: input.acceptanceID,
      kind: "report",
      label: "assistant-summary",
      payload: { summary: input.acceptance.summary },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  if (input.acceptance.diffs.length > 0) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        acceptance_id: input.acceptanceID,
        kind: "diff",
        label: "workspace-diff",
        payload: { diffs: acceptanceDiffs },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  if (input.acceptance.commitRef) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        acceptance_id: input.acceptanceID,
        kind: "git_ref",
        label: "acceptance-commit",
        payload: { commit_ref: input.acceptance.commitRef },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  for (const item of acceptanceDiffs) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        acceptance_id: input.acceptanceID,
        kind: "changed_file",
        label: item.file,
        payload: item,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}

// Per-goal deliveries are written inline by `finalizeBuildAttempt` (below) — it
// owns the goal_run_id and binds the kind="acceptance" artifact to it in the
// same transaction as the goal_run_attempt insert. The standalone
// persistGoalAcceptance helper that previously sat here was retired with
// pipeline/executor.ts in commit 54c382858 and replaced by the inline write,
// keeping a single source of truth for goal-run acceptance persistence.

// Task-level acceptance artifact writer. Current task completion is driven
// by orchestrator `complete_task` from the latest post-build integrity_attempt;
// verification evidence lives in engine_artifact
// (kind="verification-evidence"). This function writes the task acceptance
// row and emits the AcceptanceReady event used by task detail projections.
export function persistTaskAcceptance(input: {
  task: TaskRow
  run: RunRow
  acceptanceID: string
  acceptance: AcceptanceInput
  now: number
}) {
  Database.transaction((db) => {
    writeAcceptanceRow(db, input)
    Database.effect(() =>
      EngineProtocol.emit(
        Event.AcceptanceReady,
        {
          taskID: input.task.id,
          runID: input.run.id,
          acceptanceID: input.acceptanceID,
          summary: input.acceptance.summary,
        },
        { source: "persist.acceptance" },
      ),
    )
  })
  persistEvidence({
    taskID: input.task.id,
    runID: input.run.id,
    acceptanceID: input.acceptanceID,
    scope: "acceptance",
    status: "pending",
    verdict: "inconclusive",
    summary: input.acceptance.summary,
    checks: [],
    now: input.now,
  })
}

/**
 * Settle the pending scope='acceptance' evidence for a task-level acceptance by
 * appending a new evidence artifact row. Artifact rows are append-only so
 * this function inserts a fresh row rather than mutating the pending one —
 * `findLatestAcceptanceEvidence(taskID)` naturally surfaces the newest row via
 * `time_created desc`. Throws when the pending row never existed, because
 * that implies `persistTaskAcceptance()` was bypassed (or the caller passed a
 * per-goal acceptance id — per-goal deliveries carry no evidence by design).
 *
 * The `checks` parameter semantics match the pre-artifact behaviour: when
 * supplied, replaces the previous check set wholesale; when OMITTED, the
 * prior check set is preserved (used by explicit post-acceptance artifact export
 * after `deliver` has already written the structured checks). Pass [] to clear.
 */
export function updateEvaluationFromAcceptanceVerdict(input: {
  acceptanceID: string
  verdict: "accepted" | "rejected" | "inconclusive"
  summary: string
  checks?: import("./engine.sql").EngineEvaluationCheck[]
  now?: number
}) {
  const now = input.now ?? Date.now()
  const status = input.verdict === "accepted" ? "passed" : input.verdict === "rejected" ? "failed" : "inconclusive"
  const existing = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.acceptance_id, input.acceptanceID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  if (!existing) {
    throw new Error(
      `updateEvaluationFromAcceptanceVerdict: no evidence row found for acceptance ${input.acceptanceID}. ` +
        `Either persistTaskAcceptance() was bypassed, or the caller passed a per-goal acceptance id ` +
        `(per-goal deliveries have no evidence row — only task-level deliveries are 1:1 with evidence).`,
    )
  }
  const existingPayload = (existing.payload ?? {}) as {
    checks?: import("./engine.sql").EngineEvaluationCheck[]
  }
  const existingChecks = Array.isArray(existingPayload.checks) ? existingPayload.checks : []
  const checks = input.checks ?? existingChecks
  const evidence = persistEvidence({
    taskID: existing.task_id,
    // acceptance-kind artifacts always have run_id set by writeAcceptanceRow.
    // run_id is nullable for task-scoped diagnostic artifacts.
    runID: existing.run_id!,
    acceptanceID: input.acceptanceID,
    scope: "acceptance",
    status,
    verdict: input.verdict,
    summary: input.summary,
    checks,
    timeCompleted: now,
    now,
  })
  void EngineProtocol.emit(
    Event.EvaluationCompleted,
    {
      taskID: evidence.taskID,
      runID: evidence.runID,
      evaluationID: evidence.id,
      status,
      verdict: input.verdict,
      summary: input.summary,
    },
    { source: "evaluation.acceptance" },
  )
}

export function persistFailedRunEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  error: string
  now: number
}) {
  // Post-phase-6: run-level failures no longer write a standalone evaluation row.
  // `run.error` already carries the failure text (set by updateRun in runtime.ts),
  // and the on-disk snapshot below preserves the structured view for operator
  // drill-down. The pre-phase-6 evaluation insert was invariant-violating
  // anyway (wrote scope='acceptance' with acceptance_id=null) — we don't resurrect
  // that shape in artifact land. Goal-run-scoped failures remain handled at the
  // goal-run site (the build tool persists evidence before failing).
  const evaluationID = Identifier.ascending("evaluation")
  writeEvaluationSnapshot({
    task: input.task,
    run: input.run,
    goalRunID: input.goalRunID,
    evaluation: {
      id: evaluationID,
      status: "failed",
      verdict: "rejected",
      summary: input.error,
      checks: [
        {
          name: "executor_completion",
          status: "failed",
          evidence: input.error,
        },
      ],
    },
    goals: (() => {
      const plan = input.run.plan_version_id ? findPlan(input.run.plan_version_id) : undefined
      return plan ? listGoalsForPlan(plan) : []
    })(),
    createdAt: input.now,
  })
}

/** Phase-6-c: acceptance rows are append-only `engine_artifact` rows with
 *  kind="acceptance". `markAcceptancePublishing` / `finalizeAcceptanceResult` now
 *  insert a new artifact row carrying the updated payload; queries pick the
 *  latest via `time_created desc`. The artifact row id stays stable across
 *  a acceptance's lifecycle by referencing `acceptance_id` in the artifact
 *  column (FK intentionally decoupled — see engine.sql.ts). */
export function markAcceptancePublishing(acceptanceId: string, now: number) {
  const existing = findLatestAcceptanceArtifact(acceptanceId)
  if (!existing) {
    throw new Error(`markAcceptancePublishing: no acceptance artifact found for ${acceptanceId}`)
  }
  const payload = (existing.payload ?? {}) as Record<string, unknown>
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: existing.task_id,
        run_id: existing.run_id,
        goal_run_id: existing.goal_run_id ?? null,
        acceptance_id: acceptanceId,
        kind: "acceptance",
        label: existing.label,
        payload: { ...payload, status: "publishing" },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

export function finalizeAcceptanceResult(input: {
  acceptanceId: string
  taskId: string
  runId: string
  acceptance: { result?: Record<string, unknown> | null }
  result: {
    status: EngineAcceptanceStatus
    summary: string
    artifacts: Array<{ kind: EngineArtifactKind; label: string; payload: Record<string, unknown> }>
    publish: unknown
  }
  now: number
}) {
  const existing = findLatestAcceptanceArtifact(input.acceptanceId)
  if (!existing) {
    throw new Error(`finalizeAcceptanceResult: no acceptance artifact found for ${input.acceptanceId}`)
  }
  const existingPayload = (existing.payload ?? {}) as Record<string, unknown>
  const existingResult = (existingPayload.result ?? input.acceptance.result ?? {}) as Record<string, unknown>
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskId,
        run_id: input.runId,
        goal_run_id: existing.goal_run_id ?? null,
        acceptance_id: input.acceptanceId,
        kind: "acceptance",
        label: existing.label,
        payload: {
          status: input.result.status,
          summary: input.result.summary,
          result: {
            ...existingResult,
            summary: input.result.summary,
            artifacts: input.result.artifacts.map((item) => ({
              kind: item.kind,
              label: item.label,
            })),
            publish: input.result.publish,
          },
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    for (const artifact of input.result.artifacts) {
      db.insert(EngineArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.taskId,
          run_id: input.runId,
          acceptance_id: input.acceptanceId,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
  })
}

/** Phase-6-c internal: find the latest acceptance artifact row by acceptance_id.
 *  Newer rows supersede older ones (append-only semantics); id breaks same-ms
 *  ties the same way store.ts acceptance readers do. */
function findLatestAcceptanceArtifact(acceptanceId: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.acceptance_id, acceptanceId), eq(EngineArtifactTable.kind, "acceptance")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .get(),
  )
}

// ---------------------------------------------------------------------------
// Goal mutations (operator-facing: update / delete)
// ---------------------------------------------------------------------------

export function updateGoal(input: {
  goalID: string
  title: string
  acceptance_specs: import("@/acceptance/types").AcceptanceSpec[]
}) {
  return Database.use((db) =>
    db
      .update(EngineGoalTable)
      .set({
        title: input.title,
        acceptance_specs: input.acceptance_specs,
        time_updated: Date.now(),
      })
      .where(eq(EngineGoalTable.id, input.goalID))
      .run(),
  )
}

export function deleteGoal(goalID: string) {
  return Database.transaction((db) => {
    const row = db
      .select({ task_id: EngineGoalTable.task_id })
      .from(EngineGoalTable)
      .where(eq(EngineGoalTable.id, goalID))
      .get()
    if (!row) {
      return {
        deletedGoals: 0,
        deletedPlanNodes: 0,
        prunedGoalDependencyRefs: 0,
        prunedPlanNodeDependencyRefs: 0,
      }
    }
    return deleteGoalRowsForTask(db, {
      taskID: row.task_id,
      goalIDs: [goalID],
    })
  })
}

export function completeGoal(input: { goalID: string; reason: string; now?: number }): GoalRunRow {
  const goal = findGoal(input.goalID)
  if (!goal) {
    throw new Error(`completeGoal: goal ${input.goalID} not found`)
  }
  const now = input.now ?? Date.now()
  const tip = findLatestTipGoalRun(input.goalID)
  const blocker = tip ? liveGoalRunControlBlocker({ taskID: goal.task_id, goalID: input.goalID, goalRun: tip }) : undefined
  if (blocker) {
    throw new Error(
      `completeGoal: ${blocker}; finish or abort the active worker before marking the goal complete.`,
    )
  }
  if (tip?.status === "completed" && !tip.superseded_reason) {
    return tip
  }
  const completionMetadata = {
    ...(tip?.metadata && typeof tip.metadata === "object" && !Array.isArray(tip.metadata) ? tip.metadata : {}),
    manual_completion: {
      source: "orchestrator.complete_goal",
      reason: input.reason,
      time_completed: now,
    },
  }

  if (!tip) {
    const id = Identifier.uuid4First8()
    Database.use((db) =>
      db
        .insert(EngineArtifactTable)
        .values({
          id,
          task_id: goal.task_id,
          run_id: null,
          goal_run_id: id,
          kind: "goal_run_attempt",
          label: "attempt-completed",
          payload: {
            goal_id: input.goalID,
            plan_node_id: null,
            session_id: null,
            status: "completed",
            retry_count: 0,
            blocking_reason: null,
            error: null,
            workspace_dir: null,
            workspace_branch: null,
            workspace_base_ref: null,
            base_ref: null,
            merge_ref: null,
            supersede_of: null,
            superseded_reason: null,
            superseded_at: null,
            metadata: completionMetadata,
            owner: null,
            time_started: now,
            time_completed: now,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    syncGoalStatus(input.goalID, "completeGoal")
    const row = findGoalRun(id)
    if (!row) throw new Error(`completeGoal: inserted goal run ${id} not found after insert`)
    return row
  }

  appendGoalRunArtifact({
    goalRunID: tip.id,
    existing: tip,
    patch: {
      status: "completed",
      blocking_reason: null,
      error: null,
      superseded_reason: null,
      superseded_at: null,
      metadata: completionMetadata,
      time_started: tip.time_started ?? now,
      time_completed: now,
    },
    label: "attempt-completed",
    now,
  })
  syncGoalStatus(input.goalID, "completeGoal")
  const row = findGoalRun(tip.id)
  if (!row) throw new Error(`completeGoal: updated goal run ${tip.id} not found after append`)
  return row
}

/**
 * Record a build agent attempt as a `goal_run_attempt` artifact so the
 * derived goal status reflects the build outcome.
 *
 * Why this helper exists separately from `createGoalRun` / `updateGoalRun`:
 * post-phase-5 the orchestrator's `build` tool dispatches `BuildAgent.run`
 * directly without a coordinator Run row. The legacy createGoalRun path
 * required `coordinatorRunID` and assumed a GoalPool dispatcher would
 * later mark the run terminal. The new flow has neither, so we collapse
 * the two-write protocol (queued → completed) into a single terminal
 * artifact: `kind="goal_run_attempt"` carries the build outcome directly,
 * `syncGoalStatus` re-derives `engine_goal.status` from the chain tip
 * (per `goal-status.ts`), and the orchestrator's next describe sees the
 * goal as `passed` / `failed` instead of stale `pending`.
 *
 * Without this, build agents return passed but no one writes the
 * outcome — every subsequent orchestrator wake reads `goals: pending`
 * and re-dispatches build, burning decision turns indefinitely.
 *
 * Per rule 23 the LLM still owns the *decision* on what to do with the
 * outcome (run integrity, retry, fail_task). This helper only persists
 * the *fact* that build ran and what it returned.
 */
/**
 * Open a goal_run for a build that is about to run. Inserts the FIRST
 * `goal_run_attempt` artifact for a fresh goal_run id with `status="running"`,
 * `time_started=now`, `time_completed=null`. Emits `goal_run.updated` so the
 * overlay invalidates the board and materializes the goal step card with a
 * spinner immediately — instead of waiting for the build to terminate (the
 * old `recordBuildAttempt` insert wrote a row with `time_started == time_completed`,
 * so overlay's `startedAt > 0` predicate was only met post-completion and the goal
 * card "appeared" already-finished).
 *
 * The orchestrator's build tool calls this after the build session exists; the same
 * goal_run id is later threaded into `finalizeBuildAttempt` to write the
 * terminal state via `updateGoalRun` (which appends a second artifact row
 * collapsed by `latestPerGoalRun` to the newest per goal_run_id).
 */
export function beginBuildAttempt(input: {
  taskID: string
  goalID: string
  /** Coordinator run id (may be undefined for synthetic / direct paths). */
  runID?: string
  /** Concrete build session id. Required in the first running artifact so
   *  retry continuation has one durable session identity source. */
  sessionID: string
  /** Worktree directory if known at dispatch (per-goal worktree). Caller-owned
   *  worktrees may know the path up-front; greenfield BuildAgent-managed
   *  worktrees do not — leave undefined and let the row stay null. */
  workspaceDir?: string
  /** Phase B (2026-05-05): persistent worktree branch + baseRef. Pre-fix
   *  these lived on engine_goal as a duplicate cache; now they ride along
   *  on the per-attempt artifact payload so findGoalLatestWorkspace returns
   *  the full triple from a single source. */
  workspaceBranch?: string | null
  workspaceBaseRef?: string | null
  extraArtifacts?: (input: { goalRunID: string; now: number }) => Array<{
    id: string
    kind: EngineArtifactKind
    label: string
    payload: Record<string, unknown>
    runID?: string | null
    goalRunID?: string | null
    acceptanceID?: string | null
  }>
  now?: number
}): string {
  const id = Identifier.uuid4First8()
  const now = input.now ?? Date.now()
  const goal = findGoal(input.goalID)
  if (!goal) {
    throw new Error(`beginBuildAttempt: goal ${input.goalID} not found`)
  }
  let priorTip = findLatestTipGoalRun(input.goalID)
  if (priorTip && isLiveGoalRunStatus(priorTip.status)) {
    const blocker = liveGoalRunControlBlocker({ taskID: input.taskID, goalID: input.goalID, goalRun: priorTip })
    if (blocker) {
      throw new Error(`beginBuildAttempt: ${blocker}; refusing to open a second build attempt.`)
    }
    const reason = isGoalRunOrphaned(priorTip)
      ? `owner process restarted mid-stream; goal_run ${priorTip.id} orphaned and ` +
        `cannot resume — retired on re-dispatch`
      : `goal_run ${priorTip.id} had live status=${priorTip.status} but no live build ownership, ` +
        `active build session, or live foreign owner — retired on explicit build re-dispatch`
    // A live lifecycle status without active ownership/session is an audit fact,
    // not an executor. Retire it at the explicit build boundary so the new
    // attempt becomes the only tip.
    retireLiveGoalRunWithoutControl({
      goalRun: priorTip,
      reason,
      now,
    })
    priorTip = findLatestTipGoalRun(input.goalID)
  }
  if (priorTip) {
    appendBuildRetryFeedbackForPriorRun({
      taskID: input.taskID,
      goalID: input.goalID,
      priorRun: priorTip,
      source: "beginBuildAttempt",
    })
  }

  const version = openGoalImplementationVersion({
    goal,
    reason: "build_retry",
    now,
  })
  // Resolve the parent tip the new attempt supersedes in the chain. Two retry
  // shapes both reach here and BOTH must populate supersede_of correctly,
  // otherwise findLatestTipGoalRun (engine/store.ts) projects the patched-old
  // terminal row as the live tip and goal status stays `pending` while the
  // build runs (audit §11.6, codex 3rd-pass).
  //   1. beginBuildAttempt-only retry: openGoalImplementationVersion ran the
  //      supersede here, returns supersededTipID directly.
  //   2. startNewAttempt-then-beginBuildAttempt (acceptance_rework /
  //      modify_goal): startNewAttempt already patched superseded_reason on
  //      the prior tip, so openGoalImplementationVersion short-circuits and
  //      supersededTipID is undefined. The tip's id is still the right
  //      parent — findLatestTipGoalRun returns the same row id (the
  //      already-patched terminal); supersededIDs set is empty until WE
  //      insert with supersede_of pointing at it.
  //   3. First-ever attempt: no prior tip, parentTipID undefined → null.
  //
  // Never use a live tip as the retry parent. `openGoalImplementationVersion`
  // intentionally returns no supersededTipID for live rows; treating that as
  // "link to whatever tip exists" was the bug that let a retry supersede a
  // still-running executor and launch a duplicate build session.
  const parentTipID =
    version.supersededTipID ??
    (priorTip?.superseded_reason &&
    (priorTip.status === "failed" || priorTip.status === "aborted" || priorTip.status === "completed")
      ? priorTip.id
      : undefined)
  const payload = {
    goal_id: input.goalID,
    plan_node_id: null,
    session_id: input.sessionID,
    status: "running" as const,
    retry_count: version.retryCount,
    blocking_reason: null,
    error: null,
    workspace_dir: input.workspaceDir ?? null,
    workspace_branch: input.workspaceBranch ?? null,
    workspace_base_ref: input.workspaceBaseRef ?? null,
    base_ref: null,
    merge_ref: null,
    supersede_of: parentTipID ?? null,
    superseded_reason: null,
    superseded_at: null,
    metadata: null,
    // Owner-stamp: this process owns the freshly-dispatched (status=running)
    // attempt. After a restart, a different processOwner() reveals the row as
    // orphaned. Spec 2026-05-29-goal-run-owner-orphan-liveness.
    owner: processOwner(),
    time_started: now,
    time_completed: null,
  }
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID ?? null,
        goal_run_id: id,
        kind: "goal_run_attempt",
        label: "attempt-running",
        payload,
        time_created: now,
        time_updated: now,
      })
      .run()
    for (const artifact of input.extraArtifacts?.({ goalRunID: id, now }) ?? []) {
      db.insert(EngineArtifactTable)
        .values({
          id: artifact.id,
          task_id: input.taskID,
          run_id: artifact.runID ?? input.runID ?? null,
          goal_run_id: artifact.goalRunID ?? id,
          acceptance_id: artifact.acceptanceID ?? null,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
  })
  syncGoalStatus(input.goalID, `beginBuildAttempt`)
  // Emit goal_run.updated so the overlay's board-invalidating subscription
  // refetches and `goalWorkflows[i].steps[build].startedAt` becomes > 0;
  // tree-writer's lazy-materialization predicate then renders the step card.
  Database.effect(() =>
    EngineProtocol.emit(
      Event.GoalRunUpdated,
      {
        taskID: input.taskID,
        goalRunID: id,
        goalID: input.goalID,
        status: "running",
        previousStatus: "queued",
        summary: "build attempt started",
      },
      { source: "persist.beginBuildAttempt" },
    ),
  )
  return id
}

type BuildAttemptOutcomeKind = "delivered" | "failed" | "aborted" | "no_project_diff"

function buildAttemptOutcomeKind(input: {
  status: "completed" | "failed" | "aborted"
  commitRef?: string
  acceptanceDiffCount: number
}): BuildAttemptOutcomeKind {
  if (input.status === "failed") return "failed"
  if (input.status === "aborted") return "aborted"
  return input.commitRef && input.acceptanceDiffCount > 0 ? "delivered" : "no_project_diff"
}

function buildNoDiffReason(input: {
  status: "completed" | "failed" | "aborted"
  commitRef?: string
  rawDiffCount: number
  acceptanceDiffCount: number
}): string | undefined {
  if (input.status !== "completed") return undefined
  if (!input.commitRef) return "missing_commit_ref"
  if (input.rawDiffCount > 0 && input.acceptanceDiffCount === 0) return "runtime_only_changes_filtered"
  if (input.acceptanceDiffCount === 0) return "actual_changed_files_empty"
  return undefined
}

function writeBuildAttemptOutcome(
  db: EngineDatabaseConnection,
  input: {
    now: number
    goalRun: import("./store").GoalRunRow
    status: "completed" | "failed" | "aborted"
    outcomeKind: BuildAttemptOutcomeKind
    summary?: string
    error?: string
    noDiffReason?: string
    commitRef?: string
    publishedCommitRef?: string
    diffBaseRef?: string
    diffHeadRef?: string
    workspaceDir?: string | null
    workspaceBranch?: string | null
    workspaceBaseRef?: string | null
    changedFiles: string[]
  },
) {
  const outcomeID = Identifier.ascending("artifact")
  db.insert(EngineArtifactTable)
    .values({
      id: outcomeID,
      task_id: input.goalRun.task_id,
      run_id: input.goalRun.coordinator_run_id,
      goal_run_id: input.goalRun.id,
      kind: "build_attempt_outcome",
      label: input.outcomeKind,
      payload: {
        task_id: input.goalRun.task_id,
        goal_id: input.goalRun.goal_id,
        goal_run_id: input.goalRun.id,
        run_id: input.goalRun.coordinator_run_id,
        session_id: input.goalRun.session_id,
        terminal_status: input.status,
        outcome_kind: input.outcomeKind,
        summary: input.summary?.trim() || `Build attempt ${input.goalRun.id} ${input.outcomeKind}.`,
        error: input.error ?? null,
        no_diff_reason: input.noDiffReason ?? null,
        host_facts: {
          contribution_commit_ref: input.commitRef ?? null,
          published_commit_ref: input.publishedCommitRef ?? null,
          diff_base_ref: input.diffBaseRef ?? null,
          diff_head_ref: input.diffHeadRef ?? null,
          actual_changed_files: input.changedFiles,
        },
        workspace: {
          dir: input.workspaceDir ?? input.goalRun.workspace_dir,
          branch: input.workspaceBranch ?? input.goalRun.workspace_branch,
          base_ref: input.workspaceBaseRef ?? input.goalRun.workspace_base_ref,
        },
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  return outcomeID
}

export function recordAbortedBuildAttemptOutcome(input: {
  goalRunID: string
  reason: string
  now?: number
}): void {
  const goalRun = findGoalRun(input.goalRunID)
  if (!goalRun) return
  const now = input.now ?? Date.now()
  Database.transaction((db) => {
    writeBuildAttemptOutcome(db, {
      now,
      goalRun,
      status: "aborted",
      outcomeKind: "aborted",
      summary: `Build attempt aborted: ${input.reason}`,
      error: input.reason,
      changedFiles: [],
    })
  })
}

/**
 * Finalize a goal_run opened by `beginBuildAttempt`. Updates the existing
 * goal_run via the append-only `updateGoalRun` writer (which sets
 * time_completed and emits goal_run.updated → terminal status), then writes
 * the per-goal `acceptance` artifact when the build passed with concrete diffs.
 *
 * Single source for the build → goal_run finalize path: the prior
 * `recordBuildAttempt` insert-at-end design is gone (rule 22). External
 * callers now do begin → BuildAgent.run → finalize.
 */
export function finalizeBuildAttempt(input: {
  goalRunID: string
  taskID: string
  goalID: string
  runID?: string
  status: "completed" | "failed"
  commitRef?: string
  publishedCommitRef?: string
  diffBaseRef?: string
  diffHeadRef?: string
  workspaceDir?: string
  /** Phase B (2026-05-05): workspace branch + baseRef now ride along on the
   *  goal_run_attempt artifact (single source, was duplicated on engine_goal).
   *  The build tool path passes both back when BuildAgent.run produced a
   *  managedWorktree result. */
  workspaceBranch?: string
  workspaceBaseRef?: string
  error?: string
  diffs?: Array<{ file: string; before: string; after: string; additions: number; deletions: number; status?: string }>
  fileChanges?: Array<{ path: string; summary: string; reason: string }>
  summary?: string
  now?: number
}): void {
  const now = input.now ?? Date.now()
  const goalRun = findGoalRun(input.goalRunID)
  if (!goalRun) return
  const patch: Parameters<typeof updateGoalRun>[1] = {
    status: input.status,
    error: input.error ?? null,
    metadata:
      input.commitRef || input.publishedCommitRef || input.diffBaseRef || input.diffHeadRef
        ? {
            ...(input.commitRef ? { commit_ref: input.commitRef } : {}),
            ...(input.publishedCommitRef ? { published_commit_ref: input.publishedCommitRef } : {}),
            ...(input.diffBaseRef ? { diff_base_ref: input.diffBaseRef } : {}),
            ...(input.diffHeadRef ? { diff_head_ref: input.diffHeadRef } : {}),
          }
        : null,
    time_completed: now,
  }
  if (input.workspaceDir !== undefined) patch.workspace_dir = input.workspaceDir
  if (input.workspaceBranch !== undefined) patch.workspace_branch = input.workspaceBranch
  if (input.workspaceBaseRef !== undefined) patch.workspace_base_ref = input.workspaceBaseRef
  const rawDiffs = Array.isArray(input.diffs) ? input.diffs : []
  const acceptanceDiffs = rawDiffs.filter(
    (item) => !ProjectRuntimePaths.isInternalRuntimeRelativePath(item.file),
  )
  const acceptanceDiffSummaries = summarizeAcceptanceDiffs(acceptanceDiffs)
  const includeAcceptance = input.status === "completed" && !!input.commitRef && acceptanceDiffSummaries.length > 0
  const outcomeKind = buildAttemptOutcomeKind({
    status: input.status,
    commitRef: input.commitRef,
    acceptanceDiffCount: acceptanceDiffSummaries.length,
  })
  const noDiffReason = buildNoDiffReason({
    status: input.status,
    commitRef: input.commitRef,
    rawDiffCount: rawDiffs.length,
    acceptanceDiffCount: acceptanceDiffSummaries.length,
  })
  const { nextStatus, statusChanged, patch: goalRunPatch } = buildGoalRunPatch(goalRun, patch, now)
  const acceptanceSummary =
    input.summary?.trim() || `Goal ${input.goalID} build delivered ${acceptanceDiffSummaries.length} file change(s).`
  Database.transaction((db) => {
    appendGoalRunArtifact({
      goalRunID: input.goalRunID,
      existing: goalRun,
      patch: goalRunPatch,
      label: `attempt-${nextStatus}`,
      now,
      db,
    })
    const outcomeID = writeBuildAttemptOutcome(db, {
      now,
      goalRun,
      status: input.status,
      outcomeKind,
      summary: input.summary,
      error: input.error,
      noDiffReason,
      commitRef: input.commitRef,
      publishedCommitRef: input.publishedCommitRef,
      diffBaseRef: input.diffBaseRef,
      diffHeadRef: input.diffHeadRef,
      workspaceDir: input.workspaceDir,
      workspaceBranch: input.workspaceBranch,
      workspaceBaseRef: input.workspaceBaseRef,
      changedFiles: acceptanceDiffSummaries.map((d) => d.file),
    })
    if (includeAcceptance) {
      const stats = acceptanceDiffStats(acceptanceDiffSummaries)
      const acceptanceID = Identifier.ascending("acceptance")
      db.insert(EngineArtifactTable)
        .values({
          id: acceptanceID,
          task_id: input.taskID,
          run_id: input.runID ?? goalRun.coordinator_run_id ?? null,
          goal_run_id: input.goalRunID,
          acceptance_id: acceptanceID,
          kind: "acceptance",
          label: "acceptance-goal_run",
          payload: {
            status: "candidate",
            summary: acceptanceSummary,
            result: {
              summary: acceptanceSummary,
              build_attempt_outcome_id: outcomeID,
              commit_ref: input.commitRef,
              published_commit_ref: input.publishedCommitRef,
              diff_base_ref: input.diffBaseRef,
              diff_head_ref: input.diffHeadRef,
              changed_files: acceptanceDiffSummaries.map((d) => d.file),
              file_changes: input.fileChanges ?? [],
              diffs: acceptanceDiffSummaries,
              stats,
            },
          },
          time_created: now,
          time_updated: now,
        })
        .run()
    }
  })
  if (statusChanged) {
    emitGoalRunStatusChanged({
      row: goalRun,
      nextStatus,
      previousStatus: goalRun.status,
      source: "persist.finalizeBuildAttempt",
    })
  }
}

// `recordBuildAttempt` was a single-shot insert that wrote the goal_run row
// AT BUILD COMPLETION with `time_started == time_completed`. Removed (rule 22:
// no double source) in favour of begin → finalize: the overlay's goal step
// card is gated on `startedAt > 0` and was therefore only materialized after
// the build finished — making the card spawn already-passed/already-failed.
// All callers route through `beginBuildAttempt` + `finalizeBuildAttempt` now.

/**
 * Record an integrity-review attempt as an append-only artifact so the
 * orchestrator's read_context can surface "integrity already ran with verdict X
 * for spec snapshot Y". Without this the LLM has no way to distinguish
 * "integrity was never called" from "integrity ran and returned pass (no goal
 * change)" — same death-loop shape rule 23 / commit 7acb5f17f addressed
 * for build.
 */
export function recordIntegrityAttempt(input: {
  taskID: string
  /** The integrity child session id — surfaces in overlay nesting. */
  sessionID: string
  /** Spec snapshot lineage the goal set was reviewed against. The active
   *  snapshot is persisted on the artifact; inherited snapshots are used only
   *  to keep replay attempt numbering consistent across corrective snapshots. */
  lineage: SpecSnapshotLineage
  verdict: "pass" | "concerns" | "needs_correction"
  /** Per-dimension verdicts so read_context can surface "requirement_fidelity passed
   *  but solution_quality flagged 3 weak_acceptance specs" — losing this
   *  granularity behind a single aggregate would defeat the redesign. */
  /** Phase marker. `pre_build` attempts audit decomposition only — they cannot
   *  satisfy the post-build freshness evidence (a green pre-build attempt
   *  must not let an unrun graph through). `post_build` attempts have access
   *  to a Requirement Status Snapshot and represent real end-to-end completion
   *  evidence. The orchestrator decides phase from whether any claiming goal
   *  has produced run + evidence by attempt time. */
  phase: "pre_build" | "post_build"
  issuesCount?: number
  correctionsCount?: number
  missingCount?: number
  reviewers?: unknown[]
  findingsCount?: number
  requiredRepairsCount?: number
  unresolvedDisagreementsCount?: number
  reason?: string
  /** Full pre-rendered review markdown — every issue, every correction
   *  proposal, every missing-goal proposal as text. Persisted alongside the
   *  count summary so read_context / acceptance upstream context can present
   *  the orchestrator LLM the same evidence the integrity LLM produced,
   *  rather than just counts. */
  reviewMarkdown?: string
  teamReportMarkdown?: string
  findings?: unknown[]
  rounds?: unknown[]
  requiredRepairs?: unknown[]
  unresolvedDisagreements?: unknown[]
  /** Structured copies of the LLM's correction / missing-goal proposals
   *  preserved alongside the markdown so future consumers with field-level
   *  access needs do not have to re-parse markdown. */
  corrections?: Array<{
    action: "modify" | "split" | "remove"
    goalID: string
    reason: string
    updates?: Record<string, unknown>
  }>
  graphCorrections?: unknown[]
  missingGoals?: Array<{
    title: string
    objective: string
    acceptance_spec_hints: string[]
    owned_paths: string[]
    kind: string
    priority: "blocking" | "advisory"
    reason: string
  }>
  acceptance?: unknown
  now?: number
}): string {
  if (input.taskID !== input.lineage.taskID) {
    throw new Error(
      `recordIntegrityAttempt taskID ${input.taskID} does not match lineage taskID ${input.lineage.taskID}.`,
    )
  }
  const id = Identifier.ascending("artifact")
  const now = input.now ?? Date.now()
  const attempts =
    listIntegrityAttemptArtifacts({
      taskID: input.taskID,
      lineage: input.lineage,
    }).length + 1
  const payload = {
    spec_snapshot_id: input.lineage.activeSpecSnapshotID,
    session_id: input.sessionID,
    verdict: input.verdict,
    phase: input.phase,
    attempts,
    reviewers: input.reviewers ?? [],
    findings_count: input.findingsCount ?? input.issuesCount ?? 0,
    required_repairs_count: input.requiredRepairsCount ?? input.correctionsCount ?? 0,
    unresolved_disagreements_count: input.unresolvedDisagreementsCount ?? 0,
    reason: input.reason ?? null,
    team_report_markdown: input.teamReportMarkdown ?? input.reviewMarkdown ?? null,
    findings: input.findings ?? [],
    rounds: input.rounds ?? [],
    required_repairs: input.requiredRepairs ?? [],
    unresolved_disagreements: input.unresolvedDisagreements ?? [],
    time_completed: now,
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        kind: "integrity_attempt",
        label: `verdict-${input.verdict}`,
        payload,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

/**
 * Record an orchestrator stream-error fact as an append-only artifact.
 *
 * Used when the orchestrator's own LLM stream aborts mid-decision (provider
 * onError, stream-idle watchdog, mid-stream protocol violation). Per rule 23
 * we do NOT transition the task to terminal `failed` on a transient stream
 * error and we do NOT auto-rewake from this artifact — both would be
 * state-machine reactions. The orchestrator reads the artifact via describe
 * on its next external wake and decides for itself whether to retry,
 * re-dispatch, propose a new task, or fail_task.
 */
export function recordOrchestratorStreamError(input: {
  taskID: string
  reason: string
  errorName?: string
  sessionID?: string
  now: number
}) {
  return Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: null,
        kind: "orchestrator-stream-error",
        label: "orchestrator-stream-error",
        payload: {
          reason: input.reason,
          errorName: input.errorName,
          sessionID: input.sessionID,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
}

/**
 * Record a completed orchestrator wake that violated the workflow-decision
 * contract. This is not a provider/session stream failure: the stream
 * completed and the model produced an assistant turn, but the turn did not
 * make a task lifecycle or scheduling decision.
 */
export function recordOrchestratorDecisionContractFailure(input: {
  taskID: string
  reason: string
  errorName?: string
  sessionID?: string
  now: number
}) {
  return Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: null,
        kind: "orchestrator-decision-contract-failure",
        label: "orchestrator-decision-contract-failure",
        payload: {
          reason: input.reason,
          errorName: input.errorName,
          sessionID: input.sessionID,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
}

export function recordToolExecuteError(input: {
  taskID: string
  runID?: string | null
  goalRunID?: string | null
  sessionID: string
  messageID: string
  partID: string
  toolName: string
  callID: string
  input: unknown
  failure: ToolFailureCause
  now: number
}) {
  return Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID ?? null,
        goal_run_id: input.goalRunID ?? null,
        kind: "tool-execute-error",
        label: "tool-execute-error",
        payload: {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
          toolName: input.toolName,
          callID: input.callID,
          input: input.input,
          failure: input.failure,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
}

/**
 * Stream-error retry circuit breaker.
 *
 * When the orchestrator's LLM stream early-dies before producing any token,
 * the next operator wake replays the same history. If the cause is structural
 * — provider rejecting a malformed assistant turn, payload too large, account
 * blocked — every replay deterministically fails. The old runtime poll also
 * auto-woke active tasks with no in-flight loop, which turned that structural
 * failure into a retry storm. The 2026-05-08 incident on
 * `tsk_e078e1f2a001t4ZwUl5SWgoG8o` produced 277 identical `orchestrator-
 * stream-error` artifacts in 2.5 minutes against DeepSeek 400.
 *
 * The structural side of that bug is fixed at the conversion boundary
 * (`session/message.ts::toModelMessages` now drops assistant turns with no
 * provider-visible content), but any future provider truncation / new error
 * class can recur the loop. This fuse is the resource-governance bound:
 * three stream-errors within {@link ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS}
 * on the same task transitions the task to `failed`, so repeated operator
 * wakes do not keep replaying an unrecoverable prompt.
 *
 * Same family as a provider rate-limit, NOT a workflow FSM (rule 13/23): the
 * LLM here cannot decide because the stream produced no tokens. Threshold
 * and window are hardcoded constants — no config knob to drift.
 *
 * Returns `{ tripped: false, ... }` when the count stayed under threshold,
 * the task is already terminal, or it disappeared. Otherwise records a
 * visible task error and returns `{ tripped: true, consecutive, windowMs }`.
 * It does not write terminal failure; the scheduler owns success/failure
 * lifecycle decisions from the accumulated stream-error artifacts.
 */
export const ORCHESTRATOR_STREAM_ERROR_FUSE_THRESHOLD = 3
export const ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS = 60_000

export async function maybeTripOrchestratorStreamErrorFuse(input: {
  taskID: string
  now: number
  lastReason: string
}): Promise<{ tripped: boolean; consecutive: number; windowMs: number }> {
  const recent = listOrchestratorStreamErrorArtifacts(
    input.taskID,
    input.now - ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS,
    ORCHESTRATOR_STREAM_ERROR_FUSE_THRESHOLD,
  )
  if (recent.length < ORCHESTRATOR_STREAM_ERROR_FUSE_THRESHOLD) {
    return {
      tripped: false,
      consecutive: recent.length,
      windowMs: ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS,
    }
  }
  const current = requireTask(input.taskID)
  if (isTaskTerminal(current)) {
    return {
      tripped: false,
      consecutive: recent.length,
      windowMs: ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS,
    }
  }
  const seconds = ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS / 1000
  await updateTask(
    current,
    {
      error: `Orchestrator stream failed ${recent.length} consecutive times within ${seconds}s — last error: ${input.lastReason}. Operator must retry or fail_task.`,
    },
    `Stream-error fuse tripped after ${recent.length} consecutive failures; scheduler decision required`,
  )
  return {
    tripped: true,
    consecutive: recent.length,
    windowMs: ORCHESTRATOR_STREAM_ERROR_FUSE_WINDOW_MS,
  }
}
