import { afterEach, expect, test } from "bun:test"
import type { OverlayPersistedSettings } from "@opencorvus-ai/transport-protocol"
import { apiUrl, configure } from "../src/services/api"
import { DEFAULT_LOCAL_SERVER_URL, serverUrlFromOverlayLocation } from "../src/services/default-server"
import {
  BROWSER_OVERLAY_SETTINGS_KEY,
  loadBrowserOverlaySettings,
  saveBrowserOverlaySettings,
} from "../src/services/overlay-settings-storage"

class MemoryStorage {
  readonly items = new Map<string, string>()
  writeFailure: Error | null = null

  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.writeFailure) throw this.writeFailure
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
  configure({ serverUrl: DEFAULT_LOCAL_SERVER_URL, username: "opencorvus", password: "", directory: "" })
})

function location(input: { origin: string; pathname: string; protocol?: string }) {
  return {
    origin: input.origin,
    pathname: input.pathname,
    protocol: input.protocol ?? "https:",
  } as Location
}

function persistedSettings(serverUrl = "https://mirror-test.myhexin.com/opencorvus"): OverlayPersistedSettings {
  return {
    serverUrl,
    autoServer: false,
    password: "",
    username: "opencorvus",
    projectEditor: "vscode",
    initGit: true,
    sidebarCollapsed: false,
    workLedgerOrganization: "by-project",
    workLedgerSort: "updated",
    zoom: 1,
    theme: "light",
    locale: "en-US",
    preferredProjectEditor: "vscode",
    desktopNotifications: true,
  }
}

test("browser default server follows the public overlay prefix", () => {
  expect(serverUrlFromOverlayLocation(location({ origin: "https://example.com", pathname: "/ui/" }))).toBe(
    "https://example.com",
  )
  expect(serverUrlFromOverlayLocation(location({ origin: "https://example.com", pathname: "/opencorvus/ui/" }))).toBe(
    "https://example.com/opencorvus",
  )
  expect(
    serverUrlFromOverlayLocation(location({ origin: "https://example.com", pathname: "/opencorvus/ui/task/abc" })),
  ).toBe("https://example.com/opencorvus")
  expect(serverUrlFromOverlayLocation(location({ origin: "file://", pathname: "/ui/", protocol: "file:" }))).toBeNull()
  expect(serverUrlFromOverlayLocation(location({ origin: "https://example.com", pathname: "/not-ui/" }))).toBeNull()
})

test("browser settings use one canonical JSON document", () => {
  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }
  expect(loadBrowserOverlaySettings()).toBeNull()

  const settings = persistedSettings()
  expect(saveBrowserOverlaySettings(settings)).toBe(true)
  expect([...localStorage.items.keys()]).toEqual([BROWSER_OVERLAY_SETTINGS_KEY])
  expect(loadBrowserOverlaySettings()).toEqual(settings)

  configure({ serverUrl: settings.serverUrl })
  expect(apiUrl("coding/chat/sessions?limit=30")).toBe(
    "https://mirror-test.myhexin.com/opencorvus/coding/chat/sessions?limit=30",
  )
})

test("browser settings reject malformed, missing, unknown, and legacy documents", () => {
  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }

  localStorage.items.set(BROWSER_OVERLAY_SETTINGS_KEY, "{")
  expect(() => loadBrowserOverlaySettings()).toThrow()

  localStorage.items.set(BROWSER_OVERLAY_SETTINGS_KEY, JSON.stringify({ serverUrl: "https://example.com" }))
  expect(() => loadBrowserOverlaySettings()).toThrow("persisted overlay settings payload is invalid")

  localStorage.items.set(BROWSER_OVERLAY_SETTINGS_KEY, JSON.stringify({ ...persistedSettings(), unknown: true }))
  expect(() => loadBrowserOverlaySettings()).toThrow("persisted overlay settings payload is invalid")

  localStorage.items.delete(BROWSER_OVERLAY_SETTINGS_KEY)
  localStorage.items.set("oc_server_url", "https://legacy.example.com")
  expect(loadBrowserOverlaySettings()).toBeNull()
})

test("browser settings expose unavailable storage and preserve the confirmed document on write failure", () => {
  ;(globalThis as { window?: unknown }).window = {}
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
  expect(() => loadBrowserOverlaySettings()).toThrow("browser overlay settings storage is unavailable")

  const localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage }
  const confirmed = JSON.stringify(persistedSettings("https://confirmed.example.com"))
  localStorage.items.set(BROWSER_OVERLAY_SETTINGS_KEY, confirmed)
  localStorage.writeFailure = new Error("injected setItem failure")
  expect(() => saveBrowserOverlaySettings(persistedSettings("https://replacement.example.com"))).toThrow(
    "injected setItem failure",
  )
  expect(localStorage.items.get(BROWSER_OVERLAY_SETTINGS_KEY)).toBe(confirmed)
})
