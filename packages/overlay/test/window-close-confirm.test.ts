import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

function closeHandlerBody(source: string): string {
  const start = source.indexOf("const handleClose = async () => {")
  const end = source.indexOf("// ── Lifecycle", start)
  if (start < 0 || end < 0) throw new Error("WindowControls close handler not found")
  return source.slice(start, end)
}

describe("titlebar close confirmation", () => {
  const windowControls = readText("src/components/WindowControls.tsx")
  const windowService = readText("src/services/window.ts")
  const hostTransport = readText("src/services/host-transport.ts")
  const tauriTransport = readText("src/services/tauri-transport.ts")
  const tauriMain = readText("src-tauri/src/main.rs")
  const en = readText("src/i18n/en-US.json")
  const zh = readText("src/i18n/zh-CN.json")

  test("close button asks before quitting and does not hide to tray", () => {
    const body = closeHandlerBody(windowControls)

    expect(windowControls).toContain('from "../utils/native"')
    expect(windowControls).toContain('from "../services/window"')
    expect(body).toContain("nativeConfirm")
    expect(body).toContain("quitOverlay()")
    expect(body).toContain('t("titlebar.close_confirm_message")')
    expect(body).not.toContain(".hide")
    expect(body).not.toContain(".minimize")
    expect(body).not.toContain("getHostTransport")
    expect(windowControls).not.toContain("CLOSE_HINT_KEY")
    expect(windowControls).not.toContain("nativeMessage")
    expect(windowControls).not.toContain("background_notice")
  })

  test("window quit is a first-class native command mapped to Tauri cleanup", () => {
    expect(windowService).toContain("export async function quitOverlay")
    expect(windowService).toContain('native({ kind: "window.quit" })')
    expect(hostTransport).toContain('| { kind: "window.quit" }')
    expect(tauriTransport).toContain('case "window.quit":')
    expect(tauriTransport).toContain('return invokeTauri("overlay_quit")')
    expect(tauriMain).toContain("fn overlay_quit")
    expect(tauriMain).toContain("stop_server(&app);")
    expect(tauriMain).toContain("app.exit(0);")
    expect(tauriMain).toContain("overlay_quit")
  })

  test("close confirmation copy replaces the old tray-hide notice", () => {
    expect(en).toContain('"titlebar.close_confirm_title"')
    expect(en).toContain('"titlebar.close_confirm_message"')
    expect(en).toContain('"titlebar.close_confirm_quit"')
    expect(zh).toContain('"titlebar.close_confirm_title"')
    expect(zh).toContain('"titlebar.close_confirm_message"')
    expect(zh).toContain('"titlebar.close_confirm_quit"')
    expect(en).not.toContain("background_notice")
    expect(zh).not.toContain("background_notice")
  })
})
