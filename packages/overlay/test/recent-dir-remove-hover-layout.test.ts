import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const CONVERSATION_CSS = readFileSync(
  path.join(import.meta.dir, "..", "src", "styles", "surfaces", "conversation.css"),
  "utf8",
)
const TASK_DIR_BAR = readFileSync(path.join(import.meta.dir, "..", "src", "components", "TaskDirBar.tsx"), "utf8")

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

  test("hover and keyboard focus create an explicit remove action slot", () => {
    const body = selectorRuleBody('.recent-dir-row:has(.oc-button[data-ui="recent-dir-remove"]):hover')
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--recent-dir-remove-slot-width\)\s*;/)
    const focused = selectorRuleBody('.recent-dir-row:has(.oc-button[data-ui="recent-dir-remove"]):focus-within')
    expect(focused).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--recent-dir-remove-slot-width\)\s*;/)
  })

  test("remove button primitive is positioned in the action slot and disabled while hidden", () => {
    const body = selectorRuleBody('.recent-dir-row .oc-button[data-ui="recent-dir-remove"]')
    expect(body).toMatch(/position:\s*absolute\s*;/)
    expect(body).toMatch(/right:\s*calc\(6px \* var\(--ui-scale\)\)\s*;/)
    expect(body).toMatch(/opacity:\s*var\(--ui-opacity-hidden\)\s*;/)
    expect(body).toMatch(/pointer-events:\s*none\s*;/)
  })

  test("visible states re-enable the remove button", () => {
    const body = selectorRuleBody('.recent-dir-row:hover .oc-button[data-ui="recent-dir-remove"]')
    expect(body).toMatch(/opacity:\s*var\(--ui-opacity-full\)\s*;/)
    expect(body).toMatch(/pointer-events:\s*auto\s*;/)
    const focused = selectorRuleBody('.recent-dir-row:focus-within .oc-button[data-ui="recent-dir-remove"]')
    expect(focused).toMatch(/opacity:\s*var\(--ui-opacity-full\)\s*;/)
    expect(focused).toMatch(/pointer-events:\s*auto\s*;/)
  })

  test("recent directory actions route through the shared Button primitive", () => {
    expect(TASK_DIR_BAR.match(/data-ui="recent-dir-item"/g)?.length).toBe(2)
    expect(TASK_DIR_BAR).toMatch(/<Button[\s\S]*class="recent-dir-item"[\s\S]*data-ui="recent-dir-item"/)
    expect(TASK_DIR_BAR).toMatch(/<Button[\s\S]*data-ui="recent-dir-edit-submit"/)
    expect(TASK_DIR_BAR).toMatch(/<Button[\s\S]*data-ui="recent-dir-remove"/)
    expect(TASK_DIR_BAR).toContain('data-chrome="icon-action"')
    expect(TASK_DIR_BAR).toContain('aria-label={t("common.save")}')
    expect(TASK_DIR_BAR).toContain('aria-label={t("common.delete")}')
    expect(TASK_DIR_BAR).not.toContain('class="recent-dir-edit-submit"')
    expect(TASK_DIR_BAR).not.toContain('class="recent-dir-remove"')
    expect(TASK_DIR_BAR).not.toMatch(/<button[\s\S]*class="recent-dir-item"/)
    expect(CONVERSATION_CSS).not.toContain(".recent-dir-edit-submit")
    expect(CONVERSATION_CSS).not.toContain(".recent-dir-remove {")
    expect(CONVERSATION_CSS).toContain('.oc-button[data-ui="recent-dir-item"].recent-dir-item:hover')
    expect(CONVERSATION_CSS).not.toContain("recent-dir-item[data-highlighted]")
  })
})
