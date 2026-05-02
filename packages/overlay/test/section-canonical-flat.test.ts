// Regression for iter40 — finishing the iter28/30/33/36 single-
// source pass for `.section` (the inner collapsible card
// primitive in the right-panel section column). iter15 already
// flattened `.sections` (plural — the outer container); this
// iter aligns the inner card canonical with the actually-
// rendered flat values forced by the !important reset chain
// at line ~12449 of styles.css.
//
// Pre-iter40 the canonical at line ~2290 declared:
//   - gradient + --surface tinted bg
//   - 14px border-radius
//   - drop-shadow (`inset highlight + 8px blur`)
//   - rich chrome that NEVER rendered.
//
// The reset chain forced `--surface-inset` bg, `var(--radius)`
// (≈10px) radius, `box-shadow: none`. Same active rule-8
// conflict iter28/30/33/36 collapsed for the other shells.
//
// Pin: canonical declares the actually-rendered flat values
// directly. `.section` drops out of the !important reset
// chain, leaving only 4 remaining shells in that chain.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")

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

describe(".section canonical matches the actually-rendered flat chrome", () => {
  test("canonical body declares --surface-inset background", () => {
    expect(soloRuleBody(".section")).toMatch(
      /background:\s*var\(--surface-inset\)/,
    )
  })

  test("canonical body uses var(--radius) (≈10px), not the dead 14px chrome value", () => {
    const body = soloRuleBody(".section")
    expect(body).not.toMatch(/border-radius:\s*calc\(14px/)
  })

  test("canonical body does NOT declare the dead drop-shadow chrome", () => {
    const body = soloRuleBody(".section")
    expect(body).not.toMatch(/box-shadow:[^;]*8px[^;]*18px/)
  })
})

describe("`.section` no longer rides the !important shell reset chain", () => {
  test("no top-level !important-bg rule still lists `.section`", () => {
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
      if (!/background:[^;]*!important/.test(body)) continue
      const segments = head.split(",").map((s) => s.trim())
      expect(segments).not.toContain(".section")
    }
  })
})
