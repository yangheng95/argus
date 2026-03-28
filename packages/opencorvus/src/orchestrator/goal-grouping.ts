/**
 * Goal Grouping — Union-Find based affinity grouping for multi-executor dispatch.
 *
 * Groups related goals so each group can be dispatched to an independent executor.
 * Grouping signals:
 *   1. owned_paths overlap (avoids file-level merge conflicts)
 *   2. direct dependency + path overlap (keeps tightly-coupled goals together)
 * Goals with no path overlap and no dependency are placed in separate groups.
 *
 * The degenerate case (maxGroups=1) produces a single group containing all goals,
 * which maps to the existing serial dispatch path with zero behavioral change.
 */

import { type GoalRow, type PlanNodeRow } from "@/orchestrator/store"
import { goalDependencyLayers } from "@/goal/scheduler"
import { Identifier } from "@/id/id"

// ═══════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════

export type GoalGroup = {
  /** Unique group identifier (ascending, prefixed "goal_group") */
  id: string
  /** Goal IDs in topological (dependency) order */
  goalIDs: string[]
  /** Corresponding plan node IDs (same order as goalIDs) */
  goalNodeIDs: string[]
  /** Union of all owned_paths across goals in this group */
  ownedPaths: string[]
  /** Earliest dependency layer among goals in this group (lower = earlier) */
  layer: number
}

export type GroupDependencyGraph = {
  /** Map from group ID → set of upstream group IDs that must complete first */
  upstreamOf: Map<string, Set<string>>
}

// ═══════════════════════════════════════════════════════════════════
// Union-Find
// ═══════════════════════════════════════════════════════════════════

class UnionFind {
  private parent: Map<string, string>
  private rank: Map<string, number>

  constructor(keys: string[]) {
    this.parent = new Map(keys.map((k) => [k, k]))
    this.rank = new Map(keys.map((k) => [k, 0]))
  }

  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    // Path compression
    let current = x
    while (current !== root) {
      const next = this.parent.get(current)!
      this.parent.set(current, root)
      current = next
    }
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return
    const rankA = this.rank.get(rootA)!
    const rankB = this.rank.get(rootB)!
    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }
  }

  groups(): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const key of this.parent.keys()) {
      const root = this.find(key)
      const group = result.get(root)
      if (group) {
        group.push(key)
      } else {
        result.set(root, [key])
      }
    }
    return result
  }
}

// ═══════════════════════════════════════════════════════════════════
// Path overlap detection
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns true if any path in `a` overlaps with any path in `b`.
 * Overlap = exact match OR one is a prefix of the other (directory containment).
 */
export function pathsOverlap(a: string[], b: string[]): boolean {
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) return true
      // Normalize: ensure trailing-slash comparison for directory containment
      const na = pa.endsWith("/") ? pa : pa + "/"
      const nb = pb.endsWith("/") ? pb : pb + "/"
      if (na.startsWith(nb) || nb.startsWith(na)) return true
    }
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════
// Goal metadata extraction
// ═══════════════════════════════════════════════════════════════════

function goalOwnedPaths(goal: GoalRow): string[] {
  const meta = goal.metadata as Record<string, unknown> | null | undefined
  if (!meta) return []
  const paths = meta.owned_paths
  if (!Array.isArray(paths)) return []
  return paths.filter((p): p is string => typeof p === "string")
}

function goalDependsOnGoalIDs(goal: GoalRow): string[] {
  const meta = goal.metadata as Record<string, unknown> | null | undefined
  if (!meta) return []
  const deps = meta.depends_on_goal_ids
  if (!Array.isArray(deps)) return []
  return deps.filter((d): d is string => typeof d === "string")
}

// ═══════════════════════════════════════════════════════════════════
// Core grouping algorithm
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute goal affinity groups using Union-Find.
 *
 * Merge rules:
 *   1. Path overlap: goals with overlapping owned_paths are merged (avoids file conflicts).
 *   2. Dependency + path overlap: if A depends on B AND their paths overlap, merge.
 *      Pure dependencies without path overlap are NOT merged — cross-group dependency
 *      scheduling handles them.
 *
 * @param goals   All goals for the plan
 * @param nodes   Plan nodes (for dependency info and topological ordering)
 * @param maxGroups  Maximum number of groups. If natural grouping produces more,
 *                   smallest groups are merged until the limit is reached.
 * @returns Ordered array of GoalGroup (by ascending layer)
 */
