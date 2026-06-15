import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")
const BUTTON_CSS = readFileSync(join(import.meta.dir, "../src/styles/primitives/button.css"), "utf8")
const MISSION_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/mission.css"), "utf8")
const CODING_ASSISTANT_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/coding-assistant.css"), "utf8")
const EN_US = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<
  string,
  string
>
const ZH_CN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<
  string,
  string
>

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

test("task ledger wording uses Task while Coding Assistant owns Chat wording", () => {
  expect(HTML).toContain(">Recent Tasks<")
  expect(HTML).toContain(">New Task<")
  expect(HTML).not.toContain("Recent Chats")
  expect(HTML).toContain('data-left-action="assistant"')
  expect(HTML).toContain(">New Chat<")
  expect(EN_US["task.ledger.title"]).toBe("Recent Tasks")
  expect(EN_US["task.ledger.new"]).toBe("New Task")
  expect(EN_US["task.ledger.empty"]).toBe("No tasks yet")
  expect(EN_US["coding_assistant.chat.new"]).toBe("New Chat")
  expect(EN_US).not.toHaveProperty("sidebar.title")
  expect(EN_US).not.toHaveProperty("task.new")
  expect(EN_US).not.toHaveProperty("task.none")
  expect(EN_US).not.toHaveProperty("coding_assistant.new")
  expect(ZH_CN["task.ledger.title"]).toBe("最近任务")
  expect(ZH_CN["task.ledger.new"]).toBe("新建任务")
  expect(ZH_CN["task.ledger.empty"]).toBe("暂无任务")
  expect(ZH_CN["coding_assistant.chat.new"]).toBe("新建对话")
  expect(ZH_CN).not.toHaveProperty("sidebar.title")
  expect(ZH_CN).not.toHaveProperty("task.new")
  expect(ZH_CN).not.toHaveProperty("task.none")
  expect(ZH_CN).not.toHaveProperty("coding_assistant.new")
})

test("Mission and Coding Assistant new actions reuse the task new-action button style", () => {
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="sidebar-new-task-button"][data-variant="solid"],')
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="mission-new"][data-variant="solid"],')
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="coding-assistant-new"][data-variant="solid"]')
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="mission-new"] .sidebar-btn-icon')
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="coding-assistant-new"] .sidebar-btn-icon')
  expect(MISSION_CSS).not.toContain('.oc-button[data-ui="mission-new"]')
  expect(CODING_ASSISTANT_CSS).not.toContain('.oc-button[data-ui="coding-assistant-new"]')
})
