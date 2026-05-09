import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SIDEBAR_CSS = readFileSync(
  path.join(import.meta.dir, "..", "src", "styles", "surfaces", "sidebar.css"),
  "utf8",
)

function soloRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(SIDEBAR_CSS)
  if (!head) throw new Error(`selector not found: ${selector}`)
  const open = head.index + head[0].length - 1
  const close = SIDEBAR_CSS.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return SIDEBAR_CSS.slice(open + 1, close)
}

describe("task row right column stays anchored to the row edge", () => {
  test(".task-row-main grows across remaining width before the right column", () => {
    const body = soloRuleBody(".task-row-main")
    expect(body).toMatch(/flex:\s*1\s+1\s+auto\s*;/)
    expect(body).toMatch(/min-width:\s*0\s*;/)
  })

  test(".task-row-right owns right alignment for timestamp and actions", () => {
    const body = soloRuleBody(".task-row-right")
    expect(body).toMatch(/align-items:\s*flex-end\s*;/)
    expect(body).toMatch(/flex-shrink:\s*0\s*;/)
  })
})
