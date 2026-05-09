import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles", "cascade")

function readTheme(name: string): string {
  return readFileSync(join(STYLES_ROOT, name), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  )
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
    expect(themeToken(dark, "--dialog-bg")).toBe("rgba(40, 42, 46, 0.84)")
    expect(themeToken(dark, "--menu-panel-bg")).toBe("rgba(32, 34, 38, 0.9)")
    expect(themeToken(dark, "--accent")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-start")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-mid")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-end")).toBe("#4a7de0")
  })

  test("vscode dark is an Overlay-owned fixed palette", () => {
    expect(themeToken(vscodeDark, "--bg")).toBe("rgba(30, 30, 30, 0.78)")
    expect(themeToken(vscodeDark, "--surface")).toBe("rgba(37, 37, 38, 0.74)")
    expect(themeToken(vscodeDark, "--dialog-bg")).toBe("rgba(37, 37, 38, 0.86)")
    expect(themeToken(vscodeDark, "--menu-panel-bg")).toBe("rgba(31, 31, 31, 0.9)")
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
      "--dialog-bg",
      "--executor-menu-bg",
      "--task-bar-bg",
      "--menu-panel-bg",
      "--panel-fill",
      "--panel-fill-hover",
      "--card-fill",
      "--card-fill-hover",
      "--guide-card-bg",
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
})

function resolveThemeValue(css: string, value: string, seen = new Set<string>()): string {
  return value.replace(/var\(\s*(--[a-z][a-z0-9-]*)\s*\)/gi, (_, token: string) => {
    if (seen.has(token)) return `var(${token})`
    seen.add(token)
    const resolved = resolveThemeValue(css, themeToken(css, token), seen)
    seen.delete(token)
    return resolved
  })
}

function isTransparentCapable(value: string): boolean {
  return /\brgba\(/i.test(value) || /\bhsla\(/i.test(value) || /\btransparent\b/i.test(value)
}
