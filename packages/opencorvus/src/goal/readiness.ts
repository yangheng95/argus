import type { GoalRow, GoalRunRow, PlanNodeRow } from "@/engine"
import { doesGoalRunSatisfyGoal, isLiveGoalRunStatus } from "@/engine/catalog"
import { isDispatchableGoal } from "@/goal/kind"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-scheduler" })

function goalNodes(nodes: PlanNodeRow[]) {
  return nodes.filter((node): node is PlanNodeRow & { goal_id: string } => node.kind === "goal" && !!node.goal_id)
}

/**
 * The "tips" of the supersede chain — goal_runs that are NOT pointed at by
 * any other goal_run's supersede_of. These are the only rows whose status
 * is considered authoritative by readiness / dispatch / dependency checks.
 * Ancestors are frozen history; they cannot re-acquire authority.
 *
 * A retry inserts a new goal_run with supersede_of=<old terminal run.id>.
 * The old row becomes a non-tip and is invisible to the filters below.
 * This is the single mechanism that allows retry to re-dispatch without
 * mutating the immutable goal_run FSM.
 */
function supersedeTips(goalRuns: GoalRunRow[]): GoalRunRow[] {
  const supersededIDs = new Set<string>()
  for (const r of goalRuns) {
    const parent = (r as { supersede_of?: string | null }).supersede_of
    if (parent) supersededIDs.add(parent)
  }
  return goalRuns.filter((r) => !supersededIDs.has(r.id))
}

function isGoalSatisfied(goal: GoalRow | undefined, goalRuns: GoalRunRow[]) {
  if (!goal) return false
  // system goals (setup/teardown) never block the pipeline regardless of outcome
  if (goal.source === "system") return true
  if (goal.priority === "advisory" && goal.status === "failed") return true
  // Authoritative: a tip of this goal's supersede chain in a satisfies-goal
  // status ("completed") means the dep is met. A completed run that was
  // later superseded by a retry is NOT authoritative — the retry is the
  // new head and its status is what counts.
  const tips = supersedeTips(goalRuns.filter((r) => r.goal_id === goal.id))
  return tips.some((r) => doesGoalRunSatisfyGoal(r.status))
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
    // Dispatch gate operates on supersede-chain tips only — a retry-created
    // goal_run (which supersedes a prior completed/failed row) makes the old
    // row a non-tip and therefore invisible here. That way the new head's
    // status alone decides dispatch: live or completed-tip → skip; no tips
    // or only retriable tips → eligible (readiness then checks deps below).
    const tips = supersedeTips(goalRuns.filter((r) => r.goal_id === goal.id))
    const hasDispatchedRun = tips.some(
      (r) => isLiveGoalRunStatus(r.status) || doesGoalRunSatisfyGoal(r.status),
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
    // goal isn't waiting to dispatch, it's already done. Uses supersede
    // tips so a retry-superseded completion is NOT treated as satisfied.
    const tips = supersedeTips(goalRuns.filter((r) => r.goal_id === goal.id))
    const alreadyDispatched = tips.some(
      (r) => isLiveGoalRunStatus(r.status) || doesGoalRunSatisfyGoal(r.status),
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
