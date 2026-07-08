// ── Card Tree — render-side helpers ──
//
// The canonical source of truth for the card tree types (`CardNode`,
// `CardKind`, `CardStatus`, `BoundaryPart`, `StepPayload`) is
// `store/card-tree.ts`. Per CLAUDE.md rule 22 (no dual-source), this file
// re-exports those types so consumers can keep importing from utils
// without forking the type, and holds render-side helpers used by Card /
// CardHeader.
import { cardTreeStore } from "../store/card-tree"
import type {
  CardNode,
  CardKind,
  CardStatus,
  BoundaryPart,
  StepPayload,
  ActivityCounts as StoreActivityCounts,
} from "../store/card-tree"
import { toolNameKey, displayToolIcon, displayToolDetail } from "./tool"
import { extractTodos } from "./todos"
import { isBoundaryMessagePart, isCardBodyMessagePart } from "./message-part"
import { normalizeAgentRole } from "./message"

export type { CardNode, CardKind, CardStatus, StepPayload, BoundaryPart } from "../store/card-tree"

// Transient tool cards never flow through tree-writer's mutation pipeline, so
// their cached subtree fields are never populated. Store-backed cards always
// carry the cache after the first `flushCardStats` call; cards without cached
// counts use the direct recursive walk below.
function shouldUseCachedStats(node: CardNode): boolean {
  if (!node) return false
  return node.subtreeCounts !== undefined
}

// ── Status normalisation ──

function normStatus(raw: any): CardStatus | undefined {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
  if (s === "pending" || s === "running" || s === "completed" || s === "error" || s === "skipped") {
    return s as CardStatus
  }
  if (s === "failed" || s === "fail") return "error"
  if (s === "done" || s === "ok" || s === "passed") return "completed"
  return undefined
}

function normGoalStatus(raw: any): CardStatus | undefined {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
  if (s === "passed") return "completed"
  if (s === "failed") return "error"
  return normStatus(raw)
}

// Todo tools render a structured checklist; inline chips would hide the list,
// and a collapsed completed card would hide the plan itself — so they stay
// expanded regardless of completion status.
const TODO_TOOLS = new Set(["todowrite", "todoread", "todoupdate", "updateplan"])

function isFinishedConversationStatus(status: CardStatus | undefined): boolean {
  return status === "completed" || status === "error" || status === "skipped" || status === "idle"
}

function isUserAuthoredCard(node: CardNode): boolean {
  return normalizeAgentRole(node.role || node.stage || "") === "user"
}

// ── Part flattening ──

// ── Default fold policy ──
// Used by <Card> and the folding store (S3) to decide what to show when no
// explicit user override is present.

function cardHasDisplayPart(node: CardNode | undefined): boolean {
  if (!node) return false
  for (const part of node.parts || []) {
    if (!isCardBodyMessagePart(part)) continue
    if (part.type === "text" || part.type === "reasoning") {
      if (String(part.text || "").replace(/[\[\]\s]/g, "")) return true
      continue
    }
    return true
  }
  return false
}

export function defaultExpandedForNode(
  node: CardNode,
  cards: Record<string, CardNode | undefined> = cardTreeStore.cards,
): boolean {
  if (typeof node.defaultExpanded === "boolean") return node.defaultExpanded
  if (node.status === "running") return true
  if ((node.kind === "agent" || node.kind === "message") && isUserAuthoredCard(node)) return true
  if ((node.kind === "agent" || node.kind === "message") && isFinishedConversationStatus(node.status)) return false
  if (node.kind === "agent") return true
  if (node.kind === "message") return true
  // Integrity verdicts: always expand. The entire point of the card is to
  // surface the structured verdict; a collapsed badge would be weaker than
  // the previous raw-JSON render it replaces.
  if (node.kind === "integrity") return true
  // Executor step cards carry goal description plus promoted build output.
  // Completed empty executors can collapse; completed executors with real
  // build output stay open so the worker transcript does not disappear.
  if (node.kind === "step") {
    const buildPhase = buildPhaseChildForStep(node, cards)
    if (cardHasDisplayPart(buildPhase)) return true
    return node.status !== "completed"
  }
  // Todo checklists must stay expanded — the card's whole value is the list
  // of remaining items; a collapsed completed card hides the plan itself.
  if (node.kind === "tool" && TODO_TOOLS.has(toolNameKey(node.toolPart?.tool || ""))) return true
  // tool defaults: collapsed when completed, open when running.
  return node.status !== "completed"
}