export function computeGoalGroups(
  goals: GoalRow[],
  nodes: PlanNodeRow[],
  maxGroups: number,
): GoalGroup[] {
  if (goals.length === 0) return []
  if (maxGroups <= 1) return [singleGroup(goals, nodes)]

  const goalIDs = goals.map((g) => g.id)
  const goalByID = new Map(goals.map((g) => [g.id, g]))
  const pathsByGoal = new Map(goals.map((g) => [g.id, goalOwnedPaths(g)]))

  const uf = new UnionFind(goalIDs)

  // Rule 1: merge by path overlap
  for (let i = 0; i < goalIDs.length; i++) {
    const pathsA = pathsByGoal.get(goalIDs[i])!
    if (pathsA.length === 0) continue
    for (let j = i + 1; j < goalIDs.length; j++) {
      const pathsB = pathsByGoal.get(goalIDs[j])!
      if (pathsB.length === 0) continue
      if (pathsOverlap(pathsA, pathsB)) {
        uf.union(goalIDs[i], goalIDs[j])
      }
    }
  }

  // Rule 2: merge by dependency + path overlap
  for (const goal of goals) {
    const deps = goalDependsOnGoalIDs(goal)
    const pathsA = pathsByGoal.get(goal.id)!
    for (const depID of deps) {
      if (!goalByID.has(depID)) continue
      const pathsB = pathsByGoal.get(depID)!
      if (pathsA.length > 0 && pathsB.length > 0 && pathsOverlap(pathsA, pathsB)) {
        uf.union(goal.id, depID)
      }
    }
  }

  // Extract raw groups
  const rawGroups = uf.groups()

  // Compute goal-level topological depth from metadata dependencies.
  // Plan nodes may have empty depends_on, so we derive depth from goal metadata
  // (metadata.depends_on_goal_ids) which carries the actual dependency graph.
  const goalDepth = computeGoalDepths(goals)

  // Cap to maxGroups using dependency-aware merging.
  // The old size-based merge created circular cross-group dependencies
  // (e.g., Goal 1 in Group A depends on Goal 2 in Group B, and Goal 3
  // in Group B depends on Goal 4 in Group A). To avoid this, we merge
  // groups that are dependency-adjacent: when two groups have a direct
  // dependency edge between them, merge the one with the smaller maximum
  // depth into the other. This preserves topological ordering across groups.
  let groupEntries = [...rawGroups.entries()]
  while (groupEntries.length > maxGroups) {
    // Sort groups by their minimum goal depth (earliest-dependency-first)
    groupEntries.sort((a, b) => {
      const minA = Math.min(...a[1].map((id) => goalDepth.get(id) ?? 0))
      const minB = Math.min(...b[1].map((id) => goalDepth.get(id) ?? 0))
      return minA - minB
    })
    // Merge the two earliest-layer groups (most likely to share early dependencies)
    const [, smallest] = groupEntries.shift()!
    const [targetRoot, targetMembers] = groupEntries[0]
    for (const id of smallest) {
      uf.union(id, targetRoot)
    }
    targetMembers.push(...smallest)
    groupEntries = [...uf.groups().entries()]
  }

  // Verify no circular cross-group dependencies. If found, fall back to
  // topological contiguous split: sort all goals by depth and assign the
  // first ceil(N/maxGroups) to group 1, next to group 2, etc.
  const tentativeGroups = buildGroupsFromUF(uf, goals, goalByID, goalDepth, pathsByGoal, nodes)
  if (hasCircularGroupDeps(tentativeGroups, goals)) {
    return topologicalSplit(goals, nodes, goalByID, goalDepth, pathsByGoal, maxGroups)
  }

  // Build GoalGroup objects with topological ordering
  const layers = goalDependencyLayers(nodes, goals)
  const goalLayer = new Map<string, number>()
  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    for (const entry of layers[layerIdx]) {
      goalLayer.set(entry.goal.id, layerIdx)
    }
  }

  // Node lookup: goal_id → node
  const goalNodeMap = new Map<string, PlanNodeRow & { goal_id: string }>()
  for (const node of nodes) {
    if (node.kind === "goal" && node.goal_id) {
      goalNodeMap.set(node.goal_id, node as PlanNodeRow & { goal_id: string })
    }
  }

  const finalGroups = uf.groups()
  const result: GoalGroup[] = []

  for (const [, memberIDs] of finalGroups) {
    // Sort members by dependency layer, then by order_index
    const sorted = memberIDs
      .filter((id) => goalByID.has(id))
      .sort((a, b) => {
        const layerDiff = (goalLayer.get(a) ?? 0) - (goalLayer.get(b) ?? 0)
        if (layerDiff !== 0) return layerDiff
        return (goalByID.get(a)!.order_index ?? 0) - (goalByID.get(b)!.order_index ?? 0)
      })

    if (sorted.length === 0) continue

    const ownedPaths = new Set<string>()
    const goalNodeIDs: string[] = []
    let minLayer = Infinity

    for (const id of sorted) {
      for (const p of pathsByGoal.get(id) ?? []) ownedPaths.add(p)
      const node = goalNodeMap.get(id)
      goalNodeIDs.push(node?.id ?? "")
      const layer = goalLayer.get(id) ?? 0
      if (layer < minLayer) minLayer = layer
    }

    result.push({
      id: Identifier.ascending("goal_group"),
      goalIDs: sorted,
      goalNodeIDs,
      ownedPaths: [...ownedPaths],
      layer: minLayer === Infinity ? 0 : minLayer,
    })
  }

  // Sort groups by layer (earliest first)
  result.sort((a, b) => a.layer - b.layer)
  return result
}

