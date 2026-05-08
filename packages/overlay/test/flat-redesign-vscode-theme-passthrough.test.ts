/**
 * Theme isolation guard — `cascade/vscode-dark.css` is 100% VS Code
 * passthrough (theme-vscode-passthrough-2026-05-07).
 *
 * User contract (2026-05-07): "完全隔离，不要耦合" / "所有主题都要隔离".
 *
 * Pins three rules on vscode-dark.css:
 *
 *   1. No hex / rgb / rgba color literals. Color must come from
 *      VS Code via `var(--vscode-*)` or be derived through
 *      `color-mix()` from one of those references (or from black /
 *      white CSS keywords for structural scrim / highlight tones).
 *
 *   2. No fallback in `var(--vscode-*, …)`. A fallback is itself a
 *      hand-coded coupling to a "VSCode-ish" palette and defeats
 *      the passthrough; missing variables MUST surface as broken
 *      rendering, not silently degrade to an off-theme dark.
 *
 *   3. No reference to tokens declared in cascade/dark.css or
 *      cascade/light.css. The webview theme is not a sibling of the
 *      Tauri / browser palettes — it is a passthrough layer.
 *
 * Sister guards: cascade/dark.css and cascade/light.css MUST NOT
 * reference any `--vscode-*` variable (they are Tauri / browser
 * palettes; webview variables don't exist there).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CASCADE_DIR = join(import.meta.dir, "..", "src", "styles", "cascade")

function readCascade(name: string): string {
  // Strip block comments so commented-out hex examples (e.g. in the
  // file header) don't trip the literal scan.
  return readFileSync(join(CASCADE_DIR, name), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  )
}

const VSCODE_DARK = readCascade("vscode-dark.css")
const DARK = readCascade("dark.css")
const LIGHT = readCascade("light.css")

describe("vscode-dark passthrough — no color literals", () => {
  test("no hex color literals (#xxx / #xxxxxx / #xxxxxxxx)", () => {
    const hits = [...VSCODE_DARK.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })

  test("no rgb() / rgba() literals", () => {
    const hits = [...VSCODE_DARK.matchAll(/\brgba?\s*\(/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })

  test("no hsl() / hsla() literals", () => {
    const hits = [...VSCODE_DARK.matchAll(/\bhsla?\s*\(/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })

  test("no var(--vscode-*, fallback) — fallback is a coupling", () => {
    // Match `var(--vscode-...,` with any fallback after the comma.
    const hits = [...VSCODE_DARK.matchAll(/var\(\s*--vscode-[a-zA-Z0-9-]+\s*,/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })
})

describe("vscode-dark passthrough — no cross-theme coupling", () => {
  // dark.css and light.css declare these private semantic alias
  // patterns. vscode-dark must not reference them.
  test("does not reference cascade/dark.css or cascade/light.css tokens by hex value", () => {
    // The structural sentinel: extract every hex literal from dark
    // and light, then verify none of them appears in vscode-dark.
    const darkHex = new Set([...DARK.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]))
    const lightHex = new Set([...LIGHT.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]))
    const all = [...darkHex, ...lightHex]
    const leaked = all.filter((hex) => VSCODE_DARK.includes(hex))
    expect(leaked).toEqual([])
  })
})

describe("vscode-dark passthrough — semantic anchor tokens are var(--vscode-*)", () => {
  // The six semantic anchors that drive the rest of the palette.
  // Each MUST resolve to a var(--vscode-*) reference (color-mix is
  // not allowed at the anchor level — that's reserved for derived
  // dim / wash / glow tokens).
  const anchors = ["--bg", "--text", "--accent", "--good", "--bad", "--warn"]

  for (const token of anchors) {
    test(`${token} is a direct var(--vscode-*) reference`, () => {
      const re = new RegExp(`${token}\\s*:\\s*([^;]+);`)
      const match = VSCODE_DARK.match(re)
      expect(match).not.toBeNull()
      const value = match![1]!.trim()
      expect(value).toMatch(/^var\(--vscode-[a-zA-Z0-9-]+\)$/)
    })
  }
})

describe("dark.css and light.css — no VS Code coupling", () => {
  test("cascade/dark.css does not reference var(--vscode-*)", () => {
    const hits = [...DARK.matchAll(/var\(\s*--vscode-/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })

  test("cascade/light.css does not reference var(--vscode-*)", () => {
    const hits = [...LIGHT.matchAll(/var\(\s*--vscode-/g)]
    expect(hits.map((m) => m[0])).toEqual([])
  })
})
