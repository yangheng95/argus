import { Identifier } from "@/id/id"
import { executorLeaseAvailable, executorLeaseHeldByOther, executorLeaseOwner, executorLeaseUntil } from "./lease"

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
import { protocolInfo, type ProtocolCapabilitiesInfo, type ProtocolRefsInfo, type ProtocolSettingsInfo, ProtocolTransport } from "@/executor/protocol"
import { writeEvaluationSnapshot } from "@/engine/docs"
import { Database, and, desc, eq, inArray, isNull, lte, or } from "@/storage/db"
import { Log } from "@/util/log"
import { Event } from "./model"
import {
  EngineArtifactTable,
  EngineExecutorSessionTable,
  EngineGoalTable,
  EngineRequirementTable,
  EngineTaskTable,
  type EngineDeliveryStatus,
  type EngineArtifactKind,
} from "./engine.sql"
import { persistEvidence } from "@/verification/persist"
import { LIVE_GOAL_RUN_STATUSES } from "./catalog"
import { EngineProtocol } from "./protocol"
import { findGoal, findGoalRun, findLatestTipGoalRun, findPlan, listGoalRunsByGoal, listGoals, listGoalsForPlan, type GoalRow, type RunRow, type TaskRow } from "./store"
import { syncGoalStatus } from "./goal-status"
import { createDecisionLog } from "@/decision-log"

const log = Log.create({ service: "engine-transition" })

/**
 * Derive a human-readable slug from a goal title. Display-only — goal_id
 * remains the sole identity. Immutable once set.
 */
export function goalSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "goal"
}

export interface GoalRowInput {
  goalID?: string
  title: string
  objective: string
  acceptance_specs: import("@/acceptance/types").AcceptanceSpec[]
  owned_paths?: string[]
  depends_on?: string[]
  exports?: string[]
  imports?: string[]
  kind?: string
  requirement_ids?: string[]
  priority?: "blocking" | "advisory"
  source?: "spec" | "system"
  metadata?: Record<string, unknown>
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
      goal.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata)
        ? goal.metadata
        : undefined
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
        exports: goal.exports ?? [],
        imports: goal.imports ?? [],
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
  persisted: Array<{ id: string; title: string; llmID: string }>
  llmToDBID: Map<string, string>
  deletedIDs: string[]
} {
  const existing = listGoals(input.taskID)
  const existingByID = new Map(existing.map((g) => [g.id, g]))

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

  // DELETE: rows whose ids the Architect explicitly removed.
  const deletedIDs: string[] = []
  for (const llmID of input.removedLLMIDs) {
    const dbID = llmToDBID.get(llmID) ?? (existingByID.has(llmID) ? llmID : undefined)
    if (!dbID) continue
    db.delete(EngineGoalTable).where(eq(EngineGoalTable.id, dbID)).run()
    deletedIDs.push(dbID)
  }

  const persisted: Array<{ id: string; title: string; llmID: string }> = []
  for (let index = 0; index < plan.length; index++) {
    const { llmID, dbID, isNew, goal } = plan[index]
    const deps = (goal.depends_on ?? []).flatMap((dep) => {
      const mapped = llmToDBID.get(dep)
      if (mapped) return [mapped]
      if (existingByID.has(dep)) return [dep]
      log.warn("upsertGoalsFromArchitect: depends_on references unknown id — dropping", {
        goalID: dbID,
        unknownDep: dep,
      })
      return []
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
          exports: goal.exports ?? [],
          imports: goal.imports ?? [],
          kind: goal.kind ?? "feature",
          requirement_ids: goal.requirement_ids ?? [],
          metadata,
          priority: goal.priority ?? "blocking",
          source: goal.source ?? "spec",
          order_index: index,
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
          exports: goal.exports ?? [],
          imports: goal.imports ?? [],
          kind: goal.kind ?? "feature",
          requirement_ids: goal.requirement_ids ?? [],
          metadata,
          priority: goal.priority ?? "blocking",
          order_index: index,
          time_updated: input.now,
        })
        .where(eq(EngineGoalTable.id, dbID))
        .run()
    }
    persisted.push({ id: dbID, title: goal.title, llmID })
  }

  return { persisted, llmToDBID, deletedIDs }
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
        acceptance: Array.isArray(requirement.acceptance) ? JSON.stringify(requirement.acceptance) : requirement.acceptance,
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
      priority: requirement.priority === "advisory" ? "advisory" as const : "blocking" as const,
    }
  })
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
  // Live-run dedup: re-use an existing LIVE tip for the same (coordinator,
  // goal, plan_node) triple. A row that was already superseded is a leaked
  // in-flight retry and must not block the new dispatch.
  const liveTips = listGoalRunsByGoal(input.goalID).filter((r) =>
    r.coordinator_run_id === input.coordinatorRunID &&
    (input.planNodeID ? r.plan_node_id === input.planNodeID : r.plan_node_id === null) &&
    (LIVE_GOAL_RUN_STATUSES as readonly string[]).includes(r.status),
  )
  if (liveTips.length > 0) {
    const supersededIDs = new Set(
      listGoalRunsByGoal(input.goalID)
        .map((r) => r.supersede_of)
        .filter((x): x is string => !!x),
    )
    const tip = liveTips.find((r) => !supersededIDs.has(r.id))
    if (tip) return tip
  }
  const id = Identifier.ascending("goal_run")
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
// gate. Both the cache column and the dispatch gate are gone. Dep-failure
// handling is the LLM's call (it reads each goal's depends_on + describe
// layer flags and chooses retry_goal / modify_goal / fail_task).
// Verification-goal outcome is recorded on the goal's goal_run chain.

