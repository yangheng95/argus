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
import { writeEvaluationSnapshot, writeGoalSnapshot } from "@/engine/docs"
import { Database, and, desc, eq, inArray, isNull, lte, or } from "@/storage/db"
import { Log } from "@/util/log"
import { Event } from "./model"
import {
  EngineArtifactTable,
  EngineDeliveryTable,
  EngineEvaluationTable,
  EngineExecutorSessionTable,
  EngineGoalTable,
  EngineGoalRunTable,
  EngineRequirementTable,
  EngineRunTable,
  EngineTaskTable,
  type EngineDeliveryStatus,
  type EngineArtifactKind,
  type EngineGoalRunSupersededReason,
} from "./engine.sql"
import { LIVE_GOAL_RUN_STATUSES } from "./catalog"
import { EngineProtocol } from "./protocol"
import { findGoal, findGoalRun, findLatestTipGoalRun, findPlan, listGoals, listGoalsForPlan, type GoalRow, type RunRow, type TaskRow } from "./store"
import { syncGoalStatus } from "./goal-status"
import { assertGoalRunTransition, type GoalRunStatus } from "./goal-run-state-machine"
import { StaleRowError } from "./state"

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
  // Live-run dedup: only collapse against a running goal_run that is itself
  // a tip of the supersede chain. A live row that was already superseded is
  // a leaked in-flight retry and must not block the new dispatch.
  const liveCandidates = Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(and(
        eq(EngineGoalRunTable.coordinator_run_id, input.coordinatorRunID),
        eq(EngineGoalRunTable.goal_id, input.goalID),
        input.planNodeID
          ? eq(EngineGoalRunTable.plan_node_id, input.planNodeID)
          : isNull(EngineGoalRunTable.plan_node_id),
        inArray(EngineGoalRunTable.status, LIVE_GOAL_RUN_STATUSES),
      ))
      .orderBy(desc(EngineGoalRunTable.time_created))
      .all(),
  )
  if (liveCandidates.length > 0) {
    const supersededIDs = new Set(
      Database.use((db) =>
        db
          .select({ parent: EngineGoalRunTable.supersede_of })
          .from(EngineGoalRunTable)
          .where(and(
            eq(EngineGoalRunTable.goal_id, input.goalID),
            // any row whose supersede_of is set counts
          ))
          .all()
          .map((r) => r.parent)
          .filter((p): p is string => !!p),
      ),
    )
    const tip = liveCandidates.find((r) => !supersededIDs.has(r.id))
    if (tip) return tip
  }
  const id = Identifier.ascending("goal_run")
  const now = input.now ?? Date.now()
  Database.use((db) =>
    db
      .insert(EngineGoalRunTable)
      .values({
        id,
        task_id: input.taskID,
        goal_id: input.goalID,
        plan_node_id: input.planNodeID,
        coordinator_run_id: input.coordinatorRunID,
        session_id: input.sessionID,
        status: "queued",
        retry_count: input.retryCount ?? 0,
        blocking_reason: input.blockingReason ?? null,
        error: input.error ?? null,
        workspace_dir: input.workspaceDir,
        base_ref: input.baseRef,
        merge_ref: input.mergeRef,
        supersede_of: input.supersedeOf,
        metadata:
          input.metadata || input.sessionID
            ? {
                ...(input.metadata ?? {}),
                ...(input.sessionID ? { local_session_id: input.sessionID } : {}),
              }
            : undefined,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineGoalRunTable)
      .where(eq(EngineGoalRunTable.id, id))
      .get(),
  )
  if (!row) throw new Error(`createGoalRun: inserted goal run ${id} not found after insert`)
  // engine_goal.status is derived — refresh it now that a new tip exists.
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
  reason: EngineGoalRunSupersededReason
  now?: number
}) {
  const now = input.now ?? Date.now()
  const existing = findGoalRun(input.oldGoalRunID)
  if (!existing) {
    throw new Error(`supersedeGoalRun: goal_run ${input.oldGoalRunID} not found`)
  }
  Database.use((db) =>
    db
      .update(EngineGoalRunTable)
      .set({
        superseded_reason: input.reason,
        superseded_at: now,
        time_updated: now,
      })
      .where(eq(EngineGoalRunTable.id, input.oldGoalRunID))
      .run(),
  )
  syncGoalStatus(existing.goal_id, `supersedeGoalRun:${input.reason}`)
  return existing
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
  reason: EngineGoalRunSupersededReason
  now?: number
  resetWorkspace?: boolean
  feedback?: Record<string, unknown>
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
  // Event sourcing: the goal_run row itself IS the event — tip's
  // superseded_reason column + superseded_at timestamp is the persistent
  // log of "a new attempt opened under reason X at time T." Loop-side
  // consumers track offset via `lastReworkSeenAt` and query via
  // `findRecentReworkAttempt`. No separate Bus event needed; an in-memory
  // pub/sub would only duplicate what the goal_run chain already records.
  syncGoalStatus(input.goalID, `startNewAttempt:${input.reason}`)
  return { supersededTipID, resetWorkspace }
}

