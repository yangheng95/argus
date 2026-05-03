// Regression for iter17 of the design-language audit, refreshed for
// the 2026-05-04 surface migration: `.titlebar-utility` canonical
// migrated from styles.css to `src/styles/surfaces/titlebar.css`. The
// iter17 fix retired two top-level rules in styles.css (a flex base +
// a grid-placement override); the migration kept the merged single
// source and moved it to the surface file. This guard now reads the
// canonical from its new home.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const TITLEBAR_SURFACE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "titlebar.css"),
  "utf8",
)

function countSoloTopLevelRules(text: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(text.matchAll(re)).length
}

function soloRuleBody(text: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(text)
  if (!head) throw new Error(`solo ${selector} not found`)
  const open = head.index + head[0].length - 1
  const close = text.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return text.slice(open + 1, close)
}

describe(".titlebar-utility is a single source of truth", () => {
  test("styles.css no longer defines `.titlebar-utility` at all (migrated to surfaces/titlebar.css)", () => {
    expect(countSoloTopLevelRules(STYLES, ".titlebar-utility")).toBe(0)
  })

  test("surfaces/titlebar.css declares exactly one solo top-level `.titlebar-utility { … }` rule", () => {
    expect(countSoloTopLevelRules(TITLEBAR_SURFACE, ".titlebar-utility")).toBe(1)
  })

  test("the canonical body declares both grid-column and the flex container", () => {
    const body = soloRuleBody(TITLEBAR_SURFACE, ".titlebar-utility")
    expect(body).toMatch(/grid-column:\s*3/)
    expect(body).toMatch(/display:\s*flex/)
  })

  test("the canonical does not still set margin-left: auto (the pre-iter14 flex-era value)", () => {
    expect(soloRuleBody(TITLEBAR_SURFACE, ".titlebar-utility")).not.toMatch(/margin-left:\s*auto/)
  })
})