export function updateGoalWorkspace(input: {
  goalID: string
  workspaceDir: string | null
  workspaceBranch: string | null
  /** Optional — only written when explicitly provided. Leave `undefined`
   *  to preserve the existing baseRef across retries; pass `null` to
   *  clear it at terminal cleanup (see writer.ts cleanupGoalWorkspaceForGoal). */
  workspaceBaseRef?: string | null
  now?: number
}) {
  const now = input.now ?? Date.now()
  const goal = Database.use((db) =>
    db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, input.goalID)).get(),
  )
  if (!goal) {
    throw new Error(`updateGoalWorkspace: goal ${input.goalID} not found`)
  }
  const patch: Record<string, unknown> = {
    workspace_dir: input.workspaceDir,
    workspace_branch: input.workspaceBranch,
    time_updated: now,
  }
  if (input.workspaceBaseRef !== undefined) {
    patch.workspace_base_ref = input.workspaceBaseRef
  }
  Database.use((db) =>
    db.update(EngineGoalTable)
      .set(patch as any)
      .where(eq(EngineGoalTable.id, input.goalID))
      .run(),
  )
}

/** Set or clear the goal-scoped baseRef without touching workspace_dir /
 *  workspace_branch. Used by dispatchGoal to persist the first-attempt
 *  Snapshot.track() result exactly once per goal (see goal-pool.ts). */
export function updateGoalWorkspaceBaseRef(goalID: string, baseRef: string | null, now = Date.now()) {
  const goal = Database.use((db) =>
    db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get(),
  )
  if (!goal) {
    throw new Error(`updateGoalWorkspaceBaseRef: goal ${goalID} not found`)
  }
  Database.use((db) =>
    db.update(EngineGoalTable)
      .set({ workspace_base_ref: baseRef, time_updated: now } as any)
      .where(eq(EngineGoalTable.id, goalID))
      .run(),
  )
}

/**
 * Batch reset every goal in a task back to the "pending" projection by:
 *  1. clearing any explicit cascade_state marker
 *  2. supersede-annotating any failed goal_run tip so deriveGoalStatus
 *     projects `pending` via the retry marker
 *  3. calling syncGoalStatus on each goal
 *
 * Caller (restart_from_stage) is responsible for having aborted live
 * goal_runs first via abortLiveExecutionForTask — this function only
 * handles the terminal-state remnants.
 */
