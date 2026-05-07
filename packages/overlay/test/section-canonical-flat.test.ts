// Regression for iter40 — single-source pass for `.section` (the
// inner collapsible card primitive in the right-panel section
// column). Refreshed for the 2026-05-04 container-shell theme-
// override retirement: the `.section` canonical was migrated out of
// styles.css and into `surfaces/inspector.css` along with the rest
// of the right-column shell. The flat chrome (--surface-inset bg,
// no drop-shadow) is now expressed directly via palette tokens, and
// the `body[data-theme]` `border: 0 !important` reset that used to
// strip the canonical's border has been retired.
//
// Pin the new contract:
// - The canonical lives in surfaces/inspector.css with --surface-inset
//   background, no 14px chrome radius, no rich drop-shadow.
// - No top-level styles.css selector with `background: ... !important`
//   lists `.section` — the !important reset chain that used to clobber
//   the canonical is gone.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// styles.css was dissolved 2026-05-04 into styles/cascade/*.css and
// styles/surfaces/*.css. The !important-reset guard that used to scan
// styles.css now scans the cascade layer where any cross-cutting
// `background: ... !important` rule would live.
const STYLES_DIR = path.resolve(import.meta.dir, "..", "src", "styles")
const CASCADE_FILES = [
  "cascade/base.css",
  "cascade/typography.css",
  "cascade/dark.css",
  "cascade/light.css",
  "cascade/vscode-dark.css",
]
const RAW = CASCADE_FILES
  .map((rel) => readFileSync(path.join(STYLES_DIR, rel), "utf8"))
  .join("\n")
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
const INSPECTOR_RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "inspector.css"),
  "utf8",
)
const INSPECTOR_SURFACE = INSPECTOR_RAW.replace(/\/\*[\s\S]*?\*\//g, "")

function soloRuleBody(text: string, selector: string): string {
  for (const chunk of text.split("}")) {
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
    expect(soloRuleBody(INSPECTOR_SURFACE, ".section")).toMatch(
      /background:\s*var\(--surface-inset\)/,
    )
  })

  test("canonical body uses var(--oc-radius-soft) (≈4px), not the dead 14px chrome value", () => {
    const body = soloRuleBody(INSPECTOR_SURFACE, ".section")
    expect(body).not.toMatch(/border-radius:\s*calc\(14px/)
    expect(body).toMatch(/border-radius:\s*var\(--oc-radius-soft\)/)
  })

  test("canonical body does NOT declare the dead drop-shadow chrome", () => {
    const body = soloRuleBody(INSPECTOR_SURFACE, ".section")
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
