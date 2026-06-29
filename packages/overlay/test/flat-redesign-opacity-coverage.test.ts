/**
 * Coverage guard for flat-redesign Step 8a (specs/overlay-flat-redesign/plan.md §八 v4).
 *
 * Pins the opacity token contract: every `opacity:` declaration under
 * `packages/overlay/src/styles/**\/*.css` (except the token source
 * `tokens/design-language.css`) must use `var(--ui-opacity-*)`. Literal
 * decimals are forbidden.
 */

import { describe, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")

function listCss(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listCss(full))
    else if (name.endsWith(".css")) out.push(full)
  }
  return out
}

describe("flat-redesign Step 8a — opacity token coverage", () => {
  const files = listCss(STYLES_ROOT).filter((f) => !f.endsWith("design-language.css"))

  test("no surface file declares opacity with a literal decimal", () => {
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      // Find every `opacity: <value>;`. Reject literal decimals.
      // Allow: var(--ui-opacity-*).
      for (const m of text.matchAll(/(?<!-)\bopacity\s*:\s*([^;]+);/g)) {
        const value = m[1]!.trim()
        if (value.startsWith("var(--ui-opacity-")) continue
        violations.push(`${file}: opacity: ${value}`)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `opacity declarations with literal values:\n  ` +
          violations.join("\n  ") +
          `\nUse var(--ui-opacity-{hidden,faint,disabled,dim,subtle,full}) instead.`,
      )
    }
  })

  test("token source declares the canonical opacity token set", () => {
    const dl = readFileSync(join(STYLES_ROOT, "tokens", "design-language.css"), "utf8")
    const REQUIRED = [
      "--ui-opacity-hidden",
      "--ui-opacity-faint",
      "--ui-opacity-disabled",
      "--ui-opacity-dim",
      "--ui-opacity-subtle",
      "--ui-opacity-full",
    ]
    for (const token of REQUIRED) {
      const re = new RegExp(`${token.replace(/-/g, "\\-")}\\s*:`)
      if (!re.test(dl)) {
        throw new Error(`token source missing ${token}`)
      }
    }
  })

  test("legacy --oc-disabled-opacity has no consumers and no declaration", () => {
    const allFiles: string[] = []
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith(".css")) allFiles.push(full)
      }
    }
    walk(STYLES_ROOT)
    const violations: string[] = []
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      if (/var\(\s*--oc-disabled-opacity\s*\)/.test(text)) {
        violations.push(`${file}: still references var(--oc-disabled-opacity)`)
      }
      if (/(?:^|[\s;{])--oc-disabled-opacity\s*:/.test(text)) {
        violations.push(`${file}: still declares --oc-disabled-opacity`)
      }
    }
    if (violations.length > 0) {
      throw new Error(`legacy --oc-disabled-opacity still in use:\n  ` + violations.join("\n  "))
    }
  })

  test("retired window opacity token has no style consumers", () => {
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      if (text.includes("--ui-window-opacity")) violations.push(file)
    }
    if (violations.length > 0) {
      throw new Error(`retired --ui-window-opacity still referenced:\n  ` + violations.join("\n  "))
    }
  })
})