export function resetTaskGoalsToPending(input: {
  taskID: string
  reason: string
  now?: number
}) {
  const now = input.now ?? Date.now()
  const goals = listGoals(input.taskID)
  let supersededTips = 0
  for (const goal of goals) {
    const tip = findLatestTipGoalRun(goal.id)
    // Any terminal tip (failed / aborted / completed) must be superseded so
    // the goal is eligible for re-dispatch. `completed` was added when
    // abortLiveExecutionForTask stopped flipping completed→aborted
    // (catalog.ts resettable=false): restart_from_stage needs a way to
    // invalidate prior success under a new run, and the supersede marker
    // is now the sole mechanism.
    const result = startNewAttempt({
      goalID: goal.id,
      reason: "restart_stage",
      now,
    })
    if (result.supersededTipID) supersededTips++
  }
  log.info("reset task goals to pending", {
    taskID: input.taskID, reason: input.reason,
    total: goals.length, supersededTips,
  })
  return { total: goals.length, supersededTips }
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
function supersedeGoalRun(input: {
  oldGoalRunID: string
  reason: string
  now?: number
}) {
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
    base_ref: merged.base_ref,
    merge_ref: merged.merge_ref,
    supersede_of: merged.supersede_of,
    superseded_reason: merged.superseded_reason,
    superseded_at: merged.superseded_at,
    metadata: merged.metadata,
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
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("goal_run"),
        task_id: merged.task_id,
        run_id: merged.coordinator_run_id,
        goal_run_id: input.goalRunID,
        kind: "goal_run_attempt",
        label: input.label,
        payload,
        time_created: effectiveNow,
        time_updated: effectiveNow,
      })
      .run(),
  )
}

