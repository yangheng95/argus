/**
 * Derive the current goal state from (cascade_state, goal_run chain tip).
 *
 * After Phase 3, `engine_goal.status` is no longer authoritative — it is
 * a stale INSERT-time placeholder that nobody reads. Call sites derive
 * the live state via `describe.ts::goalStatusByID` (which wraps
 * `deriveGoalStatus`). The engine_goal.status column remains in the
 * schema only because a Phase 4 DB reset hasn't happened yet; it is not
 * a cache, not a gate, and will be dropped when Phase 4 ships.
 *
 * The legal signals remain:
 *   1. `engine_goal.cascade_state` — non-null only when deps permanently
 *      failed. Written by `persist.ts::updateGoalCascadeFailed`.
 *   2. `engine_goal_run` chain — the supersede-tip row, plus its
 *      `superseded_reason` first-class column.
 *
 * `syncGoalStatus()` no longer writes engine_goal.status. It re-derives
 * on every call and emits GoalPassed / GoalFailed events on transition,
 * using an in-memory last-emitted map as the baseline (the prior
 * baseline was the cache field, now stale). Event subscribers
 * (overlay, decision-log watchers, bus consumers) are idempotent, so a
 * duplicate emit after process restart is harmless.
 */

import type { EngineGoalRunStatus } from "./engine.sql"
import type { EngineGoalStatus } from "./describe"
import { Database } from "@/storage/db"
import { EngineProtocol } from "./protocol"
import { Event } from "./model"
import { listGoalRunsByGoal, findGoal } from "./store"
import { isGoalRunOrphaned } from "./orphan"
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
 * Pure function: derive goal status from the goal_run chain tip alone.
 * Returns undefined when the goal has no runs yet — caller defaults to
 * "pending" (never_dispatched semantics live in describe.ts::describeGoal).
 *
 * The cached column (engine_goal.status) and cascade_state override were
 * retired in the LLM-autonomous redesign. Dep-failure propagation is
 * now a decision the LLM makes after reading describeTask; there is no
 * pre-computed "cascade failed" projection.
 */
export function deriveGoalStatus(goalID: string): EngineGoalStatus | undefined {
  const rows = listGoalRunsByGoal(goalID)
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(
    rows.map((r) => (r as { supersede_of?: string | null }).supersede_of).filter((x): x is string => !!x),
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
  //   - failed / aborted — retry intent (manual_retry, acceptance_rework)
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
  // Owner-orphan: the head tip is in a live status but was driven live by a
  // process that has since restarted (its owner stamp ≠ the current process).
  // The half-streamed goal turn is physically dead and cannot resume, so it
  // must NOT keep projecting `running` — that is what kept the overlay goal
  // card spinning forever after a restart. Project `failed` so every reader of
  // goalStatusByID (overlay board, workflow step projection) shows a dead
  // attempt; re-dispatch is driven by describeGoal.is_orphaned + the
  // beginBuildAttempt retire-on-redispatch path, not by this label. Spec
  // 2026-05-29-goal-run-owner-orphan-liveness §2.2.
  if (isGoalRunOrphaned(head)) {
    return "failed"
  }
  return mapRunStatus(head.status as EngineGoalRunStatus)
}

/**
 * Re-derive goal state from the event stream (cascade_state + goal_run
 * chain tip) and emit transition events when the derived value has
 * changed since the last emission. Does NOT update engine_goal.status —
 * that cache was retired in Phase 3. Callers still invoke this after
 * goal_run lifecycle writes (createGoalRun, updateGoalRun,
 * startNewAttempt) so event subscribers see the transition in real time.
 *
 * Baseline for transition comparison is an in-memory map
 * (`lastEmittedStatus`) keyed by goal ID. The baseline existed implicitly
 * in the old cache field; now it is explicit and in-process. On process
 * restart the map is empty and the first derive re-emits — event
 * subscribers are idempotent (overlay projections, decision-log
 * watchers), so duplicate emits after restart are harmless.
 */
const lastEmittedStatus = new Map<string, EngineGoalStatus>()

export function syncGoalStatus(goalID: string, reason: string) {
  const goal = findGoal(goalID)
  if (!goal) {
    log.warn("syncGoalStatus: goal not found", { goalID })
    return
  }
  const derived = deriveGoalStatus(goalID)
  if (!derived) return // no goal_run yet — nothing to emit
  const prev = lastEmittedStatus.get(goalID)
  if (prev === derived) return
  lastEmittedStatus.set(goalID, derived)
  log.info("goal status transition (derived, no cache write)", {
    goalID,
    from: prev ?? "(initial)",
    to: derived,
    reason,
  })
  if (derived === "passed") {
    Database.effect(() =>
      EngineProtocol.emit(
        Event.GoalPassed,
        { taskID: goal.task_id, goalID, summary: goal.title },
        { source: "goal-status.sync" },
      ),
    )
  } else if (derived === "failed") {
    Database.effect(() =>
      EngineProtocol.emit(
        Event.GoalFailed,
        { taskID: goal.task_id, goalID, summary: goal.title },
        { source: "goal-status.sync" },
      ),
    )
  }
}
