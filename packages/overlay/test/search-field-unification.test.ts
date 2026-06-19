import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const TASK_LIST_SOURCE = readFileSync(join(OVERLAY_ROOT, "src/components/TaskList.tsx"), "utf8")
const FILE_EXPLORER_SOURCE = readFileSync(join(OVERLAY_ROOT, "src/components/FileExplorerPanel.tsx"), "utf8")
const MEMORY_PANEL_SOURCE = readFileSync(join(OVERLAY_ROOT, "src/components/MemoryPanel.tsx"), "utf8")
const FIELD_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/field.css"), "utf8")
const SIDEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"), "utf8")
const INSPECTOR_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"), "utf8")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"), "utf8")

test("task, file, and memory search inputs use the shared search-field primitive", () => {
  expect(TASK_LIST_SOURCE).toContain('class="task-list-search search-field"')
  expect(TASK_LIST_SOURCE).toContain('class="task-list-search-input search-field-input"')
  expect(FILE_EXPLORER_SOURCE).toContain('class="file-explorer-toolbar file-explorer-search search-field"')
  expect(FILE_EXPLORER_SOURCE).toContain('class="file-explorer-search-input search-field-input field-input"')
  expect(MEMORY_PANEL_SOURCE).toContain('class="memory-search search-field"')
  expect(MEMORY_PANEL_SOURCE).toContain('class="memory-search-input search-field-input"')
  expect(MEMORY_PANEL_SOURCE).toContain('class="memory-search-icon search-field-icon"')
  expect(MEMORY_PANEL_SOURCE).toContain('aria-label={t("memory.search_placeholder")}')
  expect(FIELD_CSS).toContain(".search-field {")
  expect(FIELD_CSS).toContain(".search-field-input {")
  expect(SIDEBAR_CSS).not.toContain(".task-list-search-input {")
  expect(INSPECTOR_CSS).not.toContain(".file-explorer-search {")
  expect(MEMORY_PANEL_SOURCE).not.toContain('class="knowledge-search"')
  expect(SETTINGS_CSS).not.toMatch(/\.knowledge-search\b/)
  expect(SETTINGS_CSS).not.toMatch(/\.s-toolbar-search\b/)
  expect(SETTINGS_CSS).toMatch(/\.s-toolbar\s*>\s*\.field-input\s*\{/)
})

test("file search clear action uses the Button primitive", () => {
  expect(FILE_EXPLORER_SOURCE).toContain('import { Button } from "./ui/Button"')
  expect(FILE_EXPLORER_SOURCE).toContain('data-ui="file-explorer-search-clear"')
  expect(FILE_EXPLORER_SOURCE).not.toContain('class="file-explorer-search-clear"')
})

test("memory search clear action uses the Button primitive", () => {
  expect(MEMORY_PANEL_SOURCE).toContain('import { Button } from "./ui/Button"')
  expect(MEMORY_PANEL_SOURCE).toContain('data-ui="memory-search-clear"')
  expect(MEMORY_PANEL_SOURCE).toContain('data-chrome="icon-action"')
  expect(MEMORY_PANEL_SOURCE).toContain('data-ui="memory-search-submit"')
  expect(MEMORY_PANEL_SOURCE).toContain('data-ui="memory-refresh"')
  expect(MEMORY_PANEL_SOURCE).not.toContain('class="memory-search-clear"')
})
