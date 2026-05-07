// Regression for iter22 of the design-language audit.
//
// `.chat-icon-col` (the vertical column of toolbar icons —
// attach / web search / expand — that lives between the
// .chat-textarea-wrap and .chat-send button inside the
// .chat-input row) was defined four times solo at the top
// level, with the same dual-source-with-late-override pattern:
//
//   - line ~5332: chromed canonical — 16px radius, surface-inset
//                 gradient bg, accent-tinted border, inset shadow.
//   - line ~12515: override — 10px radius via var(--radius), flat
//                  background, plain border-color.
//   - line ~12728: align-self override.
//   - line ~12976: background override — color-mix(--surface 52%).
//
// Same anti-pattern collapsed in iter5 / iter14 / iter15 / iter16
// / iter17 / iter20. The canonical lied about radius (16px in
// source, 10px rendered).
//
// After iter17 made the parent `.chat-input` flat (border-
// radius: 0) and iter20 made the inner `.chat-textarea` flat
// too, the icon column was the last rounded chip inside the
// otherwise-flat composer row — visual mismatch. Drop the
// radius so the column reads as a flush slice of the same
// flat surface.
//
// Followed the iter21 5-prefix grep (solo / pseudo / theme /
// multi-selector / @media) before authoring the canonical:
//   1. Solo: 4 sites (above)
//   2. Pseudo: 0
//   3. Theme: line ~13400 (light) and line ~13673 (dark) —
//      only set background + border-color, NO border-radius.
//   4. Multi-selector partner: removed; the canonical owns
//      gap/padding so late `!important` reset chains cannot drift.
//   5. @media: line ~12746 inside @media (max-width: 760px) —
//      sets grid-row / grid-column for narrow-width layout,
//      legit responsive.

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const STYLES_ROOT = path.resolve(import.meta.dir, "..", "src", "styles")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Concatenate all surface + cascade + primitive CSS files (styles.css was
// dissolved 2026-05-04 into this decomposed architecture).
const STYLES = walkCss(STYLES_ROOT).map((f) => readFileSync(f, "utf8")).join("\n")

function countSoloTopLevelRules(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

function soloRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`solo ${selector} not found in surface files`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".chat-icon-col is a single flat source", () => {
  test("only one solo top-level `.chat-icon-col { … }` rule", () => {
    expect(countSoloTopLevelRules(".chat-icon-col")).toBe(1)
  })

  test("the canonical body uses no `!important`", () => {
    expect(soloRuleBody(".chat-icon-col")).not.toContain("!important")
  })

  test("the canonical declares `border-radius: 0` so the column matches the flat composer row", () => {
    expect(soloRuleBody(".chat-icon-col")).toMatch(/border-radius:\s*0(?:px)?\s*;/)
  })

  test("the canonical declares its own spacing (calc-based, scale-aware)", () => {
    // The original min(calc(3px * var(--ui-scale)), 4px) cap was simplified to
    // calc(3px * var(--ui-scale)) once the reset chains were fully retired.
    expect(soloRuleBody(".chat-icon-col")).toMatch(/padding:\s*calc\(3px \* var\(--ui-scale\)\)\s*;/)
  })

  test("no theme override re-introduces a non-zero border-radius on .chat-icon-col", () => {
    const headRe = /(^|\n)body[^{]*?\.chat-icon-col(?![-\w])(?::[a-z-]+)?\s*\{/g
    for (const match of STYLES.matchAll(headRe)) {
      const open = match.index + match[0].length - 1
      const close = STYLES.indexOf("}", open)
      const body = STYLES.slice(open + 1, close)
      expect(body).not.toMatch(/border-radius:\s*(?!0)\S/)
    }
  })

  test("no theme override resets .chat-icon-col spacing", () => {
    expect(STYLES).not.toMatch(
      /body[^{]*\.chat-icon-col(?![-\w])[^{}]*\{[^}]*\b(?:gap|padding(?:-\w+)?)\s*:/,
    )
  })
})
