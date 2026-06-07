import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applySettings, settingsStore } from "../src/store/settings"
import { loadBrowserOverlaySettings } from "../src/services/overlay-settings-storage"

class MemoryStorage {
  private readonly items = new Map<string, string>()

  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.items.set(key, value)
  }

  removeItem(key: string) {
    this.items.delete(key)
  }
}

const previousWindow = (globalThis as { window?: unknown }).window
const previousLocalStorage = (globalThis as { localStorage?: unknown }).localStorage

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = previousWindow
  ;(globalThis as { localStorage?: unknown }).localStorage = previousLocalStorage
  applySettings({})
})

test("right panel defaults expanded while preserving explicit collapsed settings", () => {
  applySettings({})
  expect(settingsStore.rightPanelCollapsed).toBe(false)

  applySettings({ rightPanelCollapsed: true })
  expect(settingsStore.rightPanelCollapsed).toBe(true)
})

test("browser settings leave missing right panel collapse value to DEFAULT_SETTINGS", () => {
  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }

  const missing = loadBrowserOverlaySettings()
  expect(missing.rightPanelCollapsed).toBeUndefined()
  applySettings(missing)
  expect(settingsStore.rightPanelCollapsed).toBe(false)

  localStorage.setItem("oc_right_panel_collapsed", "true")
  const collapsed = loadBrowserOverlaySettings()
  expect(collapsed.rightPanelCollapsed).toBe(true)
  applySettings(collapsed)
  expect(settingsStore.rightPanelCollapsed).toBe(true)
})

test("right panel default width tokens are wider than the left rail", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/tokens/design-language.css"), "utf8")
  expect(css).toContain("--ui-sections-width: clamp(calc(380px * var(--ui-scale)), 30vw, calc(560px * var(--ui-scale)))")
  expect(css).not.toContain("--ui-tui-sections-width")
  expect(css).not.toContain("--ui-tui-chat-min-width")
})
