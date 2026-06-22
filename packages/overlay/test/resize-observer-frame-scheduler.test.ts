import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createAnimationFrameScheduler } from "../src/utils/animation-frame"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

let nextFrameID = 1
let frames: Map<number, FrameRequestCallback>

beforeEach(() => {
  nextFrameID = 1
  frames = new Map()
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const frameID = nextFrameID++
    frames.set(frameID, callback)
    return frameID
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((frameID: number) => {
    frames.delete(frameID)
  }) as typeof cancelAnimationFrame
})

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
})

function flushFrames(): void {
  const callbacks = Array.from(frames.values())
  frames.clear()
  for (const callback of callbacks) callback(0)
}

test("animation-frame scheduler coalesces repeated resize work into one frame", () => {
  let runs = 0
  const scheduler = createAnimationFrameScheduler(() => {
    runs++
  })

  scheduler.schedule()
  scheduler.schedule()
  scheduler.schedule()

  expect(frames.size).toBe(1)
  expect(runs).toBe(0)
  flushFrames()
  expect(runs).toBe(1)
})

test("animation-frame scheduler cancels pending resize work during cleanup", () => {
  let runs = 0
  const scheduler = createAnimationFrameScheduler(() => {
    runs++
  })

  scheduler.schedule()
  scheduler.cancel()

  expect(frames.size).toBe(0)
  flushFrames()
  expect(runs).toBe(0)
})

test("ResizeObserver callbacks never run layout-affecting work synchronously", () => {
  const card = readFileSync(join(repoRoot, "packages/overlay/src/components/Card.tsx"), "utf8")
  const conversation = readFileSync(join(repoRoot, "packages/overlay/src/components/Conversation.tsx"), "utf8")
  const imagePreview = readFileSync(join(repoRoot, "packages/overlay/src/components/ImagePreview.tsx"), "utf8")
  const screenshotBrowser = readFileSync(join(repoRoot, "packages/overlay/src/components/ScreenshotBrowserPanel.tsx"), "utf8")
  const taskProgress = readFileSync(join(repoRoot, "packages/overlay/src/components/TaskProgressBar.tsx"), "utf8")

  expect(card).toContain("createAnimationFrameScheduler(updateStickyInlineSize)")
  expect(card).toContain("new ResizeObserver(updateStickyInlineSizeOnFrame.schedule)")
  expect(conversation).toContain("createAnimationFrameScheduler(props.onMeasuredContentChanged)")
  expect(conversation).toContain("new ResizeObserver(measuredContentChangedOnFrame.schedule)")
  expect(imagePreview).toContain("createAnimationFrameScheduler(() =>")
  expect(imagePreview).toContain("new ResizeObserver(applyOpenScaleOnFrame.schedule)")
  expect(screenshotBrowser).toContain("createAnimationFrameScheduler(measure)")
  expect(screenshotBrowser).toContain("new ResizeObserver(measureOnFrame.schedule)")
  expect(screenshotBrowser).toContain("measureOnFrame.schedule()")
  expect(taskProgress).toContain("createAnimationFrameScheduler(remeasure)")
  expect(taskProgress).toContain("new ResizeObserver(remeasureOnFrame.schedule)")

  expect(conversation).not.toContain("new ResizeObserver(() => props.onMeasuredContentChanged())")
  expect(imagePreview).not.toContain("new ResizeObserver(() =>")
  expect(screenshotBrowser).not.toContain("new ResizeObserver(measure)")
  expect(screenshotBrowser).not.toContain("measure()\n    const observer = new ResizeObserver")
  expect(taskProgress).not.toContain("new ResizeObserver(remeasure)")
})

