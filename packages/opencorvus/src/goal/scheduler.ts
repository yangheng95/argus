import { type GoalRow, type PlanNodeRow } from "@/orchestrator/store"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-scheduler" })

function goalNodes(nodes: PlanNodeRow[]) {
  return nodes.filter((node): node is PlanNodeRow & { goal_id: string } => node.kind === "goal" && !!node.goal_id)
}

function isGoalSatisfied(goal: GoalRow | undefined) {
  if (!goal) return false
  if (goal.status === "passed") return true
  // system goals (setup/teardown) never block the pipeline regardless of outcome
  if (goal.source === "system") return true
  return goal.priority === "advisory" && goal.status === "failed"
}

export type GoalNodeEntry = { node: PlanNodeRow & { goal_id: string }; goal: GoalRow }

/**
 * Returns ALL goals that are ready to execute — their dependencies are satisfied.
 * The runtime decides how many to dispatch concurrently based on MAX_CONCURRENT_GOALS.
 */
export function readyGoalNodes(nodes: PlanNodeRow[], goals: GoalRow[]): GoalNodeEntry[] {
  const ordered = goalNodes(nodes)
  return ordered.flatMap((node) => {
    const goal = goals.find((item) => item.id === node.goal_id)
    if (!goal || goal.status !== "pending") return []
    const ready = (node.depends_on_ids ?? []).every((depID) => {
      const dep = ordered.find((item) => item.id === depID)
      if (!dep) {
        log.warn("depends_on_ids contains unresolvable ID — treating as unsatisfied (data corruption?)", { nodeID: node.id, goalID: node.goal_id, depID })
        return false
      }
      return isGoalSatisfied(goals.find((item) => item.id === dep.goal_id))
    })
    if (!ready) return []
    return [{ node, goal }]
  })
}
