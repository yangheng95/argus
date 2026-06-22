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
  expect(taskProgress).toContain("createAnimationFrameScheduler(remeasure)")
  expect(taskProgress).toContain("new ResizeObserver(remeasureOnFrame.schedule)")

  expect(conversation).not.toContain("new ResizeObserver(() => props.onMeasuredContentChanged())")
  expect(imagePreview).not.toContain("new ResizeObserver(() =>")
  expect(screenshotBrowser).not.toContain("new ResizeObserver(measure)")
  expect(taskProgress).not.toContain("new ResizeObserver(remeasure)")
})

test("window and center workbench resize paths use the shared frame scheduler", () => {
  const main = readFileSync(join(repoRoot, "packages/overlay/src/main.tsx"), "utf8")

  expect(main).toContain('import { createAnimationFrameScheduler } from "./utils/animation-frame"')
  expect(main).toContain("const applyWindowResizeOnFrame = createAnimationFrameScheduler(applyWindowResize)")
  expect(main).toContain('window.addEventListener("resize", applyWindowResizeOnFrame.schedule')
  expect(main).toContain('window.visualViewport.addEventListener("resize", applyWindowResizeOnFrame.schedule')
  expect(main).not.toContain('window.addEventListener("resize", onResize')
  expect(main).not.toContain("window.visualViewport.addEventListener(\"resize\", onResize")

  expect(main).toContain(
    "const applyCenterWorkbenchPanelResizeOnFrame = createAnimationFrameScheduler(applyPendingCenterWorkbenchPanelResize)",
  )
  expect(main).toContain("pendingCenterWorkbenchPanelResizeClientX = event.clientX")
  expect(main).toContain("applyCenterWorkbenchPanelResizeOnFrame.schedule()")
  expect(main).toContain("applyCenterWorkbenchPanelResizeOnFrame.cancel()")
  expect(main).toContain("applyPendingCenterWorkbenchPanelResize()")
  expect(main).not.toContain("updateCenterWorkbenchPanelWeights(drag, event.clientX")
})

test("center workbench panel open schedules layout reads after DOM state writes", () => {
  const main = readFileSync(join(repoRoot, "packages/overlay/src/main.tsx"), "utf8")
  const panelEffectStart = main.indexOf("createEffect(() => {\n      const panels = centerWorkbenchPanels()")
  const settingsEffectStart = main.indexOf("createEffect(() => {\n      settingsStore.centerWorkbenchPanelWeights")
  const nextEffectStart = main.indexOf("createEffect(() => {\n      const panels = centerWorkbenchPanels()", settingsEffectStart)

  expect(panelEffectStart).toBeGreaterThan(0)
  expect(settingsEffectStart).toBeGreaterThan(panelEffectStart)
  expect(nextEffectStart).toBeGreaterThan(settingsEffectStart)

  const panelOpenEffect = main.slice(panelEffectStart, settingsEffectStart)
  const settingsWeightEffect = main.slice(settingsEffectStart, nextEffectStart)

  expect(main).toContain("function renderCenterWorkbenchPanelLayout(): void")
  expect(main).toContain(
    "const renderCenterWorkbenchPanelLayoutOnFrame = createAnimationFrameScheduler(renderCenterWorkbenchPanelLayout)",
  )
  expect(main).toContain("disposers.push(() => renderCenterWorkbenchPanelLayoutOnFrame.cancel())")
  expect(panelOpenEffect).toContain("renderCenterWorkbenchPanelLayoutOnFrame.schedule()")
  expect(panelOpenEffect).not.toContain("renderCenterWorkbenchPanelWeights()")
  expect(panelOpenEffect).not.toContain("renderCenterWorkbenchPanelSeparators()")
  expect(settingsWeightEffect).toContain("settingsStore.centerWorkbenchPanelWeights")
  expect(settingsWeightEffect).not.toContain("centerWorkbenchPanels().length")
})