/**
 * Open a new attempt for a goal — single entry-point for "this goal must
 * re-dispatch under a fresh attempt." Replaces the four ad-hoc paths
 * (retry_goal / modify_goal / restart_from_stage / delivery_rework)
 * that all expanded to the same supersede + sync sequence and drifted apart
 * over time.
 *
 * Atomic intent:
 *   1. Supersede the terminal tip (if any) with `reason` as a typed enum.
 *      Idempotent — already-superseded tips are a no-op.
 *   2. Optionally reset `goal.workspace_dir` (when the new attempt must
 *      not inherit the prior worktree — e.g. modify_contract on a
 *      structurally different acceptance set).
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
}): { supersededTipID?: string; resetWorkspace: boolean } {
  const now = input.now ?? Date.now()
  const goal = findGoal(input.goalID)
  if (!goal) {
    throw new Error(`startNewAttempt: goal ${input.goalID} not found`)
  }
  let supersededTipID: string | undefined
  const tip = findLatestTipGoalRun(input.goalID)
  if (tip && (tip.status === "failed" || tip.status === "aborted" || tip.status === "completed")) {
    if (!tip.superseded_reason) {
      supersedeGoalRun({ oldGoalRunID: tip.id, reason: input.reason, now })
      supersededTipID = tip.id
    }
  }
  let resetWorkspace = false
  if (input.resetWorkspace && goal.workspace_dir) {
    Database.use((db) =>
      db.update(EngineGoalTable)
        .set({
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
          time_updated: now,
        })
        .where(eq(EngineGoalTable.id, input.goalID))
        .run(),
    )
    resetWorkspace = true
  }
  // Single writer of retry feedback into decision_log. Every path that opens
  // a new attempt (delivery_rework / manual_retry / modify_contract) routes
  // its per-goal analysis through this one write — `buildRetryFeedbackSection`
  // reads `phase="retry"` filtered by goalID. Previously the `feedback`
  // parameter existed on the signature but was dropped silently; only the
  // manual `retry_goal` tool duplicated a parallel decisionLog.append, so
  // executors on delivery_rework/modify_contract rework cycles ran with no
  // rejection context — i.e. blind retries.
  if (input.feedback) {
    createDecisionLog(goal.task_id).append({
      goalID: input.goalID,
      phase: "retry",
      key: `retry_analysis_${input.goalID}`,
      value: input.feedback.value,
      reason: input.feedback.reason,
    })
  }
  // Event sourcing: the goal_run row itself IS the event — tip's
  // superseded_reason column + superseded_at timestamp is the persistent
  // log of "a new attempt opened under reason X at time T." Loop-side
  // consumers track offset via `lastReworkSeenAt` and query via
  // `findRecentDeliveryRejection`. No separate Bus event needed; an in-memory
  // pub/sub would only duplicate what the goal_run chain already records.
  syncGoalStatus(input.goalID, `startNewAttempt:${input.reason}`)
  return { supersededTipID, resetWorkspace }
}

// Phase-6-d-0: `stampGoalRunProgress` deleted with goal-run-watchdog. The
// `last_progress_at` column's only reader was the watchdog — no caller now.
// The column stays until 6-d-3 table deletion cleans it up in one sweep.

export function updateGoalRun(
  goalRunID: string,
  values: Partial<import("./store").GoalRunRow>,
) {
  const row = findGoalRun(goalRunID)
  if (!row) return undefined
  const nextStatus = values.status ?? row.status
  // Rule 23: no state-machine transition gate. LLM / orchestrator may drive
  // goal_run.status to any value at any time; timestamp heuristics below are
  // informational, not blocking.
  const now = Date.now()
  const statusChanged = nextStatus !== row.status
  const patch: Partial<import("./store").GoalRunRow> = {
    ...values,
    ...(nextStatus !== "blocked" && values.blocking_reason === undefined ? { blocking_reason: null } : {}),
    ...(!row.time_started && ["accepted", "planning", "running", "evaluating", "blocked", "completed"].includes(nextStatus) && values.time_started === undefined
      ? { time_started: now }
      : {}),
    ...((nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted") && values.time_completed === undefined
      ? { time_completed: now }
      : {}),
  }
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
    syncGoalStatus(row.goal_id, `updateGoalRun ${row.status}→${nextStatus}`)
    const taskID = row.task_id
    const previousStatus = row.status
    Database.effect(() =>
      EngineProtocol.emit(
        Event.GoalRunUpdated,
        {
          taskID,
          goalRunID,
          goalID: row.goal_id,
          status: nextStatus,
          previousStatus,
          summary: `goal_run ${previousStatus}→${nextStatus}`,
        },
        { source: "persist.updateGoalRun" },
      ),
    )
  }
  return findGoalRun(goalRunID)
}

type EvaluationStatus = "passed" | "failed" | "pending"
type EvaluationVerdict = "accepted" | "rejected"

// `beginEvaluation` and `persistEvaluation` were part of the old `transition.ts`
// pipeline. With per-goal dispatch + delivery/checks they have no callers; the
// evaluation row is now created by `persistTaskDelivery()` (1:1 with the
// task-level delivery) and updated by `updateEvaluationFromDeliveryVerdict()`.
// Do not re-add conditional evaluation inserts — they break the
// task-delivery↔evaluation invariant. Per-goal deliveries do NOT create an
// evaluation row: goal_run status is driven by the executor directly, and the
// delivery-agent's checks cover per-goal verdicts — a per-goal evaluation row
// would be a dummy with no consumer.

type DeliveryInput = {
  summary: string
  commitRef?: string
  diffs: Array<{ file: string; [key: string]: unknown }>
  report?: import("@/delivery/checks").GoalReportClaim
}

// Shared diff-stat reduction + artifact inserts. Never writes the evaluation
// row — that's the split between persistGoalDelivery and persistTaskDelivery.
function writeDeliveryRow(
  db: Parameters<Parameters<typeof Database.transaction>[0]>[0],
  input: {
    task: TaskRow
    run: RunRow
    goalRunID?: string
    deliveryID: string
    delivery: DeliveryInput
    now: number
  },
) {
  const stats = input.delivery.diffs.reduce(
    (acc, d) => {
      const a = typeof (d as any).additions === "number" ? (d as any).additions : 0
      const r = typeof (d as any).deletions === "number" ? (d as any).deletions : 0
      acc.additions += a
      acc.deletions += r
      return acc
    },
    { additions: 0, deletions: 0 },
  )
  // Phase-6-c: the delivery row itself is now an `engine_artifact` with
  // kind="delivery" + label="delivery-<scope>" (task vs goal_run). Payload
  // carries the full DeliveryRow shape so the read-model can reconstruct it
  // without a JOIN. `deliveryID` is the artifact row id — consumers that
  // reference `delivery_id` on other artifact rows still point at a valid id.
  db.insert(EngineArtifactTable)
    .values({
      id: input.deliveryID,
      task_id: input.task.id,
      run_id: input.run.id,
      goal_run_id: input.goalRunID,
      delivery_id: input.deliveryID,
      kind: "delivery",
      label: input.goalRunID ? "delivery-goal_run" : "delivery-task",
      payload: {
        status: "candidate",
        summary: input.delivery.summary,
        result: {
          summary: input.delivery.summary,
          commit_ref: input.delivery.commitRef,
          changed_files: input.delivery.diffs.map((item) => item.file),
          diffs: input.delivery.diffs,
          stats,
          report: input.delivery.report,
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
      delivery_id: input.deliveryID,
      kind: "report",
      label: "assistant-summary",
      payload: { summary: input.delivery.summary },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  if (input.delivery.diffs.length > 0) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "diff",
        label: "workspace-diff",
        payload: { diffs: input.delivery.diffs },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  if (input.delivery.commitRef) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "git_ref",
        label: "delivery-commit",
        payload: { commit_ref: input.delivery.commitRef },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  for (const item of input.delivery.diffs) {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "changed_file",
        label: item.file,
        payload: item,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}

// Per-goal delivery: produced by pipeline/executor.ts the moment a goal_run
// finishes. Stores the delivery row + artifacts for later aggregation, but
// does NOT create an evaluation row — per-goal verdicts live inside the
// task-level delivery-agent run, so a per-goal eval would sit pending forever
// with no updater (see tick-32 bench DB: evl_*002* rows that never leave
// inconclusive/pending). Emits DeliveryReady so bridges know to refresh.
export function persistGoalDelivery(input: {
  task: TaskRow
  run: RunRow
  goalRunID: string
  deliveryID: string
  delivery: DeliveryInput
  now: number
}) {
  Database.transaction((db) => {
    writeDeliveryRow(db, input)
    Database.effect(() =>
      EngineProtocol.emit(Event.DeliveryReady, { taskID: input.task.id, runID: input.run.id, deliveryID: input.deliveryID, summary: input.delivery.summary }, { source: "persist.delivery" }),
    )
  })
}

// Task-level delivery: produced by orchestrator's `deliver` tool after all
// goal_runs complete. Writes the aggregated delivery row (goal_run_id=NULL) +
// one pending scope='delivery' evidence artifact. The delivery-agent settles
// it later by appending a new evidence artifact (append-only — queries take
// the latest via time_created desc). Post-phase-6 evidence lives in
// engine_artifact (kind="verification-evidence"); see verification/persist.ts.
export function persistTaskDelivery(input: {
  task: TaskRow
  run: RunRow
  deliveryID: string
  delivery: DeliveryInput
  now: number
}) {
  Database.transaction((db) => {
    writeDeliveryRow(db, input)
    Database.effect(() =>
      EngineProtocol.emit(Event.DeliveryReady, { taskID: input.task.id, runID: input.run.id, deliveryID: input.deliveryID, summary: input.delivery.summary }, { source: "persist.delivery" }),
    )
  })
  persistEvidence({
    taskID: input.task.id,
    runID: input.run.id,
    deliveryID: input.deliveryID,
    scope: "delivery",
    status: "pending",
    verdict: "inconclusive",
    summary: input.delivery.summary,
    checks: [],
    now: input.now,
  })
}

/**
 * Settle the pending scope='delivery' evidence for a task-level delivery by
 * appending a new evidence artifact row. Artifact rows are append-only so
 * this function inserts a fresh row rather than mutating the pending one —
 * `findLatestDeliveryEvidence(taskID)` naturally surfaces the newest row via
 * `time_created desc`. Throws when the pending row never existed, because
 * that implies `persistTaskDelivery()` was bypassed (or the caller passed a
 * per-goal delivery id — per-goal deliveries carry no evidence by design).
 *
 * The `checks` parameter semantics match the pre-artifact behaviour: when
 * supplied, replaces the previous check set wholesale; when OMITTED, the
 * prior check set is preserved (used by `publish_delivery` which runs after
 * `deliver` has already written the structured checks). Pass [] to clear.
 */
