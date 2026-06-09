// ── Replay harness ──
//
// Drives the cardTreeStore / tree-writer pipeline against a fixture event
// stream and returns a normalized, stably-sorted tree snapshot. Used by the
// baseline regression (P0 snapshot + P4 real-world checks).
//
// Pipeline entry point: `applyEvent(event)` in `services/tree-writer.ts`.
// `task.*` / `interaction.*` events mutate `boardStore.board` first (the
// tree-writer reads boardStore on these events, it does NOT read the event
// payload itself). The harness reproduces that contract.

import { boardStore, setBoardStore } from "../../src/store/board"
import { cardTreeStore, type CardNode } from "../../src/store/card-tree"
import { applyEvent, flushBufferedPartDeltas, resetWriter } from "../../src/services/tree-writer"
import type { FixtureEvent } from "./goal-phase-events"

// ── Snapshot shape ──
//
// Flat `nodes` dict keyed by id + top-level `order`. Each node carries only
// the fields the UI reads — `childIDs` is recursive string[] (IDs reference
// other entries in `nodes`).

export interface NormalizedPart {
  id?: string
  type: string
  text?: string
  tool?: string
  toolStatus?: string
  output?: string
}

export interface NormalizedNode {
  id: string
  kind: string
  stage?: string
  status?: string
  title: string
  subtitle?: string
  round?: number
  phaseID?: string
  phaseSessionKind?: string
  // audit-2026-04-29 W2-V26 — `phaseSessionID` is set by tree-writer
  // when a goal-scoped session (planner / build / evaluator) is
  // absorbed into a phase card; the inline AgentSessionReplyBox in
  // Card.tsx targets this field. Pre-fix the snapshot dropped it,
  // so tree-writer-hierarchy's "phase cards absorb goal-scoped
  // session parts" assertion always saw `undefined`.
  phaseSessionID?: string
  parts: NormalizedPart[]
  childIDs: string[]
}

export interface TreeSnapshot {
  order: string[]
  nodes: Record<string, NormalizedNode>
}

function normalizePart(p: any): NormalizedPart {
  const out: NormalizedPart = { type: String(p?.type || "") }
  if (p?.id) out.id = String(p.id)
  if (typeof p?.text === "string") out.text = p.text
  if (p?.tool) out.tool = String(p.tool)
  if (p?.state?.status) out.toolStatus = String(p.state.status)
  if (typeof p?.state?.output === "string") out.output = p.state.output
  return out
}

function normalizeNode(id: string, acc: Record<string, NormalizedNode>): string {
  const node = cardTreeStore.cards[id]
  if (!node) throw new Error(`replay: order references missing card ${id}`)
  if (acc[id]) return id
  const childIDs: string[] = []
  for (const cid of node.childIDs || []) {
    normalizeNode(cid, acc)
    childIDs.push(cid)
  }
  const out: NormalizedNode = {
    id: node.id,
    kind: node.kind,
    title: node.title,
    parts: (node.parts || []).map(normalizePart),
    childIDs,
  }
  if (node.stage) out.stage = node.stage
  if (node.status) out.status = node.status
  if (node.subtitle) out.subtitle = node.subtitle
  if (typeof node.round === "number") out.round = node.round
  if (node.phaseID) out.phaseID = node.phaseID
  if (node.phaseSessionKind) out.phaseSessionKind = node.phaseSessionKind
  if ((node as any).phaseSessionID) out.phaseSessionID = (node as any).phaseSessionID
  acc[id] = out
  return id
}

export function captureSnapshot(): TreeSnapshot {
  const nodes: Record<string, NormalizedNode> = {}
  const order: string[] = []
  for (const id of cardTreeStore.order) {
    normalizeNode(id, nodes)
    order.push(id)
  }
  return { order, nodes }
}

/** Apply task.* / interaction.* payload directly to boardStore — mirrors the
 *  live overlay's loadBoard() semantics without HTTP. The tree-writer's
 *  boardStore effect re-projects `ctx:user-request` / goal group cards
 *  automatically on each write. */
function applyBoardEvent(event: FixtureEvent): boolean {
  const type = event.type
  const p = event.properties || {}
  if (type === "task.created" || type === "task.updated" || type === "task.completed") {
    const current = boardStore.board || {}
    const incomingTask = p.task || {}
    const next: any = { ...current }
    for (const key of Object.keys(incomingTask)) {
      if (key === "goalWorkflows" || key === "interactions") continue
      next[key] = incomingTask[key]
    }
    if (Array.isArray(incomingTask.goalWorkflows)) next.goalWorkflows = incomingTask.goalWorkflows
    if (Array.isArray(incomingTask.interactions)) next.interactions = incomingTask.interactions
    next.task = { ...(current.task || {}), ...incomingTask }
    setBoardStore("board", next)
    if (incomingTask.id) setBoardStore("selectedTaskID", incomingTask.id)
    return true
  }
  if (type === "interaction.requested" || type === "interaction.resolved") {
    const current = boardStore.board || {}
    const existing: any[] = Array.isArray(current.interactions) ? current.interactions : []
    const incoming = p.interaction
    if (!incoming) return true
    const idx = existing.findIndex((i) => i?.id === incoming.id)
    const next = idx >= 0 ? existing.map((i, k) => (k === idx ? incoming : i)) : [...existing, incoming]
    setBoardStore("board", { ...current, interactions: next })
    return true
  }
  return false
}

export async function replay(events: FixtureEvent[], initialBoard: any): Promise<TreeSnapshot> {
  setBoardStore("board", initialBoard)
  setBoardStore("selectedTaskID", initialBoard?.task?.id || "")
  resetWriter()

  for (const event of events) {
    applyBoardEvent(event)
    applyEvent(event)
  }
  flushBufferedPartDeltas()
  return captureSnapshot()
}
