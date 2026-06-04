import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("tui host panel wiring", () => {
  test("right activity mounts the ghostty-backed embedded host panel", () => {
    const main = readFileSync(resolve(import.meta.dir, "../src/main.tsx"), "utf8")
    expect(main).toContain('import { TuiHostPanel } from "./components/TuiHostPanel"')
    expect(main).toContain('<TuiHostPanel active={() => rightActivity() === "tui"} />')
    expect(main).not.toContain("TuiRuntimePanel")
  })

  test("panel uses ghostty-web with embedded host input, resize, and snapshot APIs", () => {
    const panel = readFileSync(resolve(import.meta.dir, "../src/components/TuiHostPanel.tsx"), "utf8")
    expect(panel).toContain('import("ghostty-web")')
    expect(panel).toContain("new mod.Terminal")
    expect(panel).toContain("new mod.FitAddon")
    expect(panel).toContain("sendTuiHostInput(data)")
    expect(panel).toContain("resizeTuiHost({ cols, rows })")
    expect(panel).toContain("loadTuiHostSnapshot()")
    expect(panel).toContain("new ResizeObserver")
    expect(panel).toContain("resizeObserver?.disconnect()")
    expect(panel).not.toContain("loadTuiRuntimeStatus")
  })
})
