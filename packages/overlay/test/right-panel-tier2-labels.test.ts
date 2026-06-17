// Regression for the right-panel design-language audit (iter2).
//
// The right side panel mixed three typography tiers without a consistent
// rule: section titles in Title Case, tier-3 status pills (verdict-pill,
// req-type, req-status) in ALL CAPS, and a confusing middle layer of
// "field labels" inside goal cards that adopted the tier-3 pill styling
// (`text-transform: uppercase`, tiny font, wide letter-spacing) even
// though they read as section subtitles ("Objective", "Acceptance
// Criteria", "command", "runtime"). The result was the user-reported
// "design language completely inconsistent" — Goals/Files in Title Case
// vs OBJECTIVE/ACCEPTANCE CRITERIA in caps inside the same card.
//
// This test pins the tier-2 contract:
//   - .gwg-objective-label and .gwg-done-definition-label are tier-2 SECTION
//     SUBTITLES — they MUST NOT carry text-transform: uppercase. They share
//     the typography of "Goals" / "Files" so the reader sees a single
//     hierarchy.
//
// If a future change reintroduces uppercase on these classes, this test
// fails immediately so the regression is caught before the visual review.

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
// dissolved 2026-05-04 into this decomposed architecture).
const CSS = walkCss(STYLES_ROOT)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

function blockFor(selector: string): string {
  // Find the first CSS rule whose selector list STARTS with the given
  // class name (e.g. `.verdict-pill {` or `.verdict-pill,` or
  // `.verdict-pill[...]`). Anchored at line start so a descendant rule
  // like `.acceptance-panel .verdict-pill` does not steal the match.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const ruleRe = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{[])[^{]*\\{`, "m")
  const head = ruleRe.exec(CSS)
  if (!head) throw new Error(`selector ${selector} not found in surface files`)
  const open = head.index + head[0].length - 1
  const close = CSS.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return CSS.slice(open + 1, close)
}

describe("right panel tier-2 section subtitles avoid tier-3 pill styling", () => {
  test(".gwg-objective-label is rendered as a section subtitle, not a pill", () => {
    const body = blockFor(".gwg-objective-label")
    expect(body).not.toContain("text-transform: uppercase")
  })

  test(".gwg-done-definition-label is rendered as a section subtitle, not a pill", () => {
    const body = blockFor(".gwg-done-definition-label")
    expect(body).not.toContain("text-transform: uppercase")
  })
})

describe("tier-3 status pills keep their pill styling (negative control)", () => {
  test(".verdict-pill remains uppercase (verdict EMPTY/ACCEPTED/REJECTED)", () => {
    const body = blockFor(".verdict-pill")
    expect(body).toContain("text-transform: uppercase")
  })
})
