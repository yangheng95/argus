import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ICON_SOURCE = readFileSync(path.join(import.meta.dir, "..", "src", "components", "Icon.tsx"), "utf8")

function iconBlock(name: string): string {
  const marker = `"${name}": {`
  const start = ICON_SOURCE.indexOf(marker)
  if (start < 0) throw new Error(`${name} icon block not found`)
  const next = ICON_SOURCE.indexOf("\n  \"", start + marker.length)
  if (next < 0) throw new Error(`${name} icon block terminator not found`)
  return ICON_SOURCE.slice(start, next)
}

test("VS Code editor launcher uses the official blue brand SVG", () => {
  const block = iconBlock("editor-vscode")

  expect(block).toContain("editor-vscode-mask")
  expect(block).toContain('mask={`url(#${idPrefix}-editor-vscode-mask)`}')
  expect(block).toContain("#0065A9")
  expect(block).toContain("#007ACC")
  expect(block).toContain("#1F9CF0")
  expect(block).not.toContain('fill="currentColor"')
})

test("PyCharm editor launcher uses the official JetBrains product SVG", () => {
  const block = iconBlock("editor-pycharm")

  expect(block).toContain("editor-pycharm-gradient-a")
  expect(block).toContain("editor-pycharm-gradient-b")
  expect(block).toContain('fill={`url(#${idPrefix}-editor-pycharm-gradient-a)`}')
  expect(block).toContain('fill={`url(#${idPrefix}-editor-pycharm-gradient-b)`}')
  expect(block).toContain("#00D886")
  expect(block).toContain("#F0EB18")
  expect(block).toContain("#00C4F4")
  expect(block).toContain('fill="#000"')
  expect(block).toContain('fill="#fff"')
  expect(block).not.toContain('fill="currentColor"')
})

test("Claude Code launcher uses the Anthropic brand glyph", () => {
  const block = iconBlock("coding-claude-code")

  expect(block).toContain("M17.304 3.541")
  expect(block).toContain("L0 20.459")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("<circle")
})

test("Codex launcher uses the OpenAI brand glyph", () => {
  const block = iconBlock("coding-codex")

  expect(block).toContain("M22.282 9.821")
  expect(block).toContain("A6.065 6.065")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("L8 13.5")
})
