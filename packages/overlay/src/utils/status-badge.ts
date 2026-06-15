// ── Card status badge — terminal outcome disambiguation ──
//
// Previously the badge collapsed three terminal reasons into the same
// red ✗:  real failure, operator-cancelled, replan-superseded. And every
// `completed` card got the same green ✓ regardless of whether the
// integrity / fidelity verdict surfaced concerns. Operators reading the
// pinboard had no way to tell "this finished cleanly" from "this finished
// but you should look at it" or "this never produced a result".
//
// This helper maps `(status, terminalReason, integrity.verdict)` onto
// one of six tones. The CSS for each tone lives in `styles/surfaces/card.css`
// alongside the existing `card__badge--*` classes.

import type { CardNode } from "../store/card-tree"

export interface CardStatusBadge {
  /** Used by CSS as `card__badge--{tone}`. */
  tone: "running" | "done" | "concerns" | "cancelled" | "error" | "skipped" | "pending" | "neutral"
  /** Single-character glyph rendered inside the badge circle.
   *  Empty for `running` (replaced by spinner) and `neutral` (hidden). */
  glyph: string
}

export function statusBadge(node: CardNode): CardStatusBadge {
  const s = node.status
  const reason = String((node as any).terminalReason || "").toLowerCase()
  if (reason === "cancelled" || reason === "aborted") {
    return { tone: "cancelled", glyph: "⊘" } // ⊘
  }
  if (s === "running") return { tone: "running", glyph: "" }
  if (s === "error") {
    return { tone: "error", glyph: "✗" } // ✗
  }
  if (s === "skipped") return { tone: "skipped", glyph: "—" } // —
  if (s === "pending") return { tone: "pending", glyph: "·" } // ·
  if (s === "completed") {
    const verdict = node.integrity?.verdict
    if (verdict === "concerns" || verdict === "needs_correction") {
      return { tone: "concerns", glyph: "⚠" } // ⚠
    }
    return { tone: "done", glyph: "✓" } // ✓
  }
  if (node.kind === "message") return { tone: "neutral", glyph: "" }
  return { tone: "done", glyph: "✓" }
}