export function updateEvaluationFromDeliveryVerdict(input: {
  deliveryID: string
  verdict: "accepted" | "rejected" | "inconclusive"
  summary: string
  checks?: import("./engine.sql").EngineEvaluationCheck[]
  now?: number
}) {
  const now = input.now ?? Date.now()
  const status =
    input.verdict === "accepted"
      ? "passed"
      : input.verdict === "rejected"
        ? "failed"
        : "inconclusive"
  const existing = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.delivery_id, input.deliveryID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  if (!existing) {
    throw new Error(
      `updateEvaluationFromDeliveryVerdict: no evidence row found for delivery ${input.deliveryID}. ` +
      `Either persistTaskDelivery() was bypassed, or the caller passed a per-goal delivery id ` +
      `(per-goal deliveries have no evidence row — only task-level deliveries are 1:1 with evidence).`,
    )
  }
  const existingPayload = (existing.payload ?? {}) as {
    checks?: import("./engine.sql").EngineEvaluationCheck[]
  }
  const existingChecks = Array.isArray(existingPayload.checks) ? existingPayload.checks : []
  const checks = input.checks ?? existingChecks
  persistEvidence({
    taskID: existing.task_id,
    runID: existing.run_id,
    deliveryID: input.deliveryID,
    scope: "delivery",
    status,
    verdict: input.verdict,
    summary: input.summary,
    checks,
    timeCompleted: now,
    now,
  })
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
  // anyway (wrote scope='delivery' with delivery_id=null) — we don't resurrect
  // that shape in artifact land. Goal-run-scoped failures remain handled at the
  // goal-run site (dispatch_goal/retry_goal persist evidence before failing).
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

function claimExecutorSessionLeaseWhere(id: string, now: number) {
  const owner = executorLeaseOwner()
  return and(
    eq(EngineExecutorSessionTable.id, id),
    eq(EngineExecutorSessionTable.status, "active"),
    or(
      eq(EngineExecutorSessionTable.lease_owner, owner),
      isNull(EngineExecutorSessionTable.lease_owner),
      lte(EngineExecutorSessionTable.lease_until, now),
    ),
  )
}

function leaseWindow(now: number) {
  return {
    lease_owner: executorLeaseOwner(),
    lease_until: executorLeaseUntil(now),
    time_updated: now,
  }
}

function executorLeaseConflict(row: typeof EngineExecutorSessionTable.$inferSelect | undefined, now: number) {
  if (!row) return ""
  if (executorLeaseHeldByOther(row, now)) {
    return `executor session ${row.id} is leased by ${row.lease_owner} until ${row.lease_until}`
  }
  if (row.status !== "active") {
    return `executor session ${row.id} is not active (${row.status})`
  }
  if (!executorLeaseAvailable(row, now) && row.lease_owner !== executorLeaseOwner()) {
    return `executor session ${row.id} lease is unavailable`
  }
  return `executor session ${row.id} could not be claimed`
}

export function claimExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(EngineExecutorSessionTable)
      .set(leaseWindow(now))
      .where(claimExecutorSessionLeaseWhere(input.executorSessionID, now))
      .returning()
      .get(),
  )
}

