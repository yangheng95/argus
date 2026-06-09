// Regression for iter28 of the design-language audit.
//
// `.config-subsection` (the collapsible group inside settings
// panels — Providers / Channels / SkillMarket / etc.) had three
// top-level rules in styles.css:
//
//   - line ~8379: chromed canonical — 1px border, --section-corner
//                 radius (= var(--radius)), --surface-inset bg,
//                 no shadow, transitions for hover.
//   - line ~12331: multi-selector reset shared with .extension-row,
//                 .channel-doc-card, .detail-card, .config-section
//                 — `background / border / border-radius /
//                 box-shadow !important` re-asserting the same
//                 values the canonical already declared. Pure
//                 rule-9 copy-paste.
//   - line ~13020: multi-selector with the same siblings —
//                 `border-color: var(--border) !important` re-
//                 asserting the canonical's border value. Pure
//                 rule-9 copy-paste.
//
// Both !important multi-selector blocks set the SAME values the
// canonical already produces (--surface-inset bg, var(--radius) ≡
// var(--section-corner) radius, var(--border) border). So the
// !important chain only existed to insure against some other rule
// trying to override the canonical — but with the canonical now
// the single source of truth, nothing remains to override.
//
// Pin: ONE solo top-level rule for `.config-subsection`.
// Canonical owns `border: 0` directly after the theme reset
// extraction. Theme-scoped overrides
// (`body[data-theme="..."] .config-subsection`) are not legitimate
// palette tweaks anymore because they were changing container
// chrome instead of root palette tokens.

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
  // SOLO rules only — head equals the selector exactly, no
  // multi-selector siblings. Legitimate shared-treatment lists
  // like `.sidebar, .chat, …, .config-subsection, … { contain:
  // … }` (broad child-containment policy applied to many panel
  // shells) don't count as a `.config-subsection` source —
  // they don't override the canonical's chrome, just add a
  // containment property the canonical doesn't touch.
  let count = 0
  for (const chunk of STYLES.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const raw = chunk.slice(0, openIdx)
    const head = raw.trim()
    if (!head) continue
    if (head.startsWith("body")) continue
    if (head.startsWith("@")) continue
    const lastNewline = raw.lastIndexOf("\n")
    const lastLine = raw.slice(lastNewline + 1)
    if (lastLine !== lastLine.trimStart()) continue
    if (head === selector) count += 1
  }
  return count
}

function soloRuleBody(selector: string): string {
  for (const chunk of STYLES.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const raw = chunk.slice(0, openIdx)
    const head = raw.trim()
    if (head !== selector) continue
    const lastNewline = raw.lastIndexOf("\n")
    const lastLine = raw.slice(lastNewline + 1)
    if (lastLine !== lastLine.trimStart()) continue
    return chunk.slice(openIdx + 1)
  }
  throw new Error(`solo ${selector} not found`)
}

describe(".config-subsection base rule is a single source", () => {
  test("only one solo top-level `.config-subsection { … }` rule", () => {
    expect(countSoloTopLevelRules(".config-subsection")).toBe(1)
  })

  test("the canonical body declares the actually-rendered borderless chrome", () => {
    expect(soloRuleBody(".config-subsection")).toMatch(/\bborder:\s*0\s*;/)
  })

  test("no rule body that re-asserts canonical chrome via !important still lists `.config-subsection`", () => {
    // Direct substring check: the two reset chains used to
    // be `…,\n.config-section,\n.config-subsection {` and
    // `…,\n.detail-card,\n.config-subsection {`. After
    // iter28 dropped `.config-subsection` from those lists,
    // those exact line patterns must not appear anywhere
    // in styles.css.
    expect(STYLES).not.toMatch(/\.config-section,[\s\n]*\.config-subsection\s*\{[^}]*!important/)
    expect(STYLES).not.toMatch(/\.detail-card,[\s\n]*\.config-subsection\s*\{[^}]*!important/)
  })

  test("theme selectors cannot own `.config-subsection` chrome", () => {
    for (const chunk of STYLES.split("}")) {
      const openIdx = chunk.indexOf("{")
      if (openIdx < 0) continue
      const selector = chunk.slice(0, openIdx).trim()
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:^|\s|:is\([^)]*)\.config-subsection(?:\b|[:.[#])/)
    }
  })
})
