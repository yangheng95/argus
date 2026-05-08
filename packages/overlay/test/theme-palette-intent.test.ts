import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles", "cascade")

function readTheme(name: string): string {
  return readFileSync(join(STYLES_ROOT, name), "utf8")
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

  test("dark keeps the historical indigo palette", () => {
    expect(themeToken(dark, "--bg")).toBe("#111528")
    expect(themeToken(dark, "--surface")).toBe("rgba(28, 33, 58, 0.86)")
    expect(themeToken(dark, "--surface-inset")).toBe("rgba(20, 24, 44, 0.92)")
    expect(themeToken(dark, "--dialog-bg")).toBe("#1c213a")
    expect(themeToken(dark, "--menu-panel-bg")).toBe("rgba(28, 33, 58, 0.96)")
    expect(themeToken(dark, "--accent")).toBe("#7b83ff")
    expect(themeToken(dark, "--accent-start")).toBe("#4b8dff")
    expect(themeToken(dark, "--accent-mid")).toBe("#7b83ff")
    expect(themeToken(dark, "--accent-end")).toBe("#9b62ff")
  })

  test("vscode dark menus stay in VS Code token passthrough", () => {
    expect(themeToken(vscodeDark, "--bg")).toBe("var(--vscode-editor-background)")
    expect(themeToken(vscodeDark, "--surface")).toBe("var(--vscode-sideBar-background)")
    expect(themeToken(vscodeDark, "--dialog-bg")).toBe("var(--vscode-editor-background)")
    expect(themeToken(vscodeDark, "--menu-panel-bg")).toBe("var(--vscode-menu-background)")
    expect(vscodeDark).not.toContain("#1f2339")
    expect(vscodeDark).not.toContain("rgba(31, 35, 57")
    expect(vscodeDark).not.toContain("#1c213a")
    expect(vscodeDark).not.toContain("rgba(28, 33, 58")
  })
})
