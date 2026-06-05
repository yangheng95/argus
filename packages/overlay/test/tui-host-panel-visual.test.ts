import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const TANK_BATTLE_TUI_CASE = [
  "Build a playable Tank Battle game for this workspace.",
  "Requirements:",
  "- show a tile battlefield with brick walls, steel walls, a player tank, and enemy tanks",
  "- support keyboard movement and shooting from the overlay TUI request flow",
  "- include score, lives, wave status, win state, and game over state",
  "- verify the result with a browser visual test and a focused rule test",
  "Use a mature game/rendering library where appropriate; do not hand-roll engine primitives.",
  "Chinese acceptance marker: 坦克大战 overlay TUI usability case.",
].join("\n") + "\r"

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

function line(text: string, fg = "rgb(229, 231, 235)", bg = "rgb(10, 10, 10)", attributes = 0) {
  return {
    spans: [
      {
        text,
        fg,
        bg,
        attributes,
        width: text.length,
      },
    ],
  }
}

function embedInfo(text: string, input = "") {
  const lines = [
    line("OpenCorvus coding assistant", "rgb(125, 211, 252)", "rgb(10, 10, 10)", 1),
    line("project: D:/overlay/workspace/app", "rgb(209, 213, 219)"),
    line("todo: accept a Tank Battle build request through overlay TUI", "rgb(253, 224, 71)"),
    ...input.split("\n").map((item) => line(item, "rgb(244, 244, 245)")),
  ]
  return {
    running: true,
    cols: 100,
    rows: 30,
    directory: "D:/overlay/workspace/app",
    frame: {
      cols: 100,
      rows: 30,
      cursor: [0, Math.min(lines.length, 29)],
      lines,
    },
    text: [text, input].filter(Boolean).join("\n"),
    createdAt: 1,
    updatedAt: Date.now(),
  }
}

function commonProjectResponse(path: string) {
  if (path === "/" || path === "/ui") return "redirect" as const
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
  if (path === "/file") return send({ entries: [{ path: "src/main.tsx", name: "main.tsx", type: "file" }] })
  if (path === "/find/file") return send({ entries: [] })
  return undefined
}