test("window and center workbench resize paths use the shared frame scheduler", () => {
  const main = readFileSync(join(repoRoot, "packages/overlay/src/main.tsx"), "utf8")
  const windowResizeStart = main.indexOf("function applyWindowResize(): void")
  const windowResizeEnd = main.indexOf("const applyWindowResizeOnFrame", windowResizeStart)

  expect(windowResizeStart).toBeGreaterThan(0)
  expect(windowResizeEnd).toBeGreaterThan(windowResizeStart)

  const windowResizeFunction = main.slice(windowResizeStart, windowResizeEnd)

  expect(main).toContain('import { createAnimationFrameScheduler } from "./utils/animation-frame"')
  expect(main).toContain("const applyWindowResizeOnFrame = createAnimationFrameScheduler(applyWindowResize)")
  expect(main).toContain('window.addEventListener("resize", applyWindowResizeOnFrame.schedule')
  expect(main).toContain('window.visualViewport.addEventListener("resize", applyWindowResizeOnFrame.schedule')
  expect(main).not.toContain('window.addEventListener("resize", onResize')
  expect(main).not.toContain("window.visualViewport.addEventListener(\"resize\", onResize")

  expect(main).toContain(
    "const applyCenterWorkbenchPanelResizeOnFrame = createAnimationFrameScheduler(applyPendingCenterWorkbenchPanelResize)",
  )
  expect(main).not.toContain("createAnimationFrameScheduler(renderCenterWorkbenchPanelSeparators)")
  expect(windowResizeFunction).toContain("applyZoom(settingsStore.zoom)")
  expect(main).toContain("const renderPaneLayoutOnFrame = createAnimationFrameScheduler(flushPaneLayout)")
  expect(main).toContain("function schedulePaneLayout(state: PaneState): void")
  expect(windowResizeFunction).toContain("schedulePaneLayout(paneCallbacks.getState())")
  expect(windowResizeFunction).not.toContain("renderPaneLayout(paneCallbacks.getState(), PANEL_PANE_CONFIG)")
  expect(windowResizeFunction).toContain("renderCenterWorkbenchPanelLayoutOnFrame.schedule()")
  expect(windowResizeFunction).not.toContain("renderCenterWorkbenchPanelLayout()")
  expect(windowResizeFunction).not.toContain("renderCenterWorkbenchPanelSeparators()")
  expect(main).toContain("pendingCenterWorkbenchPanelResizeClientX = event.clientX")
  expect(main).toContain("applyCenterWorkbenchPanelResizeOnFrame.schedule()")
  expect(main).toContain("applyCenterWorkbenchPanelResizeOnFrame.cancel()")
  expect(main).toContain("applyPendingCenterWorkbenchPanelResize()")
  expect(main).not.toContain("updateCenterWorkbenchPanelWeights(drag, event.clientX")
})

