import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  OVERLAY_SIZE_CONTRACT_MARKER,
  overlaySizeContractFromTauriConfig,
  renderOverlaySizeContractStyle,
} from "../script/overlay-size-contract"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const REPO_ROOT = path.resolve(OVERLAY_ROOT, "..", "..")

function readOverlay(rel: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, rel), "utf8")
}

function readRepo(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8")
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
    const contract = overlaySizeContractFromTauriConfig(config)

    expect(mainWindow).toBeDefined()
    expect(contract).toEqual({ minWidth: 1120, minHeight: 720 })
    expect(mainWindow.width).toBeGreaterThanOrEqual(contract.minWidth)
    expect(mainWindow.height).toBeGreaterThanOrEqual(contract.minHeight)
    expect(mainWindow.minWidth).toBe(contract.minWidth)
    expect(mainWindow.minHeight).toBe(contract.minHeight)
  })

  test("Rust startup and Windows live sizing use native pre-commit constraints", () => {
    const main = readOverlay("src-tauri/src/main.rs")

    expect(main).toMatch(
      /fn overlay_main_size_constraints\(\s*config: &tauri::utils::config::Config,\s*\) -> OverlayWindowConstraints/,
    )
    expect(main).toContain("overlay_main_size_constraints(app.config())")
    expect(main).toContain("window.set_min_size(Some(tauri::LogicalSize::new(")
    expect(main).toContain("fn constrain_overlay_window_size(")
    expect(main).toContain("fn startup_overlay_window_size(")
    expect(main).toContain("fn install_overlay_resize_minimum_aspect_constraint")
    expect(main).toMatch(/#\[cfg\(windows\)\]\s+fn constrain_overlay_resize_rect_to_minimum_aspect/)
    expect(main).toMatch(/#\[cfg\(windows\)\]\s+fn install_overlay_resize_minimum_aspect_constraint/)
    expect(main).toContain("WM_SIZING")
    expect(main).toContain("SetWindowSubclass")
    expect(main).not.toContain("fn overlay_max_aspect_ratio")
    expect(main).not.toContain("max_aspect_size")
    expect(main).not.toContain("tauri::WindowEvent::Resized")
    expect(main).not.toContain("RunEvent::WindowEvent")
    expect(main).not.toContain("fn overlay_window_needs_resize(")
    expect(main).not.toContain(".clamp(760.0, 1600.0)")
    expect(main).not.toContain(".clamp(480.0, 920.0)")
  })

  test("browser shell tokens match the native overlay minimum", () => {
    const config = JSON.parse(readOverlay("src-tauri/tauri.conf.json"))
    const contract = overlaySizeContractFromTauriConfig(config)
    const generatedStyle = renderOverlaySizeContractStyle(contract)
    const index = readOverlay("src/index.html")
    const vite = readOverlay("vite.config.ts")
    const tokens = readOverlay("src/styles/tokens/design-language.css")
    const base = readOverlay("src/styles/cascade/base.css")
    const activity = readOverlay("src/styles/surfaces/activity.css")
    const workspace = readOverlay("src/styles/surfaces/workspace.css")

    expect(index).toContain(OVERLAY_SIZE_CONTRACT_MARKER)
    expect(vite).toContain("readOverlaySizeContract")
    expect(vite).toContain("renderOverlaySizeContractStyle")
    expect(generatedStyle).toContain(`--ui-overlay-min-width-units: ${contract.minWidth};`)
    expect(generatedStyle).toContain(`--ui-overlay-min-height-units: ${contract.minHeight};`)
    expect(generatedStyle).toContain("--ui-overlay-min-width: calc(var(--ui-overlay-min-width-units) * 1px)")
    expect(generatedStyle).toContain("--ui-overlay-min-height: calc(var(--ui-overlay-min-height-units) * 1px)")
    expect(generatedStyle).toContain(
      "--ui-overlay-min-aspect-ratio: calc(var(--ui-overlay-min-width-units) / var(--ui-overlay-min-height-units))",
    )
    expect(generatedStyle).not.toContain("--ui-overlay-max-aspect")
    expect(tokens).not.toContain("--ui-breakpoint-xl")
    expect(tokens).not.toContain("--ui-overlay-min-width-units")
    expect(tokens).not.toContain("--ui-overlay-min-height-units")
    expect(tokens).not.toContain("--ui-overlay-max-aspect-width-units")
    expect(tokens).not.toContain("--ui-overlay-max-aspect-height-units")
    expect(tokens).not.toContain("--ui-overlay-min-width:")
    expect(tokens).not.toContain("--ui-overlay-min-height:")
    expect(tokens).toContain("--ui-workbench-panel-min-width: calc(280px * var(--ui-scale))")
    expect(tokens).not.toContain("--ui-overlay-min-aspect-ratio")
    expect(tokens).not.toContain("--ui-overlay-max-aspect-ratio")
    expect(base).toContain("--ui-overlay-viewport-width: max(100vw, var(--ui-overlay-min-width))")
    expect(base).toContain("--ui-overlay-shell-width: max(")
    expect(base).toContain("var(--ui-overlay-viewport-width)")
    expect(base).not.toContain("--ui-overlay-max-aspect")
    expect(base).toContain("--ui-overlay-shell-height: max(")
    expect(base).toContain("var(--ui-overlay-min-height)")
    expect(base).toContain("width: var(--ui-overlay-shell-width)")
    expect(base).toContain("margin: 0 auto")
    expect(base).not.toContain("width: 100vw")
    expect(base).toContain("min-width: var(--ui-overlay-min-width)")
    expect(base).toContain("min-height: var(--ui-overlay-min-height)")
    expect(base).toContain("calc(var(--ui-overlay-viewport-width) / var(--ui-overlay-min-aspect-ratio))")
    expect(base).not.toContain("var(--ui-overlay-shell-width) * var(--ui-overlay-min-height-units) /")
    expect(base).toContain("height: var(--ui-overlay-shell-height)")
    expect(base).toContain("container: overlay-shell / inline-size")
    expect(workspace).not.toContain("@container overlay-shell (width < 1120px)")
    expect(activity).not.toContain("@container overlay-shell (width < 1120px)")
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

  test("legal overlay shell does not define unreachable compact branches", () => {
    const offenders = readStyleFiles().flatMap(({ file, source }) =>
      Array.from(source.matchAll(/@container\s+overlay-shell\s+\(width\s*</g)).map((match) => ({
        file,
        query: match[0],
      })),
    )

    expect(offenders).toEqual([])
  })

  test("superseded center workbench spec no longer claims an active legal-shell compact branch", () => {
    const spec = readRepo("specs/new-arch/2026-06-22-center-workbench-panel-min-size-contract.md")

    expect(spec).toContain("Status: Superseded 2026-06-23")
    expect(spec).toContain("removed production")
    expect(spec).toContain("Current runtime code must follow the 2026-06-23 contract")
    expect(spec).not.toContain("Status: Verified")
  })

  test("historical legal-size specs do not advertise removed size sources as active", () => {
    const compactSpec = readRepo("specs/new-arch/2026-06-23-overlay-compact-legal-frame-query.md")
    const viewportSpec = readRepo("specs/new-arch/2026-06-22-overlay-viewport-size-contract.md")
    const panelSpec = readRepo("specs/new-arch/2026-06-23-overlay-panel-legal-size-contract.md")

    expect(compactSpec).toContain("Status: Superseded 2026-06-23")
    expect(compactSpec).toContain("unreachable")
    expect(compactSpec).toContain("Current runtime code must follow")
    expect(compactSpec).not.toContain("Status: Verified")
    expect(viewportSpec).not.toContain("--ui-breakpoint-xl")
    expect(viewportSpec).toContain("generated Tauri config legal")
    expect(panelSpec).toContain("Status: Superseded 2026-06-23 by `Fullscreen Width Legality`.")
    expect(panelSpec).toContain("Normal fullscreen/maximized width is a legal overlay state.")
    expect(panelSpec).toContain("No max-aspect token, `max_aspect_size`, or `overlay_max_aspect_ratio`")
  })

  test("mission visual loop treats sub-minimum browser viewports as legal-frame captures", () => {
    const loop = readOverlay("test/mission-visual-loop.ts")

    expect(loop).toContain("VIEWPORT_ILLEGAL_NARROW")
    expect(loop).toContain("06-illegal-narrow-legal-frame")
    expect(loop).toContain("illegalNarrow")
    expect(loop).not.toContain("VIEWPORT_NARROW")
    expect(loop).not.toContain("06-narrow-breakpoint")
    expect(loop).not.toContain("Narrow-breakpoint capture")
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

  test("surface height clamps use the legal overlay shell instead of raw viewport height", () => {
    const offenders = readStyleFiles()
      .filter(({ file }) => file !== path.join("src", "styles", "cascade", "base.css"))
      .flatMap(({ file, source }) =>
        Array.from(source.matchAll(/\b\d+(?:\.\d+)?vh\b/g)).map((match) => ({
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
    const layoutTokens = readOverlay("src/utils/layout-tokens.ts")
    const dialog = readOverlay("src/components/primitives/Dialog.tsx")
    const chatComposer = readOverlay("src/components/ChatComposer.tsx")
    const screenshotBrowser = readOverlay("src/components/ScreenshotBrowserPanel.tsx")

    expect(pane).toContain(
      'import { createLayoutTokenResolver, currentUIScale, type LayoutTokenResolver } from "../utils/layout-tokens"',
    )
    expect(pane).toContain("const layoutTokens = createLayoutTokenResolver()")
    expect(pane).toContain("const remainingContentMin = config.remainingMinWidth(layoutTokens)")
    expect(pane).toContain('layoutTokens.tokenPx("--ui-rail-min-width")')
    expect(pane).toContain('layoutTokens.tokenPx("--ui-chat-min-width")')
    expect(pane).toContain('layoutTokens.tokenPx("--ui-rail-width")')
    expect(pane).toContain('leftFixedControlIds: ["solidLeftActivityToolbar"]')
    expect(pane).toContain('remainingFixedControlIds: ["solidRightActivityToolbar"]')
    expect(pane).toContain("remainingMinWidth: defaultPanelRemainingMinWidth")
    expect(pane).toContain("function readPaneGeometrySnapshot(config: PaneConfig): PaneGeometrySnapshot | null")
    expect(pane).toContain("const total = geometry.bodyRect.width - geometry.leftHandle - geometry.leftFixed")
    expect(pane).toContain("total - geometry.remainingFixed - geometry.remainingContentMin")
    expect(pane).not.toContain("function paneResolvedSidebarWidth")
    expect(pane).not.toContain("for (let index = 0; index < 6; index += 1)")
    expect(pane).not.toContain('layoutTokenPx("--ui-chat-priority-width")')
    expect(pane).not.toContain('layoutTokenPx("--ui-sections-width")')
    expect(pane).not.toContain("120 * scale")
    expect(pane).not.toContain("300 * scale")
    expect(pane).not.toContain("window.innerWidth ??")
    expect(pane).not.toContain("export function currentUIScale")
    expect(main).toContain('layoutTokenPx("--ui-workbench-panel-min-width")')
    expect(main).not.toContain("CENTER_WORKBENCH_MIN_PANEL_WIDTH")
    expect(main).not.toContain("80 * scale")
    expect(main).toContain("const next = stepZoom(delta)")
    expect(main).toContain('setSettingsStore("zoom", next)')
    expect(main).not.toContain("settingsStore.zoom || 1")
    expect(main).not.toContain("sanitizeZoom((settingsStore.zoom || 1)")
    expect(theme).toContain('import { currentUIScale } from "../utils/layout-tokens"')
    expect(theme).toContain("const current = currentUIScale()")
    expect(theme).toContain("export function stepZoom(delta: number): number")
    expect(theme).toContain("return setZoom(next)")
    expect(theme).not.toContain('getPropertyValue("--ui-scale") || "1"')
    expect(chatComposer).toContain('import { currentUIScale } from "../utils/layout-tokens"')
    expect(chatComposer).not.toContain("function currentUIScale(): number")
    expect(screenshotBrowser).toContain('import { currentUIScale } from "../utils/layout-tokens"')
    expect(theme).toContain('import { overlayLayoutFrameSize } from "../utils/overlay-layout-frame"')
    expect(theme).toContain("const frame = overlayLayoutFrameSize()")
    expect(theme).not.toContain("visualViewport")
    expect(layoutFrame).toContain("export interface OverlayLayoutFrameConstraints")
    expect(layoutFrame).toContain('width: layoutTokenPx("--ui-overlay-min-width")')
    expect(layoutFrame).toContain('height: layoutTokenPx("--ui-overlay-min-height")')
    expect(layoutFrame).not.toContain("--ui-overlay-max-aspect")
    expect(layoutFrame).not.toContain("Overlay maximum aspect ratio")
    expect(layoutFrame).toContain("width: window.innerWidth")
    expect(layoutFrame).toContain("height: window.innerHeight")
    expect(layoutFrame).not.toContain("visualViewport")
    expect(layoutTokens).toContain("function tokenSignature(root: HTMLElement, container: HTMLElement): string")
    expect(layoutTokens).toContain("export interface LayoutTokenResolver")
    expect(layoutTokens).toContain("tokenPx(name: string): number")
    expect(layoutTokens).toContain("export function createLayoutTokenResolver(): LayoutTokenResolver")
    expect(layoutTokens).toContain("return createLayoutTokenResolver().tokenPx(name)")
    expect(layoutTokens).toContain('const scale = getComputedStyle(root).getPropertyValue("--ui-scale").trim()')
    expect(layoutTokens).toContain("export function currentUIScale(): number")
    expect(layoutTokens).toContain('throw new Error("UI scale cannot be resolved without a document.")')
    expect(layoutTokens).toContain("throw new Error(`UI scale resolved to invalid value: ${raw}`)")
    expect(layoutTokens).not.toContain("return 1")
    expect(layoutTokens).not.toContain("|| 1")
    expect(layoutTokens).toContain("const containerInlineSize = container.getBoundingClientRect().width")
    expect(layoutTokens).toContain("return `${scale}|${containerInlineSize.toFixed(3)}`")
    expect(layoutTokens).toContain("const signature = tokenSignature(root, document.body)")
    expect(layoutTokens).not.toContain("width: window.innerWidth")
    expect(dialog).toContain("const shellRect = document.body.getBoundingClientRect()")
    expect(dialog).not.toContain("window.innerWidth")
    expect(dialog).not.toContain("window.innerHeight")
    expect(workspace).not.toContain("max(var(--ui-workbench-panel-min-width), calc(50cqw))")
    expect(workspace).not.toContain("max(calc(280px * var(--ui-scale)), calc(50cqw))")
    expect(workspace).not.toContain("calc(50vw)")
  })
})
