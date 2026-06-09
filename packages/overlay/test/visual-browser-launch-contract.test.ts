import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readOverlay(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8")
}

function readRepo(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, "..", "..", relativePath), "utf8")
}

test("visual capture scripts launch a headed Node-sidecar browser", () => {
  const launch = readOverlay("test/launch.ts")
  expect(launch).toContain("export type LaunchBrowserOptions")
  expect(launch).toContain("headless: params.headless !== false")
  expect(launch).toContain("new OverlayBrowserSidecar(extraArgs ?? [], options.headless ?? true")

  for (const file of [
    "test/mission-visual-loop.ts",
    "test/goal-group-benchmark.ts",
    "test/debug-card-visual.ts",
    "test/redesign-visual-capture.ts",
    "test/screenshot-card-visual.ts",
  ]) {
    expect(readOverlay(file), file).toContain("headless: false")
  }

  for (const file of [
    "packages/opencorvus/script/benchmark/capture-ainvest-reference.ts",
    "packages/opencorvus/script/benchmark/audit-calculator.ts",
    "packages/opencorvus/script/benchmark/review-deliverable.ts",
  ]) {
    expect(readRepo(file), file).toContain("headless: false")
  }

  expect(readOverlay("test/goal-group-benchmark.ts")).not.toContain("run headless")
})
