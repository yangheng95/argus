/**
 * Derive `engine_goal.status` from (cascade_state, goal_run chain tip).
 *
 * engine_goal.status is NOT an authored field — it's a cached projection of
 * two inputs:
 *   1. `engine_goal.cascade_state` — non-null only when the goal's deps
 *      are permanently failed and no goal_run will ever dispatch. Written
 *      only by `persist.ts::updateGoalCascadeFailed`.
 *   2. `engine_goal_run` chain — the supersede-tip goal_run row.
 *
 * There are exactly two legal writers for `engine_goal.status`:
 *   - `syncGoalStatus()`           — derives from the two inputs above
 *   - `updateGoalCascadeFailed()`  — writes cascade_state, then calls
 *                                    syncGoalStatus
 *
 * All other direct writes to engine_goal.status are a bug. They produce
 * divergence that the dispatch gate / readiness logic cannot reconcile,
 * which historically caused the "completed goal_run but pending goal"
 * stall (iter-6 / iter-7) and the "failed status silently re-derived"
 * stall (chgZ 2026-04-18).
 */

import { Database, eq } from "@/storage/db"
import { EngineGoalTable } from "./engine.sql"
import type { EngineGoalRunStatus, EngineGoalStatus } from "./engine.sql"
import { EngineProtocol } from "./protocol"
import { Event } from "./model"
import { listGoalRunsByGoal, findGoal } from "./store"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-status" })

/**
 * Map a goal_run.status to the corresponding engine_goal.status contribution.
 * Returns undefined for states that do not map cleanly (e.g. supersede_of link
 * should be filtered by the caller before calling this).
 */
function mapRunStatus(runStatus: EngineGoalRunStatus): EngineGoalStatus {
  switch (runStatus) {
    case "queued":
    case "accepted":
    case "planning":
      return "pending"
    case "running":
    case "evaluating":
    case "blocked":
      return "running"
    case "completed":
      return "passed"
    case "failed":
      return "failed"
    case "aborted":
      // `aborted` is retriable, not a terminal failure. Operator actions
      // like modify_goal / task cancel / restart_from_stage mark runs
      // aborted to retire them under an explicit "may re-dispatch" intent.
      // Projecting this as `pending` keeps the engine_goal view aligned
      // with readiness (`readyGoalNodes` accepts aborted tips).
      return "pending"
  }
}

/**
 * Pure function: compute what engine_goal.status should be from
 * (cascade_state, goal_run chain tip). Returns undefined only when neither
 * input is set — caller keeps the default "pending".
 *
 * Precedence: cascade_state=failed dominates any goal_run chain. This is
 * deliberate — cascade means deps permanently failed, so even a completed
 * goal_run (from a prior contract) must project as failed now.
 */
export function deriveGoalStatus(goalID: string): EngineGoalStatus | undefined {
  const goal = findGoal(goalID)
  if (goal?.cascade_state === "failed") return "failed"
  if (goal?.cascade_state === "passed") return "passed"
  const rows = listGoalRunsByGoal(goalID)
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(
    rows
      .map((r) => (r as { supersede_of?: string | null }).supersede_of)
      .filter((x): x is string => !!x),
  )
  const tips = rows.filter((r) => !supersededIDs.has(r.id))
  if (tips.length === 0) {
    // Every row is pointed at by another supersede_of — data corruption.
    // Surface instead of defaulting, since it points at a circular link.
    throw new Error(
      `deriveGoalStatus(${goalID}): supersede chain has no tip — every goal_run is superseded. ` +
      `This is a data inconsistency (circular supersede link or dangling reference).`,
    )
  }
  // Tips are sorted desc by time_created (list() returns desc). The single
  // newest tip is the authoritative head — a retry that issued createGoalRun
  // is the new tip, and an old terminal row that was not yet superseded is
  // the only tip if no retry happened.
  const head = tips[0]!
  // Terminal tip with non-null `superseded_reason` column means
  // `Goal.startNewAttempt` was invoked: the old tip stays in its terminal
  // FSM state (history is immutable) and the goal must re-dispatch under
  // a fresh attempt. Project `pending` so the task loop's `hasPending`
  // check picks the goal up and re-invokes pool.submit() → readyGoalNodes
  // → pool.dispatchGoal → pool-internal createGoalRun (the only authoritative
  // creator of dispatchable goal_runs).
  //
  // Applies to all three terminal states:
  //   - failed / aborted — retry intent (manual_retry, delivery_rework)
  //   - completed        — contract changed (modify_contract); the prior
  //     success record is preserved, but a new run under the new contract
  //     must prove acceptance. Without this projection the completed tip
  //     would keep projecting `passed` and dispatch would never pick it up.
  if (
    (head.status === "failed" || head.status === "aborted" || head.status === "completed") &&
    head.superseded_reason
  ) {
    return "pending"
  }
  return mapRunStatus(head.status as EngineGoalRunStatus)
}

/**
 * Recompute engine_goal.status from goal_run chain tip and write it back.
 * No-op when the derived value equals the current value. Emits GoalPassed /
 * GoalFailed events on transition so bus subscribers (overlay, board,
 * decision-log watchers) see the change — matches the events emitted by
 * the previous ad-hoc UPDATE sites.
 *
 * Callers must invoke this after any goal_run lifecycle write
 * (createGoalRun, updateGoalRun, startNewAttempt).
 */
export function syncGoalStatus(goalID: string, reason: string) {
  const goal = findGoal(goalID)
  if (!goal) {
    log.warn("syncGoalStatus: goal not found", { goalID })
    return
  }
  const derived = deriveGoalStatus(goalID)
  if (!derived) return // no goal_run yet; keep whatever engine_goal started with
  if (goal.status === derived) return
  const now = Date.now()
  Database.use((db) =>
    db
      .update(EngineGoalTable)
      .set({ status: derived, time_updated: now })
      .where(eq(EngineGoalTable.id, goalID))
      .run(),
  )
  log.info("goal status synced from goal_run chain", {
    goalID, from: goal.status, to: derived, reason,
  })
  if (derived === "passed") {
    Database.effect(() =>
      EngineProtocol.emit(Event.GoalPassed, { taskID: goal.task_id, goalID, summary: goal.title }, { source: "goal-status.sync" }),
    )
  } else if (derived === "failed") {
    Database.effect(() =>
      EngineProtocol.emit(Event.GoalFailed, { taskID: goal.task_id, goalID, summary: goal.title }, { source: "goal-status.sync" }),
    )
  }
}
