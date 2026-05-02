// Regression for iter17 of the design-language audit.
//
// User feedback (2026-05-02 22:57): "把输入框的圆角也去掉" —
// also drop the rounded corners on the chat composer input.
//
// `.chat-input` (the container around the chat composer textarea
// + the icon column + the send button) had three top-level
// rules with conflicting values for border-radius / margin /
// padding / background / box-shadow:
//
//   line ~5236: canonical full-chrome — 16px radius (`calc(20px
//                * --ui-scale * --chat-compose-scale)` with the
//                local scale 0.8), gradient bg, drop shadow,
//                a `::before` gradient overlay.
//   line ~12476: override that switched scale to 1, padding +
//                margin tweaks, set `border-radius: var(--panel-
//                radius)` (= 10px), background !important,
//                box-shadow: none !important.
//   line ~12963: another override — margin/padding/background
//                !important + border-color tweak. Plus a
//                `:focus-within` block setting accent border.
//
// Same dual-source-with-!important anti-pattern as `.chat-empty`
// (iter5), `.titlebar` (iter14), `.sections` (iter15), `.sidebar
// + .chat` (iter16). The canonical lied about the radius (16px
// in source, 10px rendered). Reading any one block told you a
// different story.
//
// Pin a single source: one canonical `.chat-input { … }` rule
// with `border-radius: 0` (the user-requested flat input), no
// `!important`, the ::before decorative gradient gone too (the
// flat input has no shape to overlay). The :focus-within state
// keeps an accent border ring as the lone visible affordance.

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

describe(".chat-input is a single flat source", () => {
  test("only one solo top-level `.chat-input { … }` rule", () => {
    expect(countSoloTopLevelRules(".chat-input")).toBe(1)
  })

  test("the canonical body uses no `!important`", () => {
    expect(soloRuleBody(".chat-input")).not.toContain("!important")
  })

  test("the canonical declares `border-radius: 0` (per user request, no rounded corners)", () => {
    const body = soloRuleBody(".chat-input")
    // Allow either `border-radius: 0` or `border-radius: 0px`
    // — both render the same flat corner.
    expect(body).toMatch(/border-radius:\s*0(?:px)?\s*;/)
  })

  test("no `.chat-input::before` decorative gradient survives", () => {
    // The ::before pseudo painted a radial gradient overlay
    // tied to the rounded shell. With border-radius: 0 the
    // overlay no longer makes visual sense and was removed
    // along with the shell.
    expect(STYLES).not.toMatch(/\n\.chat-input::before\s*\{/)
  })
})
