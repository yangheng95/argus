import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PANEL_PANE_CONFIG, type PaneConfig } from "../src/services/pane"

function readSrc(rel: string): string {
  return readFileSync(join(import.meta.dir, "..", "src", rel), "utf8")
}

test("PANEL_PANE_CONFIG targets the default panel's elements and variables", () => {
  expect(PANEL_PANE_CONFIG).toEqual({
    bodyId: "panelBody",
    leftHandleId: "leftPaneResizer",
    rightHandleId: null,
    sidebarVar: "--ui-sidebar-width",
    sectionsVar: "--ui-sections-width",
  } satisfies PaneConfig)
})

test("Mission no longer owns an independent pane layout or persisted widths", () => {
  const pane = readSrc("services/pane.ts")
  const mission = readSrc("components/Mission.tsx")
  const settings = readSrc("store/settings.ts")
  expect(pane).not.toContain("MISSION_PANE_CONFIG")
  expect(pane).not.toContain("missionLedgerResizer")
  expect(pane).not.toContain("missionChannelsResizer")
  expect(mission).not.toContain("initPaneResizers")
  expect(mission).not.toContain("renderPaneLayout")
  expect(mission).not.toContain("missionLedgerWidth")
  expect(mission).not.toContain("missionChannelsWidth")
  expect(settings).not.toContain("missionLedgerWidth")
  expect(settings).not.toContain("missionChannelsWidth")
})

test("right pane drag measures from the whole pane body, not the center column edge", () => {
  const pane = readSrc("services/pane.ts")
  expect(pane).toContain("const panelBody = document.getElementById(config.bodyId)")
  expect(pane).toContain("clampNumber(rect.right - clientX, railMin, max)")
  expect(pane).toContain("export function defaultSectionsWidth")
  expect(pane).toContain("state.sectionsWidth ?? defaultSectionsWidth(config)")
  expect(pane).not.toContain("document.getElementById(config.centerId)")
})

test("default settings keep the right inspector expanded", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  expect(settings).toContain('typeof input?.sidebarCollapsed === "boolean"')
  expect(settings).toContain("rightPanelCollapsed: false")
  expect(settings).toContain('typeof input?.rightPanelCollapsed === "boolean"')
  expect(storage).toContain('sidebarCollapsed: read("oc_sidebar_collapsed") === "true"')
  expect(storage).toContain('rightPanelCollapsedRaw === null ? undefined : rightPanelCollapsedRaw === "true"')
})

test("center workbench width persists through the existing settings source", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  const main = readSrc("main.tsx")
  expect(settings).toContain("centerWorkbenchWidth: number | null")
  expect(settings).toContain("centerWorkbenchWidth: sanitizePaneWidth(input?.centerWorkbenchWidth)")
  expect(settings).toContain("centerWorkbenchWidth: input.centerWorkbenchWidth || undefined")
  expect(storage).toContain('centerWorkbenchWidth: read("oc_center_workbench_width") || undefined')
  expect(storage).toContain('writeOptional("oc_center_workbench_width", input.centerWorkbenchWidth)')
  expect(main).toContain('setSettingsStore("centerWorkbenchWidth", width)')
})

test("center workbench panel weights persist through the existing settings source", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  const main = readSrc("main.tsx")
  const css = readSrc("styles/surfaces/workspace.css")
  expect(settings).toContain("centerWorkbenchPanelWeights: Record<string, number> | null")
  expect(settings).toContain("centerWorkbenchPanelWeights: sanitizePanelWeights(input?.centerWorkbenchPanelWeights)")
  expect(settings).toContain("centerWorkbenchPanelWeights: input.centerWorkbenchPanelWeights || undefined")
  expect(storage).toContain('centerWorkbenchPanelWeights: readJSON("oc_center_workbench_panel_weights")')
  expect(storage).toContain('writeOptionalJSON("oc_center_workbench_panel_weights", input.centerWorkbenchPanelWeights)')
  expect(main).toContain('setSettingsStore("centerWorkbenchPanelWeights"')
  expect(main).toContain("renderCenterWorkbenchPanelWeights")
  expect(main).toContain("renderCenterWorkbenchPanelSeparators")
  expect(main).toContain("resizeCenterWorkbenchPanelByKeyboard")
  expect(main).toContain('"[data-center-workbench-separator]"')
  expect(main).toContain('"aria-controls"')
  expect(css).toContain("--center-workbench-panel-grow")
  expect(css).toContain(".center-workbench-panel-separator")
  expect(css).not.toContain('.center-workbench-view[data-resizable-next="true"]::after')
  expect(css).toContain('body[data-center-workbench-panel-resizing="true"]')
})

test("the default Panel still passes PANEL_PANE_CONFIG", () => {
  const main = readSrc("main.tsx")
  expect(main).toContain("PANEL_PANE_CONFIG")
  expect(main).toContain("initPaneResizers(paneCallbacks, PANEL_PANE_CONFIG)")
})
