import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SIDEBAR_CSS = readFileSync(path.join(import.meta.dir, "..", "src", "styles", "surfaces", "sidebar.css"), "utf8")

function soloRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(SIDEBAR_CSS)
  if (!head) throw new Error(`selector not found: ${selector}`)
  const open = head.index + head[0].length - 1
  const close = SIDEBAR_CSS.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return SIDEBAR_CSS.slice(open + 1, close)
}

function selectorRuleBody(selector: string): string {
  for (const chunk of SIDEBAR_CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
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

describe("task row right column stays anchored to the row edge", () => {
  test(".task-row-mini gives the title the flexible track before the right column", () => {
    const body = soloRuleBody(".task-row-mini")
    expect(body).toMatch(/--task-row-actions-width:\s*calc\(108px \* var\(--ui-scale\)\)\s*;/)
    expect(body).toMatch(
      /grid-template-columns:\s*calc\(20px \* var\(--ui-scale\)\)\s+0\s+minmax\(0,\s*1fr\)\s+max-content\s*;/,
    )
  })

  test(".task-row-body can shrink inside the flexible grid track", () => {
    const body = soloRuleBody(".task-row-body")
    expect(body).toMatch(/grid-column:\s*3\s*;/)
    expect(body).toMatch(/min-width:\s*0\s*;/)
  })

  test(".task-row-mini expands the right column only while actions are visible", () => {
    const body = selectorRuleBody(".task-row-mini:has(.task-row-actions):hover")
    expect(body).toMatch(
      /grid-template-columns:\s*calc\(20px \* var\(--ui-scale\)\)\s+0\s+minmax\(0,\s*1fr\)\s+var\(--task-row-actions-width\)\s*;/,
    )
  })

  test(".task-row-right anchors timestamp at the row edge", () => {
    const body = soloRuleBody(".task-row-right")
    expect(body).toMatch(/grid-column:\s*4\s*;/)
    expect(body).toMatch(/justify-content:\s*flex-end\s*;/)
    expect(body).toMatch(/width:\s*100%\s*;/)
    expect(body).toMatch(/position:\s*relative\s*;/)
    expect(body).toMatch(/pointer-events:\s*none\s*;/)
  })

  test(".task-row-right timestamp never intercepts action button clicks", () => {
    const body = selectorRuleBody(".task-row-right .task-row-stamp")
    expect(body).toMatch(/pointer-events:\s*none\s*;/)
  })

  test(".task-row-right keeps the tree child toggle clickable", () => {
    const body = soloRuleBody('.oc-button[data-ui="task-row-children-toggle"]')
    expect(body).toMatch(/pointer-events:\s*auto\s*;/)
  })

  test(".task-row-actions overlays only the dedicated action slot", () => {
    const body = soloRuleBody(".task-row-actions")
    expect(body).toMatch(/position:\s*absolute\s*;/)
    expect(body).toMatch(/width:\s*var\(--task-row-actions-width\)\s*;/)
    expect(body).toMatch(/right:\s*0\s*;/)
    expect(body).toMatch(/transform:\s*translateY\(-50%\)\s*;/)
    expect(body).toMatch(/pointer-events:\s*none\s*;/)
  })
})
