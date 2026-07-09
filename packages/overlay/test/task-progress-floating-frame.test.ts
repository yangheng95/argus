import { expect, test } from "bun:test"
import {
  clampTaskProgressFloatingFrame,
  initialTaskProgressFloatingFrame,
  moveTaskProgressFloatingFrame,
  resizeTaskProgressFloatingFrame,
  taskProgressFloatingBounds,
} from "../src/components/task-progress-floating-frame"

test("task progress floating frame initializes inside message panel bounds", () => {
  const bounds = taskProgressFloatingBounds(900, 520, 1)
  const frame = initialTaskProgressFloatingFrame(bounds)

  expect(frame).toEqual({ x: 8, y: 8, width: 690, height: 220 })
})

test("task progress floating move clamps to the message panel", () => {
  const bounds = taskProgressFloatingBounds(900, 520, 1)
  const start = { x: 8, y: 8, width: 360, height: 160 }

  expect(moveTaskProgressFloatingFrame(start, 1200, 900, bounds)).toEqual({
    x: 532,
    y: 352,
    width: 360,
    height: 160,
  })
  expect(moveTaskProgressFloatingFrame(start, -80, -80, bounds)).toEqual({
    x: 8,
    y: 8,
    width: 360,
    height: 160,
  })
})

test("task progress floating resize clamps size and preserves anchored corner", () => {
  const bounds = taskProgressFloatingBounds(900, 520, 1)
  const start = { x: 100, y: 80, width: 420, height: 170 }

  expect(resizeTaskProgressFloatingFrame(start, 600, 500, bounds)).toEqual({
    x: 100,
    y: 80,
    width: 792,
    height: 432,
  })
  expect(resizeTaskProgressFloatingFrame(start, -300, -120, bounds)).toEqual({
    x: 100,
    y: 80,
    width: 320,
    height: 96,
  })
})

test("task progress floating bounds reject invalid panels instead of falling back", () => {
  expect(() => taskProgressFloatingBounds(0, 520, 1)).toThrow("panel width")
  expect(() => taskProgressFloatingBounds(900, Number.NaN, 1)).toThrow("panel height")
  expect(() => taskProgressFloatingBounds(900, 520, 0)).toThrow("scale")
})