// ── Text collection (for copy-to-clipboard) ──
// Walks a card node and its descendants, emitting the human-readable prose
// parts: text / reasoning, plus goal description on executor
// step cards. Tool input/output and binary parts (patch/file) are skipped —
// they rarely belong in a pasted transcript.

function partText(part: any): string {
  if (!part) return ""
  if (part.type === "text" || part.type === "reasoning") {
    return String(part.text || "").trim()
  }
  return ""
}

function previewPlainText(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim(),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][\w:-]*>/g, " ")
}

/** Sanitize markdown noise but preserve line breaks; CSS owns clamping. */
export function collapsedActivityPreviewText(text: string, title?: string): string {
  const sanitized = previewPlainText(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
  if (!sanitized) return ""
  const normalizedTitle = String(title || "")
    .replace(/\s+/g, " ")
    .trim()
  let preview = sanitized
  if (normalizedTitle) {
    const firstLine = preview.split("\n", 1)[0]
    if (firstLine.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
      const stripped = firstLine.slice(normalizedTitle.length).replace(/^[\s:：-]+/, "")
      preview = (stripped + preview.slice(firstLine.length)).replace(/^\s+/, "")
    }
  }
  return preview
}

export function collectCardText(node: CardNode): string {
  if (!node) return ""
  const chunks: string[] = []
  if (node.kind === "step" && node.goalDescription) {
    chunks.push(String(node.goalDescription).trim())
  }
  for (const part of node.parts || []) {
    const text = partText(part)
    if (text) chunks.push(text)
  }
  // Store-backed cards reference children by id — dereference via the store.
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid]
    if (!child) continue
    const sub = collectCardText(child)
    if (sub) chunks.push(sub)
  }
  return chunks.filter(Boolean).join("\n\n")
}

export function reachableCardIDsFromTree(
  order: readonly string[],
  cards: Record<string, Pick<CardNode, "childIDs"> | undefined>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const visit = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
    const card = cards[id]
    for (const childID of card?.childIDs ?? []) visit(childID)
  }
  for (const id of order) visit(id)
  return out
}

export function orderedReachableCardIDs(): string[] {
  return reachableCardIDsFromTree(cardTreeStore.order, cardTreeStore.cards)
}

export function parentIDChainForCard(
  cardID: string,
  cards: Record<string, Pick<CardNode, "parentID"> | undefined> = cardTreeStore.cards,
): string[] {
  const ancestors: string[] = []
  const seen = new Set<string>()
  let current = String(cardID || "")
  while (current) {
    if (seen.has(current)) throw new Error(`card-tree: parentID cycle at ${current}`)
    seen.add(current)
    const parentID = cards[current]?.parentID
    if (!parentID) break
    if (!cards[parentID]) throw new Error(`card-tree: card ${current} references missing parent ${parentID}`)
    ancestors.unshift(parentID)
    current = parentID
  }
  return ancestors
}

export function topLevelCardIDForCard(
  cardID: string,
  order: readonly string[] = cardTreeStore.order,
  cards: Record<string, Pick<CardNode, "parentID"> | undefined> = cardTreeStore.cards,
): string | undefined {
  const orderSet = new Set(order)
  if (orderSet.has(cardID)) return cardID
  for (const parentID of parentIDChainForCard(cardID, cards)) {
    if (orderSet.has(parentID)) return parentID
  }
  return undefined
}

export function isBuildPhaseCard(node: Pick<CardNode, "kind" | "phaseID"> | undefined): boolean {
  return node?.kind === "phase" && node.phaseID === "build"
}

export function buildPhaseChildForStep(
  node: CardNode,
  cards: Record<string, CardNode | undefined> = cardTreeStore.cards,
): CardNode | undefined {
  if (node.kind !== "step") return undefined
  const matches: CardNode[] = []
  for (const childID of node.childIDs ?? []) {
    const child = cards[childID]
    if (!child) {
      throw new Error(`card-tree: step card ${node.id} references missing child ${childID}`)
    }
    if (isBuildPhaseCard(child)) matches.push(child)
  }
  if (matches.length > 1) {
    throw new Error(`card-tree: step card ${node.id} has multiple build phase children`)
  }
  return matches[0]
}

