// ── Reasoning Visibility Store ──
// Reasoning parts are always visible by default.
// Users can manually collapse them via the toggle in ReasoningPart.

import { createSignal } from "solid-js"

// ── Internal state ──

// Reactive revision counter — increment whenever visibility changes so that
// Solid components re-render.
const [reasoningRevision, setReasoningRevision] = createSignal(0)
export { reasoningRevision }

// ── Helpers ──

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Derive a stable cache key from a reasoning part object. */
export function reasoningPartKey(part: unknown): string {
  if (!record(part)) return ""
  const id = typeof (part as any).id === "string" ? (part as any).id : ""
  const messageID = typeof (part as any).messageID === "string" ? (part as any).messageID : ""
  const sessionID = typeof (part as any).sessionID === "string" ? (part as any).sessionID : ""
  if (!id && !messageID && !sessionID) return ""
  return `reasoning:${sessionID}:${messageID}:${id}`
}

/** Reasoning parts are never auto-hidden. Always returns false. */
export function reasoningPartHidden(_part: unknown): boolean {
  return false
}

/**
 * Track a reasoning part for reactivity. No auto-hide — reasoning stays
 * visible until the user manually collapses it.
 */
export function touchReasoningPart(part: unknown): void {
  const key = reasoningPartKey(part)
  if (!key) return
  // Bump revision so components that read reasoningRevision() re-render
  setReasoningRevision((r) => r + 1)
}
