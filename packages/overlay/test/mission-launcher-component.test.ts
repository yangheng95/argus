import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST_TSX = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const MISSION_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/mission.css"), "utf8")
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")
const SERVICES_MISSION = readFileSync(join(import.meta.dir, "../src/services/mission.ts"), "utf8")
const HELPERS = readFileSync(join(import.meta.dir, "../src/utils/mission-helpers.ts"), "utf8")
const I18N_ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")
const I18N_EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")

test("Mission.tsx no longer imports the decompose service surface", () => {
  expect(MISSION_TSX).not.toContain("decomposeRequirement")
  expect(MISSION_TSX).not.toContain("MissionTaskCandidate")
  expect(MISSION_TSX).not.toContain("MissionTaskDecomposition")
  expect(MISSION_TSX).not.toContain("composeTaskText")
})

test("Mission.tsx no longer renders the proposal review UI", () => {
  expect(MISSION_TSX).not.toContain("MissionProposalReview")
  expect(MISSION_TSX).not.toContain("ProposalCandidateState")
  expect(MISSION_TSX).not.toContain("mission-proposal-")
})

test("services/mission.ts no longer exports decompose or channel panel API surfaces", () => {
  expect(SERVICES_MISSION).not.toContain("decomposeRequirement")
  expect(SERVICES_MISSION).not.toContain("MissionTaskCandidate")
  expect(SERVICES_MISSION).not.toContain("MissionTaskDecomposition")
  expect(SERVICES_MISSION).not.toContain("loadChannelList")
  expect(SERVICES_MISSION).not.toContain("loadChannelRuntime")
  expect(SERVICES_MISSION).not.toContain("restartChannelRuntime")
  expect(SERVICES_MISSION).not.toContain("ChannelRuntimeStatus")
  expect(SERVICES_MISSION).not.toContain("ChannelInfo")
})

test("mission-helpers.ts no longer exports composeTaskText", () => {
  expect(HELPERS).not.toContain("composeTaskText")
})

test("Mission waits for i18n readiness before rendering translated content", () => {
  expect(MISSION_TSX).toContain('import { appStore } from "../store/app"')
  expect(MISSION_TSX).toContain("when={appStore.i18nReady}")
  expect(MISSION_TSX).toContain('fallback={<div class="mission-left-panel" data-i18n-ready="false" />}')
  expect(MISSION_TSX).toContain("function MissionContent(props: MissionProps)")
  expect(MISSION_TSX.indexOf("when={appStore.i18nReady}")).toBeLessThan(MISSION_TSX.indexOf("function MissionContent"))
})

test("Mission wake result opens the shared center conversation surface", () => {
  expect(MAIN_TSX).toContain("async function openMissionSession(result: MissionWakeResult)")
  expect(MAIN_TSX).toContain('resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })')
  expect(MAIN_TSX).toContain('setBoardStore("selectedSource", source)')
  expect(MAIN_TSX).toContain('setBoardStore("board", null)')
  expect(MAIN_TSX).toContain("loadConversation(source")
  expect(MAIN_TSX).toContain("startSSE(source")
  expect(MAIN_TSX).toContain("setMissionSharedRefreshToken((value) => value + 1)")
  expect(MAIN_TSX).toContain("setMissionActivityActivationToken((value) => value + 1)")
  expect(MISSION_TSX).not.toContain("MissionConversation")
  expect(MISSION_TSX).not.toContain('data-ui="mission-conversation"')
  expect(MISSION_TSX).not.toContain('data-ui="mission-agent-rail"')
  expect(MISSION_TSX).not.toContain('data-ui="mission-workspace"')
})

test("Mission left activity retires the Channel rail and task bindings surface", () => {
  expect(MISSION_TSX).not.toContain("loadTaskBindings")
  expect(MISSION_TSX).not.toContain('data-ui="mission-channels-bindings"')
  expect(MISSION_TSX).not.toContain("activeTaskID")
  expect(MISSION_TSX).not.toContain("bindings_empty_no_task")
  expect(MISSION_TSX).not.toContain("MissionChannelPanel")
  expect(SERVICES_MISSION).not.toContain("export async function loadTaskBindings")
  expect(SERVICES_MISSION).not.toContain("ChannelBindingRow")
})

