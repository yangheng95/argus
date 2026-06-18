// Regression for iter30 of the design-language audit.
//
// `.extension-row` (the row for each installed extension /
// skill / channel inside settings panels) had multiple
// stacked sources:
//
//   - line ~6551: chromed canonical — 1px var(--border),
//                 var(--radius), `--subtle-1` bg,
//                 hardcoded `8px 10px` padding.
//   - line ~9204: multi-selector card-treatment shared with
//                 .channel-doc-card / .market-card /
//                 .knowledge-item / .pref-item
//                 / .criteria-check — same border/radius/bg
//                 but token-based padding.
//   - line ~12327: !important reset shared with
//                 .criteria-group / .eval-error /
//                 .channel-doc-card / .detail-card /
//                 .config-section — sets `--surface-inset
//                 !important` bg, conflicting with canonical's
//                 `--subtle-1`. The !important wins; the
//                 canonical's bg was a lie.
//   - later theme reset chains: !important background / border /
//                 border-color changes under light, dark, and
//                 vscode-dark.
//
// Late-winning rendered bg was `--surface-inset` (from the
// !important reset at ~12327). The canonical and the
// shared-card multi-selector both declared `--subtle-1` —
// pure rule-8 violation: the source said one thing, the
// browser rendered another.
//
// Pin: canonical declares `--surface-inset` and `border: 0`
// directly (the actually-rendered values). Theme reset chains
// and local !important hover chains drop `.extension-row` from
// their selector lists — the canonical is now the single source
// for the row's chrome. Siblings in those chains keep their
// resets until they get the same single-source treatment.

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
// dissolved 2026-05-04 into this decomposed architecture). CSS comments
// are stripped first so a `/* … */` block immediately preceding a rule
// does not get folded into the rule's selector head when the test
// splits on `}` (the chunk separator does not preserve comment fences).
function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}
const STYLES = stripCssComments(
  walkCss(STYLES_ROOT)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
)

function countSoloTopLevelRules(selector: string): number {
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

describe(".extension-row base rule is a single source", () => {
  test("only one solo top-level `.extension-row { … }` rule", () => {
    expect(countSoloTopLevelRules(".extension-row")).toBe(1)
  })

  test("the canonical body declares the actually-rendered transparent background", () => {
    expect(soloRuleBody(".extension-row")).toMatch(/background:\s*transparent/)
  })

  test("the canonical body declares the actually-rendered borderless chrome", () => {
    expect(soloRuleBody(".extension-row")).toMatch(/\bborder:\s*0\s*;/)
  })

  test("no rule body using !important to set background/border still lists `.extension-row`", () => {
    // Walk every top-level rule head + body; for any rule
    // whose body uses !important on background, border, or
    // border-color, assert `.extension-row` is NOT one of
    // its selector segments. The legitimate broad
    // child-containment chain at line ~10298 (`max-width:
    // 100%`, no !important) and the :hover transition
    // chain at ~9226 (no !important) don't trip — they
    // don't carry !important.
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
      const body = chunk.slice(openIdx + 1)
      const usesChromeImportant = /(background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(
        body,
      )
      if (!usesChromeImportant) continue
      const segments = head.split(",").map((s) => s.trim())
      for (const segment of segments) {
        expect(segment).not.toMatch(/(?:^|\s|:is\([^)]*)\.extension-row(?:\b|[:.[#])/)
      }
    }
  })

  test("theme selectors cannot own `.extension-row` chrome", () => {
    for (const chunk of STYLES.split("}")) {
      const openIdx = chunk.indexOf("{")
      if (openIdx < 0) continue
      const selector = chunk.slice(0, openIdx).trim()
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:^|\s|:is\([^)]*)\.extension-row(?:\b|[:.[#])/)
    }
  })
})
