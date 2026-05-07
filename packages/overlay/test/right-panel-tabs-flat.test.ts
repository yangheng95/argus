// Regression for iter18 of the design-language audit.
//
// User feedback (2026-05-02 22:57): "右侧面板也有个圆角" — the
// right panel also has a rounded corner. Following iter15 which
// made the `.sections` shell flat, the inner tab-list pill and
// individual tab pills still rendered as rounded chips. With the
// flat shell around them the rounded chips read as a bolted-on
// island, not as part of the same surface.
//
// Drop both radii so the tablist sits flush with its container
// and the tabs read as plain text affordances. The active tab
// keeps its accent border + accent-tinted background so the
// active state is still visible — just on a flat rectangle now.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "primitives", "tabs.css"),
  "utf8",
)

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`solo ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe("right-panel tabs are flat (no rounded corners)", () => {
  test(".oc-tabs drops border-radius", () => {
    const body = ruleBody(".oc-tabs")
    // Either explicit border-radius: 0 or no border-radius at all.
    expect(body).not.toMatch(/border-radius:\s*(?!0)\S/)
  })

  test(".oc-tab explicitly stays square", () => {
    const body = ruleBody(".oc-tab")
    expect(body).toMatch(/border-radius:\s*0\b/)
  })
})
