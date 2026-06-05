import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const PASTE_INPUT = "pasted-from-browser-test\r"

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function hostInfo() {
  return {
    id: "pty_visual",
    title: "OpenCorvus TUI",
    command: "opencorvus",
    args: [],
    cwd: "D:/overlay/workspace/app",
    status: "running",
    pid: 123,
  }
}

test("right sidebar TUI host panel renders as a real browser surface", async () => {
  const screenshotDir = mkdtempSync(join(tmpdir(), "opencorvus-tui-visual-"))
  const screenshotPath = join(screenshotDir, "right-tui.png")
  const connectCursors: string[] = []
  const receivedInput: string[] = []
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    websocket: {
      open(ws) {
        ws.send("\x1b[38;5;75mOpenCorvus\x1b[0m coding assistant\r\n")
        ws.send("project: D:/overlay/workspace/app\r\n")
        ws.send("todo: inspect right sidebar TUI visual smoke\r\n")
        ws.send(new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cursor: 99 }))]))
      },
      message(ws, message) {
        const text = typeof message === "string" ? message : new TextDecoder().decode(message)
        receivedInput.push(text)
        ws.send(text)
      },
    },
    async fetch(req, serverInstance) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/pty/pty_visual/connect") {
        connectCursors.push(url.searchParams.get("cursor") ?? "")
        const upgraded = serverInstance.upgrade(req)
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
      }
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/pty") {
        if (req.method === "GET") return send([hostInfo()])
        if (req.method === "POST") return send(hostInfo())
      }
      if (path === "/pty/pty_visual") {
        if (req.method === "PUT") return send(hostInfo())
        if (req.method === "DELETE") return send(true)
      }
      if (path === "/file") return send({ entries: [{ path: "src/main.tsx", name: "main.tsx", type: "file" }] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem(
        "opencorvus:tui-host:v1:D:/overlay/workspace/app:pty_visual",
        JSON.stringify({
          buffer: "Restored OpenCode snapshot\r\n",
          cursor: 42,
          rows: 24,
          cols: 88,
          scrollY: 0,
        }),
      )
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.waitForSelector(".tui-host-panel")
    await page.waitForSelector('[data-testid="tui-host-terminal"]')
    await page.waitForFunction(() => {
      const error = document.querySelector(".tui-host-error")
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      return !error && terminal?.dataset.state === "running" && terminal.getBoundingClientRect().height > 200
    }, { timeout: 30_000 })
    await page.waitForFunction(() => {
      let key: string | null | undefined
      for (let index = 0; index < localStorage.length; index += 1) {
        const item = localStorage.key(index)
        if (item?.startsWith("opencorvus:tui-host:v1:D:/overlay/workspace/app:pty_visual")) {
          key = item
          break
        }
      }
      if (!key) return false
      const snapshot = JSON.parse(localStorage.getItem(key) ?? "{}") as { buffer?: string }
      return typeof snapshot.buffer === "string" && snapshot.buffer.includes("OpenCorvus")
    }, { timeout: 30_000 })

    const focusResult = await page.evaluate((pasteInput) => {
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!terminal) throw new Error("Missing TUI terminal")
      terminal.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      const data = new DataTransfer()
      data.setData("text/plain", pasteInput)
      terminal.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
      return {
        activeTag: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute("aria-label"),
      }
    }, PASTE_INPUT)
    expect(focusResult).toMatchObject({ activeTag: "TEXTAREA", activeLabel: "Terminal input" })
    await page.waitForFunction(() => {
      let key: string | null | undefined
      for (let index = 0; index < localStorage.length; index += 1) {
        const item = localStorage.key(index)
        if (item?.startsWith("opencorvus:tui-host:v1:D:/overlay/workspace/app:pty_visual")) {
          key = item
          break
        }
      }
      if (!key) return false
      const snapshot = JSON.parse(localStorage.getItem(key) ?? "{}") as { buffer?: string }
      return typeof snapshot.buffer === "string" && snapshot.buffer.includes("pasted-from-browser-test")
    }, { timeout: 30_000 })

    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".tui-host-panel")
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!panel || !terminal) throw new Error("Missing TUI host panel")
      let snapshotKey: string | null | undefined
      for (let index = 0; index < localStorage.length; index += 1) {
        const item = localStorage.key(index)
        if (item?.startsWith("opencorvus:tui-host:v1:D:/overlay/workspace/app:pty_visual")) {
          snapshotKey = item
          break
        }
      }
      const snapshot = snapshotKey ? JSON.parse(localStorage.getItem(snapshotKey) ?? "{}") as { buffer?: string; cursor?: number; rows?: number; cols?: number; scrollY?: number } : undefined
      const panelRect = panel.getBoundingClientRect()
      const terminalRect = terminal.getBoundingClientRect()
      return {
        rightActive: document.querySelector<HTMLElement>("#rightPanelTui")?.dataset.active,
        title: document.querySelector<HTMLElement>("#rightPanelTitle")?.textContent,
        state: terminal.dataset.state,
        panelWidth: Math.round(panelRect.width),
        panelHeight: Math.round(panelRect.height),
        terminalLeft: Math.round(terminalRect.left),
        terminalTop: Math.round(terminalRect.top),
        terminalWidth: Math.round(terminalRect.width),
        terminalHeight: Math.round(terminalRect.height),
        terminalBackground: getComputedStyle(terminal).backgroundColor,
        errorText: document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? "",
        snapshotBuffer: snapshot?.buffer ?? "",
        snapshotCursor: snapshot?.cursor,
        snapshotRows: snapshot?.rows,
        snapshotCols: snapshot?.cols,
        snapshotScrollY: snapshot?.scrollY,
      }
    })

    expect(layout).toMatchObject({
      rightActive: "true",
      title: "TUI",
      state: "running",
      errorText: "",
    })
    expect(layout.snapshotBuffer).toContain("OpenCorvus")
    expect(layout.snapshotBuffer).toContain("Restored OpenCode snapshot")
    expect(layout.snapshotBuffer).toContain("pasted-from-browser-test")
    expect(receivedInput.join("")).toContain("pasted-from-browser-test")
    expect(layout.snapshotCursor).toBe(99 + PASTE_INPUT.length)
    expect(layout.snapshotRows).toBeGreaterThan(0)
    expect(layout.snapshotCols).toBeGreaterThan(0)
    expect(layout.snapshotScrollY).toBeGreaterThanOrEqual(0)
    expect(connectCursors).toContain("42")
    expect(layout.panelWidth).toBeGreaterThan(240)
    expect(layout.panelHeight).toBeGreaterThan(500)
    expect(layout.terminalWidth).toBeGreaterThan(220)
    expect(layout.terminalHeight).toBeGreaterThan(400)
    expect(layout.terminalBackground).not.toBe("rgb(11, 11, 11)")
    expect(layout.terminalBackground).not.toBe("rgba(0, 0, 0, 0)")

    await page.click('[data-ui="tui-host-refresh"]')
    for (let attempt = 0; attempt < 60 && connectCursors.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(connectCursors.length).toBeGreaterThanOrEqual(2)

    await page.screenshot({ path: screenshotPath, fullPage: false })
    const png = readFileSync(screenshotPath)
    const image = sharp(png)
    const metadata = await image.metadata()
    expect(metadata.width).toBeGreaterThan(240)
    expect(metadata.height).toBeGreaterThan(500)

    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
    const colors = new Set<string>()
    for (let i = 0; i < data.length; i += info.channels * 64) {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    }
    expect(colors.size).toBeGreaterThan(12)

    const crop = await image
      .extract({
        left: Math.max(0, layout.terminalLeft),
        top: Math.max(0, layout.terminalTop),
        width: Math.max(1, Math.min(layout.terminalWidth, metadata.width! - layout.terminalLeft)),
        height: Math.max(1, Math.min(layout.terminalHeight, metadata.height! - layout.terminalTop)),
      })
      .raw()
      .toBuffer({ resolveWithObject: true })
    let total = 0
    for (let index = 0; index < crop.data.length; index += crop.info.channels * 32) {
      total += crop.data[index] + crop.data[index + 1] + crop.data[index + 2]
    }
    const samples = Math.ceil(crop.data.length / (crop.info.channels * 32))
    expect(total / samples / 3).toBeGreaterThan(80)
  } finally {
    await browser.close()
    server.stop(true)
    rmSync(screenshotDir, { recursive: true, force: true })
  }
}, { timeout: 90_000 })

