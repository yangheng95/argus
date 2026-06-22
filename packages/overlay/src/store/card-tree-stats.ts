// ── Card Tree Stats Kernel ──
//
// Incrementally-maintained subtree aggregates for collapsed bubble headers.
//
// Why this exists: the collapsed bubble UI surfaces three subtree aggregates
// per card — activity counts ("🤖 2  🛠 14  💬 5"), latest text-or-tool
// activity line, and the most-recent TODO snapshot. Without caching, each
// visible collapsed bubble's `createMemo` recursively walks its subtree on
// every SSE event because Solid tracks `cardTreeStore.cards[childID]` reads
// through the recursion. At 500 cards and ~10 visible collapsed bubbles
// the per-event cost is O(visible × subtree) ≈ O(N²).
//
// Fix: store `subtreeCounts` / `subtreeLatestHit` / `subtreeTodoHit` on each
// CardNode, maintained by an explicit O(depth) bubble-up walk from the
// affected leaf when tree-writer mutates parts/childIDs. The Solid memos
// then read these fields directly — O(1) per bubble, invalidating only when
// the cached value actually changes (we equality-check before writing). Net
// per-event work shrinks from O(visible × subtree) to O(depth).
//
// Contract:
//   - `markCardStatsDirty(cardID)` queues a card whose own-level inputs
//     changed (parts, toolPart, or childIDs touched).
//   - `flushCardStats()` drains the queue, walking each card's ancestor
//     chain via `parentID` and rewriting cached fields where they differ.
//   - Tree-writer must call `flushCardStats()` inside every reactivity
//     batch (`applyVisibleCardTreeEvent` epilogue + `flushBufferedPartDeltas`
//     epilogue + `rebuildBoardDerivedCards` epilogue). Outside a batch we
//     would emit one notification per ancestor — inside one batch the whole
//     chain coalesces into one render frame.
//   - `linkChildToParent(parentID, childID)` and `unlinkChildFromParent(childID)`
//     are the parentID maintenance hooks. Tree-writer calls them whenever it
//     writes `cards[parentID].childIDs`. Stale entries (orphan childID that
//     was moved to a new parent) are corrected by the new parent's link call
//     overwriting the field.
//
// Transient cards (built inline by the renderer with `children: CardNode[]`
// instead of store-backed `childIDs: string[]`) never flow through tree-writer,
// so their cache is never populated. The public collectors in
// `utils/card-tree.ts` keep the recursive walk as a fallback for that case.

import { toolNameKey, displayToolIcon, displayToolDetail } from "../utils/tool"
import { extractTodos } from "../utils/todos"
import {
  collectScreenshotBrowserItemsFromCard,
  mergeScreenshotBrowserItemSets,
  type ScreenshotBrowserItem,
} from "../utils/screenshot-browser"
import {
  cardTreeStore,
  registerCardTreePruneStatsHandler,
  setCardTreeStore,
  type ActivityCounts,
  type CardNode,
  type LatestActivityHit,
  type TodoActivityHit,
} from "./card-tree"

// ── Own-level computation (mirrors utils/card-tree.ts policy) ──
//
// These functions own the "what counts as an activity / preview hit / todo
// hit" policy for a SINGLE node's own parts + toolPart. The recursive walk
// in `utils/card-tree.ts` is the fallback; both must stay byte-equivalent
// for transient cards, which the cache-invariant test enforces by comparing
// cached output to a recursive recomputation on the same fixture.

const AGENT_SPAWN_TOOLS = new Set(["task", "agent", "spawnagent", "subagent"])

const TODO_TOOLS = new Set(["todowrite", "todoread", "todoupdate", "updateplan"])

const PREVIEW_SUPPRESS_TOOLS = new Set(["structuredoutput", "structured_output"])

function isSkillTool(key: string): boolean {
  return key === "skill" || /skill/.test(key)
}

function bumpForPart(part: any, counts: ActivityCounts): void {
  if (!part) return
  if (part.type === "text" || part.type === "reasoning") {
    if (String(part.text || "").trim()) counts.messages += 1
    return
  }
  if (part.type !== "tool") return
  const key = toolNameKey(part.tool || "")
  if (!key) return
  if (AGENT_SPAWN_TOOLS.has(key)) {
    counts.agents += 1
    return
  }
  if (isSkillTool(key)) {
    counts.skills += 1
    return
  }
  counts.tools += 1
}

function partText(part: any): string {
  if (!part) return ""
  if (part.type === "text" || part.type === "reasoning") {
    return String(part.text || "").trim()
  }
  return ""
}

function toolHitText(part: any): string {
  if (!part || part.type !== "tool") return ""
  const name = String(part.tool || "").trim()
  if (!name) return ""
  const key = toolNameKey(name)
  if (TODO_TOOLS.has(key)) return ""
  if (PREVIEW_SUPPRESS_TOOLS.has(key)) return ""
  const state = part.state || {}
  const icon = displayToolIcon(name)
  const detail = displayToolDetail(name, state.input, state, "")
  const head = icon ? `${icon} ${name}` : name
  return detail ? `${head}: ${detail}` : head
}