test("Mission left activity loads and paginates Mission records only while active", () => {
  expect(MISSION_TSX).toContain("if (!props.active) return null")
  expect(MISSION_TSX).toContain("activation: props.activationToken ?? 0")
  expect(MISSION_TSX).toContain("loadMissions({")
  expect(MISSION_TSX).toContain("limit: MISSION_LIST_PAGE_SIZE + 1")
  expect(MISSION_TSX).toContain("cursorUpdated: cursor.updated")
  expect(MISSION_TSX).toContain("cursorSessionID: cursor.sessionID")
  expect(MISSION_TSX).toContain("missionPage(records, MISSION_LIST_PAGE_SIZE)")
})

test("Mission abort immediately removes the interruptible row action before list refresh settles", () => {
  expect(MISSION_TSX).toContain("await abortMission(mission)")
  expect(MISSION_TSX).toContain("missionRecordsCtl.mutate({")
  expect(MISSION_TSX).toContain("record.missionID === mission.missionID ? { ...record, interruptible: false } : record")
  expect(MISSION_TSX.indexOf("missionRecordsCtl.mutate({")).toBeLessThan(
    MISSION_TSX.indexOf("setMissionRefreshToken((value) => value + 1)"),
  )
})

test("Mission row selection is not blocked by unrelated row action busy state", () => {
  const start = MISSION_TSX.indexOf("async function handleMissionSelect")
  const end = MISSION_TSX.indexOf("function handleTaskSelect", start)
  const block = MISSION_TSX.slice(start, end)
  expect(block).toContain("await openMissionSession(mission.sessionID, mission.directory)")
  expect(block).not.toContain("withBusy")
})

test("Mission row selection ignores superseded conversation aborts without surfacing action errors", () => {
  const start = MISSION_TSX.indexOf("async function handleMissionSelect")
  const end = MISSION_TSX.indexOf("function handleTaskSelect", start)
  const block = MISSION_TSX.slice(start, end)
  expect(MISSION_TSX).toContain('import { isAbortError } from "../utils/string"')
  expect(block).toContain("if (isAbortError(err)) return")
  expect(block.indexOf("if (isAbortError(err)) return")).toBeLessThan(block.indexOf("reportActionError"))
})

test("services/mission.ts exports wakeMission pointed at /mission/wake", () => {
  expect(SERVICES_MISSION).toContain("export async function wakeMission")
  expect(SERVICES_MISSION).toContain("`mission/wake`")
  expect(SERVICES_MISSION).toContain("MissionWakeInput")
  expect(SERVICES_MISSION).toContain("MissionWakeResult")
})

test("services/mission.ts exports loadMissions pointed at /mission", () => {
  expect(SERVICES_MISSION).toContain("export async function loadMissions")
  expect(SERVICES_MISSION).toContain("MissionRecord")
  expect(SERVICES_MISSION).toContain("MissionTaskProjection")
  expect(SERVICES_MISSION).toContain("MissionTaskStats")
  expect(SERVICES_MISSION).toContain("apiJson(`mission${suffix}`")
  expect(SERVICES_MISSION).toContain("server returned non-array body")
})

test("Mission ledger renders mission-created task projections as task selectors", () => {
  expect(MISSION_LIST_TSX).toContain("MissionTaskProjectionRow")
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-task-projection"')
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-task-projection-select"')
  expect(MISSION_LIST_TSX).toContain("props.onSelectTask(props.task.id)")
  expect(MISSION_LIST_TSX).toContain("props.mission.tasks")
  expect(MISSION_LIST_TSX).toContain("mission.ledger.tasks_label")
})

