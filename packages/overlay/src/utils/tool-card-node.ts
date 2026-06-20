import type { CardNode } from "./card-tree"
import { selectedTaskDirectory } from "../store/board"
import { displayToolArguments, toolNameKey } from "./tool"

const TODO_CARD_TITLE_KEYS: Record<string, string> = {
  todowrite: "tool.card.todos",
  todoread: "tool.card.todos",
  todoupdate: "tool.card.todos",
  updateplan: "tool.card.plan",
}

function positiveFiniteTimestamp(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined
}

/** Build a transient CardNode for a tool part so every tool shares the same card chrome. */
export function toolToCardNode(part: any, observationTime: number = Date.now()): CardNode {
  const status = (() => {
    const s = String(part?.state?.status || "").toLowerCase()
    if (s === "pending" || s === "running" || s === "completed" || s === "error") return s as any
    if (s === "failed") return "error"
    return undefined
  })()
  const toolName = String(part?.tool || "tool")
  const state = part?.state || {}
  const key = toolNameKey(toolName)
  const args = displayToolArguments(toolName, state.input, state, selectedTaskDirectory())
  const title = TODO_CARD_TITLE_KEYS[key] || toolName
  const time = positiveFiniteTimestamp(state?.time?.start) ?? observationTime
  const timeCompleted = positiveFiniteTimestamp(state?.time?.end)
  return {
    id: String(part?.id || `tool:${toolName}:${Math.random().toString(36).slice(2)}`),
    kind: "tool",
    stage: key,
    status,
    title,
    subtitle: args || undefined,
    parts: [],
    children: [],
    toolPart: part,
    time,
    ...(timeCompleted !== undefined && timeCompleted > time ? { timeCompleted } : {}),
  }
}
