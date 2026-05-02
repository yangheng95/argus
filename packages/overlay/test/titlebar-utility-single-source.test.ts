// Regression for iter17 of the design-language audit.
//
// `.titlebar-utility` (the right cluster of the titlebar that
// holds the connection badge + status + window controls — the
// one iter6 moved the conn badge into) had two top-level rules:
//
//   line ~629:   base layout — flex container, justify-content
//                flex-end, margin-left: auto (so it pushes to
//                the right side of a flex parent).
//   line ~11623: grid placement — grid-column: 3, justify-self:
//                end, margin-left: 0 (overrides the flex-era
//                margin-left: auto now that iter14 made the
//                parent .titlebar a grid).
//
// The split made it look like the utility cluster did two
// things with two different layout assumptions. After iter14
// the parent is grid by default and only flips back to flex
// inside the narrow-width @media. Fold the two top-level rules
// into one single source so the layout intent reads in one
// place. The @media nested rules stay (they target the
// narrow-width responsive behavior).

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function countSoloTopLevelRules(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

function soloRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`solo ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".titlebar-utility is a single source of truth", () => {
  test("only one solo top-level `.titlebar-utility { … }` rule", () => {
    expect(countSoloTopLevelRules(".titlebar-utility")).toBe(1)
  })

  test("the canonical body declares both grid-column and the flex container", () => {
    // Proves the merge happened (grid-column was a separate
    // block before iter17), not just a deletion of one block.
    const body = soloRuleBody(".titlebar-utility")
    expect(body).toMatch(/grid-column:\s*3/)
    expect(body).toMatch(/display:\s*flex/)
  })

  test("the canonical does not still set margin-left: auto (the pre-iter14 flex-era value)", () => {
    // After iter14 the parent .titlebar is grid; margin-left:0
    // is the right value. margin-left:auto used to live in the
    // base flex layout block and was overridden by the grid
    // placement block. Single source means the auto is gone.
    expect(soloRuleBody(".titlebar-utility")).not.toMatch(/margin-left:\s*auto/)
  })
})
