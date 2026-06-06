import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PANEL_PANE_CONFIG, MISSION_PANE_CONFIG, type PaneConfig } from "../src/services/pane"

// The pane resizer service is now config-driven (one implementation, two
// layouts) — the Panel and Mission each supply their own DOM handles + CSS
// variables. These tests pin the two contracts so a future edit can't
// silently collapse them back to a single hardcoded layout (rule 8) or make
// Mission share the Panel's width state (the user asked for independent
// persistence).

function readSrc(rel: string): string {
  return readFileSync(join(import.meta.dir, "..", "src", rel), "utf8")
}

test("PANEL_PANE_CONFIG targets the default panel's elements + variables", () => {
  expect(PANEL_PANE_CONFIG).toEqual({
    bodyId: "panelBody",
    leftHandleId: "leftPaneResizer",
    rightHandleId: "rightPaneResizer",
    sidebarVar: "--ui-sidebar-width",
    sectionsVar: "--ui-sections-width",
  } satisfies PaneConfig)
})

test("MISSION_PANE_CONFIG targets the mission page's elements + variables", () => {
  expect(MISSION_PANE_CONFIG).toEqual({
    bodyId: "missionBody",
    leftHandleId: "missionLedgerResizer",
    rightHandleId: "missionChannelsResizer",
    sidebarVar: "--ui-mission-ledger-width",
    sectionsVar: "--ui-mission-channels-width",
  } satisfies PaneConfig)
})

test("the two configs share NO element id or CSS variable (independent layouts)", () => {
  const fields: (keyof PaneConfig)[] = [
    "bodyId", "leftHandleId", "rightHandleId", "sidebarVar", "sectionsVar",
  ]
  for (const field of fields) {
    expect(MISSION_PANE_CONFIG[field]).not.toBe(PANEL_PANE_CONFIG[field])
  }
})

test("Mission wires the drag service with MISSION_PANE_CONFIG and its own width settings", () => {
  const mission = readSrc("components/Mission.tsx")
  expect(mission).toContain('import { initPaneResizers, renderPaneLayout, MISSION_PANE_CONFIG } from "../services/pane"')
  expect(mission).toContain("initPaneResizers(missionPaneCallbacks, MISSION_PANE_CONFIG)")
  expect(mission).toContain("settingsStore.missionLedgerWidth")
  expect(mission).toContain("settingsStore.missionChannelsWidth")
  // Mission has no column-collapse affordance — the drag service's collapse
  // gates must be hard false, not wired to the Panel's collapse settings.
  expect(mission).toContain("sidebarCollapsed: false")
  expect(mission).toContain("rightPanelCollapsed: false")
  // The handles must exist in the DOM so onMount can attach to them.
  expect(mission).toContain('id="missionBody"')
  expect(mission).toContain('id="missionWorkbench"')
  expect(mission).toContain('id="missionLedgerResizer"')
  expect(mission).toContain('id="missionChannelsResizer"')
})

test("right pane drag measures from the whole pane body, not the center column edge", () => {
  const pane = readSrc("services/pane.ts")
  expect(pane).toContain('const panelBody = document.getElementById(config.bodyId);')
  expect(pane).toContain("clampNumber(rect.right - clientX, railMin, max)")
  expect(pane).toContain("export function defaultSectionsWidth")
  expect(pane).toContain("state.sectionsWidth ?? defaultSectionsWidth(config)")
  expect(pane).not.toContain("document.getElementById(config.centerId)")
})

test("default settings collapse the right panel without collapsing Mission", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  expect(settings).toContain("rightPanelCollapsed: true")
  expect(settings).toContain('typeof input?.rightPanelCollapsed === "boolean"')
  expect(storage).toContain('rightPanelCollapsedRaw === null ? undefined : rightPanelCollapsedRaw === "true"')
})

test("Mission conversation scroll container opts into the visible chat scrollbar", () => {
  const base = readSrc("styles/cascade/base.css")
  expect(base).toContain(".mission-conversation-body,")
  expect(base).toContain(".mission-conversation-body::-webkit-scrollbar")
  expect(base).toContain(".mission-conversation-body::-webkit-scrollbar-thumb")
})

test("the default Panel still passes PANEL_PANE_CONFIG (no behavior change)", () => {
  const main = readSrc("main.tsx")
  expect(main).toContain("PANEL_PANE_CONFIG")
  expect(main).toContain("initPaneResizers(paneCallbacks, PANEL_PANE_CONFIG)")
})

test("settings store persists the mission column widths independently", () => {
  const settings = readSrc("store/settings.ts")
  // Declared on the settings type + default + sanitised on load + serialised
  // on save, mirroring sidebarWidth / sectionsWidth.
  expect(settings).toContain("missionLedgerWidth: number | null")
  expect(settings).toContain("missionChannelsWidth: number | null")
  expect(settings).toContain("missionLedgerWidth: sanitizePaneWidth(input?.missionLedgerWidth)")
  expect(settings).toContain("missionChannelsWidth: sanitizePaneWidth(input?.missionChannelsWidth)")
  expect(settings).toContain("missionLedgerWidth: input.missionLedgerWidth || undefined")
  expect(settings).toContain("missionChannelsWidth: input.missionChannelsWidth || undefined")
})

test("Mission column headers reuse the shared .oc-surface-header primitive (no bespoke header chrome)", () => {
  const mission = readSrc("components/Mission.tsx")
  const missionList = readSrc("components/MissionList.tsx")
  // Each of the three column headers carries the shared primitive class. The
  // ledger header belongs to MissionList, the single source for Mission rows.
  expect(missionList).toContain('class="mission-ledger-header oc-surface-header"')
  expect(mission).toContain('class="mission-conversation-header chat-header oc-surface-header"')
  expect(mission).toContain('class="mission-channels-header oc-surface-header"')
  // The "Task context" kicker (mission.workbench.task_kicker) that duplicated
  // the column meaning above the task conversation is gone.
  expect(mission).not.toContain("mission-conversation-kicker")
  expect(mission).not.toContain("mission.workbench.task_kicker")
})

test("mission.css no longer overrides conversation card sizing / goals strip / composer width", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/mission.css"), "utf8")
  // The card-centering + 920px clamp that fought conversation.css is gone.
  expect(css).not.toContain(".mission-conversation .chat-scroll")
  // The negative-margin bleed hack on the goals strip is gone.
  expect(css).not.toContain(".mission-conversation .task-progress")
  // The composer max-width centering that stopped it filling the column is gone.
  expect(css).not.toMatch(/\.mission-conversation-composer\s+\.chat-input/)
})
