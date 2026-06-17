// Regression for iter10 of the design-language audit.
//
// `.dialog-subtitle` (the small line under a modal dialog's main
// heading) was styled with tier-3 pill typography (uppercase +
// 0.05em wide letter-spacing) but has none of the pill chrome
// (no background, no border-radius, no accent color). It's a
// section subtitle, not a status chip — so the all-caps rendering
// fought the Title Case used by the surrounding dialog header.
//
// `.reasoning-label`, by contrast, is a legitimate tier-3 pill
// (pill chrome — accent-dim background + 999px radius + accent
// color) and keeps its uppercase styling. The pinned negative
// control at the bottom guards that distinction so a future
// "remove all uppercase" sweep can't quietly strip the legit pill.

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

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{[])[^{]*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`selector ${selector} not found in surface files`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".dialog-subtitle renders Title Case", () => {
  test(".dialog-subtitle does not force-uppercase", () => {
    expect(ruleBody(".dialog-subtitle")).not.toContain("text-transform: uppercase")
  })
})

describe("legitimate tier-3 pills keep uppercase (negative control)", () => {
  for (const sel of [".verdict-pill", ".req-status", ".gwg-verdict", ".reasoning-label"]) {
    test(`${sel} stays uppercase`, () => {
      expect(ruleBody(sel)).toContain("text-transform: uppercase")
    })
  }
})