test("right sidebar TUI host panel accepts the Tank Battle build case through OpenTUI embed frames", async () => {
  const screenshotDir = mkdtempSync(join(tmpdir(), "opencorvus-tui-visual-"))
  const screenshotPath = join(screenshotDir, "right-tui.png")
  const receivedInput: string[] = []
  const startBodies: unknown[] = []
  const resizeBodies: unknown[] = []
  let inputText = ""
  let started = false

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      const common = commonProjectResponse(path)
      if (common === "redirect") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (common) return common
      if (path === "/tui/embed/status") return send(started ? embedInfo("OpenCorvus coding assistant", inputText) : { running: false, cols: null, rows: null, directory: "", frame: null, text: "", createdAt: null, updatedAt: null })
      if (path === "/tui/embed/start") {
        started = true
        startBodies.push(await req.json())
        return send(embedInfo("OpenCorvus coding assistant", inputText))
      }
      if (path === "/tui/embed/input") {
        const body = (await req.json()) as { text?: string; key?: string }
        if (body.text) {
          receivedInput.push(body.text)
          inputText += body.text
        }
        if (body.key === "enter") inputText += "\n"
        return send(embedInfo("OpenCorvus coding assistant", inputText))
      }
      if (path === "/tui/embed/resize") {
        resizeBodies.push(await req.json())
        return send(embedInfo("OpenCorvus coding assistant", inputText))
      }
      if (path === "/tui/embed/stop") {
        started = false
        return send(true)
      }
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
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    await page.waitForSelector(".tui-host-panel")
    await page.waitForFunction(() => {
      const error = document.querySelector(".tui-host-error")
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      return !error && terminal?.dataset.state === "running" && terminal.textContent?.includes("OpenCorvus")
    }, { timeout: 30_000 })

    const focusResult = await page.evaluate((pasteInput) => {
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!terminal) throw new Error("Missing TUI terminal")
      terminal.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      const data = new DataTransfer()
      data.setData("text/plain", pasteInput)
      terminal.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
      return {
        activeTestId: (document.activeElement as HTMLElement | null)?.dataset.testid,
      }
    }, TANK_BATTLE_TUI_CASE)
    expect(focusResult).toMatchObject({ activeTestId: "tui-host-terminal" })

    await page.waitForFunction(() => {
      const text = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')?.textContent ?? ""
      return text.includes("Tank Battle") && text.includes("browser visual test") && text.includes("坦克大战")
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
        terminalLeft: Math.round(terminalRect.left),
        terminalTop: Math.round(terminalRect.top),
        terminalWidth: Math.round(terminalRect.width),
        terminalHeight: Math.round(terminalRect.height),
        terminalBackground: getComputedStyle(terminal).backgroundColor,
        terminalText: terminal.textContent ?? "",
        errorText: document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? "",
      }
    })

    expect(layout).toMatchObject({
      rightActive: "true",
      title: "TUI",
      state: "running",
      errorText: "",
    })
    expect(layout.terminalText).toContain("Build a playable Tank Battle game")
    expect(layout.terminalText).toContain("tile battlefield")
    expect(layout.terminalText).toContain("overlay TUI")
    expect(layout.terminalText).toContain("坦克大战")
    expect(receivedInput.join("")).toContain("Build a playable Tank Battle game")
    expect(receivedInput.join("")).toContain("browser visual test")
    expect(receivedInput.join("")).toContain("坦克大战")
    expect(startBodies[0]).toMatchObject({ agent: "tui-coding" })
    expect(resizeBodies.length).toBeGreaterThanOrEqual(0)
    expect(layout.panelWidth).toBeGreaterThan(240)
    expect(layout.panelHeight).toBeGreaterThan(500)
    expect(layout.terminalWidth).toBeGreaterThan(220)
    expect(layout.terminalHeight).toBeGreaterThan(400)
    expect(layout.terminalBackground).not.toBe("rgba(0, 0, 0, 0)")

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
    expect(total / samples / 3).toBeGreaterThan(40)
  } finally {
    await browser.close()
    server.stop(true)
    rmSync(screenshotDir, { recursive: true, force: true })
  }
}, { timeout: 90_000 })

test("right sidebar TUI host panel shows embedded renderer input failure details", async () => {
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      const common = commonProjectResponse(path)
      if (common === "redirect") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (common) return common
      if (path === "/tui/embed/status") return send({ running: false, cols: null, rows: null, directory: "", frame: null, text: "", createdAt: null, updatedAt: null })
      if (path === "/tui/embed/start") return send(embedInfo("OpenCorvus input failure smoke"))
      if (path === "/tui/embed/input") {
        return send({ name: "EmbeddedTuiInputError", data: { message: "renderer input rejected", secret: "do-not-render" } }, { status: 400 })
      }
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
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')?.dataset.state === "running")
    await page.evaluate(() => {
      const terminal = document.querySelector<HTMLElement>('[data-testid="tui-host-terminal"]')
      if (!terminal) throw new Error("Missing TUI terminal")
      terminal.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "x" }))
    })

    await page.waitForFunction(() => {
      const text = document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? ""
      return text.includes("EmbeddedTuiInputError: renderer input rejected") && !text.includes("do-not-render")
    }, { timeout: 30_000 })
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 90_000 })

test("right sidebar TUI host panel shows embedded renderer start failure details", async () => {
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      const common = commonProjectResponse(path)
      if (common === "redirect") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (common) return common
      if (path === "/tui/embed/status") return send({ running: false, cols: null, rows: null, directory: "", frame: null, text: "", createdAt: null, updatedAt: null })
      if (path === "/tui/embed/start") {
        return send({
          name: "EmbeddedTuiStartError",
          data: {
            message: "renderer failed",
            env: { SHOULD_NOT_RENDER: "secret" },
          },
        }, { status: 400 })
      }
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
    await page.waitForFunction(() => {
      const text = document.querySelector<HTMLElement>(".tui-host-error")?.textContent ?? ""
      return text.includes("EmbeddedTuiStartError: renderer failed") && !text.includes("secret")
    }, { timeout: 30_000 })
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 90_000 })
