// Regression for iter15 of the design-language audit, refreshed for
// the 2026-05-04 container-shell theme-override retirement.
//
// Original iter15 fix retired four duplicate `.sections` rules in
// styles.css and pinned a single canonical with no `!important`. The
// 2026-05-04 slice migrated that canonical out of styles.css entirely:
// the right-column container shell now lives in
// `src/styles/surfaces/inspector.css`, and the `body[data-theme]`
// background overrides that used to repaint it are gone (palette
// tokens — `--inspector-surface` differs per theme — drive the
// rendering without selectors). The `.sidebar, .chat, .sections`
// `!important` flat-reset chains are also gone.
//
// Pin the new contract:
// - styles.css must NOT define `.sections` at all (single-source in
//   surfaces/inspector.css).
// - surfaces/inspector.css declares exactly one solo top-level
//   `.sections { … }` rule with no `!important`.
// - The legacy `.sidebar, .chat, .sections { … !important }` reset
//   chain remains absent.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const INSPECTOR_SURFACE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "inspector.css"),
  "utf8",
)

function countSoloTopLevelRules(text: string, selector: string): number {
  // Solo top-level rules only — no leading whitespace, no
  // theme prefix (`body[data-theme]`), no multi-selector list.
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

describe(".sections is a single source of truth", () => {
  test("styles.css no longer defines `.sections` at all (migrated to surfaces/inspector.css)", () => {
    expect(countSoloTopLevelRules(STYLES, ".sections")).toBe(0)
  })

  test("surfaces/inspector.css declares exactly one solo top-level `.sections { … }` rule", () => {
    expect(countSoloTopLevelRules(INSPECTOR_SURFACE, ".sections")).toBe(1)
  })

  test("the canonical `.sections` body uses no `!important`", () => {
    expect(soloRuleBody(INSPECTOR_SURFACE, ".sections")).not.toContain("!important")
  })

  test("`.sections` is no longer riding on `.sidebar, .chat, .sections { … !important }` flat resets", () => {
    expect(STYLES).not.toMatch(/\.sidebar,[\s\n]*\.chat,[\s\n]*\.sections\s*\{[^}]*!important/)
  })
})
