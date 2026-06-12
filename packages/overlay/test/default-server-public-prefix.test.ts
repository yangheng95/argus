import { afterEach, expect, test } from "bun:test"
import { DEFAULT_LOCAL_SERVER_URL, serverUrlFromOverlayLocation } from "../src/services/default-server"
import { apiUrl, configure } from "../src/services/api"

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
  configure({ serverUrl: DEFAULT_LOCAL_SERVER_URL, username: "opencorvus", password: "", directory: "" })
})

function location(input: { origin: string; pathname: string; protocol?: string }) {
  return {
    origin: input.origin,
    pathname: input.pathname,
    protocol: input.protocol ?? "https:",
  } as Location
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

test("browser settings migrate the old local default when served under a public prefix", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", DEFAULT_LOCAL_SERVER_URL)
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?public-prefix-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com/opencorvus")
  expect(settings.autoServer).toBe(true)
})

test("browser settings keep the prefixed public default", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://mirror-test.myhexin.com/opencorvus")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?legacy-prefix-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com/opencorvus")
  expect(settings.autoServer).toBe(true)
})

test("browser settings migrate the old origin-only public default under a public prefix", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://mirror-test.myhexin.com")
  localStorage.setItem("oc_auto_server", "true")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?origin-only-prefix-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com/opencorvus")
  expect(settings.autoServer).toBe(true)

  configure({ serverUrl: String(settings.serverUrl) })
  expect(apiUrl("coding/sessions?limit=30")).toBe("https://mirror-test.myhexin.com/opencorvus/coding/sessions?limit=30")
})

test("browser settings migrate the old origin-only public default when autoServer was not persisted", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://mirror-test.myhexin.com")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?origin-only-implicit-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com/opencorvus")
  expect(settings.autoServer).toBe(true)
})

test("browser settings keep an explicit origin-only custom server under a public prefix", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://mirror-test.myhexin.com")
  localStorage.setItem("oc_auto_server", "false")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?origin-only-custom-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com")
  expect(settings.autoServer).toBe(false)
})

test("browser settings keep an explicit prefixed custom server under a public prefix", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://mirror-test.myhexin.com/opencorvus")
  localStorage.setItem("oc_auto_server", "false")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?explicit-prefix-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://mirror-test.myhexin.com/opencorvus")
  expect(settings.autoServer).toBe(false)
})

test("browser settings keep an explicit custom server under a public prefix", async () => {
  const localStorage = new MemoryStorage()
  localStorage.setItem("oc_server_url", "https://api.example.com")
  ;(globalThis as { window?: unknown }).window = {
    location: location({ origin: "https://mirror-test.myhexin.com", pathname: "/opencorvus/ui/" }),
    localStorage,
  }

  const module = await import(`../src/services/overlay-settings-storage.ts?custom-server-test=${Date.now()}`)
  const settings = module.loadBrowserOverlaySettings()
  expect(settings.serverUrl).toBe("https://api.example.com")
  expect(settings.autoServer).toBe(false)
})
