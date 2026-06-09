import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")
const BUTTON_CSS = readFileSync(join(import.meta.dir, "../src/styles/primitives/button.css"), "utf8")

test("sidebar header buttons use the button primitive contract instead of legacy sidebar-btn classes", () => {
  expect(HTML).not.toContain('data-ui="sidebar-refresh-button"')
  expect(HTML).not.toContain('data-ui="sidebar-toggle-button"')
  expect(HTML).not.toContain('id="solidLeftPanelCollapseControl"')
  expect(HTML).not.toContain('id="solidLeftCollapsedRailControl"')
  expect(SIDEBAR_CSS).not.toContain('data-ui="sidebar-header-collapse-toggle"')
  expect(HTML).toContain('data-ui="sidebar-new-task-button"')
  expect(HTML).not.toContain('id="btnRefreshTasks"')
  expect(HTML).not.toContain('id="btnSidebarToggle"')
  expect(HTML).not.toContain('class="sidebar-tool"')
  expect(HTML).not.toContain('class="sidebar-toggle"')
  expect(HTML).not.toContain("sidebar-btn-primary")
  expect(SIDEBAR_CSS).not.toContain("sidebar-toolset")
  expect(SIDEBAR_CSS).not.toContain('data-ui="sidebar-refresh-button"')
  expect(SIDEBAR_CSS).not.toContain('data-ui="sidebar-toggle-button"')
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="sidebar-new-task-button"]')
  expect(BUTTON_CSS).not.toContain(".sidebar-btn-primary")
})
