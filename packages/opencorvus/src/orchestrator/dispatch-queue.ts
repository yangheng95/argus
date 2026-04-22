/**
 * Durable dispatch queue — tool→loop coordination backed by queued goal_run rows.
 *
 * `dispatch_goal` and `submit_execution` materialize the LLM's dispatch
 * decision immediately as `engine_goal_run(status='queued')`. The task loop
 * and GoalPool read those rows directly; there is no separate in-memory
 * scheduler channel anymore.
 */

import { createGoalRun } from "@/engine/persist"
import {
  findPlan,
  findTask,
  listGoalRunsForDispatch,
  listGoalsByPlan,
  listPlanNodesByPlan,
  listQueuedGoalRunsForRun,
  requireRun,
} from "@/engine/store"
import { isGoalDispatchable } from "@/goal/readiness"

/** Queue dispatchable goals as queued goal_run rows on the active run. */
export function queueDispatchGoals(taskID: string, goalIDs: string[]): string[] {
  if (goalIDs.length === 0) return []
  const task = findTask(taskID)
  if (!task?.active_run_id) return []

  const run = requireRun(task.active_run_id)
  const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!plan) return []

  const goalsByID = new Map(listGoalsByPlan(plan.id).map((goal) => [goal.id, goal]))
  const nodesByGoalID = new Map(
    listPlanNodesByPlan(plan.id)
      .filter((node) => node.kind === "goal" && !!node.goal_id)
      .map((node) => [node.goal_id as string, node]),
  )
  const goalRuns = listGoalRunsForDispatch(taskID)
  const queuedGoalIDs: string[] = []

  for (const goalID of goalIDs) {
    const goal = goalsByID.get(goalID)
    const node = nodesByGoalID.get(goalID)
    if (!goal || !node) continue
    if (!isGoalDispatchable(goal, goalRuns)) continue

    const goalRun = createGoalRun({
      taskID,
      goalID,
      planNodeID: node.id,
      coordinatorRunID: run.id,
    })
    queuedGoalIDs.push(goalID)
    goalRuns.push(goalRun)
  }

  return queuedGoalIDs
}

/** Current queued dispatch facts for this task's active run. */
export function listQueuedDispatchGoalIDs(taskID: string): string[] {
  const task = findTask(taskID)
  if (!task?.active_run_id) return []
  return listQueuedGoalRunsForRun(task.active_run_id).map((goalRun) => goalRun.goal_id)
}

/** Number of queued dispatch rows pending on this task's active run. */
export function peekDispatchCount(taskID: string): number {
  return listQueuedDispatchGoalIDs(taskID).length
}
