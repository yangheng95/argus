import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resetVsCodeRuntimeMock, vscodeMockState, vscodeRuntimeMock } from "./vscode-runtime-mock"

mock.module("vscode", () => vscodeRuntimeMock)

describe("OpencorvusPanel", () => {
  let extensionRoot: string

  beforeEach(() => {
    resetVsCodeRuntimeMock()
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
    const before = vscodeMockState.createdPanel.postedMessages.length

    panel.sendUiCommand("composer.attach", { foo: "bar" })

    const delta = vscodeMockState.createdPanel.postedMessages.slice(before)
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
      const before = vscodeMockState.createdPanel.postedMessages.length
      // 8 MiB string > 6 MiB cap. JSON.stringify adds ~quote chars but
      // is still well over the limit, so we hit the size-guard branch.
      const huge = "x".repeat(8 * 1024 * 1024)
      panel.sendUiCommand("composer.attach", { dataUrl: huge })
      expect(vscodeMockState.createdPanel.postedMessages.length).toBe(before)
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
      const before = vscodeMockState.createdPanel.postedMessages.length
      // Should not throw — the size guard's try/catch routes the
      // serialisation throw to a console.error + drop.
      expect(() => panel.sendUiCommand("composer.attach", cyclic)).not.toThrow()
      expect(vscodeMockState.createdPanel.postedMessages.length).toBe(before)
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

    expect(vscodeMockState.createdPanel.webview.html).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(vscodeMockState.createdPanel.webview.html).toContain('window.__OC_VSCODE_INITIAL_THEME__="vscode-dark"')
    expect(vscodeMockState.createdPanel.webview.html).toContain('<div id="root"></div>')
    expect(vscodeMockState.createdPanel.htmlAssignments).toBe(1)

    OpencorvusPanel.show(context as any, sidecar as any)

    expect(vscodeMockState.createdPanel.htmlAssignments).toBe(1)
  })

  test("posts host:theme when VS Code color theme changes", async () => {
    await bootPanel()
    expect(vscodeMockState.colorThemeListeners.length).toBe(1)
    const before = vscodeMockState.createdPanel.postedMessages.length

    vscodeMockState.activeColorThemeKind = 1
    vscodeMockState.colorThemeListeners[0]!({ kind: vscodeMockState.activeColorThemeKind })

    const delta = vscodeMockState.createdPanel.postedMessages.slice(before)
    expect(delta).toEqual([
      {
        protocol: 2,
        type: "host:theme",
        theme: "light",
      },
    ])
  })

  test("disposes the VS Code color theme listener with the panel", async () => {
    const { OpencorvusPanel } = await bootPanel()
    expect(vscodeMockState.colorThemeListeners.length).toBe(1)

    OpencorvusPanel.current!.dispose()

    expect(vscodeMockState.colorThemeListeners.length).toBe(0)
  })
})
