/**
 * Coverage guard for flat-redesign Step 8a (specs/overlay-flat-redesign/plan.md §八 v4).
 *
 * Pins the elevation token contract: every `z-index:` declaration under
 * `packages/overlay/src/styles/**\/*.css` (except the token source
 * `tokens/design-language.css`) must use `var(--ui-z-*)`. Literal
 * integers are forbidden. `auto` is allowed (CSS default).
 *
 * `calc(var(--ui-z-*) + N)` patterns are allowed for dynamic stacking
 * (e.g. agent-workflow's `--stack-index` ladder).
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

describe("flat-redesign Step 8a — elevation token coverage", () => {
  const files = listCss(STYLES_ROOT).filter((f) => !f.endsWith("design-language.css"))

  test("no surface file declares z-index with a literal integer", () => {
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      // Find every `z-index: <value>;`. Reject pure integer literals.
      // Allow: `auto`, `var(--ui-z-*)`, `calc(var(--ui-z-*) + N)`.
      for (const m of text.matchAll(/z-index\s*:\s*([^;]+);/g)) {
        const value = m[1]!.trim()
        if (value === "auto") continue
        if (value.startsWith("var(--ui-z-")) continue
        if (/^calc\(\s*var\(--ui-z-[^)]+\)/.test(value)) continue
        violations.push(`${file}: z-index: ${value}`)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `z-index declarations with literal integers:\n  ` +
          violations.join("\n  ") +
          `\nUse var(--ui-z-{below,base,decoration,raised,sticky,overlay,titlebar,dialog,toast}) instead.`,
      )
    }
  })

  test("token source declares the canonical elevation token set", () => {
    const dl = readFileSync(join(STYLES_ROOT, "tokens", "design-language.css"), "utf8")
    const REQUIRED = [
      "--ui-z-below",
      "--ui-z-base",
      "--ui-z-decoration",
      "--ui-z-raised",
      "--ui-z-sticky",
      "--ui-z-overlay",
      "--ui-z-titlebar",
      "--ui-z-dialog",
      "--ui-z-toast",
    ]
    for (const token of REQUIRED) {
      const re = new RegExp(`${token.replace(/-/g, "\\-")}\\s*:`)
      if (!re.test(dl)) {
        throw new Error(`token source missing ${token}`)
      }
    }
  })
})
