// ── Section phase utilities ──
// phaseSections, liveConversationPhase, relatePhase
// These functions directly manipulate DOM data-attributes (data-phaseState)
// on the template section elements to drive CSS active/related highlighting.
// The functions that previously read from the `state` now
// receive their data as parameters so Solid callers can supply Solid store
// values.

import { getDomRefs } from "../dom"
import { cardTreeStore, type CardNode } from "../store/card-tree"
import { normalizeAgentRole, agentRoleToSectionPhase } from "./message"

// ── Internal: phaseSections ──
// Returns a map of phase-kind → DOM section node.

function phaseSections(): Record<string, HTMLElement | null> {
  const dom = getDomRefs()
  return {
    spec: dom.specSection,
    plan: dom.planSection,
    goals: dom.goalsSection,
    executor: dom.executorSection,
    evaluation: dom.criteriaSection,
    acceptance: dom.acceptanceSection,
    files: dom.changesSection,
  }
}

// ── Internal: markSectionPhase ──
// Sets or removes the data-phaseState attribute on a section element.

function markSectionPhase(kind: string, value: string): void {
  const node = phaseSections()[kind]
  if (!node) return
  if (!value) {
    delete node.dataset.phaseState
    return
  }
  node.dataset.phaseState = value
}

// ── Internal: liveConversationPhase ──
// Scans cards in reverse to find the currently active agent phase.

function cardIsActive(node: CardNode): boolean {
  if (node.status === "running" || node.status === "pending") return true
  return (node.parts ?? []).some(
    (part: any) => part?.type === "tool" && ["running", "pending"].includes(part?.state?.status || ""),
  )
}

function cardPhase(node: CardNode): string {
  const agent = String(node.role || node.stage || "")
    .trim()
    .toLowerCase()
  return agentRoleToSectionPhase(normalizeAgentRole(agent))
}

function visitCardReverse(id: string, seen: Set<string>): string {
  if (seen.has(id)) return ""
  seen.add(id)
  const node = cardTreeStore.cards[id]
  if (!node) throw new Error(`section phase: missing card ${id}`)
  const childIDs = node.childIDs ?? []
  for (let index = childIDs.length - 1; index >= 0; index -= 1) {
    const childPhase = visitCardReverse(childIDs[index]!, seen)
    if (childPhase) return childPhase
  }
  if (!cardIsActive(node)) return ""
  return cardPhase(node)
}

function liveConversationPhase(): string {
  const seen = new Set<string>()
  for (let index = cardTreeStore.order.length - 1; index >= 0; index -= 1) {
    const phase = visitCardReverse(cardTreeStore.order[index]!, seen)
    if (phase) return phase
  }
  return ""
}

// ── Internal: relatePhase ──
// changesCount: number of file-change entries ( state.changes.length equivalent).

function relatePhase(kind: string, related: string[], board: any, goals: any[], changesCount: number): void {
  if (!kind) return
  if (kind === "plan") {
    if (board?.spec) related.push("spec")
    return
  }
  if (kind === "goals") {
    if (board?.plan) related.push("plan")
    if (changesCount > 0) related.push("files")
    return
  }
  if (kind === "evaluation") {
    if (goals.length > 0) related.push("goals")
    if (changesCount > 0) related.push("files")
    return
  }
  if (kind === "files") {
    if (board?.evaluation) related.push("evaluation")
    if (goals.length > 0) related.push("goals")
    return
  }
}

// ── Public: clearSectionPhases ──
// Removes data-phaseState from all template section nodes.

export function clearSectionPhases(): void {
  Object.values(phaseSections()).forEach((node) => {
    if (!node) return
    delete node.dataset.phaseState
  })
}

// ── Public: syncSectionPhases ──
// board: board data object (boardStore.board equivalent).
// changesCount: number of current file diffs ( state.changes.length equivalent).
// Callers should pass:
// board — boardStore.board
// changesCount — changes array length from app store or local state

export function syncSectionPhases(board: any, changesCount = 0): void {
  clearSectionPhases()
  const live = liveConversationPhase()
  if (!board?.task && !live) return

  const goals = board?.goalWorkflows || []
  const pending = (board?.interactions || []).some((item: any) => item.status === "pending")
  const taskStatus = board?.task?.status || ""
  const planning = board?.task ? board.run?.phase === "plan" || board.run?.phase === "replan" : false
  const active: string[] = []
  const related: string[] = []

  if (live) {
    active.push(live)
    relatePhase(live, related, board, goals, changesCount)
  }

  if (board?.task && pending) {
    active.length = 0
    if (board.plan) active.push("plan")
    else if (goals.length > 0) active.push("goals")
    else if (board.spec) active.push("spec")
  }

  if (board?.task && active.length === 0 && taskStatus === "queued") {
    if (board.spec) active.push("spec")
    else if (board.plan) active.push("plan")
  }

  if (board?.task && active.length === 0 && planning) {
    active.push(board.spec ? "plan" : "spec")
    if (board.spec) related.push("spec")
    if (board.plan) related.push("plan")
  }

  // New "active" status: infer the best section from available board data
  if (board?.task && active.length === 0 && taskStatus === "active") {
    if (board.evaluation) {
      active.push("evaluation")
      if (goals.length > 0) related.push("goals")
      if (changesCount > 0) related.push("files")
    } else if (board.acceptance) {
      active.push("acceptance")
      if (changesCount > 0) related.push("files")
      if (goals.length > 0) related.push("goals")
    } else if (goals.length > 0) {
      active.push("executor")
      related.push("goals")
      if (board.plan) related.push("plan")
      if (changesCount > 0) related.push("files")
    } else if (board.plan) {
      active.push("plan")
      if (board.spec) related.push("spec")
    } else {
      active.push("spec")
    }
  }

  if (board?.task && active.length === 0 && board.task.status === "completed") {
    active.push(board.acceptance ? "acceptance" : changesCount > 0 ? "files" : "evaluation")
    if (board.acceptance && changesCount > 0) related.push("files")
    if (board.evaluation) related.push("evaluation")
    if (goals.length > 0) related.push("goals")
  }

  if (board?.task && active.length === 0 && board.task.status === "failed") {
    active.push(board.evaluation ? "evaluation" : board.plan ? "plan" : "spec")
    if (board.plan) related.push("plan")
    if (goals.length > 0) related.push("goals")
  }

  if (board?.task && active.length === 0 && board.task.status === "cancelled") {
    if (board.plan) active.push("plan")
    else if (board.spec) active.push("spec")
  }

  const current = [...new Set(active.filter(Boolean))]
  const contextual = [...new Set(related.filter((kind) => kind && !current.includes(kind)))]

  current.forEach((kind) => markSectionPhase(kind, "active"))
  contextual.forEach((kind) => markSectionPhase(kind, "related"))
}