// ═══════════════════════════════════════════════════════════════════
// Group dependency graph
// ═══════��═══════════════════════════════════════════════════════════

/**
 * Compute inter-group dependency graph.
 * If a goal in group G2 depends on a goal in group G1, then G2 depends on G1.
 */
export function computeGroupDependencyGraph(
  groups: GoalGroup[],
  goals: GoalRow[],
): GroupDependencyGraph {
  // Map goal_id → group_id
  const goalToGroup = new Map<string, string>()
  for (const group of groups) {
    for (const goalID of group.goalIDs) {
      goalToGroup.set(goalID, group.id)
    }
  }

  const upstreamOf = new Map<string, Set<string>>()
  for (const group of groups) {
    upstreamOf.set(group.id, new Set())
  }

  for (const goal of goals) {
    const myGroup = goalToGroup.get(goal.id)
    if (!myGroup) continue
    for (const depGoalID of goalDependsOnGoalIDs(goal)) {
      const depGroup = goalToGroup.get(depGoalID)
      if (!depGroup || depGroup === myGroup) continue // same group = internal, skip
      upstreamOf.get(myGroup)!.add(depGroup)
    }
  }

  return { upstreamOf }
}

/**
 * Returns groups that are ready to dispatch — all upstream groups have completed.
 */
export function readyGroups(
  groups: GoalGroup[],
  graph: GroupDependencyGraph,
  completedGroupIDs: Set<string>,
): GoalGroup[] {
  return groups.filter((group) => {
    const upstream = graph.upstreamOf.get(group.id)
    if (!upstream) return true
    for (const upID of upstream) {
      if (!completedGroupIDs.has(upID)) return false
    }
    return true
  })
}

// ═══════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute topological depth for each goal using metadata dependencies.
 * Depth 0 = no dependencies. Depth N = longest chain of dependencies.
 */
function computeGoalDepths(goals: GoalRow[]): Map<string, number> {
  const goalSet = new Set(goals.map((g) => g.id))
  const depMap = new Map<string, string[]>()
  for (const goal of goals) {
    depMap.set(goal.id, goalDependsOnGoalIDs(goal).filter((id) => goalSet.has(id)))
  }

  const depth = new Map<string, number>()
  const visited = new Set<string>()

  function resolve(id: string): number {
    if (depth.has(id)) return depth.get(id)!
    if (visited.has(id)) return 0 // Break cycles
    visited.add(id)
    const deps = depMap.get(id) ?? []
    const d = deps.length === 0 ? 0 : Math.max(...deps.map(resolve)) + 1
    depth.set(id, d)
    return d
  }

  for (const goal of goals) resolve(goal.id)
  return depth
}

/**
 * Build GoalGroup array from a UnionFind state. Used for tentative validation.
 */
