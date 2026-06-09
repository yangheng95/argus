// Regression for iter16 of the design-language audit.
//
// `.sidebar` and `.chat` (the left column and middle column of
// the overlay's three-column layout) had the same dual-source
// pattern iter15 cleaned up for `.sections`:
//
//   .sidebar — canonical at line ~9398 with full chrome (border,
//              radius, --surface bg, --shadow), then a
//              .sidebar, .chat { … !important } reset around
//              line ~12249 that knocked out background / border /
//              radius / box-shadow, then a .sidebar { background:
//              var(--rail-surface) !important } at line ~12783,
//              then yet another .sidebar, .chat reset at line
//              ~12795. Plus a .sidebar:hover, .chat:hover, … flat
//              reset around line ~12257.
//
//   .chat    — canonical at line ~3831 with the same chrome,
//              then the same multi-selector !important resets
//              that overrode it to flat with var(--chat-canvas)
//              bg.
//
// Same anti-pattern as `.titlebar` (iter14) and `.sections`
// (iter15). Reading the canonical block left a contributor
// convinced the column had a border + shadow + transition; the
// rendered visual was actually flat. Tweaks at the canonical
// silently lost to the late !important chain.
//
// Pin a single source for both: one canonical `.sidebar { … }`
// and one canonical `.chat { … }`, both flat (no border, no
// shadow, no hover chrome), with the right per-column
// background token (--rail-surface for sidebar, --chat-canvas
// for chat) baked into the canonical. Theme-scoped overrides
// (`body[data-theme="..."] .sidebar { … }`) stay legitimate.

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

describe(".sidebar is a single source of truth", () => {
  test("only one solo top-level `.sidebar { … }` rule", () => {
    expect(countSoloTopLevelRules(".sidebar")).toBe(1)
  })

  test("the canonical body uses no `!important`", () => {
    expect(soloRuleBody(".sidebar")).not.toContain("!important")
  })
})

describe(".chat is a single source of truth", () => {
  test("only one solo top-level `.chat { … }` rule", () => {
    expect(countSoloTopLevelRules(".chat")).toBe(1)
  })

  test("the canonical body uses no `!important`", () => {
    expect(soloRuleBody(".chat")).not.toContain("!important")
  })
})

describe("`.sidebar, .chat { … !important }` reset chains are gone", () => {
  test("no top-level multi-selector flat reset still rides .sidebar + .chat", () => {
    // The flat resets used to spell out
    // `.sidebar,\n.chat { … !important }` near the file tail.
    // With both canonicals already flat, no chain should still
    // clobber them.
    expect(STYLES).not.toMatch(/\n\.sidebar,[\s\n]*\.chat\s*\{[^}]*!important/)
  })
})

describe("hover/focus chrome on the shell columns is gone", () => {
  // CRON self-audit on iter16 caught a leftover `.chat:hover,
  // .chat:focus-within { border-color, gradient, shadow }`
  // rule near line ~3851 that would have re-introduced gradient
  // chrome on hover the moment the !important resets were
  // removed. The symmetric `.sidebar:hover` block was deleted
  // in iter16 itself; this one was missed. Pin both so a
  // future contributor can't reintroduce the regression.
  test("no top-level `.chat:hover` rule reintroduces gradient or border chrome", () => {
    // A top-level `.chat:hover { … }` block is forbidden. Theme-
    // scoped blocks (`body[data-theme="..."] .chat:hover { … }`)
    // also caused dead-override leaks (canonical has no border /
    // shadow to override) so they got removed too — assert that.
    expect(STYLES).not.toMatch(/\n\.chat:hover\b/)
  })

  test("no top-level `.sidebar:hover` rule reintroduces chrome either", () => {
    expect(STYLES).not.toMatch(/\n\.sidebar:hover\b/)
  })
})
