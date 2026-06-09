// Regression for iter5 of the design-language audit.
//
// The placeholder shown when a task has no messages yet
// ("Conversation updates will appear here") used to be styled by
// THREE separate `.chat-empty {}` blocks in styles.css:
//
//   - styles.css:4418 — the original rich treatment: gradient + drop
//     shadow, 220px min-height, 24px border-radius, 1px border.
//   - styles.css:12715 — !important override #1: padding/border/
//     border-radius/background/box-shadow all knocked out so the
//     card chrome flattens away.
//   - styles.css:12896 — !important override #2: min-height shrinks
//     to 150px and opacity drops to 0.9.
//
// This is exactly the anti-pattern the existing comment at
// styles.css:12741 says was fixed for `.empty-hint` ("the empty-hint
// vocabulary used to be defined twice … merged into the original
// block above so there's one source of truth and no !important
// hacks"). The same fix never made it to `.chat-empty`. Specificity
// wars + !important make the placeholder a moving target whenever
// anyone touches one of the three sites.
//
// CLAUDE.md rule 8 (no dual source) and rule 9 (extract patterns):
// merge the three blocks into one and pin the contract here so
// future contributors can't reintroduce the override stack.

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

function countRulesStartingWith(selector: string): number {
  // Count CSS rules whose selector list STARTS with the exact class
  // (so descendant or modifier rules like `.chat-empty--task`,
  // `.chat-empty .chat-empty-icon`, `body[data-theme] .chat-empty`,
  // `@media (...) .chat-empty` don't count). Anchored at line start
  // because dual-source duplicates are always top-level rules.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Selector must be the entire selector list head — followed by
  // whitespace then `{` (no comma, no descendant combinator).
  const re = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

describe(".chat-empty placeholder is defined exactly once", () => {
  test("only one `.chat-empty { … }` rule exists", () => {
    expect(countRulesStartingWith(".chat-empty")).toBe(1)
  })

  test("no `!important` overrides leak into the .chat-empty block", () => {
    // Find the one canonical block and assert it does NOT use
    // `!important` to clobber an earlier definition. With a single
    // source there's nothing to clobber.
    const head = /(^|\n)\s*\.chat-empty\s*\{/m.exec(STYLES)
    expect(head).not.toBeNull()
    const open = head!.index + head![0].length - 1
    const close = STYLES.indexOf("}", open)
    const body = STYLES.slice(open + 1, close)
    expect(body).not.toContain("!important")
  })
})
