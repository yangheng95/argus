/**
 * Coverage guard for flat-redesign Step 5 (flat redesign migration contract §八 v3).
 *
 * Asserts that every `font-weight:` declaration under
 * `packages/overlay/src/styles/**\/*.css` references one of the three canonical
 * weight tokens (`--ui-font-weight-body` / `-medium` / `-strong`) or a narrow
 * whitelist of CSS keyword values. Literal numbers (`600`, `700`, `bold`,
 * `650`, etc.) are rejected — the migration on 2026-05-04 retired all 178
 * such callsites by routing through the 3-token scale.
 *
 * Mapping that drove the migration:
 *   400         → --ui-font-weight-body
 *   500         → --ui-font-weight-medium
 *   600/620/650/680 → --ui-font-weight-strong
 *   700/720/760/780 / "bold" → --ui-font-weight-strong (heaviest weights
 *                                                     down-tiered to fix
 *                                                     "通篇粗体" complaint)
 *
 * Also enforces zero consumers of the retired thin alias tokens
 * (`--title-weight`, `--subhead-weight`, `--title-track`, `--subhead-track`,
 * `--title-size`, `--subhead-size`) — they were single-redirect aliases that
 * added no value and violated rule 8.
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")
const TOKEN_FILE = join(STYLES_ROOT, "tokens", "design-language.css")

const ALLOWED_VALUES = new Set([
  "var(--ui-font-weight-body)",
  "var(--ui-font-weight-medium)",
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
  test("design-language.css declares the 3 canonical font-weight tokens", () => {
    const text = readFileSync(TOKEN_FILE, "utf8")
    expect(text).toMatch(/^\s*--ui-font-weight-body\s*:/m)
    expect(text).toMatch(/^\s*--ui-font-weight-medium\s*:/m)
    expect(text).toMatch(/^\s*--ui-font-weight-strong\s*:/m)
  })

  test("zero font-weight literals outside the token file (Step 5 strict)", () => {
    const files = listCss(STYLES_ROOT)
    const violations: string[] = []
    for (const file of files) {
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

    if (violations.length > 0) {
      throw new Error(
        `font-weight callsites must use --ui-font-weight-{body,medium,strong} or inherit/normal:\n  ${violations.join("\n  ")}`,
      )
    }
  })

  test("retired thin-alias tokens have no consumers", () => {
    const RETIRED = [
      "--title-weight",
      "--subhead-weight",
      "--title-track",
      "--subhead-track",
      "--title-size",
      "--subhead-size",
    ]
    const files = listCss(STYLES_ROOT)
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, "utf8")
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "")
      for (const token of RETIRED) {
        const consumerRe = new RegExp(`var\\(${token.replace(/-/g, "\\-")}\\)`)
        if (consumerRe.test(stripped)) {
          violations.push(`${file}: still references ${token}`)
        }
        const declRe = new RegExp(`(?:^|\\s)${token.replace(/-/g, "\\-")}\\s*:`)
        if (declRe.test(stripped)) {
          violations.push(`${file}: still declares ${token}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`retired aliases still in use:\n  ${violations.join("\n  ")}`)
    }
  })
})