test("Mission ledger is embedded in the left task panel without its retired panel header", () => {
  expect(MISSION_LIST_TSX).not.toContain('data-ui="mission-new"')
  expect(HTML).toContain('id="btnCreateMission"')
  expect(HTML).toContain('data-ui="mission-new"')
  expect(HTML).toContain('data-left-action="mission"')
  expect(HTML).toContain('data-variant="solid"')
  expect(HTML).toContain('data-size="md"')
  expect(HTML).toContain('data-tone="accent"')
  expect(HTML).not.toContain('data-chrome="icon-action"')
  expect(HTML).toContain('class="sidebar-btn-icon"')
  expect(HTML).toContain('class="sidebar-btn-label"')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-header')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-title')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-header-actions')
  expect(MISSION_LIST_TSX).not.toContain('data-ui="mission-back-panel"')
  expect(MISSION_CSS).not.toContain('.oc-button[data-ui="mission-new"]')
  expect(MISSION_CSS).not.toContain(".mission-new-label")
  expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="mission-new"][data-variant="solid"]')
  expect(MISSION_CSS).toContain(".mission-ledger-controls")
  expect(MISSION_CSS).toContain(".mission-project-group .project-group-body")
  expect(MISSION_LIST_TSX).toContain('class="task-row-mini global-task-row mission-row"')
  expect(MISSION_LIST_TSX).not.toContain('class="ledger-row-meta"')
  expect(MISSION_LIST_TSX).not.toContain("compactDirectory")
  expect(MISSION_CSS).toContain(".mission-row.task-row-mini")
  expect(MISSION_LIST_TSX).toContain('data-ui="task-row-cancel"')
  expect(MISSION_LIST_TSX).toContain('data-ui="task-row-rename"')
  expect(MISSION_LIST_TSX).toContain('data-ui="task-row-delete"')
  expect(MISSION_LIST_TSX).toContain("<Show when={canAbort()}>")
  expect(MISSION_LIST_TSX).not.toContain('data-ui="mission-row-abort"')
  expect(MISSION_LIST_TSX).not.toContain('data-ui="mission-row-delete"')
  expect(MISSION_CSS).not.toContain(".mission-row-actions")
  expect(MISSION_LIST_TSX).toContain('class="mission-ledger-search search-field"')
  expect(MISSION_LIST_TSX).toContain('class="mission-ledger-search-input search-field-input"')
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-ledger-search-clear"')
})

test("Mission launcher reuses the main ChatComposer with mission-scoped bindings", () => {
  expect(MISSION_TSX).not.toContain("function MissionComposer")
  expect(MISSION_TSX).not.toContain("<ChatComposer")
  expect(MISSION_TSX).not.toContain("onCreateMission")
  expect(MAIN_TSX).toContain('document.getElementById("btnCreateMission")?.addEventListener("click"')
  expect(MAIN_TSX).toContain("openMissionLauncher()")
  expect(MAIN_TSX).toContain("<ChatComposer")
  expect(MAIN_TSX).toContain("function missionSubmitActive()")
  expect(MAIN_TSX).toContain('"mission-composer-input"')
  expect(MAIN_TSX).toContain('"mission-composer-submit"')
  expect(MAIN_TSX).toContain('composerDraftKey("mission", "new", directory)')
})

test("Mission activity does not implicitly reopen the newest Mission session while launching a new Mission", () => {
  expect(MISSION_TSX).not.toContain("const mission = missionRecords()?.records[0]")
  expect(MISSION_TSX).not.toContain("rows.some((mission) => mission.sessionID === selected)")
  expect(MISSION_TSX).toContain('onSelectMission={(mission) => void handleMissionSelect(mission)}')
  expect(MAIN_TSX).toContain("function selectLeftActivity(activity: LeftActivity)")
  expect(MAIN_TSX).toContain("setMissionLauncherActive(false)")
  expect(MAIN_TSX).toContain("function openMissionLauncher()")
  expect(MAIN_TSX).toContain("setMissionLauncherActive(true)")
  expect(MAIN_TSX).toContain('void selectTask("")')
})

test("Mission task projection selection explicitly rebinds the left toolbar and center panel to Tasks", () => {
  const start = MAIN_TSX.indexOf("function selectMissionTask")
  const end = MAIN_TSX.indexOf("function openMissionLauncher", start)
  const block = MAIN_TSX.slice(start, end)
  expect(block).toContain('resetCenterWorkbenchToFocusedPanel("tasks")')
  expect(block).toContain('setSelectedLeftActivity("tasks")')
  expect(block).toContain('setSelectedLeftPanelActivity("tasks")')
  expect(block).toContain("void selectTask(taskID)")
})

