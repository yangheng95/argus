import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MESSAGES_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "messages.css"), "utf8")

function lastRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matches = [...MESSAGES_CSS.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "g"))]
  const last = matches[matches.length - 1]
  if (!last) throw new Error(`Missing CSS rule for ${selector}`)
  return last[1] || ""
}

test("dense agent message blocks keep their own scroll container", () => {
  const toolOutput = lastRuleBody(".msg-tool-output")
  const reasoningAndPatch = lastRuleBody(".msg-reasoning,\n.msg-patch")

  expect(toolOutput).toContain("max-height: calc(128px * var(--ui-scale));")
  expect(toolOutput).toContain("overflow: auto;")
  expect(toolOutput).toContain("overscroll-behavior: contain;")
  expect(reasoningAndPatch).toContain("max-height: calc(128px * var(--ui-scale));")
  expect(reasoningAndPatch).toContain("overflow: auto;")
  expect(reasoningAndPatch).toContain("overscroll-behavior: contain;")
  expect(MESSAGES_CSS).not.toContain("overflow-y: visible;")
})