export function visibleChildIDsForCard(
  node: CardNode,
  cards: Record<string, CardNode | undefined> = cardTreeStore.cards,
): string[] {
  const childIDs = node.childIDs ?? []
  const visible: string[] = []
  for (const childID of childIDs) {
    const child = cards[childID]
    if (!child) {
      throw new Error(`card-tree: card ${node.id} references missing child ${childID}`)
    }
    if (node.kind === "step" && isBuildPhaseCard(child)) continue
    visible.push(childID)
  }
  return visible
}

export function stepHeaderNodeWithBuildPhase(
  node: CardNode,
  cards: Record<string, CardNode | undefined> = cardTreeStore.cards,
): CardNode {
  const buildPhase = buildPhaseChildForStep(node, cards)
  if (!buildPhase) return node
  return {
    ...node,
    status: buildPhase.status ?? node.status,
    contextTokens: buildPhase.contextTokens ?? node.contextTokens,
    contextTokensEstimated: buildPhase.contextTokensEstimated ?? node.contextTokensEstimated,
    usage: buildPhase.usage ?? node.usage,
    timeCompleted: buildPhase.timeCompleted ?? node.timeCompleted,
    errorReason: buildPhase.errorReason ?? node.errorReason,
    terminalReason: buildPhase.terminalReason ?? node.terminalReason,
  }
}

// ── Latest-activity preview (collapsed header) ──
// Walks the subtree and keeps only the single most recent activity by
// (card.time, part-index). An activity is either:
//   - a text/reasoning part (assistant prose / chain-of-thought), or
//   - a tool part (formatted as "<icon> <ToolName>: <detail>" so the
//     operator can see "what is this card actually doing right now").
// This is the canonical preview source — text and tool calls compete
// for the same line so the operator always sees the actual latest
// signal, not whichever channel happened to be picked.

interface LatestHit {
  time: number
  index: number
  text: string
}

// Internal-only tools whose tool name + state carry no operator-visible
// signal. StructuredOutput is the Zod-call wrapper used for decompose /
// architect; surfacing it as preview text produces "⚡ StructuredOutput:
// Structured Output" — pure noise. Suppressed alongside TODO tools.
const PREVIEW_SUPPRESS_TOOLS = new Set(["structuredoutput", "structured_output"])

function toolHitText(part: any): string {
  if (!part || part.type !== "tool") return ""
  const name = String(part.tool || "").trim()
  if (!name) return ""
  const key = toolNameKey(name)
  // Todo tools own a dedicated UI row; surfacing them here would steal
  // attention from the actual work that happened around the plan.
  if (TODO_TOOLS.has(key)) return ""
  if (PREVIEW_SUPPRESS_TOOLS.has(key)) return ""
  const state = part.state || {}
  const icon = displayToolIcon(name)
  const detail = displayToolDetail(name, state.input, state, "")
  const head = icon ? `${icon} ${name}` : name
  return detail ? `${head}: ${detail}` : head
}

// Goal step cards (kind="step") want a different preview policy: the
// operator scanning a goal needs the goal context (objective / latest
// reasoning), not "Bash: rg --files". Tool calls are visible inside the
// expanded card body — the collapsed line should answer "what is this
// goal trying to do" rather than "what command is currently running".
function gatherLatest(node: CardNode, hits: LatestHit[], suppressTools: boolean): void {
  if (!node) return
  const baseTime = typeof node.time === "number" ? node.time : 0
  if (!suppressTools && node.kind === "tool" && node.toolPart) {
    const toolText = toolHitText(node.toolPart)
    if (toolText) hits.push({ time: baseTime, index: 0, text: toolText })
  }
  const parts = node.parts || []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const text = partText(part)
    if (text) {
      hits.push({ time: baseTime, index: i, text })
      continue
    }
    if (suppressTools) continue
    const toolText = toolHitText(part)
    if (toolText) hits.push({ time: baseTime, index: i, text: toolText })
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid]
    if (child) gatherLatest(child as unknown as CardNode, hits, suppressTools)
  }
}

