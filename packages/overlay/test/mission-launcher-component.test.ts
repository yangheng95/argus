import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Vite replaces this token at build time; the test runner has to provide
// a stub before importing any module that transitively depends on it.
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ =
  "test"

const MISSION_TSX = readFileSync(join(import.meta.dir, "../src/components/Mission.tsx"), "utf8")
const MISSION_LIST_TSX = readFileSync(join(import.meta.dir, "../src/components/MissionList.tsx"), "utf8")
const SERVICES_MISSION = readFileSync(join(import.meta.dir, "../src/services/mission.ts"), "utf8")
const HELPERS = readFileSync(join(import.meta.dir, "../src/utils/mission-helpers.ts"), "utf8")
const I18N_ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")
const I18N_EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")

/**
 * Spec: gateway-mission-split-2026-05-28.md §3.
 *
 * The Mission page's composer surface is the MissionComposer launcher — it
 * starts or resumes a Mission agent session via POST /mission/wake. The
 * legacy decompose-then-review flow (GatewayComposer +
 * GatewayProposalReview) is intentionally absent (rule 8 + 16 / 17).
 *
 * These structural assertions guard the wiring:
 *   - the source no longer references the dead decompose API surface,
 *   - the new wakeMission client function is reachable from the page,
 *   - both locales carry the launcher.* copy the UI renders.
 */

// ── Dead surfaces purged ─────────────────────────────────────

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

test("services/mission.ts no longer exports decompose API surface", () => {
  expect(SERVICES_MISSION).not.toContain("decomposeRequirement")
  expect(SERVICES_MISSION).not.toContain("MissionTaskCandidate")
  expect(SERVICES_MISSION).not.toContain("MissionTaskDecomposition")
})

test("mission-helpers.ts no longer exports composeTaskText", () => {
  expect(HELPERS).not.toContain("composeTaskText")
})

// ── New mission launcher surface present ─────────────────────

test("Mission.tsx uses wakeMission from the mission service", () => {
  expect(MISSION_TSX).toContain('wakeMission')
})

test("Mission wake result opens the shared mission conversation surface", () => {
  expect(MISSION_TSX).toContain("handleMissionAwake")
  expect(MISSION_TSX).toContain("missionRecordsCtl.refetch()")
  expect(MISSION_TSX).toContain('setBoardStore("selectedSource", source)')
  expect(MISSION_TSX).toContain('setBoardStore("board", null)')
  expect(MISSION_TSX).toContain("loadConversation(source")
  expect(MISSION_TSX).toContain("startSSE(source")
  expect(MISSION_TSX).toContain("MissionConversation")
})

test("Mission conversation reuses the shared agent rail and workspace components", () => {
  expect(MISSION_TSX).toContain('import { ConversationAgentRail } from "./ConversationAgentRail"')
  expect(MISSION_TSX).toContain('import { WorkspacePanel } from "./WorkspacePanel"')
  expect(MISSION_TSX).toContain("<ConversationAgentRail />")
  expect(MISSION_TSX).toContain("<WorkspacePanel target={props.workspaceTarget()} onClose={props.closeWorkspace} />")
  expect(MISSION_TSX).toContain('data-ui="mission-agent-rail"')
  expect(MISSION_TSX).toContain('data-ui="mission-workspace"')
})

test("Mission channels do not load or render task-scoped bindings", () => {
  expect(MISSION_TSX).not.toContain("loadTaskBindings")
  expect(MISSION_TSX).not.toContain('data-ui="mission-channels-bindings"')
  expect(MISSION_TSX).not.toContain("activeTaskID")
  expect(MISSION_TSX).not.toContain("bindings_empty_no_task")
  expect(SERVICES_MISSION).toContain("export async function loadTaskBindings")
})

test("Mission list refreshes after follow-up Mission messages", () => {
  expect(MISSION_TSX).toContain("handleMissionMessageSubmitted")
  expect(MISSION_TSX).toContain("setMissionRefreshToken")
  expect(MISSION_TSX).toContain("onMissionMessageSubmitted")
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

test("Mission ledger renders mission-created task projections under each mission", () => {
  expect(MISSION_LIST_TSX).toContain("MissionTaskProjectionRow")
  expect(MISSION_LIST_TSX).toContain('data-ui="mission-task-projection"')
  expect(MISSION_LIST_TSX).toContain("props.mission.tasks")
  expect(MISSION_LIST_TSX).toContain("mission.ledger.tasks_label")
})

test("Mission ledger back action is a text-only Task button", () => {
  const backButton = MISSION_LIST_TSX.match(/data-ui="mission-back-panel"[\s\S]*?<\/Button>/)?.[0] ?? ""
  expect(backButton).toContain("<span>{t(\"mission.back\")}</span>")
  expect(backButton).not.toContain("<Icon")
  expect(I18N_EN_US).toContain('"mission.back": "Task"')
  expect(I18N_ZH_CN).toContain('"mission.back": "Task"')
})

test("Mission conversation header shows runtime instead of close", () => {
  expect(MISSION_TSX).toContain('data-ui="mission-runtime"')
  expect(MISSION_TSX).toContain("formatDuration")
  expect(MISSION_TSX).toContain("useNowTick")
  expect(MISSION_TSX).not.toContain('data-ui="mission-close"')
})

test("Mission channel rail shows created task stats before channel runtime", () => {
  const statsIndex = MISSION_TSX.indexOf('data-ui="mission-created-task-stats"')
  const runtimeIndex = MISSION_TSX.indexOf('data-ui="mission-channels-runtime"')
  expect(statsIndex).toBeGreaterThan(0)
  expect(runtimeIndex).toBeGreaterThan(statsIndex)
  expect(MISSION_TSX).toContain("missionChannelTaskStats")
})

test("MissionComposer reuses ChatComposer with mission-scoped DOM ids", () => {
  expect(MISSION_TSX).toContain('formID="missionLauncherChatForm"')
  expect(MISSION_TSX).toContain('textareaID="missionLauncherChatTextarea"')
  expect(MISSION_TSX).toContain('sendID="missionLauncherChatSend"')
  expect(MISSION_TSX).toContain('textareaDataUI="mission-composer-input"')
  expect(MISSION_TSX).toContain('sendDataUI="mission-composer-submit"')
})

test("MissionComposer exposes the standard data-ui hooks for downstream e2e", () => {
  // These attributes are part of the mission page contract — the e2e
  // tests select on them rather than on i18n text.
  expect(MISSION_TSX).toContain('textareaDataUI="mission-composer-input"')
  expect(MISSION_TSX).toContain('sendDataUI="mission-composer-submit"')
  expect(MISSION_TSX).not.toContain('data-ui="mission-composer-mission-id"')
  expect(MISSION_TSX).not.toContain("missionID().trim()")
})

// ── i18n launcher keys present in both locales ───────────────

const LAUNCHER_KEYS = [
  "mission.launcher.title",
  "mission.launcher.error",
  "mission.launcher.discard",
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

// ── No legacy compose/proposal keys leak through ─────────────

test("legacy gateway.compose.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    const stragglers = Object.keys(map).filter((k) => k.startsWith("gateway.compose."))
    expect(stragglers).toEqual([])
  }
})

test("legacy gateway.proposal.* keys are fully removed from both locales", () => {
  const zh = JSON.parse(I18N_ZH_CN) as Record<string, unknown>
  const en = JSON.parse(I18N_EN_US) as Record<string, unknown>
  for (const map of [zh, en]) {
    const stragglers = Object.keys(map).filter((k) => k.startsWith("gateway.proposal."))
    expect(stragglers).toEqual([])
  }
})
