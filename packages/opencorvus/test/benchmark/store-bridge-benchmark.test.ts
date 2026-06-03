import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const benchmarkPath = path.join(repoRoot, "packages/opencorvus/script/benchmark/overlay-web-benchmark.ts")
const overlayMainPath = path.join(repoRoot, "packages/overlay/src/main.tsx")

describe("overlay benchmark store bridge", () => {
  test("benchmark probes named overlay stores instead of the legacy state eval bridge", () => {
    const benchmark = readFileSync(benchmarkPath, "utf8")

    expect(benchmark).not.toContain("window.eval(")
    expect(benchmark).toContain("type OverlayBenchmarkWindow")
    expect(benchmark).toContain("boardStore")
    expect(benchmark).toContain("settingsStore")
    expect(benchmark).toContain("overlay.boardStore.selectedTaskID")
    expect(benchmark).toContain("overlay.settingsStore.directory")
    expect(benchmark).not.toContain("loadConversation")
  })

  test("overlay exposes explicit benchmark store hooks", () => {
    const main = readFileSync(overlayMainPath, "utf8")

    expect(main).not.toContain("(window as any).state")
    expect(main).toMatch(/\(window as any\)\.boardStore\s*=\s*boardStore/)
    expect(main).toMatch(/\(window as any\)\.settingsStore\s*=\s*settingsStore/)
  })
})
