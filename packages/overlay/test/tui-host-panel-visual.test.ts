import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

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
        ws.send(typeof message === "string" ? message : new TextDecoder().decode(message))
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
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.waitForSelector(".tui-host-panel")
    await page.waitForSelector('[data-testid="tui-host-terminal"]')
    await page.waitForFunction(() => {
      const error = document.querySelector(".tui-host-error")
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      return !error && terminal?.dataset.state === "running" && terminal.getBoundingClientRect().height > 200
    }, { timeout: 30_000 })

    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".tui-host-panel")
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!panel || !terminal) throw new Error("Missing TUI host panel")
      const panelRect = panel.getBoundingClientRect()
      const terminalRect = terminal.getBoundingClientRect()
      return {
        rightActive: document.querySelector<HTMLElement>("#rightPanelTui")?.dataset.active,
        title: document.querySelector<HTMLElement>("#rightPanelTitle")?.textContent,
        state: terminal.dataset.state,
        panelWidth: Math.round(panelRect.width),
        panelHeight: Math.round(panelRect.height),
        terminalWidth: Math.round(terminalRect.width),
        terminalHeight: Math.round(terminalRect.height),
        errorText: document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? "",
      }
    })

    expect(layout).toMatchObject({
      rightActive: "true",
      title: "TUI",
      state: "running",
      errorText: "",
    })
    expect(layout.panelWidth).toBeGreaterThan(240)
    expect(layout.panelHeight).toBeGreaterThan(500)
    expect(layout.terminalWidth).toBeGreaterThan(220)
    expect(layout.terminalHeight).toBeGreaterThan(400)

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
  } finally {
    await browser.close()
    server.stop(true)
    rmSync(screenshotDir, { recursive: true, force: true })
  }
}, { timeout: 90_000 })
