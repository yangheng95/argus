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
  const taskProgress = readFileSync(join(repoRoot, "packages/overlay/src/components/TaskProgressBar.tsx"), "utf8")

  expect(card).toContain("createAnimationFrameScheduler(updateStickyInlineSize)")
  expect(card).toContain("new ResizeObserver(updateStickyInlineSizeOnFrame.schedule)")
  expect(conversation).toContain("createAnimationFrameScheduler(props.onMeasuredContentChanged)")
  expect(conversation).toContain("new ResizeObserver(measuredContentChangedOnFrame.schedule)")
  expect(taskProgress).toContain("createAnimationFrameScheduler(remeasure)")
  expect(taskProgress).toContain("new ResizeObserver(remeasureOnFrame.schedule)")

  expect(conversation).not.toContain("new ResizeObserver(() => props.onMeasuredContentChanged())")
  expect(taskProgress).not.toContain("new ResizeObserver(remeasure)")
})
