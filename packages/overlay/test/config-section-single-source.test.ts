// Regression for iter33 of the design-language audit.
//
// `.config-section` (the outer collapsible container of every
// settings sub-panel — Providers / Channels / SkillMarket /
// AgentModels / etc.) had the same dual-source-with-late-
// override pattern collapsed in iter28 (.config-subsection)
// and iter30 (.extension-row):
//
//   - line ~8287: canonical — 1px var(--border),
//                 var(--section-corner) radius, `--subtle-1`
//                 bg, no shadow, transition.
//   - line ~12362: !important reset shared with .section /
//                 .gwg / .delivery-panel / .criteria-group /
//                 .eval-error / .channel-doc-card /
//                 .detail-card — `var(--surface-inset)
//                 !important` bg overriding the canonical's
//                 `--subtle-1`. Different bg colors. Late
//                 winner; canonical lied.
//
// Pin: canonical declares `--surface-inset` and `border: 0`
// directly (the actually-rendered values). Theme reset chains
// and local important chains drop `.config-section` from their
// selector lists. Other siblings in those chains keep the reset
// until each gets its own single-source pass.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")

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

describe(".config-section base rule is a single source", () => {
  test("only one solo top-level `.config-section { … }` rule", () => {
    expect(countSoloTopLevelRules(".config-section")).toBe(1)
  })

  test("the canonical body declares the actually-rendered `--surface-inset` background", () => {
    expect(soloRuleBody(".config-section")).toMatch(
      /background:\s*[\s\S]*?var\(--surface-inset\)/,
    )
  })

  test("the canonical body declares the actually-rendered borderless chrome", () => {
    expect(soloRuleBody(".config-section")).toMatch(/\bborder:\s*0\s*;/)
  })

  test("no rule body using !important on chrome still lists `.config-section`", () => {
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
      if (!/(background|border|border-color|border-radius|box-shadow):[^;]*!important/.test(body)) continue
      const segments = head.split(",").map((s) => s.trim())
      for (const segment of segments) {
        expect(segment).not.toMatch(/(?:^|\s|:is\([^)]*)\.config-section(?:\b|[:.[#])/)
      }
    }
  })

  test("theme selectors cannot own `.config-section` chrome", () => {
    for (const chunk of STYLES.split("}")) {
      const openIdx = chunk.indexOf("{")
      if (openIdx < 0) continue
      const selector = chunk.slice(0, openIdx).trim()
      const isThemeSelector =
        /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:^|\s|:is\([^)]*)\.config-section(?:\b|[:.[#])/)
    }
  })
})
