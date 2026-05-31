import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { BrowserRuntime } from "../../src/browser/runtime"
import { BrowserMCPBuiltin } from "../../src/mcp/browser/builtin"
import { tmpdir } from "../fixture/fixture"

describe("built-in browser MCP stdio", () => {
  let client: Client | undefined
  let server: Server | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
      server = undefined
    })
  })

  const connectClient = async (name: string, env: Record<string, string | undefined> = {}) => {
    const [command, ...args] = BrowserMCPBuiltin.command()
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: process.cwd(),
      stderr: "pipe",
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter((entry): entry is [string, string] => !!entry[1]),
      ),
    })

    client = new Client({ name, version: "0.0.0" })
    await client.connect(transport)
    return client
  }

  const startFixtureServer = async () => {
    server = createServer((req, res) => {
      if (req.url === "/download.txt") {
        res.writeHead(200, {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="fixture-download.txt"',
        })
        res.end("downloaded fixture")
        return
      }
      if (req.url === "/frame") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(`<!doctype html>
          <html>
            <body>
              <input id="frame-input" value="" />
              <button id="frame-button" onclick="document.getElementById('frame-output').textContent = document.getElementById('frame-input').value">Frame save</button>
              <p id="frame-output">empty</p>
            </body>
          </html>`)
        return
      }
      if (req.url === "/missing.png") {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("missing")
        return
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(`<!doctype html>
        <html>
          <head>
            <title>Browser MCP fixture</title>
            <style>
              body { margin: 0; font-family: sans-serif; }
              #color-block { width: 160px; height: 96px; background: rgb(20, 120, 220); }
              #drag-source { width: 80px; height: 40px; background: rgb(240, 190, 70); }
              #drop-target { width: 140px; height: 50px; border: 1px solid #333; margin-top: 8px; }
            </style>
          </head>
          <body>
            <main>
              <h1>Browser MCP fixture</h1>
              <button id="fixture-button">Click target</button>
              <button id="dialog-button" onclick="window.alert('fixture dialog')">Dialog target</button>
              <input id="fixture-input" value="ready" />
              <select id="fixture-select">
                <option value="one">First</option>
                <option value="two">Second</option>
              </select>
              <a id="download-link" href="/download.txt">Download fixture</a>
              <div id="drag-source" draggable="true">Drag me</div>
              <div id="drop-target">Drop here</div>
              <iframe id="fixture-frame" src="/frame"></iframe>
              <div id="color-block"></div>
              <img src="/missing.png" alt="missing diagnostic fixture" />
            </main>
            <script>
              console.error("fixture-error")
              const source = document.getElementById("drag-source")
              const target = document.getElementById("drop-target")
              source.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", "dragged fixture"))
              target.addEventListener("dragover", (event) => event.preventDefault())
              target.addEventListener("drop", (event) => {
                event.preventDefault()
                target.textContent = event.dataTransfer.getData("text/plain")
              })
            </script>
          </body>
        </html>`)
    })
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("fixture server did not bind a TCP address")
    return `http://127.0.0.1:${address.port}`
  }

  const expectMissingBrowserDiagnostic = async (missingExecutable: string) => {
    const mcp = await connectClient("opencorvus-browser-missing-diagnostic", {
      OPENCORVUS_BROWSER_EXECUTABLE: missingExecutable,
    })
    const result = await mcp.callTool(
      { name: "session_create", arguments: { viewport: { width: 320, height: 240 } } },
      undefined,
      { timeout: 30_000 },
    )
    expect(result.isError).toBe(true)
    const text = result.content.map((item) => ("text" in item ? item.text : "")).join("\n")
    expect(text).toMatch(/browser_executable_not_found|OPENCORVUS_BROWSER_EXECUTABLE/)
  }

  test("lists the built-in browser tools through stdio", async () => {
    const mcp = await connectClient("opencorvus-browser-smoke")
    const result = await mcp.listTools()
    const names = result.tools.map((tool) => tool.name)
    expect(names).toContain("session_create")
    expect(names).toContain("screenshot")
    expect(names).toContain("observe")
    expect(names).toContain("diagnostics_get")
    expect(names).toContain("session_status")
    expect(names).toContain("dialog_policy_set")
    expect(names).toContain("dialog_history")
    expect(names).toContain("keyboard_shortcut")
    expect(names).toContain("drag_and_drop")
    expect(names).toContain("download")
    expect(names).toContain("download_history")
    expect(names).toContain("frames")
    expect(names).toContain("frame_click")
    expect(names).toContain("viewport_set")
    expect(names).toContain("storage_state_export")
    expect(names).toContain("storage_state_import")
    expect(names).toContain("navigate")
  })

  test("reports a structured browser diagnostic when the executable is missing", async () => {
    await using tmp = await tmpdir()
    await expectMissingBrowserDiagnostic(path.join(tmp.path, "missing-browser.exe"))
  })

  test("navigates, observes, screenshots, and destroys a local fixture session through stdio", async () => {
    const executable = await BrowserRuntime.findBrowserExecutable().catch(() => undefined)
    if (!executable) {
      await using tmp = await tmpdir()
      await expectMissingBrowserDiagnostic(path.join(tmp.path, "missing-browser.exe"))
      return
    }
    const baseUrl = await startFixtureServer()
    const mcp = await connectClient("opencorvus-browser-session-smoke")

    const created = await mcp.callTool(
      {
        name: "session_create",
        arguments: { viewport: { width: 800, height: 600 } },
      },
      undefined,
      { timeout: 30_000 },
    )
    const sessionId = (created.structuredContent as { sessionId?: string } | undefined)?.sessionId
    expect(sessionId?.startsWith("sess_")).toBe(true)
    if (!sessionId) throw new Error("session_create did not return a sessionId")
    try {
      const viewport = await mcp.callTool(
        { name: "viewport_set", arguments: { sessionId, width: 640, height: 480 } },
        undefined,
        { timeout: 30_000 },
      )
      expect((viewport.structuredContent as { viewport?: { width?: number; height?: number } }).viewport).toEqual({
        width: 640,
        height: 480,
      })

      const navigated = await mcp.callTool(
        { name: "navigate", arguments: { sessionId, url: baseUrl, waitUntil: "load" } },
        undefined,
        { timeout: 30_000 },
      )
      expect((navigated.structuredContent as { title?: string }).title).toBe("Browser MCP fixture")

      const selected = await mcp.callTool(
        { name: "select_option", arguments: { sessionId, selector: "#fixture-select", label: "Second" } },
        undefined,
        { timeout: 30_000 },
      )
      expect((selected.structuredContent as { selectedValues?: string[] }).selectedValues).toEqual(["two"])

      await mcp.callTool({ name: "type", arguments: { sessionId, selector: "#fixture-input", text: "shortcut target" } }, undefined, {
        timeout: 30_000,
      })
      await mcp.callTool({ name: "keyboard_shortcut", arguments: { sessionId, shortcut: "Control+A" } }, undefined, {
        timeout: 30_000,
      })
      await mcp.callTool({ name: "press_key", arguments: { sessionId, key: "Backspace" } }, undefined, {
        timeout: 30_000,
      })
      const shortcutValue = await mcp.callTool(
        { name: "get_value", arguments: { sessionId, selector: "#fixture-input" } },
        undefined,
        { timeout: 30_000 },
      )
      expect((shortcutValue.structuredContent as { value?: string }).value).toBe("")

      await mcp.callTool({ name: "dialog_policy_set", arguments: { sessionId, action: "accept" } }, undefined, {
        timeout: 30_000,
      })
      await mcp.callTool({ name: "click", arguments: { sessionId, selector: "#dialog-button" } }, undefined, {
        timeout: 30_000,
      })
      const dialogHistory = await mcp.callTool({ name: "dialog_history", arguments: { sessionId } }, undefined, {
        timeout: 30_000,
      })
      expect((dialogHistory.structuredContent as { dialogs?: Array<{ message?: string; action?: string }> }).dialogs).toContainEqual(
        expect.objectContaining({ message: "fixture dialog", action: "accept" }),
      )

      await mcp.callTool(
        { name: "drag_and_drop", arguments: { sessionId, sourceSelector: "#drag-source", targetSelector: "#drop-target" } },
        undefined,
        { timeout: 30_000 },
      )
      const dropped = await mcp.callTool(
        { name: "get_text", arguments: { sessionId, selector: "#drop-target" } },
        undefined,
        { timeout: 30_000 },
      )
      expect((dropped.structuredContent as { text?: string }).text).toContain("dragged fixture")

      const frameList = await mcp.callTool({ name: "frames", arguments: { sessionId } }, undefined, { timeout: 30_000 })
      expect((frameList.structuredContent as { frames?: unknown[] }).frames?.length ?? 0).toBeGreaterThanOrEqual(2)
      await mcp.callTool(
        { name: "frame_type", arguments: { sessionId, frameSelector: "#fixture-frame", selector: "#frame-input", text: "inside frame" } },
        undefined,
        { timeout: 30_000 },
      )
      await mcp.callTool(
        { name: "frame_click", arguments: { sessionId, frameSelector: "#fixture-frame", selector: "#frame-button" } },
        undefined,
        { timeout: 30_000 },
      )
      const frameText = await mcp.callTool(
        { name: "frame_get_text", arguments: { sessionId, frameSelector: "#fixture-frame", selector: "#frame-output" } },
        undefined,
        { timeout: 30_000 },
      )
      expect((frameText.structuredContent as { text?: string }).text).toBe("inside frame")

      const downloaded = await mcp.callTool(
        { name: "download", arguments: { sessionId, selector: "#download-link" } },
        undefined,
        { timeout: 30_000 },
      )
      const downloadPath = (downloaded.structuredContent as { path?: string; suggestedFilename?: string }).path
      expect((downloaded.structuredContent as { suggestedFilename?: string }).suggestedFilename).toBe("fixture-download.txt")
      if (!downloadPath) throw new Error("download did not return a saved path")
      expect(await fs.readFile(downloadPath, "utf8")).toBe("downloaded fixture")
      const downloadHistory = await mcp.callTool({ name: "download_history", arguments: { sessionId } }, undefined, {
        timeout: 30_000,
      })
      expect((downloadHistory.structuredContent as { downloads?: unknown[] }).downloads?.length ?? 0).toBeGreaterThanOrEqual(1)

      const observed = await mcp.callTool(
        { name: "observe", arguments: { sessionId, includeScreenshot: true } },
        undefined,
        { timeout: 30_000 },
      )
      const observeData = observed.structuredContent as {
        url?: string
        title?: string
        screenshot?: { data?: string; width?: number; height?: number }
        dom?: { visibleText?: string; interactive?: unknown[] }
        diagnostics?: { consoleErrors?: unknown[]; httpErrors?: unknown[] }
      }
      expect(observeData.url).toBe(baseUrl + "/")
      expect(observeData.title).toBe("Browser MCP fixture")
      expect(observeData.dom?.visibleText).toContain("Browser MCP fixture")
      expect(observeData.dom?.interactive?.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(observeData.screenshot?.width).toBe(640)
      expect(observeData.screenshot?.height).toBe(480)
      expect(observeData.screenshot?.data?.length ?? 0).toBeGreaterThan(100)

      const screenshot = await mcp.callTool(
        { name: "screenshot", arguments: { sessionId, hideCursor: true } },
        undefined,
        { timeout: 30_000 },
      )
      const shotData = screenshot.structuredContent as { data?: string; width?: number; height?: number }
      expect(shotData.width).toBe(640)
      expect(shotData.height).toBe(480)
      const shotBytes = Buffer.from(shotData.data ?? "", "base64")
      expect([...shotBytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

      const exported = await mcp.callTool(
        { name: "storage_state_export", arguments: { sessionId } },
        undefined,
        { timeout: 30_000 },
      )
      const storageState = (exported.structuredContent as { storageState?: { cookies?: unknown[]; origins?: unknown[] } })
        .storageState
      expect(Array.isArray(storageState?.cookies)).toBe(true)
      expect(Array.isArray(storageState?.origins)).toBe(true)

      const imported = await mcp.callTool(
        {
          name: "storage_state_import",
          arguments: { storageState, viewport: { width: 320, height: 240 }, virtualCursor: false },
        },
        undefined,
        { timeout: 30_000 },
      )
      const importedSessionId = (imported.structuredContent as { sessionId?: string } | undefined)?.sessionId
      expect(importedSessionId?.startsWith("sess_")).toBe(true)
      if (importedSessionId) {
        await mcp.callTool({ name: "session_destroy", arguments: { sessionId: importedSessionId } }, undefined, {
          timeout: 30_000,
        })
      }

      const diagnostics = await mcp.callTool(
        { name: "diagnostics_get", arguments: { sessionId } },
        undefined,
        { timeout: 30_000 },
      )
      const diagnosticData = diagnostics.structuredContent as { consoleErrors?: unknown[]; httpErrors?: unknown[] }
      expect(diagnosticData.consoleErrors?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(diagnosticData.httpErrors?.length ?? 0).toBeGreaterThanOrEqual(1)
    } finally {
      await mcp.callTool({ name: "session_destroy", arguments: { sessionId } }, undefined, { timeout: 30_000 }).catch(
        () => undefined,
      )
    }
  })
})
