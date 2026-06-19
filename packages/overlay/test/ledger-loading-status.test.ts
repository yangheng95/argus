import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const LEDGER_LIST = readFileSync(join(import.meta.dir, "../src/components/LedgerList.tsx"), "utf8")
const TASK_LIST = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")
const MISSION_LIST = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const CODING_ASSISTANT_LIST = readFileSync(
  join(import.meta.dir, "../src/components/CodingAssistantSessionList.tsx"),
  "utf8",
)
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")

test("Ledger loading skeleton exposes one shared live status contract", () => {
  expect(LEDGER_LIST).toContain("loadingLabel: string")
  expect(LEDGER_LIST).toContain("export function LedgerLoadingStatus")
  expect(LEDGER_LIST).toContain('role="status"')
  expect(LEDGER_LIST).toContain('aria-live="polite"')
  expect(LEDGER_LIST).toContain('aria-busy="true"')
  expect(LEDGER_LIST).toContain('class="ledger-loading-label"')
  expect(LEDGER_LIST).toContain('class="ledger-skeleton-rows" aria-hidden="true"')
  expect(LEDGER_LIST).toContain('class="ledger-skeleton-row task-list-skeleton-row"')
  expect(LEDGER_LIST).toContain("<LedgerLoadingStatus label={props.loadingLabel} />")
  expect(LEDGER_LIST).not.toContain('class="ledger-skeleton" aria-hidden="true"')
})

test("Task, Mission, and Coding Assistant ledgers reuse the shared loading status", () => {
  expect(TASK_LIST).toContain('import { LedgerLoadingStatus } from "./LedgerList"')
  expect(TASK_LIST).toContain(
    '<LedgerLoadingStatus label={t("common.loading")} class="task-list-skeleton" dataUi="task-list-loading" />',
  )
  expect(TASK_LIST).not.toContain('class="task-list-skeleton" aria-hidden="true"')
  expect(MISSION_LIST).toContain('loadingLabel={t("common.loading")}')
  expect(CODING_ASSISTANT_LIST).toContain('loadingLabel={t("common.loading")}')
})

test("Ledger loading label is visually hidden while skeleton rows remain visible", () => {
  expect(SIDEBAR_CSS).toMatch(/\.task-list-skeleton,\s*\.ledger-skeleton\s*\{/)
  expect(SIDEBAR_CSS).toMatch(/\.ledger-skeleton-rows\s*\{[^}]*display:\s*flex;/s)
  expect(SIDEBAR_CSS).toMatch(/\.ledger-loading-label\s*\{[^}]*clip:\s*rect\(0 0 0 0\);/s)
  expect(SIDEBAR_CSS).toMatch(/\.task-list-skeleton-row,\s*\.ledger-skeleton-row\s*\{/)
  expect(SIDEBAR_CSS).toMatch(/\.task-list-skeleton-row:nth-child\(2\),\s*\.ledger-skeleton-row:nth-child\(2\)\s*\{/)
  expect(SIDEBAR_CSS).toMatch(/\.task-list-skeleton-row:nth-child\(3\),\s*\.ledger-skeleton-row:nth-child\(3\)\s*\{/)
})
