/**
 * Coverage guard for flat-redesign Step 1 / Step 5 (specs/overlay-flat-redesign/plan.md).
 *
 * Asserts that every `font-weight:` declaration under
 * `packages/overlay/src/styles/**\/*.css` references one of the two canonical
 * weight tokens (`--ui-font-weight-body` / `--ui-font-weight-strong`) or a
 * narrow whitelist of literals that the design-language token file owns.
 *
 * The whole point of the 2-token scale is to stop the 700/650/600/500/bold
 * mix from regrowing. The guard scans CSS files only — TSX inline styles
 * use the same tokens via CSS custom properties.
 *
 * NOTE: Step 1 only adds the token + this guard. Step 5 will replace every
 * literal `font-weight: <number>` callsite with `var(--ui-font-weight-…)`.
 * Until Step 5 lands, this guard runs in REPORT-ONLY mode, returning a
 * count and the count is allowed to be > 0. Step 5 flips the assertion to
 * strict equality with 0.
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")
const TOKEN_FILE = join(STYLES_ROOT, "tokens", "design-language.css")

const ALLOWED_VALUES = new Set([
  "var(--ui-font-weight-body)",
  "var(--ui-font-weight-strong)",
  "inherit",
  "normal",
])

function listCss(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listCss(full))
    else if (name.endsWith(".css")) out.push(full)
  }
  return out
}

describe("flat-redesign font-weight token coverage", () => {
  test("design-language.css declares the 2 canonical font-weight tokens", () => {
    const text = readFileSync(TOKEN_FILE, "utf8")
    expect(text).toMatch(/^\s*--ui-font-weight-body\s*:/m)
    expect(text).toMatch(/^\s*--ui-font-weight-strong\s*:/m)
  })

  test("[Step 5] no font-weight literal — flips strict after Step 5 lands", () => {
    const files = listCss(STYLES_ROOT)
    const violations: string[] = []
    for (const file of files) {
      // The token file itself is the one place literal numbers may appear.
      if (file === TOKEN_FILE) continue
      const content = readFileSync(file, "utf8")
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "")
      const lines = stripped.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(/font-weight:\s*([^;]+);/)
        if (!m) continue
        const value = m[1]!.trim()
        if (ALLOWED_VALUES.has(value)) continue
        violations.push(`${file}:${i + 1}: ${value}`)
      }
    }

    // Step 1 records the baseline count so Step 5 has a target to drive to 0.
    // The number is the audit count from `feedback_overlay_typography` work
    // on 2026-05-04 (177 occurrences across 20 files). Keep this value in
    // sync with the migration progress; final value MUST be 0.
    const STEP_1_BASELINE = 177
    expect(violations.length).toBeLessThanOrEqual(STEP_1_BASELINE)
  })
})
