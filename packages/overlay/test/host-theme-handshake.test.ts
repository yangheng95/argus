import { afterEach, describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage } from "@opencorvus-ai/transport-protocol"

// NOTE: previously this file ran `mock.module("../src/services/tauri-transport", ...)` at
// file scope to swap in a stub. bun:test's `mock.module` registers
// process-wide and is not undone by `mock.restore()`, so the stub leaked
// into later tests (e.g. tauri-transport-error-body.test.ts) and
// crashed them with "tauri request not used in host theme handshake
// tests". Every test in this file installs its own transport via
// `__setHostTransportForTest` (or `installFakeVsCodeWindow`), so the
// upstream stub is unnecessary — the real module imports cleanly.

function fakeVsCodeSettingsTransport(settings: unknown) {
  return {
    kind: "vscode",
    async request() {
      throw new Error("request not used in host theme handshake tests")
    },
    openStream() {
      throw new Error("openStream not used in host theme handshake tests")
    },
    async native(command) {
      expect(command.kind).toBe("settings.load")
      return settings
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

async function modules() {
  const hostTransport = await import("../src/services/host-transport")
  const vscodeTransport = await import("../src/services/vscode-transport")
  const hostTheme = await import("../src/services/host-theme")
  const hostThemeHandshake = await import("../src/services/host-theme-handshake")
  const settings = await import("../src/store/settings")
  return {
    ...hostTransport,
    ...vscodeTransport,
    ...hostTheme,
    ...hostThemeHandshake,
    ...settings,
  }
}

function installDocument(): () => void {
  const previousDocument = (globalThis as any).document
  ;(globalThis as any).document = {
    documentElement: { dataset: {} },
    body: { dataset: {} },
  }
  return () => {
    ;(globalThis as any).document = previousDocument
  }
}

function installFakeVsCodeWindow(initialTheme = "vscode-dark"): {
  trigger: (message: ExtensionMessage) => void
  cleanup: () => void
} {
  let listener: ((event: MessageEvent) => void) | undefined
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).window = {
    __OC_VSCODE_INITIAL_THEME__: initialTheme,
    addEventListener(_type: string, fn: (event: MessageEvent) => void) {
      listener = fn
    },
    removeEventListener() {},
    location: {
      protocol: "vscode-webview:",
      reload() {},
    },
    sessionStorage: {
      data: new Map<string, string>(),
      getItem(key: string) {
        return this.data.get(key) ?? null
      },
      setItem(key: string, value: string) {
        this.data.set(key, value)
      },
      removeItem(key: string) {
        this.data.delete(key)
      },
    },
    acquireVsCodeApi() {
      return {
        postMessage() {},
        setState() {},
        getState() {
          return null
        },
      }
    },
  }
  ;(globalThis as any).__OC_VSCODE_INITIAL_THEME__ = initialTheme
  return {
    trigger(message) {
      if (!listener) throw new Error("VS Code transport listener was not installed")
      listener({ data: message } as MessageEvent)
    },
    cleanup() {
      delete (globalThis as any).__OC_VSCODE_INITIAL_THEME__
      ;(globalThis as any).window = previousWindow
    },
  }
}

afterEach(async () => {
  const m = await modules()
  m.__resetHostThemeHandshakeForTest()
  m.__resetHostThemeForTest()
  m.__resetVsCodeTransportForTest()
  m.__setHostTransportForTest(undefined)
  delete (globalThis as any).__OC_VSCODE_INITIAL_THEME__
  m.applySettings({ ...m.DEFAULT_SETTINGS })
})

describe("VS Code host theme handshake", () => {
  test("uses the injected initial VS Code theme when settings have no persisted theme", async () => {
    const fakeWindow = installFakeVsCodeWindow("vscode-dark")
    try {
      const m = await modules()
      m.__setHostTransportForTest(fakeVsCodeSettingsTransport({}) as any)

      await m.loadSettings()

      expect(m.readInitialVsCodeHostTheme()).toBe("vscode-dark")
      expect(m.settingsStore.theme).toBe("vscode-dark")
    } finally {
      fakeWindow.cleanup()
    }
  })

  test("host:theme message updates settings.theme and the applied dataset theme", async () => {
    const cleanupDocument = installDocument()
    const fakeWindow = installFakeVsCodeWindow("vscode-dark")
    try {
      const m = await modules()
      m.installHostThemeHandshakeSubscription()
      m.createVsCodeTransport()

      fakeWindow.trigger({
        protocol: PROTOCOL_VERSION,
        type: "host:theme",
        theme: "light",
      })

      expect(m.settingsStore.theme).toBe("light")
      expect(document.documentElement.dataset.theme).toBe("light")
      expect(document.body.dataset.theme).toBe("light")
    } finally {
      fakeWindow.cleanup()
      cleanupDocument()
    }
  })
})
