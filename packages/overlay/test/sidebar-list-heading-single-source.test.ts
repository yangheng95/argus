import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SIDEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"), "utf8")
const TASK_LIST = readFileSync(join(OVERLAY_ROOT, "src/components/TaskList.tsx"), "utf8")
const PROJECT_LEDGER_GROUP = readFileSync(join(OVERLAY_ROOT, "src/components/ProjectLedgerGroup.tsx"), "utf8")

describe("retired sidebar list heading", () => {
  test("old date-bucket heading selector stays removed", () => {
    expect(SIDEBAR_CSS).not.toContain(".sidebar-list-heading")
    expect(TASK_LIST).not.toContain("sidebar-list-heading")
  })

  test("ProjectLedgerGroup owns grouped sidebar headings", () => {
    expect(TASK_LIST).toContain("ProjectLedgerGroup")
    expect(PROJECT_LEDGER_GROUP).toContain('class="project-group-heading"')
    expect(SIDEBAR_CSS).toMatch(/\.project-group-heading\s*\{/)
    expect(SIDEBAR_CSS).toMatch(/\.project-group-copy\s*\{/)
    expect(SIDEBAR_CSS).toMatch(/\.project-group-count\s*\{/)
  })
})
