// Regression for iter7 of the design-language audit.
//
// `.field-label` is the form-label primitive used across every
// settings panel (Providers, AgentModels, Channels, SkillMarket,
// PromptCatalog, General). It carried `text-transform: uppercase`
// + `letter-spacing: 0.08em` (via the --subhead-track token), which
// force-uppercased every form label across Settings — "Server URL"
// rendered as "SERVER URL", "API Key" as "API KEY", etc — even
// though the i18n strings are already Title Case. Same anti-pattern
// the iter4 sweep removed from `.btn`, just one tier deeper.
//
// One existing theme block (line ~11955) already overrides
// `--subhead-track` to 0, which strongly hints the design intent
// is Title Case across themes; the global `text-transform: uppercase`
// fights that intent and produces TitleCase-but-LOOKS-LIKE-CAPS.
//
// Tier-3 status chips (req-type, req-status, gwg-verdict,
// verdict-pill, …) keep their own uppercase styling — those ARE
// short single-word color-coded pills, the convention reads as a
// status tag.

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

describe(".field-label is rendered in Title Case", () => {
  test(".field-label does NOT force-uppercase its text", () => {
    const body = ruleBody(".field-label")
    expect(body).not.toContain("text-transform: uppercase")
  })
})

describe("tier-3 status pills keep uppercase (negative control)", () => {
  for (const sel of [".req-type", ".req-status", ".verdict-pill", ".gwg-verdict"]) {
    test(`${sel} stays uppercase`, () => {
      expect(ruleBody(sel)).toContain("text-transform: uppercase")
    })
  }
})
