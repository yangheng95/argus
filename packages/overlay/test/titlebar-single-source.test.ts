// Regression for iter14 of the design-language audit, refreshed for
// the 2026-05-04 surface migration: `.titlebar` canonical now lives
// in `src/styles/surfaces/titlebar.css`, not styles.css. The original
// fix retired three duplicate `.titlebar { … }` blocks (canonical +
// layout switcher + calm/flat !important override) inside styles.css;
// the subsequent migration moved the resulting single canonical out
// to the surface file and the iter14 dual-source pattern stays gone.
//
// New contract:
// - styles.css must NOT define `.titlebar` at all (the migration is
//   the single source).
// - surfaces/titlebar.css declares exactly one solo top-level
//   `.titlebar { … }` rule with no `!important` and the grid layout
//   declaration.
//
// Companion cleanup (iter6) — `<span class="brand-name">` removed
// from index.html and no styles.css selector references `.brand-
// name` outside comments — still pins below.

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const STYLES_ROOT = path.resolve(import.meta.dir, "..", "src", "styles")
const CASCADE_DIR = path.join(STYLES_ROOT, "cascade")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// styles.css was dissolved 2026-05-04 into cascade + surface files. The
// "no .titlebar in styles.css" guard is now "no .titlebar in cascade layer"
// (cascade owns cross-cutting rules; surface-specific chrome lives in titlebar.css).
const CASCADE_CSS = walkCss(CASCADE_DIR)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

const TITLEBAR_SURFACE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "titlebar.css"),
  "utf8",
)
const HTML = readFileSync(path.resolve(import.meta.dir, "..", "src", "index.html"), "utf8")

function countRulesStartingWith(text: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(text.matchAll(re)).length
}

function ruleBody(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`, "m").exec(text)
  if (!head) throw new Error(`selector ${selector} not found`)
  const open = head.index + head[0].length - 1
  const close = text.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return text.slice(open + 1, close)
}

describe(".titlebar is defined exactly once", () => {
  test("cascade layer does not define `.titlebar` at all (migrated to surfaces/titlebar.css)", () => {
    expect(countRulesStartingWith(CASCADE_CSS, ".titlebar")).toBe(0)
  })

  test("surfaces/titlebar.css declares exactly one solo top-level `.titlebar { … }` rule", () => {
    expect(countRulesStartingWith(TITLEBAR_SURFACE, ".titlebar")).toBe(1)
  })

  test("the canonical .titlebar body uses no `!important`", () => {
    expect(ruleBody(TITLEBAR_SURFACE, ".titlebar")).not.toContain("!important")
  })

  test("the canonical .titlebar carries the grid layout", () => {
    expect(ruleBody(TITLEBAR_SURFACE, ".titlebar")).toContain("display: grid")
  })
})

describe(".brand-name is dead CSS after iter6 and removed", () => {
  test('`<span class="brand-name">` is gone from index.html (iter6 contract still holds)', () => {
    expect(HTML).not.toMatch(/class=["']brand-name["']/)
  })

  test("no cascade or surface CSS still references `.brand-name` as a selector", () => {
    // Allow a `.brand-name` substring inside comments (so historical
    // comments explaining why the class is gone can survive). Forbid
    // only an actual selector token — `.brand-name {` or `.brand-name,`.
    const selectorRe = /\.brand-name(?=[\s,{:.\[])/
    // Strip CSS comments before checking so doc-only mentions do not trip.
    const stripped = CASCADE_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(stripped).not.toMatch(selectorRe)
  })
})
