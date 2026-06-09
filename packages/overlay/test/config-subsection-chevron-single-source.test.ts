// Regression for iter29 of the design-language audit.
//
// `.config-subsection-head::before` (the chevron indicator
// telling the operator the section is collapsible) had TWO
// disjoint implementations stacked in styles.css:
//
//   Early version (lines ~8431 + ~8438):
//     - `::before { content: "▸"; … transition: transform 120ms }`
//       — Unicode `▸` glyph + transform 120ms transition.
//     - `[open] ::before { transform: rotate(90deg) }` — rotates
//       the glyph 90deg when the details element is open.
//
//   Late version (lines ~8508 + ~8519):
//     - `::before { content: ""; width 6px; height 6px;
//                  border-right 1.5px; border-bottom 1.5px;
//                  transform: rotate(-45deg) translateY(-1px) }`
//       — CSS-drawn chevron via 1.5px borders.
//     - `[open] ::before { transform: rotate(45deg) translateY(-1px) }`
//       — rotates the box from pointing-right to pointing-down.
//
// They are mutually exclusive treatments. The late version
// fully shadows the early one (its `content: ""` empties the
// `▸` glyph, its width/height/border declarations override
// the font-size/color of the early block, and its [open]
// transform overrides the early rotate(90deg)). The early
// version is pure dead code — same specificity-shadowed
// pattern collapsed in iter5 / iter14 / iter17 / iter20 /
// iter25 / iter26 / iter27.
//
// Pin: ONE solo top-level `.config-subsection-head::before`
// rule and ONE solo top-level
// `.config-subsection[open] > .config-subsection-head::before`
// rule.

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

function countSoloTopLevelRules(selector: string): number {
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
    if (head === selector) count += 1
  }
  return count
}

describe(".config-subsection chevron pseudo-element is a single source", () => {
  test("only one solo top-level `.config-subsection-head::before { … }` rule", () => {
    expect(countSoloTopLevelRules(".config-subsection-head::before")).toBe(1)
  })

  test("only one solo top-level `[open] > .config-subsection-head::before` rule", () => {
    expect(countSoloTopLevelRules(".config-subsection[open] > .config-subsection-head::before")).toBe(1)
  })

  test("the surviving canonical uses the CSS-drawn chevron (not the Unicode ▸ glyph)", () => {
    // Walk the surviving block and confirm it sets
    // `content: ""` (empty) + border-right + border-bottom
    // — the geometric chevron, not the Unicode glyph the
    // dead block declared.
    const idx = STYLES.indexOf(".config-subsection-head::before")
    expect(idx).toBeGreaterThan(-1)
    const open = STYLES.indexOf("{", idx)
    const close = STYLES.indexOf("}", open)
    const body = STYLES.slice(open + 1, close)
    expect(body).toMatch(/content:\s*""/)
    expect(body).toMatch(/border-right:/)
    expect(body).toMatch(/border-bottom:/)
    expect(body).not.toMatch(/content:\s*"▸"/)
  })
})