function extractTodoList(part: any): any[] | null {
  if (!part || part.type !== "tool") return null
  const key = toolNameKey(part.tool || "")
  if (!TODO_TOOLS.has(key)) return null
  return extractTodos(part.state || {})
}

/** Newer hit wins by (time, index). Tied null + non-null returns non-null. */
function pickLater<T extends { time: number; index: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b
  if (!b) return a
  if (b.time > a.time || (b.time === a.time && b.index > a.index)) return b
  return a
}

/** Compute a single card's OWN-LEVEL contributions (parts + toolPart only,
 *  no recursion). Returns a tuple ready to be combined with cached child
 *  aggregates. */
function ownLevelStats(
  card: CardNode,
  suppressTools: boolean,
): {
  counts: ActivityCounts
  latestHit: LatestActivityHit | undefined
  todoHit: TodoActivityHit | undefined
  screenshotItems: ScreenshotBrowserItem[]
} {
  const counts: ActivityCounts = { messages: 0, tools: 0, agents: 0, skills: 0 }
  let latestHit: LatestActivityHit | undefined
  let todoHit: TodoActivityHit | undefined
  const baseTime = typeof card.time === "number" ? card.time : 0

  if (card.kind === "tool" && card.toolPart) {
    bumpForPart(card.toolPart, counts)
    if (!suppressTools) {
      const t = toolHitText(card.toolPart)
      if (t) latestHit = pickLater(latestHit, { time: baseTime, index: 0, text: t })
    }
    const todos = extractTodoList(card.toolPart)
    if (todos && todos.length > 0) {
      todoHit = pickLater(todoHit, { time: baseTime, index: 0, todos })
    }
  }
  const parts = card.parts || []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    bumpForPart(part, counts)
    const text = partText(part)
    if (text) {
      latestHit = pickLater(latestHit, { time: baseTime, index: i, text })
    } else if (!suppressTools) {
      const tt = toolHitText(part)
      if (tt) latestHit = pickLater(latestHit, { time: baseTime, index: i, text: tt })
    }
    const todos = extractTodoList(part)
    if (todos && todos.length > 0) {
      todoHit = pickLater(todoHit, { time: baseTime, index: i, todos })
    }
  }
  return { counts, latestHit, todoHit, screenshotItems: collectScreenshotBrowserItemsFromCard(card) }
}

/** Goal step cards suppress tool-hits in the LATEST preview (operators want
 *  the goal objective / latest prose, not "Bash: rg --files"). Matches
 *  `collectLatestActivityText` policy in utils/card-tree.ts. */
function suppressToolsForCard(card: CardNode): boolean {
  return card.kind === "step"
}

function equalCounts(a: ActivityCounts | undefined, b: ActivityCounts): boolean {
  return (
    a !== undefined &&
    a.messages === b.messages &&
    a.tools === b.tools &&
    a.agents === b.agents &&
    a.skills === b.skills
  )
}

function equalLatestHit(a: LatestActivityHit | undefined, b: LatestActivityHit | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.time === b.time && a.index === b.index && a.text === b.text
}

function equalTodoHit(a: TodoActivityHit | undefined, b: TodoActivityHit | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.time !== b.time || a.index !== b.index) return false
  // Object identity is enough: we only ever store the original tool-call's
  // todos array; a new hit means a new tool call with a fresh array.
  return a.todos === b.todos
}

function equalScreenshotItems(a: readonly ScreenshotBrowserItem[] | undefined, b: readonly ScreenshotBrowserItem[]): boolean {
  if (a === b) return true
  if (!a || a.length !== b.length) return false
  for (let index = 0; index < b.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (
      !left ||
      left.id !== right.id ||
      left.role !== right.role ||
      left.src !== right.src ||
      left.alt !== right.alt ||
      left.title !== right.title ||
      left.detail !== right.detail ||
      left.time !== right.time ||
      left.messageID !== right.messageID ||
      left.partID !== right.partID ||
      left.source !== right.source
    ) {
      return false
    }
  }
  return true
}

// ── Dirty queue + bubble-up ──

const dirtyCardIDs = new Set<string>()

/** Mark a card as needing a subtree-stats recompute. Cheap; safe to call
 *  many times per batch — recompute happens once in `flushCardStats`. */
export function markCardStatsDirty(cardID: string): void {
  if (cardID) dirtyCardIDs.add(cardID)
}

/** Maintain the back-pointer used by `bubbleStatsFromCard`. Tree-writer
 *  calls this whenever a cardID is placed into a parent's childIDs. */
export function linkChildToParent(parentID: string, childID: string): void {
  if (!childID) return
  const card = cardTreeStore.cards[childID]
  if (!card) return
  if (card.parentID === parentID) return
  setCardTreeStore("cards", childID, "parentID", parentID)
}