export function collectLatestActivityText(node: CardNode): string {
  if (!node) return ""
  if (shouldUseCachedStats(node)) {
    const cached = node.subtreeLatestHit
    if (cached?.text) return cached.text
    if (node.kind === "step" && node.goalDescription) {
      return String(node.goalDescription).trim()
    }
    return ""
  }
  const suppressTools = node.kind === "step"
  const hits: LatestHit[] = []
  gatherLatest(node, hits, suppressTools)
  if (hits.length === 0) {
    if (node.kind === "step" && node.goalDescription) {
      return String(node.goalDescription).trim()
    }
    return ""
  }
  let best = hits[0]
  for (let i = 1; i < hits.length; i++) {
    const h = hits[i]
    if (h.time > best.time || (h.time === best.time && h.index > best.index)) {
      best = h
    }
  }
  return best.text
}

// ── Message segmentation ──
//
// A card aggregates N message turns into one flat `parts` array, with a
// `BoundaryPart` (carrying the effective role + timestamp) marking each
// turn transition. Splitting the array back at those boundaries yields the
// individual messages — this is the single source for that operation,
// shared by the Board streaming surfaces and the ConversationAgentRail
// "latest message" preview. Role is preserved verbatim (empty string when
// the boundary carried none); callers that require a role assert it
// themselves rather than this splitter inventing an assistant role.

export interface CardMessageSegment {
  id: string
  role: string
  time: number
  parts: any[]
}

export function cardMessageSegments(card: CardNode): CardMessageSegment[] {
  const parts = card.parts || []
  if (parts.length === 0) return []
  const segments: CardMessageSegment[] = []
  let boundary: BoundaryPart | null = null
  let buffer: any[] = []
  // A message-turn card IS one message and carries no in-card boundary
  // (the card itself is the boundary). Use the card's own
  // role/stage for that single segment. Phase-absorbed cards still carry
  // boundary parts (they fold N sub-sessions) and split exactly as before.
  const cardRole =
    typeof card.role === "string" && card.role.length > 0 ? card.role : typeof card.stage === "string" ? card.stage : ""
  const flush = () => {
    if (buffer.length === 0) return
    segments.push({
      id: `${card.id}:msg:${segments.length}`,
      role: typeof boundary?.role === "string" && boundary.role.length > 0 ? boundary.role : cardRole,
      time: boundary?.time ?? card.time ?? 0,
      parts: buffer,
    })
    buffer = []
  }
  for (const part of parts) {
    if (isBoundaryMessagePart(part)) {
      flush()
      boundary = part as BoundaryPart
      continue
    }
    buffer.push(part)
  }
  flush()
  return segments
}

// ── Activity counts (collapsed header) ──
// Tally the work that has happened inside a card subtree so the collapsed
// header can show "🤖 2  🛠 14  🎯 1  💬 5" and the operator gets a sense
// of activity volume without expanding the card.

export interface ActivityCounts {
  messages: number
  tools: number
  agents: number
  skills: number
}

const AGENT_SPAWN_TOOLS = new Set(["task", "agent", "spawnagent", "subagent"])

function isSkillTool(key: string): boolean {
  // Claude-Code-style Skill tool, plus any tool whose key contains "skill"
  // (covers "skill", "invokeskill", "useskill", etc).
  return key === "skill" || /skill/.test(key)
}

function bumpCountsForPart(part: any, counts: ActivityCounts): void {
  if (!part) return
  if (part.type === "text" || part.type === "reasoning") {
    if (String(part.text || "").trim()) counts.messages++
    return
  }
  if (part.type !== "tool") return
  const key = toolNameKey(part.tool || "")
  if (!key) return
  if (AGENT_SPAWN_TOOLS.has(key)) {
    counts.agents++
    return
  }
  if (isSkillTool(key)) {
    counts.skills++
    return
  }
  counts.tools++
}

function gatherCounts(node: CardNode, counts: ActivityCounts): void {
  if (!node) return
  if (node.kind === "tool" && node.toolPart) {
    bumpCountsForPart(node.toolPart, counts)
  }
  for (const part of node.parts || []) {
    bumpCountsForPart(part, counts)
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid]
    if (child) gatherCounts(child as unknown as CardNode, counts)
  }
}

