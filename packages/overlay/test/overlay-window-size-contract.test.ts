import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function readOverlay(rel: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, rel), "utf8")
}

describe("overlay window and pane size contract", () => {
  test("native window minimum follows the desktop layout boundary", () => {
    const config = JSON.parse(readOverlay("src-tauri/tauri.conf.json"))
    const mainWindow = config.app.windows.find((window: { label?: string }) => window.label === "main")

    expect(mainWindow).toBeDefined()
    expect(mainWindow.width).toBeGreaterThanOrEqual(1120)
    expect(mainWindow.height).toBeGreaterThanOrEqual(720)
    expect(mainWindow.minWidth).toBe(1120)
    expect(mainWindow.minHeight).toBe(720)
  })

  test("Rust startup uses the configured minimum without a live resize feedback loop", () => {
    const main = readOverlay("src-tauri/src/main.rs")

    expect(main).toContain("fn overlay_main_min_size(config: &tauri::utils::config::Config) -> OverlayWindowSize")
    expect(main).toContain("overlay_main_min_size(app.config())")
    expect(main).toContain("window.set_min_size(Some(tauri::LogicalSize::new(")
    expect(main).toContain("fn constrain_overlay_window_size(")
    expect(main).toContain("fn startup_overlay_window_size(")
    expect(main).not.toContain("tauri::WindowEvent::Resized")
    expect(main).not.toContain("fn overlay_window_needs_resize(")
    expect(main).not.toContain(".clamp(760.0, 1600.0)")
    expect(main).not.toContain(".clamp(480.0, 920.0)")
  })

  test("browser shell tokens match the native overlay minimum", () => {
    const tokens = readOverlay("src/styles/tokens/design-language.css")
    const base = readOverlay("src/styles/cascade/base.css")
    const activity = readOverlay("src/styles/surfaces/activity.css")
    const workspace = readOverlay("src/styles/surfaces/workspace.css")

    expect(tokens).toContain("--ui-breakpoint-xl: 1120px")
    expect(tokens).toContain("--ui-overlay-min-width: 1120px")
    expect(tokens).toContain("--ui-overlay-min-height: 720px")
    expect(base).toContain("min-width: var(--ui-overlay-min-width)")
    expect(base).toContain("min-height: var(--ui-overlay-min-height)")
    expect(workspace).toContain("@media (width < 1120px)")
    expect(activity).toContain("@media (width < 1120px)")
    expect(workspace).not.toContain("@media (max-width: 1120px)")
    expect(activity).not.toContain("@media (max-width: 1120px)")
  })

  test("pane and center workbench minimums are token-owned", () => {
    const pane = readOverlay("src/services/pane.ts")
    const main = readOverlay("src/main.tsx")
    const workspace = readOverlay("src/styles/surfaces/workspace.css")

    expect(pane).toContain('import { layoutTokenPx } from "../utils/layout-tokens"')
    expect(pane).toContain('layoutTokenPx("--ui-rail-min-width")')
    expect(pane).toContain('layoutTokenPx("--ui-chat-min-width")')
    expect(pane).toContain('layoutTokenPx("--ui-chat-priority-width")')
    expect(pane).not.toContain("120 * scale")
    expect(pane).not.toContain("300 * scale")
    expect(pane).not.toContain("window.innerWidth ??")
    expect(main).toContain('layoutTokenPx("--ui-workbench-panel-min-width")')
    expect(main).not.toContain("CENTER_WORKBENCH_MIN_PANEL_WIDTH")
    expect(main).not.toContain("80 * scale")
    expect(workspace).toContain("max(var(--ui-workbench-panel-min-width), calc(50vw))")
    expect(workspace).not.toContain("max(calc(280px * var(--ui-scale)), calc(50vw))")
  })
})
