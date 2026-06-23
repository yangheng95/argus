import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function readOverlay(rel: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, rel), "utf8")
}

function readStyleFiles(dir = path.join(OVERLAY_ROOT, "src/styles")): Array<{ file: string; source: string }> {
  const files: Array<{ file: string; source: string }> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...readStyleFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      files.push({ file: path.relative(OVERLAY_ROOT, fullPath), source: readFileSync(fullPath, "utf8") })
    }
  }
  return files
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
    expect(main).toContain("fn install_overlay_resize_aspect_constraint")
    expect(main).toContain("WM_SIZING")
    expect(main).toContain("SetWindowSubclass")
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
    expect(tokens).toContain("--ui-overlay-min-width-units: 1120")
    expect(tokens).toContain("--ui-overlay-min-height-units: 720")
    expect(tokens).toContain("--ui-workbench-panel-min-width: calc(280px * var(--ui-scale))")
    expect(tokens).toContain("--ui-overlay-min-width: calc(var(--ui-overlay-min-width-units) * 1px)")
    expect(tokens).toContain("--ui-overlay-min-height: calc(var(--ui-overlay-min-height-units) * 1px)")
    expect(tokens).toContain(
      "--ui-overlay-min-aspect-ratio: calc(var(--ui-overlay-min-width-units) / var(--ui-overlay-min-height-units))",
    )
    expect(base).toContain("width: 100vw")
    expect(base).toContain("min-width: var(--ui-overlay-min-width)")
    expect(base).toContain("min-height: var(--ui-overlay-min-height)")
    expect(base).toContain(
      "height: min(100vh, calc(100vw * var(--ui-overlay-min-height-units) / var(--ui-overlay-min-width-units)))",
    )
    expect(base).toContain("container: overlay-shell / inline-size")
    expect(workspace).toContain("@container overlay-shell (width < 1120px)")
    expect(activity).toContain("@container overlay-shell (width < 1120px)")
    expect(workspace).not.toContain("@media (width < 1120px)")
    expect(activity).not.toContain("@media (width < 1120px)")
    expect(workspace).not.toContain("@media (max-width: 1120px)")
    expect(activity).not.toContain("@media (max-width: 1120px)")
  })

  test("width responsive CSS uses layout containers instead of raw viewport media queries", () => {
    const offenders = readStyleFiles().flatMap(({ file, source }) =>
      Array.from(source.matchAll(/@media\s*\([^)]*\b(?:max-width|min-width|width\s*[<>=])[^)]*\)/g)).map((match) => ({
        file,
        query: match[0],
      })),
    )

    expect(offenders).toEqual([])
  })

  test("surface width clamps use the legal overlay container instead of raw viewport width", () => {
    const offenders = readStyleFiles()
      .filter(({ file }) => file !== path.join("src", "styles", "cascade", "base.css"))
      .flatMap(({ file, source }) =>
        Array.from(source.matchAll(/\b\d+(?:\.\d+)?vw\b/g)).map((match) => ({
          file,
          unit: match[0],
        })),
      )

    expect(offenders).toEqual([])
  })

  test("pane and center workbench minimums are token-owned", () => {
    const pane = readOverlay("src/services/pane.ts")
    const main = readOverlay("src/main.tsx")
    const workspace = readOverlay("src/styles/surfaces/workspace.css")
    const theme = readOverlay("src/services/theme.ts")
    const layoutFrame = readOverlay("src/utils/overlay-layout-frame.ts")

    expect(pane).toContain('import { layoutTokenPx } from "../utils/layout-tokens"')
    expect(pane).toContain('layoutTokenPx("--ui-rail-min-width")')
    expect(pane).toContain('layoutTokenPx("--ui-chat-min-width")')
    expect(pane).toContain('leftFixedControlIds: ["solidLeftActivityToolbar"]')
    expect(pane).toContain('remainingFixedControlIds: ["solidRightActivityToolbar"]')
    expect(pane).toContain("remainingMinWidth: defaultPanelRemainingMinWidth")
    expect(pane).toContain("const total = panelWidth - leftHandle - leftFixed")
    expect(pane).toContain("total - remainingFixed - remainingContentMin")
    expect(pane).not.toContain('layoutTokenPx("--ui-chat-priority-width")')
    expect(pane).not.toContain('layoutTokenPx("--ui-sections-width")')
    expect(pane).not.toContain("120 * scale")
    expect(pane).not.toContain("300 * scale")
    expect(pane).not.toContain("window.innerWidth ??")
    expect(main).toContain('layoutTokenPx("--ui-workbench-panel-min-width")')
    expect(main).not.toContain("CENTER_WORKBENCH_MIN_PANEL_WIDTH")
    expect(main).not.toContain("80 * scale")
    expect(theme).toContain('import { overlayLayoutFrameSize } from "../utils/overlay-layout-frame"')
    expect(theme).toContain("const frame = overlayLayoutFrameSize()")
    expect(theme).not.toContain("visualViewport")
    expect(layoutFrame).toContain("width: window.innerWidth")
    expect(layoutFrame).toContain("height: window.innerHeight")
    expect(layoutFrame).not.toContain("visualViewport")
    expect(workspace).toContain("max(var(--ui-workbench-panel-min-width), calc(50cqw))")
    expect(workspace).not.toContain("max(calc(280px * var(--ui-scale)), calc(50cqw))")
    expect(workspace).not.toContain("calc(50vw)")
  })
})
