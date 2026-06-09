import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles", "cascade")

function readTheme(name: string): string {
  return readFileSync(join(STYLES_ROOT, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
}

function themeToken(css: string, token: string): string {
  const pattern = new RegExp(`${token.replace(/-/g, "\\-")}\\s*:\\s*([^;]+);`)
  const match = css.match(pattern)
  if (!match) throw new Error(`Missing ${token}`)
  return match[1]!.trim()
}

describe("overlay theme palette intent", () => {
  const dark = readTheme("dark.css")
  const light = readTheme("light.css")
  const vscodeDark = readTheme("vscode-dark.css")

  test("dark keeps the April-mid historical Overlay palette", () => {
    expect(themeToken(dark, "--bg")).toBe("rgba(26, 27, 30, 0.78)")
    expect(themeToken(dark, "--surface")).toBe("rgba(38, 40, 44, 0.74)")
    expect(themeToken(dark, "--surface-inset")).toBe("rgba(31, 33, 37, 0.72)")
    expect(themeToken(dark, "--dialog-bg")).toBe("rgb(40, 42, 46)")
    expect(themeToken(dark, "--menu-panel-bg")).toBe("rgb(32, 34, 38)")
    expect(themeToken(dark, "--accent")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-start")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-mid")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-end")).toBe("#4a7de0")
  })

  test("vscode dark is an Overlay-owned fixed palette", () => {
    expect(themeToken(vscodeDark, "--bg")).toBe("rgba(30, 30, 30, 0.78)")
    expect(themeToken(vscodeDark, "--surface")).toBe("rgba(37, 37, 38, 0.74)")
    expect(themeToken(vscodeDark, "--dialog-bg")).toBe("rgb(37, 37, 38)")
    expect(themeToken(vscodeDark, "--menu-panel-bg")).toBe("rgb(31, 31, 31)")
    expect(vscodeDark).not.toContain("--vscode-")
    expect(vscodeDark).not.toContain("#1f2339")
    expect(vscodeDark).not.toContain("rgba(31, 35, 57")
    expect(vscodeDark).not.toContain("#1c213a")
    expect(vscodeDark).not.toContain("rgba(28, 33, 58")
  })

  test("all themes keep window backing materials transparent-capable", () => {
    const themes = [
      ["dark", dark],
      ["light", light],
      ["vscode-dark", vscodeDark],
    ] as const
    const backingTokens = [
      "--bg",
      "--surface",
      "--surface-hover",
      "--surface-inset",
      "--surface-strong",
      "--rail-surface",
      "--chat-canvas",
      "--inspector-surface",
      "--body-bg",
      "--panel-body-bg",
      "--chrome",
      "--task-bar-bg",
      "--panel-fill",
      "--panel-fill-hover",
      "--card-fill",
      "--card-fill-hover",
    ]
    const violations: string[] = []

    for (const [themeName, css] of themes) {
      for (const token of backingTokens) {
        const value = resolveThemeValue(css, themeToken(css, token))
        if (!isTransparentCapable(value)) {
          violations.push(`${themeName} ${token}: ${value}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  test("retired card-shadow theme tokens stay removed", () => {
    for (const css of [dark, light, vscodeDark]) {
      expect(css).not.toContain("--guide-card-")
      expect(css).not.toContain("--hover-accent-shadow")
    }
  })

  test("popup window backing materials are opaque", () => {
    const themes = [
      ["dark", dark],
      ["light", light],
      ["vscode-dark", vscodeDark],
    ] as const
    const popupTokens = ["--dialog-bg", "--menu-panel-bg", "--executor-menu-bg"]
    const violations: string[] = []

    for (const [themeName, css] of themes) {
      for (const token of popupTokens) {
        const value = resolveThemeValue(css, themeToken(css, token))
        if (!isOpaqueColor(value)) {
          violations.push(`${themeName} ${token}: ${value}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

function resolveThemeValue(css: string, value: string, seen = new Set<string>()): string {
  return value.replace(/var\(\s*(--[a-z][a-z0-9-]*)\s*\)/gi, (raw, token: string) => {
    if (seen.has(token)) return `var(${token})`
    const local = themeTokenOptional(css, token)
    // Cross-cascade tokens (e.g. --ui-window-opacity lives in base.css, not
    // in theme files) legitimately resolve outside this file. Leave them as
    // `var(--token)` rather than throwing — the transparent-capability check
    // only cares whether the value literally contains rgba/hsla/transparent.
    if (local === null) return raw
    seen.add(token)
    const resolved = resolveThemeValue(css, local, seen)
    seen.delete(token)
    return resolved
  })
}

function themeTokenOptional(css: string, token: string): string | null {
  const pattern = new RegExp(`${token.replace(/-/g, "\\-")}\\s*:\\s*([^;]+);`)
  const match = css.match(pattern)
  return match ? match[1]!.trim() : null
}

function isTransparentCapable(value: string): boolean {
  return /\brgba\(/i.test(value) || /\bhsla\(/i.test(value) || /\btransparent\b/i.test(value)
}

function isOpaqueColor(value: string): boolean {
  return /\brgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/i.test(value) || /#[0-9a-f]{6}\b/i.test(value)
}