test("right sidebar TUI host panel shows disconnected input failures", async () => {
  let closedSockets = 0
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    websocket: {
      open(ws) {
        ws.send("OpenCorvus disconnected input smoke\r\n")
        ws.send(new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cursor: 40 }))]))
        ws.close(1000, "normal close before input")
      },
      close() {
        closedSockets += 1
      },
    },
    async fetch(req, serverInstance) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/pty/pty_visual/connect") {
        const upgraded = serverInstance.upgrade(req)
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
      }
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/pty") {
        if (req.method === "GET") return send([hostInfo()])
        if (req.method === "POST") return send(hostInfo())
      }
      if (path === "/pty/pty_visual") {
        if (req.method === "PUT") return send(hostInfo())
        if (req.method === "DELETE") return send(true)
      }
      if (path === "/file") return send({ entries: [] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.waitForSelector('[data-testid="tui-host-terminal"]')
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')?.dataset.state === "running")
    for (let attempt = 0; attempt < 60 && closedSockets === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(closedSockets).toBeGreaterThan(0)

    await page.evaluate(() => {
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!terminal) throw new Error("Missing TUI terminal")
      terminal.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      const data = new DataTransfer()
      data.setData("text/plain", "lost-input-should-be-visible\r")
      terminal.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
    })

    await page.waitForFunction(() => {
      const text = document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? ""
      return text.includes("TUI host is not connected. Press refresh to reconnect.")
    }, { timeout: 30_000 })
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 90_000 })
