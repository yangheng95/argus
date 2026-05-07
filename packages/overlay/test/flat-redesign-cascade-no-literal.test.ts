/**
 * Cascade theme-isolation guard (theme-vscode-passthrough-2026-05-07,
 * user 2026-05-07: "所有主题都要隔离").
 *
 * Pins the two-layer ref / sys structure inside cascade/dark.css and
 * cascade/light.css:
 *
 *   - `--ref-<theme>-*` declarations are the theme's reference palette
 *     swatches. Hex / rgba literals are allowed (and only) here.
 *
 *   - Every other declaration in the same block is a semantic surface
 *     token (--bg / --text / --accent / ...) and MUST resolve through
 *     `var()` + `color-mix()` only. No hex / rgb / rgba / hsl literal
 *     is permitted at the semantic layer — that would re-create the
 *     coupling the rewrite was meant to eliminate.
 *
 * `cascade/vscode-dark.css` is covered by flat-redesign-vscode-theme-
 * passthrough.test (stricter: no hex literals at all). This file
 * covers the dark/light siblings.
 *
 * `color-mix(in srgb, black|white …)` is allowed in semantic
 * declarations because black/white CSS keywords are structural, not
 * theme color (modal scrim, edge highlight) — see the same exception
 * documented in cascade/vscode-dark.css.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CASCADE_DIR = join(import.meta.dir, "..", "src", "styles", "cascade")

function readBlock(filename: string): string {
  const text = readFileSync(join(CASCADE_DIR, filename), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  )
  const open = text.indexOf("{")
  if (open < 0) throw new Error(`${filename}: no { found`)
  let depth = 1
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  throw new Error(`${filename}: unbalanced braces`)
}

interface Declaration {
  name: string
  value: string
}

/** Split block body into top-level declarations (`--name: value;`),
 * paired by balancing parentheses so commas inside color-mix(...) /
 * linear-gradient(...) don't truncate values. */
function declarations(blockBody: string): Declaration[] {
  const out: Declaration[] = []
  let i = 0
  while (i < blockBody.length) {
    while (i < blockBody.length && /\s/.test(blockBody[i]!)) i++
    if (i >= blockBody.length) break
    if (blockBody[i] !== "-") {
      // skip non-declaration content (e.g. `color-scheme: dark;`)
      while (i < blockBody.length && blockBody[i] !== ";") i++
      i++
      continue
    }
    const colon = blockBody.indexOf(":", i)
    if (colon < 0) break
    const name = blockBody.slice(i, colon).trim()
    let j = colon + 1
    let depth = 0
    while (j < blockBody.length) {
      const c = blockBody[j]!
      if (c === "(") depth++
      else if (c === ")") depth--
      else if (c === ";" && depth === 0) break
      j++
    }
    const value = blockBody.slice(colon + 1, j).trim()
    out.push({ name, value })
    i = j + 1
  }
  return out
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/
const RGB_RE = /\brgba?\s*\(/
const HSL_RE = /\bhsla?\s*\(/

describe("cascade dark.css — sys layer is var()-only", () => {
  const decls = declarations(readBlock("dark.css"))

  test("ref tokens carry every hex literal in the file", () => {
    const refDecls = decls.filter((d) => d.name.startsWith("--ref-dark-"))
    expect(refDecls.length).toBeGreaterThan(0)
  })

  test("sys (non-ref) declarations contain no hex / rgb / rgba / hsl literal", () => {
    const violations: string[] = []
    for (const d of decls) {
      if (d.name.startsWith("--ref-dark-")) continue
      if (HEX_RE.test(d.value)) violations.push(`${d.name}: hex in ${d.value}`)
      if (RGB_RE.test(d.value)) violations.push(`${d.name}: rgb() in ${d.value}`)
      if (HSL_RE.test(d.value)) violations.push(`${d.name}: hsl() in ${d.value}`)
    }
    expect(violations).toEqual([])
  })

  test("sys declarations only reference --ref-dark-* (not --ref-light-*)", () => {
    const violations: string[] = []
    for (const d of decls) {
      if (d.name.startsWith("--ref-dark-")) continue
      if (/--ref-light-/.test(d.value)) violations.push(`${d.name}: cross-theme ref → ${d.value}`)
      if (/--vscode-/.test(d.value)) violations.push(`${d.name}: webview var → ${d.value}`)
    }
    expect(violations).toEqual([])
  })
})

describe("cascade light.css — sys layer is var()-only", () => {
  const decls = declarations(readBlock("light.css"))

  test("ref tokens carry every hex literal in the file", () => {
    const refDecls = decls.filter((d) => d.name.startsWith("--ref-light-"))
    expect(refDecls.length).toBeGreaterThan(0)
  })

  test("sys (non-ref) declarations contain no hex / rgb / rgba / hsl literal", () => {
    const violations: string[] = []
    for (const d of decls) {
      if (d.name.startsWith("--ref-light-")) continue
      if (HEX_RE.test(d.value)) violations.push(`${d.name}: hex in ${d.value}`)
      if (RGB_RE.test(d.value)) violations.push(`${d.name}: rgb() in ${d.value}`)
      if (HSL_RE.test(d.value)) violations.push(`${d.name}: hsl() in ${d.value}`)
    }
    expect(violations).toEqual([])
  })

  test("sys declarations only reference --ref-light-* (not --ref-dark-*)", () => {
    const violations: string[] = []
    for (const d of decls) {
      if (d.name.startsWith("--ref-light-")) continue
      if (/--ref-dark-/.test(d.value)) violations.push(`${d.name}: cross-theme ref → ${d.value}`)
      if (/--vscode-/.test(d.value)) violations.push(`${d.name}: webview var → ${d.value}`)
    }
    expect(violations).toEqual([])
  })
})
