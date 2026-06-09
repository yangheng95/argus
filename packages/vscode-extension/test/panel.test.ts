import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

let createdPanel: any
let activeColorThemeKind = 2
let colorThemeListeners: Array<(theme: { kind: number }) => void> = []

mock.module("vscode", () => ({
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { Beside: 2 },
  env: { language: "en-US" },
  Uri: {
    joinPath(base: any, ...parts: string[]) {
      const root = base.fsPath ?? String(base)
      const fsPath = path.join(root, ...parts)
      return { fsPath, toString: () => fsPath }
    },
  },
  window: {
    activeColorTheme: {
      get kind() {
        return activeColorThemeKind
      },
    },
    onDidChangeActiveColorTheme(cb: (theme: { kind: number }) => void) {
      colorThemeListeners.push(cb)
      return {
        dispose() {
          colorThemeListeners = colorThemeListeners.filter((listener) => listener !== cb)
        },
      }
    },
    createWebviewPanel(_viewType: string, title: string, viewColumn: number, options: unknown) {
      const disposers: Array<() => void> = []
      let htmlAssignments = 0
      const postedMessages: any[] = []
      const webview = {
        cspSource: "vscode-webview://test-source",
        html: "",
        asWebviewUri(uri: any) {
          return { toString: () => `https://test-cdn/${encodeURIComponent(uri.fsPath)}` }
        },
        onDidReceiveMessage() {
          return { dispose() {} }
        },
        postMessage(m: unknown) {
          postedMessages.push(m)
          return Promise.resolve(true)
        },
      }
      Object.defineProperty(webview, "html", {
        get() {
          return this._html
        },
        set(value: string) {
          this._html = value
          htmlAssignments += 1
        },
      })
      createdPanel = {
        title,
        viewColumn,
        options,
        webview,
        get htmlAssignments() {
          return htmlAssignments
        },
        get postedMessages() {
          return postedMessages
        },
        reveal: mock(() => {}),
        dispose() {
          for (const dispose of disposers.splice(0)) dispose()
        },
        onDidDispose(cb: () => void) {
          disposers.push(cb)
          return { dispose() {} }
        },
      }
      return createdPanel
    },
  },
}))

describe("OpencorvusPanel", () => {
  let extensionRoot: string

  beforeEach(() => {
    createdPanel = undefined
    activeColorThemeKind = 2
    colorThemeListeners = []
    extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-panel-"))
    const mediaUi = path.join(extensionRoot, "media", "ui")
    fs.mkdirSync(mediaUi, { recursive: true })
    fs.writeFileSync(
      path.join(mediaUi, "index.html"),
      `<!doctype html><html lang="en-US"><head><script src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`,
      "utf8",
    )
  })

  afterEach(async () => {
    const { OpencorvusPanel } = await import("../src/webview/panel")
    OpencorvusPanel.current?.dispose()
    OpencorvusPanel.current = undefined
    try {
      fs.rmSync(extensionRoot, { recursive: true, force: true })
    } catch {}
  })

  async function bootPanel() {
    const { OpencorvusPanel } = await import("../src/webview/panel")
    const sidecar = {
      baseUrl: "http://127.0.0.1:1234",
      token: "secret",
      username: "opencorvus",
      pid: 1234,
      stop: async () => {},
      onExit: () => ({ dispose() {} }),
    }
    const context = {
      extensionPath: extensionRoot,
      extensionUri: { fsPath: extensionRoot },
    }
    OpencorvusPanel.show(context as any, sidecar as any)
    return { OpencorvusPanel }
  }

  test("sendUiCommand within size cap forwards to postMessage (audit W2-P8)", async () => {
    const { OpencorvusPanel } = await bootPanel()
    const panel = OpencorvusPanel.current!
    const before = createdPanel.postedMessages.length

    panel.sendUiCommand("composer.attach", { foo: "bar" })

    const delta = createdPanel.postedMessages.slice(before)
    expect(delta.length).toBe(1)
    expect(delta[0].type).toBe("ui-command")
    expect(delta[0].kind).toBe("composer.attach")
    expect(delta[0].payload).toEqual({ foo: "bar" })
  })

  test("sendUiCommand drops payloads beyond the 6 MiB cap, no postMessage call (audit W2-P8)", async () => {
    const { OpencorvusPanel } = await bootPanel()
    const panel = OpencorvusPanel.current!
    const errors: unknown[][] = []
    const origError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
    try {
      const before = createdPanel.postedMessages.length
      // 8 MiB string > 6 MiB cap. JSON.stringify adds ~quote chars but
      // is still well over the limit, so we hit the size-guard branch.
      const huge = "x".repeat(8 * 1024 * 1024)
      panel.sendUiCommand("composer.attach", { dataUrl: huge })
      expect(createdPanel.postedMessages.length).toBe(before)
      expect(errors.length).toBeGreaterThanOrEqual(1)
      const msg = errors[0]!.map(String).join(" ")
      expect(msg).toMatch(/composer\.attach/)
      expect(msg).toMatch(/exceeds/)
    } finally {
      console.error = origError
    }
  })

  test("sendUiCommand drops non-serialisable payloads (cyclic) without crashing (audit W2-P8)", async () => {
    const { OpencorvusPanel } = await bootPanel()
    const panel = OpencorvusPanel.current!
    const cyclic: any = { name: "loop" }
    cyclic.self = cyclic
    const errors: unknown[][] = []
    const origError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
    try {
      const before = createdPanel.postedMessages.length
      // Should not throw — the size guard's try/catch routes the
      // serialisation throw to a console.error + drop.
      expect(() => panel.sendUiCommand("composer.attach", cyclic)).not.toThrow()
      expect(createdPanel.postedMessages.length).toBe(before)
      expect(errors.length).toBeGreaterThanOrEqual(1)
      const msg = errors[0]!.map(String).join(" ")
      expect(msg).toMatch(/not JSON-serialisable/)
    } finally {
      console.error = origError
    }
  })

  test("initial show assigns webview HTML exactly once", async () => {
    const { OpencorvusPanel } = await import("../src/webview/panel")
    const sidecar = {
      baseUrl: "http://127.0.0.1:1234",
      token: "secret",
      username: "opencorvus",
      pid: 1234,
      stop: async () => {},
      onExit: () => ({ dispose() {} }),
    }
    const context = {
      extensionPath: extensionRoot,
      extensionUri: { fsPath: extensionRoot },
    }

    OpencorvusPanel.show(context as any, sidecar as any)

    expect(createdPanel.webview.html).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(createdPanel.webview.html).toContain('window.__OC_VSCODE_INITIAL_THEME__="vscode-dark"')
    expect(createdPanel.webview.html).toContain('<div id="root"></div>')
    expect(createdPanel.htmlAssignments).toBe(1)

    OpencorvusPanel.show(context as any, sidecar as any)

    expect(createdPanel.htmlAssignments).toBe(1)
  })

  test("posts host:theme when VS Code color theme changes", async () => {
    await bootPanel()
    expect(colorThemeListeners.length).toBe(1)
    const before = createdPanel.postedMessages.length

    activeColorThemeKind = 1
    colorThemeListeners[0]!({ kind: activeColorThemeKind })

    const delta = createdPanel.postedMessages.slice(before)
    expect(delta).toEqual([
      {
        protocol: 1,
        type: "host:theme",
        theme: "light",
      },
    ])
  })

  test("disposes the VS Code color theme listener with the panel", async () => {
    const { OpencorvusPanel } = await bootPanel()
    expect(colorThemeListeners.length).toBe(1)

    OpencorvusPanel.current!.dispose()

    expect(colorThemeListeners.length).toBe(0)
  })
})
