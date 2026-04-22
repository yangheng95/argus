/**
 * Goal dispatch readiness helpers.
 *
 * Readiness stays goal_run-history-driven: we do not read or mutate
 * engine_goal.status here. But the pool must still enforce two admission
 * invariants before a new goal_run is allowed to start:
 *
 *   1. idempotency — never double-dispatch a goal that already has a live or
 *      authoritative satisfied tip in its supersede chain
 *   2. dependency satisfaction — a goal with depends_on cannot dispatch until
 *      every dependency has an authoritative satisfied tip
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

function authoritativeTip(goalID: string, goalRuns: GoalRunRow[]): GoalRunRow | undefined {
  return supersedeTips(goalRuns.filter((r) => r.goal_id === goalID))[0]
}

export function isQueuedGoalRunStartable(goalRun: GoalRunRow, goal: GoalRow, goalRuns: GoalRunRow[]): boolean {
  if (goalRun.status !== "queued") return false
  if (!isDispatchableGoal(goal)) return false
  const tip = authoritativeTip(goal.id, goalRuns)
  if (!tip || tip.id !== goalRun.id) return false
  return unsatisfiedDependencyGoalIDs(goal, goalRuns).length === 0
}

export function unsatisfiedDependencyGoalIDs(goal: GoalRow, goalRuns: GoalRunRow[]): string[] {
  const dependencyIDs = Array.isArray(goal.depends_on) ? goal.depends_on : []
  return dependencyIDs.filter((dependencyGoalID) => {
    const tip = authoritativeTip(dependencyGoalID, goalRuns)
    if (!tip) return true
    if (tip.superseded_reason) return true
    return !doesGoalRunSatisfyGoal(tip.status)
  })
}

/**
 * True when it is legal to dispatch a fresh goal_run for this goal. Returns
 * false when any declared dependency lacks an authoritative successful tip,
 * or when the goal's own tip is:
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
  if (unsatisfiedDependencyGoalIDs(goal, goalRuns).length > 0) return false
  const tip = authoritativeTip(goal.id, goalRuns)
  if (!tip) return true
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
  if (!isDispatchableGoal(goal)) return false
  const tip = authoritativeTip(goal.id, goalRuns)
  if (!tip) return false
  if (isLiveGoalRunStatus(tip.status)) return true
  return doesGoalRunSatisfyGoal(tip.status) && !tip.superseded_reason
}