export function collectActivityCounts(node: CardNode): ActivityCounts {
  if (shouldUseCachedStats(node)) {
    const cached = node.subtreeCounts as StoreActivityCounts | undefined
    if (cached) {
      return {
        messages: cached.messages,
        tools: cached.tools,
        agents: cached.agents,
        skills: cached.skills,
      }
    }
  }
  const counts: ActivityCounts = { messages: 0, tools: 0, agents: 0, skills: 0 }
  gatherCounts(node, counts)
  return counts
}

// ── Todo summary (collapsed header) ──
// Walks the subtree to find the most recent TodoWrite/UpdatePlan tool part
// and reports counts + the in-progress (or last completed) item title.
// Returns null when no todo tool calls exist anywhere in the subtree —
// the header then skips the third row entirely.

export interface TodoSummary {
  total: number
  completed: number
  inProgress: number
  pending: number
  /** Title of the in_progress item, else last completed, else first pending. */
  current: string
}

function todoTitle(item: any): string {
  if (!item || typeof item !== "object") return ""
  const af = typeof item.activeForm === "string" ? item.activeForm.trim() : ""
  const c = typeof item.content === "string" ? item.content.trim() : ""
  return af || c
}

function extractTodoList(part: any): any[] | null {
  if (!part || part.type !== "tool") return null
  const key = toolNameKey(part.tool || "")
  if (!TODO_TOOLS.has(key)) return null
  return extractTodos(part.state || {})
}

interface TodoHit {
  time: number
  index: number
  todos: any[]
}

function gatherTodos(node: CardNode, hits: TodoHit[]): void {
  if (!node) return
  const baseTime = typeof node.time === "number" ? node.time : 0
  // kind="tool" cards carry the tool part on `toolPart` (parts[] is empty
  // because the tool was promoted into its own card).
  if (node.kind === "tool" && node.toolPart) {
    const todos = extractTodoList(node.toolPart)
    if (todos && todos.length > 0) hits.push({ time: baseTime, index: 0, todos })
  }
  const parts = node.parts || []
  for (let i = 0; i < parts.length; i++) {
    const todos = extractTodoList(parts[i])
    if (todos && todos.length > 0) hits.push({ time: baseTime, index: i, todos })
  }
  for (const cid of node.childIDs || []) {
    const child = cardTreeStore.cards[cid]
    if (child) gatherTodos(child as unknown as CardNode, hits)
  }
}

export function collectTodoSummary(node: CardNode): TodoSummary | null {
  if (!node) return null
  let best: TodoHit | undefined
  if (shouldUseCachedStats(node)) {
    const cached = node.subtreeTodoHit
    if (!cached || !Array.isArray(cached.todos) || cached.todos.length === 0) return null
    best = { time: cached.time, index: cached.index, todos: cached.todos }
  } else {
    const hits: TodoHit[] = []
    gatherTodos(node, hits)
    if (hits.length === 0) return null
    best = hits[0]
    for (let i = 1; i < hits.length; i++) {
      const h = hits[i]
      if (h.time > best.time || (h.time === best.time && h.index > best.index)) {
        best = h
      }
    }
  }
  let completed = 0
  let inProgress = 0
  let pending = 0
  let inProgressTitle = ""
  let lastCompletedTitle = ""
  let firstPendingTitle = ""
  for (const item of best.todos) {
    const status = String((item as any)?.status || "")
      .toLowerCase()
      .trim()
    const title = todoTitle(item)
    if (status === "completed") {
      completed++
      if (title) lastCompletedTitle = title
    } else if (status === "in_progress") {
      inProgress++
      if (title && !inProgressTitle) inProgressTitle = title
    } else if (status === "cancelled") {
      // Cancelled items don't contribute to progress, but still count toward total.
    } else {
      pending++
      if (title && !firstPendingTitle) firstPendingTitle = title
    }
  }
  const current = inProgressTitle || firstPendingTitle || lastCompletedTitle
  return {
    total: best.todos.length,
    completed,
    inProgress,
    pending,
    current,
  }
}
