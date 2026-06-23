import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const LAUNCHER_SOURCE = readFileSync(join(import.meta.dir, "../src/components/WorkspaceSplitLauncher.tsx"), "utf8")
const CONVERSATION_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")

function selectorRuleBody(selector: string): string {
  for (const chunk of CONVERSATION_CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const selectors = chunk
      .slice(0, openIdx)
      .split(",")
      .map((item) => item.trim())
    if (selectors.includes(selector)) return chunk.slice(openIdx + 1)
  }
  throw new Error(`selector not found: ${selector}`)
}

describe("WorkspaceSplitLauncher primitive", () => {
  test("delegates menu behavior to Kobalte dropdown menu", () => {
    expect(LAUNCHER_SOURCE).toMatch(/import\s+\*\s+as\s+DropdownMenu\s+from\s+["']@kobalte\/core\/dropdown-menu["'];?/)
    expect(LAUNCHER_SOURCE).toContain('import { Button } from "./ui/Button"')
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Root")
    expect(LAUNCHER_SOURCE).toContain("<Button")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Trigger")
    expect(LAUNCHER_SOURCE).toContain("as={Button}")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Portal")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Content")
    expect(LAUNCHER_SOURCE).toContain("<DropdownMenu.Item")
    expect(LAUNCHER_SOURCE).not.toContain("<button")
    expect(LAUNCHER_SOURCE).not.toContain("workspace-split-launcher-primary")
    expect(LAUNCHER_SOURCE).not.toContain("workspace-split-launcher-menu-button")
    expect(LAUNCHER_SOURCE).not.toContain("primaryClass")
    expect(LAUNCHER_SOURCE).not.toContain("menuButtonClass")
    expect(LAUNCHER_SOURCE).not.toContain('data-open={props.open ? "true" : "false"}')
    expect(LAUNCHER_SOURCE).not.toContain("document.addEventListener")
    expect(LAUNCHER_SOURCE).not.toContain("getBoundingClientRect")
    expect(LAUNCHER_SOURCE).not.toContain('from "solid-js/web"')
  })

  test("styles Kobalte highlighted workspace menu options", () => {
    for (const selector of [
      ".workspace-terminal-option[data-highlighted]",
      ".workspace-editor-option[data-highlighted]",
      ".workspace-coding-cli-option[data-highlighted]",
    ]) {
      const body = selectorRuleBody(selector)
      expect(body).toMatch(/background:\s*var\(--subtle-3\)/)
      expect(body).toMatch(/color:\s*var\(--text-strong\)/)
    }
    const openButton = selectorRuleBody(
      '.workspace-command-dock .oc-button[data-chrome="workspace-split-menu"][data-expanded]',
    )
    expect(openButton).toMatch(/--oc-button-bg:\s*var\(--oc-control-bg-hover\)/)
    expect(CONVERSATION_CSS).not.toContain(
      '.workspace-command-dock .oc-button[data-chrome="workspace-split-menu"][data-open="true"]',
    )
  })
})
