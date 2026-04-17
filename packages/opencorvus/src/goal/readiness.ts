import type { GoalRow, GoalRunRow, PlanNodeRow, EngineGoalRunStatus } from "@/engine"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-scheduler" })

function goalNodes(nodes: PlanNodeRow[]) {
  return nodes.filter((node): node is PlanNodeRow & { goal_id: string } => node.kind === "goal" && !!node.goal_id)
}

/**
 * Classifier: for every goal_run status, is it "live" (scheduler must not
 * dispatch this goal again) or "retriable" (prior attempt ended badly, new
 * dispatch allowed)?
 *
 *   live      queued/accepted/planning/running/evaluating/blocked — still in
 *             flight; "completed" — terminal success, goal is done.
 *   retriable failed/aborted — terminal failure; creating a new goal_run for
 *             the same goal is how retries happen.
 *
 * The `satisfies Record<EngineGoalRunStatus, ...>` is load-bearing:
 * adding a new status to `EngineGoalRunStatus` will fail the type
 * check here until someone decides which bucket it belongs in. This is the
 * type-level guarantee against the "connected-two-goals" bug — a stray new
 * status silently defaulting to "retriable" is what would let the scheduler
 * dispatch the same goal twice.
 */
const RUN_STATUS_CLASSIFIER = {
  queued: "live",
  accepted: "live",
  planning: "live",
  running: "live",
  evaluating: "live",
  blocked: "live",
  completed: "live",
  failed: "retriable",
  aborted: "retriable",
} as const satisfies Record<EngineGoalRunStatus, "live" | "retriable">

function isLiveRun(status: GoalRunRow["status"]): boolean {
  return RUN_STATUS_CLASSIFIER[status] === "live"
}

function isGoalSatisfied(goal: GoalRow | undefined, goalRuns: GoalRunRow[]) {
  if (!goal) return false
  // system goals (setup/teardown) never block the pipeline regardless of outcome
  if (goal.source === "system") return true
  if (goal.priority === "advisory" && goal.status === "failed") return true
  // Authoritative: any goal_run reaching "completed" satisfies the dep,
  // regardless of what mutated goal.status afterwards.
  return goalRuns.some((r) => r.goal_id === goal.id && r.status === "completed")
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
    // Dispatch gate: skip if any goal_run for this goal is active or already completed.
    const hasLiveRun = goalRuns.some(
      (r) => r.goal_id === goal.id && isLiveRun(r.status),
    )
    if (hasLiveRun) return []
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
    const hasLiveRun = goalRuns.some(
      (r) => r.goal_id === goal.id && isLiveRun(r.status),
    )
    if (hasLiveRun) continue

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
