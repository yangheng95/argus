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

test("retired right pane settings are not part of the overlay settings store", () => {
  applySettings({})
  expect("rightPanelCollapsed" in settingsStore).toBe(false)
  expect("sectionsWidth" in settingsStore).toBe(false)

  applySettings({ rightPanelCollapsed: true, sectionsWidth: 640 } as any)
  expect("rightPanelCollapsed" in settingsStore).toBe(false)
  expect("sectionsWidth" in settingsStore).toBe(false)
})

test("browser settings ignore stale retired right pane localStorage keys", () => {
  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }

  localStorage.setItem("oc_right_panel_collapsed", "true")
  localStorage.setItem("oc_sections_width", "640")

  const loaded = loadBrowserOverlaySettings()
  expect("rightPanelCollapsed" in loaded).toBe(false)
  expect("sectionsWidth" in loaded).toBe(false)

  applySettings(loaded)
  expect("rightPanelCollapsed" in settingsStore).toBe(false)
  expect("sectionsWidth" in settingsStore).toBe(false)
})

test("retired right pane storage keys stay absent from settings sources", () => {
  const settings = readFileSync(join(import.meta.dir, "../src/store/settings.ts"), "utf8")
  const storage = readFileSync(join(import.meta.dir, "../src/services/overlay-settings-storage.ts"), "utf8")
  const pane = readFileSync(join(import.meta.dir, "../src/services/pane.ts"), "utf8")

  expect(settings).not.toContain("rightPanelCollapsed")
  expect(settings).not.toContain("sectionsWidth")
  expect(storage).not.toContain("oc_right_panel_collapsed")
  expect(storage).not.toContain("oc_sections_width")
  expect(pane).not.toContain("rightHandleId")
  expect(pane).not.toContain("sectionsWidth")
})
