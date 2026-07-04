import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

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

test("sidebar version label keeps the author email on hover", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
      return send({
        branch: "dev",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
    if (path === "/config") return send({ model: "", version: "1.2.3" })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    if (path === "/log/tail") return send({ path: "D:/overlay/logs/server.log", lines: [] })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720 })
    await page.evaluateOnNewDocument((serverUrl: string) => {
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      window.__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                directory: "D:/overlay/workspace/app",
                directoryMode: "custom",
              }
            }
            if (command === "overlay_server_info") return { url: serverUrl, pid: 12345 }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            if (command === "overlay_open_url") return true
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              hide: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector("#chatVersion", { visible: true })

    const versionState = await page.$eval("#chatVersion", (node: HTMLElement) => ({
      text: node.textContent || "",
      ariaLabel: node.getAttribute("aria-label") || "",
    }))
    assert.equal(versionState.ariaLabel, "yangheng@myhexin.com")
    assert.ok(versionState.text.trim().startsWith("OpenCorvus v"))

    await page.hover("#chatVersion")
    await page.waitForSelector(".card-meta-tooltip", { visible: true })
    const tooltip = await page.$eval(".card-meta-tooltip", (node: HTMLElement) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim() || "",
        role: node.getAttribute("role") || "",
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        background: style.backgroundColor,
        color: style.color,
      }
    })
    assert.equal(tooltip.role, "tooltip")
    assert.equal(tooltip.text, "yangheng@myhexin.com")
    assert.ok(tooltip.width > 90 && tooltip.height > 12, `tooltip should be visible: ${JSON.stringify(tooltip)}`)
    assert.notEqual(tooltip.background, "rgba(0, 0, 0, 0)")
    assert.notEqual(tooltip.color, "rgba(0, 0, 0, 0)")

    const screenshotPath = resolve(".scratch/sidebar-version-tooltip-hover.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await page.screenshot({ fullPage: false }))
    assert.ok(screenshotPath.endsWith("sidebar-version-tooltip-hover.png"))
  } finally {
    await browser.close()
    await server.close()
  }
})
