import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { browserPreviewLivePoint } from "../src/components/browser-preview-live-point"

const REPO_ROOT = path.resolve(import.meta.dir, "../..", "..")

test("browser preview live point maps rendered image coordinates into viewport coordinates", () => {
  const point = browserPreviewLivePoint(
    { clientX: 350, clientY: 225 },
    { left: 100, top: 50, width: 500, height: 350 },
    { width: 1000, height: 700 },
  )

  expect(point).toEqual({ x: 500, y: 350 })
})

test("browser preview live point clamps pointer coordinates to the viewport", () => {
  const point = browserPreviewLivePoint(
    { clientX: 999, clientY: -10 },
    { left: 10, top: 20, width: 200, height: 100 },
    { width: 400, height: 200 },
  )

  expect(point).toEqual({ x: 400, y: 0 })
})

test("browser preview live point rejects unavailable geometry", () => {
  expect(
    browserPreviewLivePoint(
      { clientX: 20, clientY: 20 },
      { left: 10, top: 10, width: 0, height: 100 },
      { width: 400, height: 200 },
    ),
  ).toBeUndefined()
  expect(
    browserPreviewLivePoint({ clientX: 20, clientY: 20 }, { left: 10, top: 10, width: 100, height: 100 }, undefined),
  ).toBeUndefined()
})

test("test workflow runs the current GUI coordinate smoke target", () => {
  const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/test.yml"), "utf8")

  expect(workflow).toContain("Run GUI coordinate smoke")
  expect(workflow).toContain("bun test --cwd packages/overlay test/browser-preview-live-point.test.ts")
  expect(workflow).not.toContain("packages/opencorvus/script/gui-coordinate-smoke.ts")
})
