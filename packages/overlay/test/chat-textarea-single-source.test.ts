// Regression for iter20 of the design-language audit.
//
// `.chat-textarea` (the textarea inside the chat composer)
// was defined six times in styles.css with conflicting values:
//
//   line ~5462: canonical full-chrome — 16px radius, gradient
//                bg, accent shadow, 72px min-height, transition.
//   line ~12490: multi-selector with .chat-textarea-wrap setting
//                min-height: 64px.
//   line ~12494: !important override — border-radius var(--radius)
//                (~10px), border-color tweak, background and
//                box-shadow !important.
//   line ~12713: another multi-selector min-height: 68px.
//   line ~12965: background !important (color-mix --bg 72%).
//   line ~12970: another multi-selector min-height: 62px.
//
// Same dual-source-with-late-override anti-pattern as
// `.chat-empty` (iter5), `.titlebar` (iter14), `.sections`
// (iter15), `.sidebar + .chat` (iter16), `.chat-input` (iter17).
// The canonical lied about radius (16px in source, 10px
// rendered) and min-height (72px in source, 62px rendered).
//
// Visual consequence: after iter17 made `.chat-input` flat
// (border-radius: 0), the inner textarea still rendered with
// a second late-overridden radius. The UX pass keeps the composer shell
// flat in the dock, but lets the actual editable field carry the canonical
// soft radius so focus chrome reads as one deliberate input surface.
//
// Pin: one canonical `.chat-textarea` rule with
// `border-radius: var(--oc-radius-soft)`, no `!important`, the
// post-UX-pass treatment baked in. Sibling multi-selector min-height
// helpers consolidate to one too (last value wins anyway).

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

describe(".chat-textarea is a single composer input source", () => {
  test("only one solo top-level `.chat-textarea { … }` rule", () => {
    expect(countSoloTopLevelRules(".chat-textarea")).toBe(1)
  })

  test("the canonical body uses no `!important`", () => {
    expect(soloRuleBody(".chat-textarea")).not.toContain("!important")
  })

  test("the canonical declares the shared soft radius token", () => {
    expect(soloRuleBody(".chat-textarea")).toMatch(/border-radius:\s*var\(--oc-radius-soft\)\s*;/)
  })

  test("no theme override owns .chat-textarea radius", () => {
    // CRON lesson from iter17: theme-scoped overrides quietly
    // forced a non-zero radius back. Walk every theme-scoped
    // .chat-textarea rule body and assert none of them
    // declare a non-zero border-radius.
    const headRe = /(^|\n)body[^{]*?\.chat-textarea(?![-\w])(?::[a-z-]+)?\s*\{/g
    for (const match of STYLES.matchAll(headRe)) {
      const open = match.index + match[0].length - 1
      const close = STYLES.indexOf("}", open)
      const body = STYLES.slice(open + 1, close)
      expect(body).not.toMatch(/border-radius\s*:/)
    }
  })

  test(".chat-textarea-wrap min-height matches the textarea so the wrap doesn't render taller than its child", () => {
    // CRON self-audit on iter20: collapsing the shared
    // `.chat-textarea-wrap, .chat-textarea { min-height: ... }`
    // chain only updated the textarea side. The wrap's
    // canonical kept declaring 72px and rendered ~10px
    // taller than its inner textarea — a silent layout
    // regression. Pin both at the same value so the wrap is
    // flush with the textarea.
    //
    // The 62px floor was later promoted to a CSS variable
    // (`--chat-textarea-height` in surfaces/composer.css), so we accept
    // either the literal `calc(62px * var(--ui-scale))` or the
    // variable reference here. The actual single-source invariant is
    // that the wrap reads the *same* value the textarea does — the
    // assertion below verifies they match instead of hardcoding the
    // numeric floor in two test files.
    const wrapBody = soloRuleBody(".chat-textarea-wrap")
    const textareaBody = soloRuleBody(".chat-textarea")
    const extractMinHeight = (body: string) => {
      const m = body.match(/min-height:\s*([^;]+);/)
      return m ? m[1]!.trim() : null
    }
    const wrapMinHeight = extractMinHeight(wrapBody)
    const textareaMinHeight = extractMinHeight(textareaBody)
    expect(wrapMinHeight).not.toBeNull()
    expect(wrapMinHeight).toBe(textareaMinHeight)
  })
})
