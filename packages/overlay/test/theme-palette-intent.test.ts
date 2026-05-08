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
  const vscodeDark = readTheme("vscode-dark.css")

  test("dark keeps the April-mid historical Overlay palette", () => {
    expect(themeToken(dark, "--bg")).toBe("rgba(26, 27, 30, 0.78)")
    expect(themeToken(dark, "--surface")).toBe("rgba(38, 40, 44, 0.74)")
    expect(themeToken(dark, "--surface-inset")).toBe("rgba(31, 33, 37, 0.72)")
    expect(themeToken(dark, "--dialog-bg")).toBe("rgba(40, 42, 46, 0.84)")
    expect(themeToken(dark, "--menu-panel-bg")).toBe("#202226")
    expect(themeToken(dark, "--accent")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-start")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-mid")).toBe("#5b8def")
    expect(themeToken(dark, "--accent-end")).toBe("#4a7de0")
  })

  test("vscode dark is an Overlay-owned fixed palette", () => {
    expect(themeToken(vscodeDark, "--bg")).toBe("#1e1e1e")
    expect(themeToken(vscodeDark, "--surface")).toBe("#252526")
    expect(themeToken(vscodeDark, "--dialog-bg")).toBe("#252526")
    expect(themeToken(vscodeDark, "--menu-panel-bg")).toBe("#1f1f1f")
    expect(vscodeDark).not.toContain("--vscode-")
    expect(vscodeDark).not.toContain("#1f2339")
    expect(vscodeDark).not.toContain("rgba(31, 35, 57")
    expect(vscodeDark).not.toContain("#1c213a")
    expect(vscodeDark).not.toContain("rgba(28, 33, 58")
  })
})
