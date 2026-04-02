import { type GoalRow, type PlanNodeRow } from "@/orchestrator/store"

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
  return readyGoalNodes(nodes, goals)[0]
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
      if (!dep?.goal_id) return true
      return isGoalSatisfied(goals.find((item) => item.id === dep.goal_id))
    })
    if (!ready) return []
    return [{ node, goal }]
  })
}

/**
 * Compute dependency layers via topological sort.
 * Layer 0 = goals with no dependencies.
 * Layer N = goals whose dependencies are all in layers < N.
 * Goals within the same layer can run in parallel.
 * Cross-layer execution is allowed as long as dependencies are satisfied
 * (handled by readyGoalNodes at dispatch time).
 */
export function goalDependencyLayers(nodes: PlanNodeRow[], goals: GoalRow[]): GoalNodeEntry[][] {
  const ordered = goalNodes(nodes)
  const goalMap = new Map(goals.map((g) => [g.id, g]))
  // Map from goal_id to its node
  const nodeByGoal = new Map(ordered.map((n) => [n.goal_id, n]))
  // Map from node_id to goal_id for dependency resolution
  const nodeToGoal = new Map(ordered.map((n) => [n.id, n.goal_id]))
  // Compute depth (layer) for each goal node
  const depthCache = new Map<string, number>()

  function computeDepth(goalId: string): number {
    const cached = depthCache.get(goalId)
    if (cached !== undefined) return cached
    const node = nodeByGoal.get(goalId)
    if (!node) return 0
    const deps = (node.depends_on_ids ?? [])
      .map((depNodeId) => nodeToGoal.get(depNodeId))
      .filter((id): id is string => !!id)
    if (deps.length === 0) {
      depthCache.set(goalId, 0)
      return 0
    }
    // Prevent cycles: temporarily mark as processing
    depthCache.set(goalId, -1)
    let maxDep = 0
    for (const depGoalId of deps) {
      const d = computeDepth(depGoalId)
      if (d < 0) continue // cycle detected, skip
      maxDep = Math.max(maxDep, d)
    }
    const depth = maxDep + 1
    depthCache.set(goalId, depth)
    return depth
  }

  // Compute depth for all goals
  const entries: Array<{ entry: GoalNodeEntry; depth: number }> = []
  for (const node of ordered) {
    const goal = goalMap.get(node.goal_id)
    if (!goal) continue
    const depth = computeDepth(node.goal_id)
    entries.push({ entry: { node, goal }, depth })
  }

  // Group by depth
  const layers: GoalNodeEntry[][] = []
  for (const { entry, depth } of entries) {
    while (layers.length <= depth) layers.push([])
    layers[depth].push(entry)
  }
  return layers
}

export function pendingBlockingGoals(goals: GoalRow[]) {
  return goals.filter((goal) => goal.priority === "blocking" && goal.status === "pending")
}

export function hasBlockingFailures(goals: GoalRow[]) {
  return goals.some((goal) => goal.source !== "system" && goal.priority === "blocking" && goal.status === "failed")
}
