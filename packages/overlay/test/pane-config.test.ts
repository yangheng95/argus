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
    leftControls: ["sidebar", "workspaceMain"],
    rightHandleId: null,
    rightControls: null,
    sidebarVar: "--ui-sidebar-width",
    sectionsVar: "--ui-sections-width",
  } satisfies PaneConfig)
})

test("default pane resizer exposes separator semantics through the pane service", () => {
  const html = readSrc("index.html")
  const main = readSrc("main.tsx")
  const pane = readSrc("services/pane.ts")
  const css = readSrc("styles/surfaces/workspace.css")
  expect(html).toContain('id="leftPaneResizer"')
  expect(html).toContain('aria-label="Resize left panel"')
  expect(html).toContain('aria-controls="sidebar workspaceMain"')
  expect(html).toContain('aria-valuenow="0"')
  expect(html).toContain('tabindex="0"')
  expect(pane).toContain("function renderPaneHandleSemantics")
  expect(pane).toContain("const renderPaneHandleSemanticsOnFrame = createAnimationFrameScheduler(flushPaneHandleSemantics)")
  expect(pane).toContain("function schedulePaneHandleSemantics")
  expect(pane).toContain("function resizePaneByKeyboard")
  expect(pane).toContain('import { createAnimationFrameScheduler, type AnimationFrameScheduler } from "../utils/animation-frame"')
  expect(pane).toContain('import { layoutTokenPx } from "../utils/layout-tokens"')
  expect(pane).toContain('layoutTokenPx("--ui-rail-width")')
  expect(pane).toContain('layoutTokenPx("--ui-sections-width")')
  expect(pane).toContain('layoutTokenPx("--ui-rail-min-width")')
  expect(pane).toContain('layoutTokenPx("--ui-chat-min-width")')
  expect(pane).toContain('layoutTokenPx("--ui-chat-priority-width")')
  expect(pane).not.toContain("120 * scale")
  expect(pane).not.toContain("300 * scale")
  expect(pane).toContain("function flushPendingPaneResize")
  expect(pane).toContain("pendingClientX")
  expect(pane).toContain("paneDrag.resizeOnFrame.schedule()")
  expect(pane).toContain("paneDrag.resizeOnFrame.cancel()")
  expect(pane).not.toContain("resizePane(paneDrag.side, event.clientX")
  expect(pane).toContain('side: "left" | "right"')
  expect(pane).toContain('side === "left" ? sidebarWidth : null')
  expect(pane).toContain('side === "right" ? sectionsWidth : null')
  expect(pane).toContain("aria-valuemin")
  expect(pane).toContain("aria-valuemax")
  expect(pane).toContain("aria-valuenow")
  expect(pane).toContain("tabIndex = enabled ? 0 : -1")
  expect(pane).toContain('addEventListener("keydown"')
  expect(css).toContain(".pane-resizer:focus-visible")
  expect(css).toContain("outline: var(--oc-border-width) solid var(--accent)")
  expect(css).not.toContain('body[data-resizing="row"]')
  expect(css).not.toContain("row-resize")
  expect(css).not.toContain('body[data-resizing="true"] .pane-resizer::before')
  expect(css).toContain('body[data-resizing="true"] .pane-resizer::after')
  expect(pane).toContain('document.body.dataset.resizing = "true"')
  expect(pane).not.toContain('document.body.dataset.resizing = "row"')
  expect(main).not.toContain("leftResizer.dataset.disabled")
})

