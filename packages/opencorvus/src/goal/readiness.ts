/**
 * Goal dispatch idempotency helpers.
 *
 * The FSM-era "readiness" gate (dep-graph filter + status-based admission)
 * was retired in the LLM-autonomous scheduling redesign — the orchestrator
 * LLM reads the describe layer and decides which goals to dispatch, and
 * the pool executes whatever IDs it's told. The only invariant the pool
 * still enforces is **idempotency**: never double-dispatch a goal that
 * already has a live or satisfied tip in its supersede chain.
 *
 * Everything here is a pure function of the goal_run event stream — no
 * engine_goal.status reads, no dependency graph resolution.
 */
import type { GoalRow, GoalRunRow } from "@/engine"
import { doesGoalRunSatisfyGoal, isLiveGoalRunStatus } from "@/engine/catalog"
import { isDispatchableGoal } from "@/goal/kind"

/**
 * The "tips" of the supersede chain — goal_runs that are NOT pointed at by
 * any other goal_run's supersede_of. A retry inserts a new goal_run with
 * supersede_of=<old terminal run.id>, making the old row a non-tip;
 * idempotency checks operate on tips only.
 */
export function supersedeTips(goalRuns: GoalRunRow[]): GoalRunRow[] {
  const supersededIDs = new Set<string>()
  for (const r of goalRuns) {
    const parent = r.supersede_of
    if (parent) supersededIDs.add(parent)
  }
  return goalRuns.filter((r) => !supersededIDs.has(r.id))
}

/**
 * True when it is legal to dispatch a fresh goal_run for this goal. Returns
 * false when the tip is:
 *   - live (queued / accepted / planning / running / evaluating / blocked),
 *     because that goal_run is already working — a second dispatch would
 *     race against it.
 *   - terminal-satisfying (completed) without a superseded_reason set,
 *     because the goal is already done under the current contract.
 *
 * Returns true when there are no tips (never dispatched) or when the tip
 * is terminal-but-superseded (an attempt cycle was opened under retry /
 * delivery_rework / modify_contract / restart_stage). The LLM's
 * describe layer surfaces `needs_redispatch` for this case.
 *
 * Advisory goals that failed are not dispatchable (pipeline moves on);
 * system goals are not dispatchable (setup/teardown runs elsewhere).
 */
export function isGoalDispatchable(goal: GoalRow, goalRuns: GoalRunRow[]): boolean {
  if (!isDispatchableGoal(goal)) return false
  const tips = supersedeTips(goalRuns.filter((r) => r.goal_id === goal.id))
  if (tips.length === 0) return true
  const tip = tips[0]!
  if (isLiveGoalRunStatus(tip.status)) return false
  if (doesGoalRunSatisfyGoal(tip.status) && !tip.superseded_reason) return false
  return true
}

/**
 * Pure check: does this goal have a live or completed-and-authoritative tip
 * (i.e. it has already been dispatched and is running or satisfied)? Used
 * by the pool to skip IDs the LLM re-submitted after they already ran.
 */
export function isGoalAlreadyDispatched(goal: GoalRow, goalRuns: GoalRunRow[]): boolean {
  return !isGoalDispatchable(goal, goalRuns) && isDispatchableGoal(goal)
}
