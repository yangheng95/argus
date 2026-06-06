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

test("right panel defaults collapsed while preserving explicit expanded settings", () => {
  applySettings({})
  expect(settingsStore.rightPanelCollapsed).toBe(true)

  applySettings({ rightPanelCollapsed: false })
  expect(settingsStore.rightPanelCollapsed).toBe(false)
})

test("browser settings leave missing right panel collapse value to DEFAULT_SETTINGS", () => {
  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }

  const missing = loadBrowserOverlaySettings()
  expect(missing.rightPanelCollapsed).toBeUndefined()
  applySettings(missing)
  expect(settingsStore.rightPanelCollapsed).toBe(true)

  localStorage.setItem("oc_right_panel_collapsed", "false")
  const expanded = loadBrowserOverlaySettings()
  expect(expanded.rightPanelCollapsed).toBe(false)
  applySettings(expanded)
  expect(settingsStore.rightPanelCollapsed).toBe(false)
})

test("right panel default width tokens are wider than the left rail", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/tokens/design-language.css"), "utf8")
  expect(css).toContain("--ui-sections-width: clamp(calc(380px * var(--ui-scale)), 30vw, calc(560px * var(--ui-scale)))")
  expect(css).toContain("--ui-tui-sections-width: clamp(calc(760px * var(--ui-scale)), 58vw, calc(980px * var(--ui-scale)))")
})
