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
// Pin: ONE solo top-level rule for `.config-subsection`. The two
// multi-selector partner blocks keep their other siblings
// (.extension-row, .channel-doc-card, .detail-card, .config-section)
// — those iters are scoped separately. Theme-scoped overrides
// (`body[data-theme="..."] .config-subsection`) stay legitimate
// per-context palette tweaks.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")

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

describe(".config-subsection base rule is a single source", () => {
  test("only one solo top-level `.config-subsection { … }` rule", () => {
    expect(countSoloTopLevelRules(".config-subsection")).toBe(1)
  })

  test("no rule body that re-asserts canonical chrome via !important still lists `.config-subsection`", () => {
    // Direct substring check: the two reset chains used to
    // be `…,\n.config-section,\n.config-subsection {` and
    // `…,\n.detail-card,\n.config-subsection {`. After
    // iter28 dropped `.config-subsection` from those lists,
    // those exact line patterns must not appear anywhere
    // in styles.css.
    expect(STYLES).not.toMatch(
      /\.config-section,[\s\n]*\.config-subsection\s*\{[^}]*!important/,
    )
    expect(STYLES).not.toMatch(
      /\.detail-card,[\s\n]*\.config-subsection\s*\{[^}]*!important/,
    )
  })
})
