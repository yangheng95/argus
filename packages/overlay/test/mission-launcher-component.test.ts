import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const CHAT_COMPOSER = readFileSync(join(import.meta.dir, "../src/components/ChatComposer.tsx"), "utf8")
const WORK_LEDGER = readFileSync(join(import.meta.dir, "../src/components/WorkLedger.tsx"), "utf8")
const WORK_LEDGER_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/work-ledger.css"), "utf8")
const SERVICES_MISSION = readFileSync(join(import.meta.dir, "../src/services/mission.ts"), "utf8")
const SERVICES_TASK = readFileSync(join(import.meta.dir, "../src/services/task.ts"), "utf8")
const I18N_ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")
const I18N_EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")

test("Mission launcher is the main composer Mission mode, not a left header button", () => {
  expect(HTML).toContain('id="solidChatComposer"')
  expect(HTML).toContain('id="workLedgerPanel"')
  expect(HTML).not.toContain('id="btnCreateMission"')
  expect(HTML).not.toContain('data-ui="mission-new"')

  expect(MAIN_TSX).toContain('const [composerMode, setComposerMode] = createSignal<ComposerMode>("chat")')
  expect(MAIN_TSX).toContain("function missionSubmitActive(): boolean")
  expect(MAIN_TSX).toContain('return composerMode() === "mission" && !activeTaskID() && !activeSessionID()')
  expect(MAIN_TSX).toContain("const result = await wakeMission({ text, model, promptProfile })")
  expect(MAIN_TSX).toContain("await openMissionSession(result)")
  expect(MAIN_TSX).not.toContain('document.getElementById("btnCreateMission")?.addEventListener("click"')
  expect(MAIN_TSX).not.toContain("openMissionLauncher")
})

test("composer exposes a Kobalte-backed Mission/Chat mode selector and removes external executor chrome", () => {
  expect(CHAT_COMPOSER).toContain("export type ComposerMode = \"mission\" | \"chat\"")
  expect(CHAT_COMPOSER).toContain("<SelectControl<ComposerModeOption>")
  expect(CHAT_COMPOSER).toContain('triggerDataUI="composer-mode-selector"')
  expect(CHAT_COMPOSER).toContain('import { ComposerModelSelector } from "./ExecutorSelector"')
  expect(CHAT_COMPOSER).toContain("<ComposerModelSelector />")
  expect(CHAT_COMPOSER).toContain('onComposerModeChange: (mode: ComposerMode) => void')
  expect(CHAT_COMPOSER).not.toContain("<ExecutorSelector")
  expect(CHAT_COMPOSER).not.toContain('import { ExecutorSelector }')
  expect(CHAT_COMPOSER).not.toContain('import * as Select from "@kobalte/core/select"')
})

test("New Task launcher is retired; Mission-owned tasks are selected from Work Ledger child rows", () => {
  expect(HTML).not.toContain('id="btnCreateTask"')
  expect(MAIN_TSX).not.toContain("function openTaskLauncher")
  expect(MAIN_TSX).not.toContain('document.getElementById("btnCreateTask")?.addEventListener("click"')
  expect(MAIN_TSX).toContain("async function selectWorkLedgerTask(row: WorkLedgerTaskRow): Promise<void>")
  expect(MAIN_TSX).toContain('runMainAsync("work-ledger.select-task"')
  expect(MAIN_TSX).toContain("await selectTask(row.id, { directory: row.directory })")
  expect(WORK_LEDGER).toContain('data-ui="work-ledger-child-task"')
  expect(WORK_LEDGER).toContain("WorkLedgerTaskChildRow")
  expect(WORK_LEDGER).toContain("onSelect={props.onSelect}")
  expect(WORK_LEDGER_CSS).toContain(".work-row-child-list")
})

test("Mission status and task status service types retain task-level detail", () => {
  expect(SERVICES_MISSION).toContain("export async function wakeMission")
  expect(SERVICES_MISSION).toContain("`mission/wake`")
  expect(SERVICES_MISSION).toContain("export async function loadMissionStatus")
  expect(SERVICES_MISSION).toContain("export async function loadTaskStatus")
  expect(SERVICES_MISSION).toContain("agentInvocationDAG: unknown")
  expect(SERVICES_TASK).toContain("export interface SelectTaskOptions")
  expect(SERVICES_TASK).toContain("directory?: string")
})

const MODE_KEYS = [
  "work_ledger.mode_selector_title",
  "work_ledger.mode_selector_label",
  "work_ledger.kind.mission",
  "work_ledger.kind.chat",
  "mission.launcher.placeholder",
]

for (const key of MODE_KEYS) {
  test(`zh-CN locale defines ${key}`, () => {
    const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
    expect(typeof zh[key]).toBe("string")
    expect((zh[key] as string).length).toBeGreaterThan(0)
  })
  test(`en-US locale defines ${key}`, () => {
    const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
    expect(typeof en[key]).toBe("string")
    expect((en[key] as string).length).toBeGreaterThan(0)
  })
}

test("legacy gateway proposal and compose keys remain removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    expect(Object.keys(map).filter((key) => key.startsWith("gateway.compose."))).toEqual([])
    expect(Object.keys(map).filter((key) => key.startsWith("gateway.proposal."))).toEqual([])
  }
})
