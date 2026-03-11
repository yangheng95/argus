import { type GoalRow, type PlanNodeRow } from "./store"

function goalNodes(nodes: PlanNodeRow[]) {
  return nodes.filter((node): node is PlanNodeRow & { goal_id: string } => node.kind === "goal" && !!node.goal_id)
}

export function isGoalSatisfied(goal: GoalRow | undefined) {
  if (!goal) return false
  if (goal.status === "passed") return true
  // system goals (setup/teardown) never block the pipeline regardless of outcome
  if (goal.source === "system") return true
  return goal.priority === "advisory" && goal.status === "failed"
}

export function nextGoalNode(nodes: PlanNodeRow[], goals: GoalRow[]) {
  const ordered = goalNodes(nodes)
  for (const node of ordered) {
    const goal = goals.find((item) => item.id === node.goal_id)
    if (!goal || goal.status !== "pending") continue
    const ready = (node.depends_on_ids ?? []).every((depID) => {
      const dep = ordered.find((item) => item.id === depID)
      if (!dep?.goal_id) return true
      return isGoalSatisfied(goals.find((item) => item.id === dep.goal_id))
    })
    if (ready) return { node, goal }
  }
}

export function pendingBlockingGoals(goals: GoalRow[]) {
  return goals.filter((goal) => goal.priority === "blocking" && goal.status === "pending")
}

export function hasBlockingFailures(goals: GoalRow[]) {
  return goals.some((goal) => goal.source !== "system" && goal.priority === "blocking" && goal.status === "failed")
}
