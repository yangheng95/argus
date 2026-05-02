// Regression for iter14 of the design-language audit.
//
// `.titlebar` was defined three times in styles.css:
//
//   - line ~382:  the canonical block — flex layout, 12px gap, 8/12px
//                 padding, 48px min-height, gradient + chrome bg,
//                 12px-deep box-shadow, transparent bottom-border.
//   - line ~11597: layout switcher — flips display from flex to
//                 grid with a 3-column template (titlebar-left /
//                 spacer / titlebar-utility).
//   - line ~12149: calm/flat override — clobbers padding,
//                 min-height, background, box-shadow, gap with
//                 !important so the titlebar drops the gradient
//                 and the deep shadow.
//
// Same dual-source-with-late-override anti-pattern collapsed for
// `.chat-empty` in iter5 and `.sidebar-list-heading` in iter8.
// Reading just the canonical block left a contributor convinced
// the titlebar still had a 12px shadow and a gradient; touching
// any of the three sites silently lost to the !important chain.
//
// Pin a single source: one canonical `.titlebar { … }` rule with
// no `!important`. Layout (display: grid, grid-template-columns)
// + chrome (background, border, shadow) live together.
//
// Companion cleanup: iter6 deleted the `<span class="brand-name">`
// from index.html. The `.brand-name` selector survived in a
// multi-selector rule (`.brand-name, .sections-title, …`) and is
// now dead CSS per CLAUDE.md rule 16. Drop it.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const HTML = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "index.html"),
  "utf8",
)

function countRulesStartingWith(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Top-level rules only (no leading indentation) so @media-nested
  // rules don't trip the count. Each top-level dual definition is
  // a rule-8 violation; @media-nested overrides at narrow widths
  // are legitimate per-context tweaks (consolidated separately).
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`selector ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".titlebar is defined exactly once", () => {
  test("only one top-level `.titlebar { … }` rule exists", () => {
    expect(countRulesStartingWith(".titlebar")).toBe(1)
  })

  test("the canonical .titlebar body uses no `!important`", () => {
    expect(ruleBody(".titlebar")).not.toContain("!important")
  })

  test("the canonical .titlebar carries the grid layout (so the layout switcher block is gone)", () => {
    expect(ruleBody(".titlebar")).toContain("display: grid")
  })
})

describe(".brand-name is dead CSS after iter6 and removed", () => {
  test("`<span class=\"brand-name\">` is gone from index.html (iter6 contract still holds)", () => {
    expect(HTML).not.toMatch(/class=["']brand-name["']/)
  })

  test("no styles.css selector still references `.brand-name`", () => {
    // Allow a `.brand-name` substring inside comments (so the
    // historical comment that explains why the class is gone
    // can survive). Forbid only an actual selector token —
    // `.brand-name {` or `.brand-name,` or `.brand-name {whitespace`.
    const selectorRe = /\.brand-name(?=[\s,{:.\[])/
    // Strip CSS comments before checking so doc-only mentions
    // of the historical class do not trip the regression.
    const stripped = STYLES.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(stripped).not.toMatch(selectorRe)
  })
})
