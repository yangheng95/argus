/**
 * Coverage guard for flat-redesign Step 8a (specs/overlay-flat-redesign/plan.md §八 v4).
 *
 * Pins the motion token contract: every transition declaration under
 * `packages/overlay/src/styles/**\/*.css` (except the token source
 * `tokens/design-language.css`) must use `var(--ui-duration-*)` for
 * its duration and `var(--ui-timing-standard)` (or no timing keyword,
 * which CSS resolves to ease) for its timing function. Literal `\d+ms`
 * / `0?\.\d+s` durations are forbidden.
 *
 * `animation:` properties are deliberately out of scope — animation
 * cycles (spinners, pulses) carry per-instance personality and don't
 * collapse into the 3-tier transition scale. `transition-delay: 0`
 * (the unitless zero) is allowed; `0ms` is rejected to avoid drift.
 */

import { describe, expect, test } from "bun:test"
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

/** Strip CSS comments + @keyframes blocks. Keyframes carry literal
 * percentages and timing values that don't fall under transition-token
 * policy; the rest of the file is fair game. */
function stripCommentsAndKeyframes(text: string): string {
  let cleaned = text.replace(/\/\*[\s\S]*?\*\//g, "")
  // Remove @keyframes <name> { ... } blocks (handle nested braces).
  let result = ""
  let i = 0
  while (i < cleaned.length) {
    const m = /@keyframes\s+[a-zA-Z0-9_-]+\s*\{/.exec(cleaned.slice(i))
    if (!m) {
      result += cleaned.slice(i)
      break
    }
    result += cleaned.slice(i, i + m.index)
    let depth = 1
    let j = i + m.index + m[0].length
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === "{") depth++
      else if (cleaned[j] === "}") depth--
      j++
    }
    i = j
  }
  return result
}

/** Extract every transition / transition-duration / transition-timing-
 * function declaration value, including multi-line ones. */
function extractTransitionValues(text: string): Array<{ prop: string; value: string }> {
  const out: Array<{ prop: string; value: string }> = []
  const re = /(transition(?:-duration|-timing-function)?)\s*:\s*([^;}]*)(;|$)/g
  for (const m of text.matchAll(re)) {
    out.push({ prop: m[1]!, value: m[2]!.trim() })
  }
  return out
}

describe("flat-redesign Step 8a — motion token coverage", () => {
  const files = listCss(STYLES_ROOT).filter((f) => !f.endsWith("design-language.css"))

  test("no surface file declares transitions with literal durations", () => {
    const violations: string[] = []
    for (const file of files) {
      const cleaned = stripCommentsAndKeyframes(readFileSync(file, "utf8"))
      for (const { prop, value } of extractTransitionValues(cleaned)) {
        // Reject any \d+ms or 0?.\d+s that isn't var(...).
        const ms = /\b\d+ms\b/.exec(value)
        const sec = /\b0?\.\d+s\b/.exec(value)
        // Allow `transition-delay: 0` (no unit). Reject `0ms` to avoid drift.
        if (ms || sec) {
          violations.push(`${file}: ${prop}: ${value}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `transition declarations with literal durations:\n  ` +
          violations.join("\n  ") +
          `\nUse var(--ui-duration-fast|base|slow) instead.`,
      )
    }
  })

  test("no surface file declares transition timing as bare `ease` keyword", () => {
    const violations: string[] = []
    for (const file of files) {
      const cleaned = stripCommentsAndKeyframes(readFileSync(file, "utf8"))
      for (const { prop, value } of extractTransitionValues(cleaned)) {
        // Bare `ease` (not `ease-in` / `ease-out` / etc., not inside `var()`).
        const bareEase = /(?:^|[\s,])ease(?=$|[\s,;])/.exec(value)
        if (bareEase) {
          violations.push(`${file}: ${prop}: ${value}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `transition declarations with bare \`ease\` keyword:\n  ` +
          violations.join("\n  ") +
          `\nUse var(--ui-timing-standard) instead.`,
      )
    }
  })

  test("token source declares the canonical motion token set", () => {
    const dl = readFileSync(
      join(STYLES_ROOT, "tokens", "design-language.css"),
      "utf8",
    )
    expect(dl).toContain("--ui-duration-fast: 80ms")
    expect(dl).toContain("--ui-duration-base: 120ms")
    expect(dl).toContain("--ui-duration-slow: 200ms")
    expect(dl).toContain("--ui-timing-standard: ease")
  })
})
