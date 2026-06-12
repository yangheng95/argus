import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST_TSX = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const MISSION_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/mission.css"), "utf8")
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
  expect(MISSION_TSX).toContain("loadMissions({")
  expect(MISSION_TSX).toContain("limit: MISSION_LIST_PAGE_SIZE + 1")
  expect(MISSION_TSX).toContain("cursorUpdated: cursor.updated")
  expect(MISSION_TSX).toContain("cursorSessionID: cursor.sessionID")
  expect(MISSION_TSX).toContain("missionPage(records, MISSION_LIST_PAGE_SIZE)")
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
  const newButton = MISSION_LIST_TSX.match(/<Button[\s\S]*?data-ui="mission-new"[\s\S]*?<\/Button>/)?.[0] ?? ""
  expect(newButton).toContain('variant="ghost"')
  expect(newButton).toContain('size="icon"')
  expect(newButton).toContain('tone="accent"')
  expect(newButton).toContain('data-chrome="icon-action"')
  expect(newButton).toContain('class="mission-new-label"')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-header')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-title')
  expect(MISSION_LIST_TSX).not.toContain('class="mission-ledger-header-actions')
  expect(MISSION_LIST_TSX).not.toContain('data-ui="mission-back-panel"')
  expect(MISSION_CSS).not.toContain('.oc-button[data-ui="mission-new"][data-variant="solid"]')
  expect(MISSION_CSS).toContain('.oc-button[data-ui="mission-new"]')
  expect(MISSION_CSS).toContain("justify-content: center;")
  expect(MISSION_CSS).toContain(".mission-ledger-controls")
  expect(MISSION_CSS).toContain(".mission-project-group .project-group-body")
  expect(MISSION_LIST_TSX).toContain('class="mission-ledger-search search-field"')
  expect(MISSION_LIST_TSX).toContain('class="mission-ledger-search-input search-field-input"')
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-ledger-search-clear"')
})

test("Mission launcher reuses the main ChatComposer with mission-scoped bindings", () => {
  expect(MISSION_TSX).not.toContain("function MissionComposer")
  expect(MISSION_TSX).not.toContain("<ChatComposer")
  expect(MISSION_TSX).toContain("props.onCreateMission()")
  expect(MAIN_TSX).toContain("<ChatComposer")
  expect(MAIN_TSX).toContain('textareaDataUI={missionLauncherActive() ? "mission-composer-input" : undefined}')
  expect(MAIN_TSX).toContain('sendDataUI={missionLauncherActive() ? "mission-composer-submit" : undefined}')
  expect(MAIN_TSX).toContain('composerDraftKey("mission", "new", directory)')
})

test("main ChatComposer exposes the standard Mission data-ui hooks for downstream e2e", () => {
  expect(MAIN_TSX).toContain('textareaDataUI={missionLauncherActive() ? "mission-composer-input" : undefined}')
  expect(MAIN_TSX).toContain('sendDataUI={missionLauncherActive() ? "mission-composer-submit" : undefined}')
  expect(MISSION_TSX).not.toContain('data-ui="mission-composer-mission-id"')
  expect(MISSION_TSX).not.toContain("missionID().trim()")
})

const LAUNCHER_KEYS = [
  "mission.launcher.title",
  "mission.launcher.error",
  "mission.launcher.placeholder",
  "mission.launcher.discard_title",
  "mission.launcher.result_created",
  "mission.launcher.result_resumed",
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
