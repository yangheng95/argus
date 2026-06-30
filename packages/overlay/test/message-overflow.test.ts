import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MESSAGES_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "messages.css"), "utf8")
const MARKDOWN_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "markdown.css"), "utf8")

function lastRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matches = [...MESSAGES_CSS.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "g"))]
  const last = matches[matches.length - 1]
  if (!last) throw new Error(`Missing CSS rule for ${selector}`)
  return last[1] || ""
}

test("dense tool and patch blocks keep their own scroll container while reasoning stays full-height", () => {
  const toolOutput = lastRuleBody(".msg-tool-output")
  const patch = lastRuleBody(".msg-patch")
  const collapsedReasoningText = lastRuleBody('.msg-reasoning[data-expanded="false"] .reasoning-text')

  expect(toolOutput).toContain("max-height: calc(128px * var(--ui-scale));")
  expect(toolOutput).toContain("overflow: auto;")
  expect(toolOutput).toContain("overscroll-behavior: contain;")
  expect(patch).toContain("max-height: calc(128px * var(--ui-scale));")
  expect(patch).toContain("overflow: auto;")
  expect(patch).toContain("overscroll-behavior: contain;")
  expect(collapsedReasoningText).toContain("display: none;")
  expect(MESSAGES_CSS).not.toContain("tool-output / reasoning blocks")
  expect(MESSAGES_CSS).not.toMatch(/\.msg-reasoning\s*\{[^}]*max-height:/)
  expect(MESSAGES_CSS).not.toMatch(/\.msg-reasoning\s*\{[^}]*overflow:\s*auto/)
  expect(MESSAGES_CSS).toMatch(/(?:^|\n)\.reasoning-text\s*\{[^}]*white-space:\s*normal;/)
  expect(MARKDOWN_CSS).toMatch(/\.md-active-text,\s*\.reasoning-text--streaming\s*\{[^}]*white-space:\s*pre-wrap;/)
  expect(MESSAGES_CSS).not.toContain("overflow-y: visible;")
})
