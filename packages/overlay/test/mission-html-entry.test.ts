import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const WORK_LEDGER = readFileSync(join(import.meta.dir, "../src/components/WorkLedger.tsx"), "utf8")
const WORK_LEDGER_SERVICE = readFileSync(join(import.meta.dir, "../src/services/work-ledger.ts"), "utf8")
const MISSION = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")

test("index.html exposes Mission through the unified Work Ledger instead of a Mission left activity body", () => {
  const shellIndex = HTML.indexOf('id="leftActivityShell"')
  const sidebarIndex = HTML.indexOf('<aside class="sidebar"')
  const workPanelIndex = HTML.indexOf('id="leftPanelWork"')
  const workLedgerIndex = HTML.indexOf('id="workLedgerPanel"')

  expect(shellIndex).toBeGreaterThan(0)
  expect(sidebarIndex).toBeGreaterThan(shellIndex)
  expect(workPanelIndex).toBeGreaterThan(sidebarIndex)
  expect(workLedgerIndex).toBeGreaterThan(workPanelIndex)
  expect(HTML).toContain('data-i18n="work_ledger.title"')
  expect(HTML).toContain('href="styles/surfaces/work-ledger.css"')
  expect(HTML).toContain('href="styles/surfaces/mission.css"')
  expect(HTML).not.toContain('id="solidLeftActivityToolbar"')
  expect(HTML).not.toContain('id="leftPanelMissions"')
  expect(HTML).not.toContain('id="missionListPanel"')
  expect(HTML).not.toContain('id="btnCreateMission"')
  expect(HTML).not.toContain('id="solidMissionMount"')
})

test("main.tsx opens Mission sessions from Work Ledger rows", () => {
  expect(MAIN).toContain("async function openWorkLedgerMission(row: WorkLedgerMissionRow)")
  expect(MAIN).toContain('runMainAsync("work-ledger.select-mission"')
  expect(MAIN).toContain("await openMissionSession(")
  expect(MAIN).toContain("{ missionID: row.missionID, sessionID: row.sessionID, created: false }")
  expect(MAIN).toContain("row.directory")
  expect(MAIN).toContain("async function openMissionSession(result: MissionWakeResult")
  expect(MAIN).toContain('resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })')
  expect(MAIN).toContain('setBoardStore("selectedSource", source)')
  expect(MAIN).toContain('setBoardStore("board", null)')
  expect(MAIN).toContain("loadConversation(source")
  expect(MAIN).toContain("startSSE(source")
  expect(MAIN).not.toContain('document.getElementById("missionListPanel")')
  expect(MAIN).not.toContain("<Mission")
  expect(MAIN).not.toContain("selectMissionTask")
})

test("Work Ledger renders Mission-owned tasks as child task selectors", () => {
  expect(WORK_LEDGER).toContain('data-ui="work-ledger-child-task"')
  expect(WORK_LEDGER).toContain('data-kind="task"')
  expect(WORK_LEDGER).toContain("WorkLedgerTaskChildRow")
  expect(WORK_LEDGER).toContain("props.onSelect(props.task)")
  expect(WORK_LEDGER).toContain("row().kind === \"mission\" && (row() as WorkLedgerMissionRow).tasks.length > 0")
  expect(WORK_LEDGER_SERVICE).toContain("tasks: WorkLedgerTaskRow[]")
  expect(WORK_LEDGER_SERVICE).toContain("missionID?: string")
  expect(WORK_LEDGER_SERVICE).toContain("missionSessionID?: string")
})

test("retired Mission component remains unmounted while old task-list coupling stays absent", () => {
  expect(MISSION).not.toContain("MissionConversation")
  expect(MISSION).not.toContain("<Conversation")
  expect(MISSION).not.toContain("<ConversationAgentRail")
  expect(MISSION).not.toContain("<WorkspacePanel")
  expect(MISSION_LIST).not.toContain('class="mission-ledger-header')
  expect(MISSION_LIST).not.toContain('class="mission-ledger-title')
  expect(MISSION_LIST).not.toContain('class="mission-ledger-header-actions')
  expect(MISSION_LIST).not.toContain('data-ui="mission-back-panel"')
})