/** Clear the back-pointer when a card is detached from its parent (delete
 *  or move-without-new-parent). Called from `removeCardReferences`. */
export function unlinkChildFromParent(childID: string): void {
  if (!childID) return
  const card = cardTreeStore.cards[childID]
  if (!card || card.parentID === undefined) return
  setCardTreeStore("cards", childID, "parentID", undefined)
}

/** Recompute one card's cached aggregates from its own parts/toolPart plus
 *  the cached aggregates of its direct children. Returns `true` when ANY
 *  cached field actually changed (drives the early-exit during bubble-up
 *  — once an ancestor's aggregate is stable, ancestors further up cannot
 *  have changed either). */
function recomputeNodeStats(cardID: string): boolean {
  const card = cardTreeStore.cards[cardID]
  if (!card) return false
  const suppress = suppressToolsForCard(card)
  const own = ownLevelStats(card, suppress)
  let counts = own.counts
  let latestHit = own.latestHit
  let todoHit = own.todoHit
  const screenshotItemSets: Array<readonly ScreenshotBrowserItem[]> = [own.screenshotItems]
  for (const childID of card.childIDs ?? []) {
    const child = cardTreeStore.cards[childID]
    if (!child) continue
    const childCounts = child.subtreeCounts
    if (childCounts) {
      counts = {
        messages: counts.messages + childCounts.messages,
        tools: counts.tools + childCounts.tools,
        agents: counts.agents + childCounts.agents,
        skills: counts.skills + childCounts.skills,
      }
    }
    if (!suppress) {
      latestHit = pickLater(latestHit, child.subtreeLatestHit)
    } else {
      // Goal-step suppression applies to OWN-LEVEL tool hits only; descendant
      // text contributions still flow up (operators want the latest prose from
      // any descendant agent). Children's caches already encode their own
      // policy, so we propagate them as-is.
      latestHit = pickLater(latestHit, child.subtreeLatestHit)
    }
    todoHit = pickLater(todoHit, child.subtreeTodoHit)
    if (child.subtreeScreenshotItems) screenshotItemSets.push(child.subtreeScreenshotItems)
  }
  const screenshotItems = mergeScreenshotBrowserItemSets(screenshotItemSets)
  let changed = false
  if (!equalCounts(card.subtreeCounts, counts)) {
    setCardTreeStore("cards", cardID, "subtreeCounts", counts)
    changed = true
  }
  if (!equalLatestHit(card.subtreeLatestHit, latestHit)) {
    setCardTreeStore("cards", cardID, "subtreeLatestHit", latestHit)
    changed = true
  }
  if (!equalTodoHit(card.subtreeTodoHit, todoHit)) {
    setCardTreeStore("cards", cardID, "subtreeTodoHit", todoHit)
    changed = true
  }
  if (!equalScreenshotItems(card.subtreeScreenshotItems, screenshotItems)) {
    setCardTreeStore("cards", cardID, "subtreeScreenshotItems", screenshotItems)
    changed = true
  }
  return changed
}

/** Walk up the ancestor chain via `parentID`, recomputing each ancestor's
 *  cached aggregates. Stops early when an ancestor's aggregate doesn't
 *  change (transitively all further ancestors stay the same). */
function bubbleStatsFromCard(cardID: string, seen: Set<string>): void {
  let current: string | undefined = cardID
  while (current && !seen.has(current)) {
    seen.add(current)
    const changed = recomputeNodeStats(current)
    if (!changed) return
    current = cardTreeStore.cards[current]?.parentID
  }
}

/** Drain the dirty queue. Each entry's ancestor chain is recomputed once;
 *  ancestors visited via a prior entry are skipped. Safe to call when the
 *  queue is empty (no-op). */
export function flushCardStats(): void {
  if (dirtyCardIDs.size === 0) return
  const toFlush = [...dirtyCardIDs]
  dirtyCardIDs.clear()
  const seen = new Set<string>()
  // Re-seeding seen from scratch each flush is correct: a card touched in
  // a prior flush has its cache already settled relative to its descendants;
  // a new flush only needs to revisit ancestors of cards dirtied THIS round.
  for (const id of toFlush) bubbleStatsFromCard(id, seen)
}

/** Test-only escape hatch: clear queue without flushing. Production code
 *  should never need this — tree-writer always flushes at batch end. */
export function __resetCardStatsForTests(): void {
  dirtyCardIDs.clear()
}

registerCardTreePruneStatsHandler(() => {
  for (const [cardID, card] of Object.entries(cardTreeStore.cards)) {
    const parentID = card?.parentID
    if (parentID) {
      const parent = cardTreeStore.cards[parentID]
      if (!parent || !Array.isArray(parent.childIDs) || !parent.childIDs.includes(cardID)) {
        unlinkChildFromParent(cardID)
      }
    }
    markCardStatsDirty(cardID)
  }
  flushCardStats()
})
