import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ICON_SOURCE = readFileSync(path.join(import.meta.dir, "..", "src", "components", "Icon.tsx"), "utf8")
const CONVERSATION_CSS = readFileSync(
  path.join(import.meta.dir, "..", "src", "styles", "surfaces", "conversation.css"),
  "utf8",
)

function iconBlock(name: string): string {
  const marker = `"${name}": {`
  const start = ICON_SOURCE.indexOf(marker)
  if (start < 0) throw new Error(`${name} icon block not found`)
  const next = ICON_SOURCE.indexOf('\n  "', start + marker.length)
  if (next < 0) throw new Error(`${name} icon block terminator not found`)
  return ICON_SOURCE.slice(start, next)
}

test("VS Code editor launcher uses the official blue brand SVG", () => {
  const block = iconBlock("editor-vscode")

  expect(block).toContain("editor-vscode-mask")
  expect(block).toContain("mask={`url(#${idPrefix}-editor-vscode-mask)`}")
  expect(block).toContain("#0065A9")
  expect(block).toContain("#007ACC")
  expect(block).toContain("#1F9CF0")
  expect(block).not.toContain('fill="currentColor"')
})

test("PyCharm editor launcher uses the official JetBrains product SVG", () => {
  const block = iconBlock("editor-pycharm")

  expect(block).toContain("editor-pycharm-gradient-a")
  expect(block).toContain("editor-pycharm-gradient-b")
  expect(block).toContain("fill={`url(#${idPrefix}-editor-pycharm-gradient-a)`}")
  expect(block).toContain("fill={`url(#${idPrefix}-editor-pycharm-gradient-b)`}")
  expect(block).toContain("#00D886")
  expect(block).toContain("#F0EB18")
  expect(block).toContain("#00C4F4")
  expect(block).toContain('fill="#000"')
  expect(block).toContain('fill="#fff"')
  expect(block).not.toContain('fill="currentColor"')
})

test("Claude Code launcher uses the official Claude brand glyph", () => {
  const block = iconBlock("coding-claude-code")

  expect(block).toContain("m4.7144 15.9555")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("#D97757")
  expect(block).not.toContain("#d97757")
  expect(block).toContain("l-6.3385 4.1164")
  expect(block).not.toContain("M17.304 3.541")
  expect(block).not.toContain("<circle")
})

test("Codex launcher uses the official OpenAI brand glyph", () => {
  const block = iconBlock("coding-codex")

  expect(block).toContain("M22.2819 9.8211")
  expect(block).toContain("a5.9847 5.9847")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("L8 13.5")
})

test("Gemini launcher uses the official Google Gemini brand glyph", () => {
  const block = iconBlock("coding-gemini")

  expect(block).toContain("M11.04 19.32Q12 21.51")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("#8E75B2")
  expect(block).not.toContain("#8e75b2")
  expect(block).not.toContain("M8 2.5c.5")
})

test("Copilot launcher uses the official GitHub Copilot brand glyph", () => {
  const block = iconBlock("coding-copilot")

  expect(block).toContain("M23.922 16.997")
  expect(block).toContain("C23.061 18.492")
  expect(block).toContain('fill="currentColor"')
  expect(block).not.toContain("M4 7.2c0-2.2")
})

test("GLM launcher uses the official Z.ai app icon", () => {
  const block = iconBlock("coding-glm")

  expect(block).toContain("M24.51,28.51H5.49")
  expect(block).toContain("24.3,7.1 13.14,22.91")
  expect(block).toContain('fill="currentColor"')
  expect(block).toContain('fill="var(--surface)"')
  expect(block).toContain('stroke="var(--surface)"')
  expect(block).not.toContain("#2D2D2D")
  expect(block).not.toContain("#2d2d2d")
  expect(block).not.toContain("#FFFFFF")
  expect(block).not.toContain("#ffffff")
  expect(block).not.toContain("M3.2 11.2V4.8")
})

test("Coding CLI launcher icon colors are owned by CSS tokens", () => {
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-option-icon[data-coding-cli-icon="claude-code"]')
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-select-icon[data-coding-cli-icon="claude-code"]')
  expect(CONVERSATION_CSS).toContain("color: var(--oc-brand-claude-code);")
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-option-icon[data-coding-cli-icon="gemini"]')
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-select-icon[data-coding-cli-icon="gemini"]')
  expect(CONVERSATION_CSS).toContain("color: var(--oc-brand-gemini);")
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-option-icon[data-coding-cli-icon="glm"]')
  expect(CONVERSATION_CSS).toContain('.workspace-coding-cli-select-icon[data-coding-cli-icon="glm"]')
  expect(CONVERSATION_CSS).toContain("color: var(--text-strong);")
})

test("Terminal profile icons use distinct glyphs", () => {
  expect(ICON_SOURCE).toContain('"terminal-powershell": { component: SquareTerminal }')
  expect(ICON_SOURCE).toContain('"terminal-command-prompt": { component: Terminal }')
  expect(ICON_SOURCE).toContain('"terminal-bash": { component: Shell }')
})
