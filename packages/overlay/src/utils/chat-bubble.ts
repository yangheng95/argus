import type { CardNode } from "../store/card-tree"
import { normalizeAgentRole } from "./message"

export function renderAsBubble(node: CardNode): boolean {
  return node.kind === "message" || node.kind === "agent"
}

export function bubbleAlign(node: CardNode): "left" | "right" {
  const role = normalizeAgentRole(node.role || node.stage || "")
  return role === "user" ? "right" : "left"
}