test("center workbench panel open schedules layout reads after DOM state writes", () => {
  const main = readFileSync(join(repoRoot, "packages/overlay/src/main.tsx"), "utf8")
  const resetPanelStart = main.indexOf("function resetCenterWorkbenchToFocusedPanel")
  const nextAfterResetStart = main.indexOf("function hasWorkspaceDiffTarget", resetPanelStart)
  const openPanelStart = main.indexOf("function openCenterWorkbenchPanel(panel: CenterWorkbenchPanel): void")
  const closePanelStart = main.indexOf("function closeCenterWorkbenchPanel", openPanelStart)
  const scheduleRevealStart = main.indexOf("function scheduleCenterWorkbenchPanelReveal(panel: CenterWorkbenchPanel): void")
  const scheduleRevealEnd = main.indexOf("function isRecord", scheduleRevealStart)
  const dragApplyStart = main.indexOf("function applyPendingCenterWorkbenchPanelResize(): void")
  const dragApplyEnd = main.indexOf("const applyCenterWorkbenchPanelResizeOnFrame", dragApplyStart)
  const keyboardResizeStart = main.indexOf("function resizeCenterWorkbenchPanelByKeyboard")
  const keyboardResizeEnd = main.indexOf("function stopCenterWorkbenchPanelResize", keyboardResizeStart)
  const layoutRevealStart = main.indexOf("function renderCenterWorkbenchPanelLayoutAndReveal(): void")
  const layoutRevealEnd = main.indexOf(
    "const renderCenterWorkbenchPanelLayoutOnFrame = createAnimationFrameScheduler",
    layoutRevealStart,
  )
  const panelEffectStart = main.indexOf("createEffect(() => {\n      const panels = centerWorkbenchPanels()")
  const settingsEffectStart = main.indexOf("createEffect(() => {\n      centerWorkbenchPanelWeightsSignature()")
  const nextEffectStart = main.indexOf("createEffect(() => {\n      const panels = centerWorkbenchPanels()", settingsEffectStart)

  expect(resetPanelStart).toBeGreaterThan(0)
  expect(nextAfterResetStart).toBeGreaterThan(resetPanelStart)
  expect(openPanelStart).toBeGreaterThan(0)
  expect(closePanelStart).toBeGreaterThan(openPanelStart)
  expect(scheduleRevealStart).toBeGreaterThan(0)
  expect(scheduleRevealEnd).toBeGreaterThan(scheduleRevealStart)
  expect(dragApplyStart).toBeGreaterThan(0)
  expect(dragApplyEnd).toBeGreaterThan(dragApplyStart)
  expect(keyboardResizeStart).toBeGreaterThan(0)
  expect(keyboardResizeEnd).toBeGreaterThan(keyboardResizeStart)
  expect(layoutRevealStart).toBeGreaterThan(0)
  expect(layoutRevealEnd).toBeGreaterThan(layoutRevealStart)
  expect(panelEffectStart).toBeGreaterThan(0)
  expect(settingsEffectStart).toBeGreaterThan(panelEffectStart)
  expect(nextEffectStart).toBeGreaterThan(settingsEffectStart)

  const resetPanelFunction = main.slice(resetPanelStart, nextAfterResetStart)
  const openPanelFunction = main.slice(openPanelStart, closePanelStart)
  const scheduleRevealFunction = main.slice(scheduleRevealStart, scheduleRevealEnd)
  const dragApplyFunction = main.slice(dragApplyStart, dragApplyEnd)
  const keyboardResizeFunction = main.slice(keyboardResizeStart, keyboardResizeEnd)
  const layoutRevealFunction = main.slice(layoutRevealStart, layoutRevealEnd)
  const panelOpenEffect = main.slice(panelEffectStart, settingsEffectStart)
  const settingsWeightEffect = main.slice(settingsEffectStart, nextEffectStart)

  expect(main).toContain("function renderCenterWorkbenchPanelLayout(): void")
  expect(main).toContain("function centerWorkbenchPanelWeightsSignature(): string")
  expect(main).toContain("const weights = settingsStore.centerWorkbenchPanelWeights")
  expect(main).toContain("const weight = Number(weights[panel])")
  expect(main).toContain(
    "const renderCenterWorkbenchPanelLayoutOnFrame = createAnimationFrameScheduler(renderCenterWorkbenchPanelLayoutAndReveal)",
  )
  expect(main).toContain("renderCenterWorkbenchPanelLayoutOnFrame.cancel()")
  expect(main).not.toContain("createAnimationFrameScheduler(revealPendingCenterWorkbenchPanel)")
  expect(main).not.toContain("revealCenterWorkbenchPanelOnFrame")
  expect(layoutRevealFunction).toContain("renderCenterWorkbenchPanelLayout()")
  expect(layoutRevealFunction).toContain("revealPendingCenterWorkbenchPanel()")
  expect(layoutRevealFunction.indexOf("renderCenterWorkbenchPanelLayout()")).toBeLessThan(
    layoutRevealFunction.indexOf("revealPendingCenterWorkbenchPanel()"),
  )
  expect(resetPanelFunction).toContain('scheduleCenterWorkbenchPanelReveal("workflow")')
  expect(resetPanelFunction).not.toContain("queueMicrotask")
  expect(resetPanelFunction).not.toContain("scrollIntoView")
  expect(openPanelFunction).toContain("scheduleCenterWorkbenchPanelReveal(panel)")
  expect(openPanelFunction).not.toContain("queueMicrotask")
  expect(openPanelFunction).not.toContain("scrollIntoView")
  expect(scheduleRevealFunction).toContain("pendingCenterWorkbenchRevealPanel = panel")
  expect(scheduleRevealFunction).toContain("renderCenterWorkbenchPanelLayoutOnFrame.schedule()")
  expect(panelOpenEffect).toContain("renderCenterWorkbenchPanelLayoutOnFrame.schedule()")
  expect(panelOpenEffect).not.toContain("renderCenterWorkbenchPanelWeights()")
  expect(panelOpenEffect).not.toContain("renderCenterWorkbenchPanelSeparators()")
  expect(settingsWeightEffect).toContain("centerWorkbenchPanelWeightsSignature()")
  expect(settingsWeightEffect).toContain("untrack(renderCenterWorkbenchPanelLayout)")
  expect(settingsWeightEffect).not.toContain("centerWorkbenchPanels().length")
  expect(settingsWeightEffect).not.toContain("renderCenterWorkbenchPanelWeights()")
  expect(settingsWeightEffect).not.toContain("renderCenterWorkbenchPanelSeparators()")
  expect(dragApplyFunction).toContain("updateCenterWorkbenchPanelWeights(drag, clientX - drag.leftRect.left)")
  expect(dragApplyFunction).not.toContain("renderCenterWorkbenchPanelWeights()")
  expect(dragApplyFunction).not.toContain("renderCenterWorkbenchPanelSeparators()")
  expect(keyboardResizeFunction).toContain("updateCenterWorkbenchPanelWeights(metrics, leftWidth)")
  expect(keyboardResizeFunction).not.toContain("renderCenterWorkbenchPanelWeights()")
  expect(keyboardResizeFunction).not.toContain("renderCenterWorkbenchPanelSeparators()")
})