test("pane layout writes and handle semantics run in separate frame phases", () => {
  const pane = readSrc("services/pane.ts")
  const main = readSrc("main.tsx")
  const renderPaneLayoutStart = pane.indexOf("export function renderPaneLayout")
  const applyWindowResizeStart = main.indexOf("function applyWindowResize(): void")
  const applyWindowResizeEnd = main.indexOf("const applyWindowResizeOnFrame", applyWindowResizeStart)

  expect(renderPaneLayoutStart).toBeGreaterThan(0)
  expect(applyWindowResizeStart).toBeGreaterThan(0)
  expect(applyWindowResizeEnd).toBeGreaterThan(applyWindowResizeStart)

  const renderPaneLayoutFunction = pane.slice(renderPaneLayoutStart, pane.indexOf("\n}\n", renderPaneLayoutStart) + 3)
  const applyWindowResizeFunction = main.slice(applyWindowResizeStart, applyWindowResizeEnd)

  expect(pane).toContain("const pendingPaneHandleSemantics = new Map<PaneConfig, PaneState>()")
  expect(pane).toContain("pendingPaneHandleSemantics.set(config, { ...state })")
  expect(pane).toContain("renderPaneHandleSemanticsOnFrame.schedule()")
  expect(renderPaneLayoutFunction).toContain("setPaneWidthProperty(config.sidebarVar, widths.sidebar)")
  expect(renderPaneLayoutFunction).toContain("setPaneWidthProperty(config.sectionsVar, widths.sections)")
  expect(renderPaneLayoutFunction).toContain("schedulePaneHandleSemantics(state, config)")
  expect(renderPaneLayoutFunction).not.toContain("renderPaneHandleSemantics(state, config)")
  expect(main).toContain("const renderPaneLayoutOnFrame = createAnimationFrameScheduler(flushPaneLayout)")
  expect(main).toContain("function schedulePaneLayout(state: PaneState): void")
  expect(applyWindowResizeFunction).toContain("applyZoom(settingsStore.zoom)")
  expect(applyWindowResizeFunction).toContain("schedulePaneLayout(paneCallbacks.getState())")
  expect(applyWindowResizeFunction).not.toContain("renderPaneLayout(paneCallbacks.getState(), PANEL_PANE_CONFIG)")
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
  expect(pane).toContain("function paneResizeBounds")
  expect(pane).toContain("bounds.bodyRect.right - clientX")
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

test("center workbench no longer keeps an outer width source", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  const main = readSrc("main.tsx")
  expect(settings).not.toContain("centerWorkbenchWidth")
  expect(storage).not.toContain("oc_center_workbench_width")
  expect(main).not.toContain("centerWorkbenchWidth")
  expect(main).not.toContain("centerWorkbenchResizer")
})

test("center workbench panel weights persist through the existing settings source", () => {
  const settings = readSrc("store/settings.ts")
  const storage = readSrc("services/overlay-settings-storage.ts")
  const main = readSrc("main.tsx")
  const html = readSrc("index.html")
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
  expect(main).toContain("centerWorkbenchShowsAdjacentPanels")
  expect(main).toContain("separator.addEventListener(")
  expect(main).toContain('"[data-center-workbench-separator]"')
  expect(main).toContain('"aria-controls"')
  expect(main).not.toContain("findCenterWorkbenchResizePanel")
  expect(main).not.toContain("boundaryX")
  expect(main).not.toContain("data.resizableNext")
  expect(main).not.toContain("data.resizablePrev")
  expect(html).toContain('data-center-workbench-separator="workflow"')
  expect(html).toContain('data-center-workbench-separator="notifications"')
  expect(css).toContain("--center-workbench-panel-grow")
  expect(css).toContain(".center-workbench-panel-separator")
  expect(css).toContain(".center-workbench-panel-separator:focus-visible")
  expect(css).toContain("outline: var(--oc-border-width) solid var(--accent)")
  expect(css).toContain("outline-offset: calc(1px * var(--ui-scale))")
  expect(css).not.toContain("--oc-focus-ring-width")
  expect(css).not.toContain("var(--focus)")
  expect(css).not.toContain(".center-workbench-resizer")
  expect(css).not.toContain('.center-workbench-view[data-resizable-next="true"]::after')
  expect(css).toContain('body[data-center-workbench-panel-resizing="true"]')
})

test("the default Panel still passes PANEL_PANE_CONFIG", () => {
  const main = readSrc("main.tsx")
  expect(main).toContain("PANEL_PANE_CONFIG")
  expect(main).toContain("initPaneResizers(paneCallbacks, PANEL_PANE_CONFIG)")
})
