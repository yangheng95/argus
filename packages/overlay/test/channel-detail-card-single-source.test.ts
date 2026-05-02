// Regression for iter36 — finishing the iter28 / iter30 / iter33
// single-source pass for the last two siblings still in the
// `var(--surface-inset) !important` reset chain at line ~12428
// of styles.css and the `border-color: var(--border) !important`
// reset at ~13122:
//
//   .channel-doc-card  (channel docs / install panel cards)
//   .detail-card       (settings detail cards used by Memory /
//                       Knowledge / Skills detail panels)
//
// Both canonicals (lines ~6790 and ~6300) declared
// `background: var(--subtle-1)`, while the !important reset
// forced `var(--surface-inset)` over them. Same rule-8 active
// conflict — source said one thing, browser rendered another.
//
// Pin: canonicals declare `--surface-inset` directly so source
// matches rendered. Both selectors drop out of both reset
// chains. The 12428 reset chain is now down to its last 5
// shell-level siblings (.section / .gwg / .delivery-panel /
// .criteria-group / .eval-error) and the 13122 border-color
// reset becomes empty (deleted).

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

describe(".channel-doc-card + .detail-card canonicals match the rendered bg", () => {
  test(".channel-doc-card canonical declares --surface-inset background", () => {
    expect(soloRuleBody(".channel-doc-card")).toMatch(
      /background:\s*var\(--surface-inset\)/,
    )
  })

  test(".detail-card canonical declares --surface-inset background", () => {
    expect(soloRuleBody(".detail-card")).toMatch(
      /background:\s*var\(--surface-inset\)/,
    )
  })
})

describe("neither selector still rides an !important bg/border-color reset chain", () => {
  for (const sel of [".channel-doc-card", ".detail-card"]) {
    test(`no rule body using !important on background still lists \`${sel}\` as a top-level segment`, () => {
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
        expect(segments).not.toContain(sel)
      }
    })

    test(`no rule body using !important on border-color still lists \`${sel}\``, () => {
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
        if (!/border-color:[^;]*!important/.test(body)) continue
        const segments = head.split(",").map((s) => s.trim())
        expect(segments).not.toContain(sel)
      }
    })
  }
})