export function updateGoalRun(
  goalRunID: string,
  values: Partial<typeof EngineGoalRunTable.$inferInsert>,
) {
  const row = findGoalRun(goalRunID)
  if (!row) return undefined
  const nextStatus = values.status ?? row.status
  if (nextStatus !== row.status) {
    assertGoalRunTransition(row.status as GoalRunStatus, nextStatus as GoalRunStatus)
  }
  const now = Date.now()
  const statusChanged = nextStatus !== row.status
  const normalizedValues = {
    ...values,
    ...(nextStatus !== "blocked" && values.blocking_reason === undefined ? { blocking_reason: null } : {}),
    ...(!row.time_started && ["accepted", "planning", "running", "evaluating", "blocked", "completed"].includes(nextStatus) && values.time_started === undefined
      ? { time_started: now }
      : {}),
    ...((nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted") && values.time_completed === undefined
      ? { time_completed: now }
      : {}),
  }
  let updated: typeof EngineGoalRunTable.$inferSelect | undefined
  Database.transaction((db) => {
    const whereClause = statusChanged
      ? and(
          eq(EngineGoalRunTable.id, goalRunID),
          eq(EngineGoalRunTable.status, row.status),
        )
      : eq(EngineGoalRunTable.id, goalRunID)
    updated = db
      .update(EngineGoalRunTable)
      .set({
        ...normalizedValues,
        time_updated: now,
      })
      .where(whereClause)
      .returning()
      .get()
    if (!updated) {
      throw new StaleRowError("goal_run", goalRunID, row.status, nextStatus)
    }
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
  return updated ?? findGoalRun(goalRunID)
}

type EvaluationStatus = "passed" | "failed" | "pending"
type EvaluationVerdict = "accepted" | "rejected"

// `beginEvaluation` and `persistEvaluation` were part of the old `transition.ts`
// pipeline. With per-goal dispatch + delivery/checks they have no callers; the
// evaluation row is now created by `persistDelivery()` (1:1 with delivery) and
// updated by `updateEvaluationFromDeliveryVerdict()`. Do not re-add conditional
// evaluation inserts — they break the delivery↔evaluation invariant.


export function persistDelivery(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  delivery: {
    summary: string
    commitRef?: string
    diffs: Array<{ file: string; [key: string]: unknown }>
    report?: import("@/delivery/checks").GoalReportClaim
  }
  now: number
}) {
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
  // 1:1 delivery↔evaluation invariant — the row is created here pending, and
  // update-in-place is the only allowed path afterwards. Never conditional-insert
  // an evaluation elsewhere; doing so breaks the invariant and reintroduces the
  // "delivery candidate + no evaluation" stall that the 006/007 benchmark hit.
  const evaluationID = Identifier.ascending("evaluation")
  Database.transaction((db) => {
    db.insert(EngineDeliveryTable)
      .values({
        id: input.deliveryID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
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
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineEvaluationTable)
      .values({
        id: evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        // Invariant: scope='delivery' ⇒ delivery_id NOT NULL, trivially held
        // because persistDelivery is the only inserter that sets delivery_id.
        scope: "delivery",
        status: "pending",
        verdict: "inconclusive",
        summary: input.delivery.summary,
        checks: [],
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
    Database.effect(() =>
      EngineProtocol.emit(Event.DeliveryReady, { taskID: input.task.id, runID: input.run.id, deliveryID: input.deliveryID, summary: input.delivery.summary }, { source: "persist.delivery" }),
    )
  })
}

/**
 * Update the pending evaluation row attached to a delivery. Requires the row
 * created by persistDelivery() to exist — throws loudly when it does not,
 * because the 1:1 delivery↔evaluation invariant is the whole reason the
 * evaluation-never-created stall is fixable. A missing row means something
 * inserted a delivery without going through persistDelivery(), which is a
 * bug that must be surfaced, not silently patched.
 */
export function updateEvaluationFromDeliveryVerdict(input: {
  deliveryID: string
  verdict: "accepted" | "rejected" | "inconclusive"
  summary: string
  /** Structured checks for the evaluation row. When supplied replaces the
   *  existing array wholesale; when OMITTED the existing checks are
   *  preserved (used by `publish_delivery` which runs after `deliver` has
   *  already written the structured check set). Pass [] to explicitly
   *  clear. No `issues` parameter exists — callers must either build their
   *  own structured EngineEvaluationCheck[] or omit `checks` to preserve. */
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
      .from(EngineEvaluationTable)
      .where(eq(EngineEvaluationTable.delivery_id, input.deliveryID))
      .get(),
  )
  if (!existing) {
    throw new Error(
      `updateEvaluationFromDeliveryVerdict: no evaluation row found for delivery ${input.deliveryID}. ` +
      `persistDelivery() must have been bypassed — deliveries and evaluations are 1:1.`,
    )
  }
  const existingChecks: import("./engine.sql").EngineEvaluationCheck[] = Array.isArray(existing.checks)
    ? (existing.checks as import("./engine.sql").EngineEvaluationCheck[])
    : []
  const checks = input.checks ?? existingChecks
  Database.use((db) =>
    db
      .update(EngineEvaluationTable)
      .set({
        status,
        verdict: input.verdict,
        summary: input.summary,
        checks,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(EngineEvaluationTable.id, existing.id))
      .run(),
  )
}

export function persistFailedRunEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  error: string
  now: number
}) {
  const evaluationID = Identifier.ascending("evaluation")
  Database.use((db) =>
    db
      .insert(EngineEvaluationTable)
      .values({
        id: evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
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
        time_completed: input.now,
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
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


export function markDeliveryPublishing(deliveryId: string, now: number) {
  Database.use((db) =>
    db
      .update(EngineDeliveryTable)
      .set({
        status: "publishing",
        time_updated: now,
      })
      .where(eq(EngineDeliveryTable.id, deliveryId))
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
  Database.transaction((db) => {
    db.update(EngineDeliveryTable)
      .set({
        status: input.result.status,
        summary: input.result.summary,
        result: {
          ...(input.delivery.result ?? {}),
          summary: input.result.summary,
          artifacts: input.result.artifacts.map((item) => ({
            kind: item.kind,
            label: item.label,
          })),
          publish: input.result.publish,
        },
        time_updated: input.now,
      })
      .where(eq(EngineDeliveryTable.id, input.deliveryId))
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