export function ensureExecutorSession(input: {
  taskID: string
  runID: string
  goalRunID?: string
  provider: RunRow["executor"]
  refs?: ProtocolRefsInfo
  capabilities?: ProtocolCapabilitiesInfo
  settings?: ProtocolSettingsInfo
  started?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(
        input.goalRunID
          ? eq(EngineExecutorSessionTable.goal_run_id, input.goalRunID)
          : and(eq(EngineExecutorSessionTable.run_id, input.runID), isNull(EngineExecutorSessionTable.goal_run_id)),
      )
      .orderBy(desc(EngineExecutorSessionTable.time_created))
      .get(),
  )
  const info = protocolInfo(input.provider)
  const now = Date.now()
  const refs = mergeRefs(existing?.refs ?? undefined, input.refs)
  const capabilities = input.capabilities ?? info.capabilities
  const settings = {
    ...(existing?.settings ?? {}),
    ...(input.settings ?? {}),
  }
  if (existing) {
    const updated = Database.use((db) =>
      db
        .update(EngineExecutorSessionTable)
        .set({
          provider: input.provider,
          protocol: info.protocol,
          protocol_version: info.version,
          transport: ProtocolTransport.parse(info.transport).kind,
          status: "active",
          refs,
          capabilities,
          settings,
          lease_owner: executorLeaseOwner(),
          lease_until: executorLeaseUntil(now),
          time_started: existing.time_started ?? input.started ?? now,
          time_updated: now,
        })
        .where(claimExecutorSessionLeaseWhere(existing.id, now))
        .returning()
        .get(),
    )
    if (updated) return updated
    const blocked = Database.use((db) =>
      db
        .select()
        .from(EngineExecutorSessionTable)
        .where(eq(EngineExecutorSessionTable.id, existing.id))
        .get(),
    )
    throw new Error(`ensureExecutorSession: ${executorLeaseConflict(blocked, now)}`)
  }
  const id = Identifier.ascending("executor_session")
  Database.use((db) =>
    db
      .insert(EngineExecutorSessionTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        provider: input.provider,
        protocol: info.protocol,
        protocol_version: info.version,
        transport: ProtocolTransport.parse(info.transport).kind,
        status: "active",
        refs,
        capabilities,
        settings,
        lease_owner: executorLeaseOwner(),
        lease_until: executorLeaseUntil(now),
        time_started: input.started ?? now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const inserted = Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.id, id))
      .get(),
  )
  if (!inserted) throw new Error(`ensureExecutorSession: executor session ${id} not found after insert`)
  return inserted
}