function buildGroupsFromUF(
  uf: UnionFind,
  goals: GoalRow[],
  goalByID: Map<string, GoalRow>,
  goalDepth: Map<string, number>,
  pathsByGoal: Map<string, string[]>,
  nodes: PlanNodeRow[],
): GoalGroup[] {
  const goalNodeMap = new Map<string, string>()
  for (const node of nodes) {
    if (node.kind === "goal" && node.goal_id) goalNodeMap.set(node.goal_id, node.id)
  }
  const finalGroups = uf.groups()
  const result: GoalGroup[] = []
  for (const [, memberIDs] of finalGroups) {
    const sorted = memberIDs.filter((id) => goalByID.has(id))
      .sort((a, b) => (goalDepth.get(a) ?? 0) - (goalDepth.get(b) ?? 0))
    if (sorted.length === 0) continue
    const ownedPaths = new Set<string>()
    const goalNodeIDs: string[] = []
    for (const id of sorted) {
      for (const p of pathsByGoal.get(id) ?? []) ownedPaths.add(p)
      goalNodeIDs.push(goalNodeMap.get(id) ?? "")
    }
    result.push({
      id: Identifier.ascending("goal_group"),
      goalIDs: sorted,
      goalNodeIDs,
      ownedPaths: [...ownedPaths],
      layer: Math.min(...sorted.map((id) => goalDepth.get(id) ?? 0)),
    })
  }
  return result.sort((a, b) => a.layer - b.layer)
}

/**
 * Check if groups have circular cross-group dependencies.
 */
function hasCircularGroupDeps(groups: GoalGroup[], goals: GoalRow[]): boolean {
  const graph = computeGroupDependencyGraph(groups, goals)
  // Simple cycle detection: BFS from each node, check for back-edges
  for (const group of groups) {
    const visited = new Set<string>()
    const queue = [...(graph.upstreamOf.get(group.id) ?? [])]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === group.id) return true // Cycle found
      if (visited.has(current)) continue
      visited.add(current)
      for (const up of graph.upstreamOf.get(current) ?? []) {
        queue.push(up)
      }
    }
  }
  return false
}

/**
 * Topological contiguous split: sort goals by depth, split into maxGroups
 * contiguous slices. This guarantees no circular cross-group dependencies
 * because all goals in group K have depth <= all goals in group K+1.
 */
function topologicalSplit(
  goals: GoalRow[],
  nodes: PlanNodeRow[],
  goalByID: Map<string, GoalRow>,
  goalDepth: Map<string, number>,
  pathsByGoal: Map<string, string[]>,
  maxGroups: number,
): GoalGroup[] {
  const sorted = [...goals].sort((a, b) => {
    const depthDiff = (goalDepth.get(a.id) ?? 0) - (goalDepth.get(b.id) ?? 0)
    if (depthDiff !== 0) return depthDiff
    return (a.order_index ?? 0) - (b.order_index ?? 0)
  })

  const goalNodeMap = new Map<string, string>()
  for (const node of nodes) {
    if (node.kind === "goal" && node.goal_id) goalNodeMap.set(node.goal_id, node.id)
  }

  // Split into maxGroups contiguous slices
  const chunkSize = Math.ceil(sorted.length / maxGroups)
  const result: GoalGroup[] = []
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize)
    const ownedPaths = new Set<string>()
    const goalNodeIDs: string[] = []
    for (const goal of chunk) {
      for (const p of pathsByGoal.get(goal.id) ?? []) ownedPaths.add(p)
      goalNodeIDs.push(goalNodeMap.get(goal.id) ?? "")
    }
    result.push({
      id: Identifier.ascending("goal_group"),
      goalIDs: chunk.map((g) => g.id),
      goalNodeIDs,
      ownedPaths: [...ownedPaths],
      layer: Math.min(...chunk.map((g) => goalDepth.get(g.id) ?? 0)),
    })
  }
  return result
}

function singleGroup(goals: GoalRow[], nodes: PlanNodeRow[]): GoalGroup {
  const goalNodeMap = new Map<string, string>()
  for (const node of nodes) {
    if (node.kind === "goal" && node.goal_id) {
      goalNodeMap.set(node.goal_id, node.id)
    }
  }
  const ownedPaths = new Set<string>()
  for (const goal of goals) {
    for (const p of goalOwnedPaths(goal)) ownedPaths.add(p)
  }
  return {
    id: Identifier.ascending("goal_group"),
    goalIDs: goals.map((g) => g.id),
    goalNodeIDs: goals.map((g) => goalNodeMap.get(g.id) ?? ""),
    ownedPaths: [...ownedPaths],
    layer: 0,
  }
}
