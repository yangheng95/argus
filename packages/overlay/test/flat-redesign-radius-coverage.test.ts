/**
 * Coverage guard for flat-redesign Step 1 (flat redesign migration contract).
 *
 * Asserts that every `border-radius:` callsite under
 * `packages/overlay/src/styles/**\/*.css` references one of the canonical
 * radius tokens (or a whitelisted literal). Any new declaration that drifts
 * back to `--oc-radius-control`, `--card-radius`, `--radius`, hardcoded
 * `calc(Npx * --ui-scale)`, etc. is a regression.
 *
 * Whitelist for raw values:
 *   - `0`            zero radius is unambiguous; var(--oc-radius-none) is a
 *                    legal synonym but the literal is allowed for clarity.
 *   - `50%`          full circle (avatars, dots).
 *   - `inherit`      consumer inherits parent radius.
 *
 * Whitelist for tokens:
 *   - `var(--oc-radius-none|soft|large|xl|pill)`
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")

const ALLOWED_TOKENS = new Set([
  "var(--oc-radius-none)",
  "var(--oc-radius-soft)",
  "var(--oc-radius-large)",
  "var(--oc-radius-xl)",
  "var(--oc-radius-pill)",
])

const ALLOWED_LITERALS = new Set(["0", "50%", "inherit"])

function listCss(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listCss(full))
    else if (name.endsWith(".css")) out.push(full)
  }
  return out
}

/** True if every space-separated piece of the value is whitelisted. */
function isAllowed(value: string): boolean {
  const parts = splitOutsideParens(value)
  if (parts.length === 0) return false
  return parts.every((p) => ALLOWED_TOKENS.has(p) || ALLOWED_LITERALS.has(p))
}

/** Split a CSS value on top-level whitespace (respecting calc() / var() parens). */
function splitOutsideParens(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of s.trim()) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (depth === 0 && /\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur)
        cur = ""
      }
    } else {
      cur += ch
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

describe("flat-redesign radius token coverage", () => {
  test("every border-radius callsite uses a canonical token or whitelisted literal", () => {
    const files = listCss(STYLES_ROOT)
    expect(files.length).toBeGreaterThan(0)
    const violations: string[] = []

    for (const file of files) {
      const content = readFileSync(file, "utf8")
      // Strip comments so commented-out historical values don't trip the guard.
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "")
      const lines = stripped.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(/border-radius:\s*([^;]+);/)
        if (!m) continue
        const value = m[1]!.trim()
        if (!isAllowed(value)) {
          violations.push(`${file}:${i + 1}: ${value}`)
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `border-radius callsites must use --oc-radius-{none,soft,large,xl,pill} or 0/50%/inherit:\n  ${violations.join("\n  ")}`,
      )
    }
  })

  test("retired radius tokens have no consumers", () => {
    const RETIRED = [
      "--oc-radius-panel",
      "--oc-radius-card",
      "--oc-radius-control",
      "--card-radius",
      "--section-corner",
      "--oc-button-radius",
      "--oc-titlebar-status-radius",
      // legacy cascade radii
      "--radius",
      "--radius-lg",
      "--panel-radius",
    ]
    const files = listCss(STYLES_ROOT)
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, "utf8")
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "")
      for (const token of RETIRED) {
        // var() consumer
        const consumerRe = new RegExp(`var\\(${token.replace(/-/g, "\\-")}\\)`, "g")
        if (consumerRe.test(stripped)) {
          violations.push(`${file}: still references ${token}`)
        }
        // declaration of the retired token
        const declRe = new RegExp(`${token.replace(/-/g, "\\-")}\\s*:`, "g")
        if (declRe.test(stripped)) {
          violations.push(`${file}: still declares ${token}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`retired tokens still in use:\n  ${violations.join("\n  ")}`)
    }
  })

  test("design-language.css declares the canonical radius tokens", () => {
    const tokenFile = readFileSync(join(STYLES_ROOT, "tokens", "design-language.css"), "utf8")
    for (const token of [
      "--oc-radius-none",
      "--oc-radius-soft",
      "--oc-radius-large",
      "--oc-radius-xl",
      "--oc-radius-pill",
    ]) {
      // matches `--oc-radius-X:` declaration (not just a comment mention)
      const declRe = new RegExp(`^\\s*${token.replace(/-/g, "\\-")}\\s*:`, "m")
      expect(declRe.test(tokenFile)).toBe(true)
    }
  })
})
