// Tree assembly helpers for the task list lineage display.
// Pure data transforms — no Solid reactivity, no DOM. Lifted out of
// TaskList.tsx so the cycle guard, orphan fallback, and depth-first
// flatten can be exercised by unit tests instead of only source-string
// contract assertions.
//
// Spec: docs/superpowers/specs/2026-05-27-task-tree-display.md.

/** One pre-flattened row in a directory group. depth drives indent;
 *  `crossDirectory` flags rows whose own `task.directory` differs from
 *  the enclosing group, mainly for the visual dim hint (drag is force-
 *  disabled on any nested row, not only the cross-directory ones —
 *  see TaskRow.canDrag in TaskList.tsx). */
export type TaskTreeEntry = {
  item: any
  depth: number
  directChildren: any[]
  crossDirectory: boolean
  expanded: boolean
}

/** Result of walking the filtered task list once: a parentID→children map
 *  for direct lineage edges, the set of top-level items (parent missing
 *  from the filtered set OR a cycle victim), and the cycle victims for
 *  diagnostic purposes. */
export type TaskTreeShape = {
  childMap: Map<string, any[]>
  topLevelItems: any[]
  cycleVictims: Set<string>
}

function getID(item: any): string | undefined {
  const id = item?.task?.id
  return typeof id === "string" && id ? id : undefined
}

function getParentID(item: any): string | undefined {
  const pid = item?.task?.parentTaskID
  return typeof pid === "string" && pid ? pid : undefined
}

/** Build the lineage shape from a flat, filter-applied item list.
 *
 *  - Items whose parent is not in the visible set bubble up to top-level
 *    (orphan fallback). This lets search filtering hide parents without
 *    hiding their visible children.
 *  - Cycles (a→b→a, longer chains, self-loops) are broken: every member
 *    of the cycle is treated as top-level and a console.warn is emitted.
 *  - Order within `topLevelItems` preserves the input order, so callers
 *    can still sort by creation time downstream.
 *
 *  Multiple concurrent calls on a tight render loop are fine — the
 *  function holds no shared state. */
export function buildTaskTree(items: readonly any[]): TaskTreeShape {
  const byID = new Map<string, any>()
  for (const item of items) {
    const id = getID(item)
    if (id) byID.set(id, item)
  }
  const cycleVictims = new Set<string>()
  for (const item of items) {
    const startID = getID(item)
    if (!startID || cycleVictims.has(startID)) continue
    const seen = new Set<string>()
    let cur: any = item
    while (cur) {
      const curID = getID(cur)
      if (!curID) break
      if (seen.has(curID)) {
        console.warn(`[TaskList] task tree cycle detected involving ${curID} — rendering cycle members as top-level`)
        for (const v of seen) cycleVictims.add(v)
        cycleVictims.add(curID)
        break
      }
      seen.add(curID)
      const parentID = getParentID(cur)
      if (!parentID) break
      const next = byID.get(parentID)
      if (!next) break // parent not in filtered set — orphan, not cycle
      cur = next
    }
  }
  const childMap = new Map<string, any[]>()
  const isNestedChild = new Set<string>()
  for (const item of items) {
    const id = getID(item)
    const parentID = getParentID(item)
    if (!id || !parentID) continue
    if (cycleVictims.has(id) || cycleVictims.has(parentID)) continue
    if (!byID.has(parentID)) continue // orphan — parent filtered out
    const arr = childMap.get(parentID) ?? []
    arr.push(item)
    childMap.set(parentID, arr)
    isNestedChild.add(id)
  }
  const topLevelItems = items.filter((item) => {
    const id = getID(item)
    return !id || !isNestedChild.has(id)
  })
  return { childMap, topLevelItems, cycleVictims }
}

/** Depth-first flatten of a directory group's top-level items into a
 *  render-ready entry list. Children appear only when their parent's
 *  id is in the `expanded` set, so default-collapsed is the natural
 *  rest state (empty set → only top-level rows).
 *
 *  `projectDirectoryOf` is injected because the canonical implementation
 *  lives in TaskList.tsx and does null-safe unassigned-project handling
 *  that doesn't belong in this module's API surface. */
export function flattenGroup(
  topLevel: readonly any[],
  groupDirectory: string,
  childMap: Map<string, any[]>,
  expanded: ReadonlySet<string>,
  projectDirectoryOf: (item: any) => string,
): TaskTreeEntry[] {
  const out: TaskTreeEntry[] = []
  const visit = (item: any, depth: number) => {
    const id = getID(item)
    const direct = (id && childMap.get(id)) ?? []
    const itemDir = projectDirectoryOf(item)
    const isExpanded = id ? expanded.has(id) : false
    out.push({
      item,
      depth,
      directChildren: direct,
      crossDirectory: depth > 0 && itemDir !== groupDirectory,
      expanded: isExpanded,
    })
    if (id && isExpanded && direct.length > 0) {
      for (const child of direct) visit(child, depth + 1)
    }
  }
  for (const item of topLevel) visit(item, 0)
  return out
}
