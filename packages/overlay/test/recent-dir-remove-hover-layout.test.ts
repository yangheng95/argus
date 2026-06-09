import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const CONVERSATION_CSS = readFileSync(
  path.join(import.meta.dir, "..", "src", "styles", "surfaces", "conversation.css"),
  "utf8",
)

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

describe("recent directory remove action hover layout", () => {
  test("row does not reserve a remove column at rest", () => {
    const body = selectorRuleBody(".recent-dir-row")
    expect(body).toMatch(/display:\s*grid\s*;/)
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/)
    expect(body).toMatch(/--recent-dir-remove-slot-width:\s*calc\(28px \* var\(--ui-scale\)\)\s*;/)
    expect(body).toMatch(/position:\s*relative\s*;/)
  })

  test("hover and focus create an explicit remove action slot", () => {
    const body = selectorRuleBody(".recent-dir-row:has(.recent-dir-remove):hover")
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--recent-dir-remove-slot-width\)\s*;/)
  })

  test("remove button is positioned in the action slot and disabled while hidden", () => {
    const body = selectorRuleBody(".recent-dir-remove")
    expect(body).toMatch(/position:\s*absolute\s*;/)
    expect(body).toMatch(/right:\s*calc\(6px \* var\(--ui-scale\)\)\s*;/)
    expect(body).toMatch(/opacity:\s*var\(--ui-opacity-hidden\)\s*;/)
    expect(body).toMatch(/pointer-events:\s*none\s*;/)
  })

  test("visible states re-enable the remove button", () => {
    const body = selectorRuleBody(".recent-dir-row:hover .recent-dir-remove")
    expect(body).toMatch(/opacity:\s*var\(--ui-opacity-full\)\s*;/)
    expect(body).toMatch(/pointer-events:\s*auto\s*;/)
  })
})