test("selected task source does not globally steal Mission or Assistant activity focus", () => {
  const taskListMount = MAIN_TSX.indexOf('const taskListEl = document.getElementById("taskListPanel")')
  const beforeTaskListMount = MAIN_TSX.slice(0, taskListMount)
  const restoreStart = beforeTaskListMount.indexOf("function focusInitialRestoredTaskWorkspace")
  const restoreEnd = beforeTaskListMount.indexOf("function selectTaskFromTaskList", restoreStart)
  const beforeRestore = beforeTaskListMount.slice(0, restoreStart)
  const afterRestore = restoreEnd >= 0 ? beforeTaskListMount.slice(restoreEnd) : ""
  const globalFocusSource = `${beforeRestore}\n${afterRestore}`
  expect(globalFocusSource).not.toContain('const selectedSource = boardStore.selectedSource')
  expect(globalFocusSource).not.toContain('selectedSource?.kind !== "task"')
  expect(globalFocusSource).not.toContain('boardStore.selectedSource?.kind === "task"')
})

test("initial restored task workspace focuses the task surface once after startup", () => {
  const start = MAIN_TSX.indexOf("function focusInitialRestoredTaskWorkspace")
  const end = MAIN_TSX.indexOf("function selectTaskFromTaskList", start)
  const block = MAIN_TSX.slice(start, end)
  expect(block).toContain('if (!activeTaskID() || boardStore.selectedSource?.kind !== "task") return')
  expect(block).toContain("setMissionLauncherActive(false)")
  expect(block).toContain("setAssistantLauncherActive(false)")
  expect(block).toContain('resetCenterWorkbenchToFocusedPanel("tasks")')
  expect(block).toContain('setSelectedLeftActivity("tasks")')
  expect(block).toContain('setSelectedLeftPanelActivity("tasks")')
  expect(MAIN_TSX).toContain("onConnected: focusInitialRestoredTaskWorkspace")
  expect(MAIN_TSX).not.toContain("onReconnect: focusInitialRestoredTaskWorkspace")
})

test("main ChatComposer exposes the standard Mission data-ui hooks for downstream e2e", () => {
  expect(MAIN_TSX).toContain("function missionSubmitActive()")
  expect(MAIN_TSX).toContain("return missionLauncherActive()")
  expect(MAIN_TSX).not.toContain('missionLauncherActive() || (primaryCenterPanel() === "mission"')
  expect(MAIN_TSX).toContain("function missionLedgerActive()")
  expect(MAIN_TSX).toContain('primaryCenterPanel() === "mission" && !missionSubmitActive() && !isMissionSessionSource()')
  expect(MAIN_TSX).toContain("canComposeChat() && !missionLedgerActive()")
  expect(MAIN_TSX).toContain('composerDraftKey("mission", "ledger", directory)')
  expect(MAIN_TSX).toContain('missionSubmitActive()')
  expect(MAIN_TSX).toContain('"mission-composer-input"')
  expect(MAIN_TSX).toContain('"mission-composer-submit"')
  expect(MAIN_TSX).toMatch(
    /if \(missionSubmitActive\(\)\)[\s\S]+?const result = await wakeMission\(\{ text, model, promptProfile \}\)[\s\S]+?return result/,
  )
  expect(MISSION_TSX).not.toContain('data-ui="mission-composer-mission-id"')
  expect(MISSION_TSX).not.toContain("missionID().trim()")
})

const LAUNCHER_KEYS = [
  "mission.launcher.title",
  "mission.launcher.placeholder",
  "mission.launcher.attachments_unsupported",
]

for (const key of LAUNCHER_KEYS) {
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

test("legacy gateway.compose.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    expect(Object.keys(map).filter((key) => key.startsWith("gateway.compose."))).toEqual([])
  }
})

test("legacy gateway.proposal.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    expect(Object.keys(map).filter((key) => key.startsWith("gateway.proposal."))).toEqual([])
  }
})
