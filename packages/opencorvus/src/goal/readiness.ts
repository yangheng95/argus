import type { GoalRow, GoalRunRow, PlanNodeRow } from "@/engine"
import { doesGoalRunSatisfyGoal, isLiveGoalRunStatus } from "@/engine/catalog"
import { isDispatchableGoal } from "@/goal/kind"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-scheduler" })

function goalNodes(nodes: PlanNodeRow[]) {
  return nodes.filter((node): node is PlanNodeRow & { goal_id: string } => node.kind === "goal" && !!node.goal_id)
}

function isGoalSatisfied(goal: GoalRow | undefined, goalRuns: GoalRunRow[]) {
  if (!goal) return false
  // system goals (setup/teardown) never block the pipeline regardless of outcome
  if (goal.source === "system") return true
  if (goal.priority === "advisory" && goal.status === "failed") return true
  // Authoritative: any goal_run reaching "completed" satisfies the dep,
  // regardless of what mutated goal.status afterwards.
  return goalRuns.some((r) => r.goal_id === goal.id && doesGoalRunSatisfyGoal(r.status))
}

export type GoalNodeEntry = { node: PlanNodeRow & { goal_id: string }; goal: GoalRow }

/**
 * Returns ALL goals that are ready to execute — i.e. no live or successful
 * goal_run already exists for them, AND all their dependencies are satisfied.
 *
 * Idempotency is anchored on `engine_goal_run` history (the immutable
 * record of "we ran this") rather than `goal.status` (a mutable intent field
 * that retry / cancel / refine paths can flip back to "pending"). This is
 * what prevents the same goal from being dispatched twice.
 */
export function readyGoalNodes(
  nodes: PlanNodeRow[],
  goals: GoalRow[],
  goalRuns: GoalRunRow[],
): GoalNodeEntry[] {
  const ordered = goalNodes(nodes)
  return ordered.flatMap((node) => {
    const goal = goals.find((item) => item.id === node.goal_id)
    if (!goal) return []
    if (!isDispatchableGoal(goal)) return []
    // Dispatch gate: skip if any goal_run for this goal is active or already completed.
    // Dispatch dedup must treat "terminal-successful" the same as "in flight":
    // a completed goal_run is done, don't redispatch. The orchestrator
    // dispatch-gate (agent.ts) uses the narrower "live only" check so the
    // TaskAgent still wakes up on completion — the two checks intentionally
    // diverge now that `completed` is classified `terminal`, not `live`.
    const hasDispatchedRun = goalRuns.some(
      (r) => r.goal_id === goal.id && (isLiveGoalRunStatus(r.status) || doesGoalRunSatisfyGoal(r.status)),
    )
    if (hasDispatchedRun) return []
    const ready = (node.depends_on_ids ?? []).every((depID) => {
      const dep = ordered.find((item) => item.id === depID)
      if (!dep) {
        log.warn("depends_on_ids contains unresolvable ID — treating as unsatisfied (data corruption?)", { nodeID: node.id, goalID: node.goal_id, depID })
        return false
      }
      return isGoalSatisfied(goals.find((item) => item.id === dep.goal_id), goalRuns)
    })
    if (!ready) return []
    return [{ node, goal }]
  })
}

// ---------------------------------------------------------------------------
// Diagnostics — WHY are pending goals not ready?
// ---------------------------------------------------------------------------

export interface BlockedGoalDiag {
  goalID: string
  goalTitle: string
  unsatisfiedDeps: Array<{
    depGoalID: string
    depGoalTitle: string
    depStatus: string
  }>
}

/**
 * For each goal still awaiting dispatch (no live or completed goal_run), return
 * the list of unsatisfied dependencies. This tells the Orchestrator exactly what
 * is blocking progress so it can retry / modify / fail the blocking goals.
 */
export function blockedGoalDiagnostics(
  nodes: PlanNodeRow[],
  goals: GoalRow[],
  goalRuns: GoalRunRow[],
): BlockedGoalDiag[] {
  const ordered = goalNodes(nodes)
  const result: BlockedGoalDiag[] = []

  for (const node of ordered) {
    const goal = goals.find((item) => item.id === node.goal_id)
    if (!goal) continue
    if (!isDispatchableGoal(goal)) continue
    // Same rule as readyGoalNodes: a completed goal_run means the goal is
    // already satisfied — don't report its deps as "blocking", because the
    // goal isn't waiting to dispatch, it's already done.
    const alreadyDispatched = goalRuns.some(
      (r) => r.goal_id === goal.id && (isLiveGoalRunStatus(r.status) || doesGoalRunSatisfyGoal(r.status)),
    )
    if (alreadyDispatched) continue

    const unsatisfied: BlockedGoalDiag["unsatisfiedDeps"] = []
    for (const depID of node.depends_on_ids ?? []) {
      const dep = ordered.find((item) => item.id === depID)
      if (!dep) continue
      const depGoal = goals.find((item) => item.id === dep.goal_id)
      if (!depGoal || isGoalSatisfied(depGoal, goalRuns)) continue
      unsatisfied.push({
        depGoalID: depGoal.id,
        depGoalTitle: depGoal.title,
        depStatus: depGoal.status,
      })
    }

    if (unsatisfied.length > 0) {
      result.push({ goalID: goal.id, goalTitle: goal.title, unsatisfiedDeps: unsatisfied })
    }
  }

  return result
}