export function updateExecutorSessionStatus(runID: string, status: typeof EngineExecutorSessionTable.$inferInsert.status) {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.run_id, runID))
      .orderBy(desc(EngineExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  return updateExecutorSessionStatusByID(row.id, status)
}

export function updateExecutorSessionStatusByID(
  executorSessionID: string,
  status: typeof EngineExecutorSessionTable.$inferInsert.status,
) {
  Database.use((db) =>
    db
      .update(EngineExecutorSessionTable)
      .set({
        status,
        lease_owner: null,
        lease_until: 0,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(EngineExecutorSessionTable.id, executorSessionID))
      .run(),
  )
}

export function updateGoalRunExecutorSessionStatus(
  goalRunID: string,
  status: typeof EngineExecutorSessionTable.$inferInsert.status,
) {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.goal_run_id, goalRunID))
      .orderBy(desc(EngineExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  return updateExecutorSessionStatusByID(row.id, status)
}

export function renewExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(EngineExecutorSessionTable)
      .set(leaseWindow(now))
      .where(
        and(
          eq(EngineExecutorSessionTable.id, input.executorSessionID),
          eq(EngineExecutorSessionTable.status, "active"),
          eq(EngineExecutorSessionTable.lease_owner, executorLeaseOwner()),
        ),
      )
      .returning()
      .get(),
  )
}


/** Phase-6-c: delivery rows are append-only `engine_artifact` rows with
 *  kind="delivery". `markDeliveryPublishing` / `finalizeDeliveryResult` now
 *  insert a new artifact row carrying the updated payload; queries pick the
 *  latest via `time_created desc`. The artifact row id stays stable across
 *  a delivery's lifecycle by referencing `delivery_id` in the artifact
 *  column (FK intentionally decoupled — see engine.sql.ts). */
export function markDeliveryPublishing(deliveryId: string, now: number) {
  const existing = findLatestDeliveryArtifact(deliveryId)
  if (!existing) {
    throw new Error(`markDeliveryPublishing: no delivery artifact found for ${deliveryId}`)
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
        delivery_id: deliveryId,
        kind: "delivery",
        label: existing.label,
        payload: { ...payload, status: "publishing" },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

export function finalizeDeliveryResult(input: {
  deliveryId: string
  taskId: string
  runId: string
  delivery: { result?: Record<string, unknown> | null }
  result: {
    status: EngineDeliveryStatus
    summary: string
    artifacts: Array<{ kind: EngineArtifactKind; label: string; payload: Record<string, unknown> }>
    publish: unknown
  }
  now: number
}) {
  const existing = findLatestDeliveryArtifact(input.deliveryId)
  if (!existing) {
    throw new Error(`finalizeDeliveryResult: no delivery artifact found for ${input.deliveryId}`)
  }
  const existingPayload = (existing.payload ?? {}) as Record<string, unknown>
  const existingResult = (existingPayload.result ?? input.delivery.result ?? {}) as Record<string, unknown>
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskId,
        run_id: input.runId,
        goal_run_id: existing.goal_run_id ?? null,
        delivery_id: input.deliveryId,
        kind: "delivery",
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
          delivery_id: input.deliveryId,
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

/** Phase-6-c internal: find the latest delivery artifact row by delivery_id.
 *  Newer rows supersede older ones (append-only semantics). */
function findLatestDeliveryArtifact(deliveryId: string) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.delivery_id, deliveryId),
          eq(EngineArtifactTable.kind, "delivery"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
}


function mergeRefs(current?: ProtocolRefsInfo, next?: ProtocolRefsInfo) {
  if (!current && !next) return undefined
  const result = {
    ...(current ?? {}),
    ...(next ?? {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
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
  return Database.use((db) =>
    db.delete(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).run(),
  )
}
