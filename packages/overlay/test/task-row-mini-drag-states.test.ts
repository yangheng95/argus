// Regression for iter27 of the design-language audit.
//
// `.task-row-mini` drag-state pseudo cousins (`[data-draggable]`,
// `[data-dragging]`, `[data-drag-over]`) were each defined twice
// in styles.css with the same dual-source pattern collapsed in
// earlier iters:
//
//   [data-draggable="true"]
//     - line ~9838: `cursor: grab` only.
//     - line ~12418: `cursor: grab` only — exact duplicate.
//
//   [data-dragging="true"]
//     - line ~9842: `opacity: 0.58`.
//     - line ~12422: `opacity: 0.58` — exact duplicate.
//
//   [data-drag-over="true"]
//     - line ~9846: `background: color-mix(--accent 12%, transparent);
//                   box-shadow: inset 2px 0 0 …;`
//                   No !important; lost specificity to ~12426.
//     - line ~12426: same bg + border-color + box-shadow plus
//                   `!important`. Late winner. The pre-iter27
//                   version added a `border-color` declaration
//                   the dead 9846 block lacked.
//
// Editing the canonical-tier rules at 9838 / 9842 / 9846 was a
// no-op for `[data-draggable]` and `[data-dragging]` (CSS
// dedupe — last-of-equals wins, but they're equal anyway), and
// for `[data-drag-over]` the canonical lost to the !important
// late winner — same trap as iter5 / iter14 / iter17 / iter20 /
// iter25 / iter26 collapses.
//
// Pin: ONE solo top-level rule per drag-state attribute.

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
// dissolved 2026-05-04 into this decomposed architecture). Comments are
// stripped first so a /* ... */ block immediately preceding a rule does
// not get folded into the rule's selector head when we split on }.
function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}
const STYLES = stripCssComments(
  walkCss(STYLES_ROOT)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
)

function countTopLevelRulesEndingWithSelector(selector: string): number {
  // Walk every CSS rule by splitting on `}`. Same parser as
  // task-row-mini-pseudo-states.test.ts. Skip @media-nested
  // and theme-scoped (`body[…]`) rules.
  let count = 0
  for (const chunk of STYLES.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const raw = chunk.slice(0, openIdx)
    const head = raw.trim()
    if (!head) continue
    if (head.startsWith("body")) continue
    if (head.startsWith("@")) continue
    const lastNewline = raw.lastIndexOf("\n")
    const lastLine = raw.slice(lastNewline + 1)
    if (lastLine !== lastLine.trimStart()) continue
    const segments = head.split(",").map((s) => s.trim())
    if (segments.includes(selector)) count += 1
  }
  return count
}

describe(".task-row-mini drag-state base rules are single source", () => {
  for (const sel of [
    '.task-row-mini[data-draggable="true"]',
    '.task-row-mini[data-dragging="true"]',
    '.task-row-mini[data-drag-over="true"]',
  ]) {
    test(`${sel} appears in exactly one top-level block`, () => {
      expect(countTopLevelRulesEndingWithSelector(sel)).toBe(1)
    })
  }
})
