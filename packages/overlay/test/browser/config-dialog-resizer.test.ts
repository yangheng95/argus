import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

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

test(
  "config dialog resizer exposes separator semantics and keyboard resizing",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [] })
      if (path === "/mission") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs")
        return send({
          branch: "preview-e2e",
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
      if (path === "/config" && req.method === "PATCH") return send({ model: "" })
      if (path === "/config") return send({ model: "", version: "1.2.3" })
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/agent") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      return send({})
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
        }
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") return settings
              if (command === "overlay_settings_save") {
                Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                return true
              }
              if (command === "overlay_open_path") return true
              if (command === "overlay_open_url") return true
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => true,
                hide: async () => true,
                startDragging: async () => true,
                minimize: async () => true,
              }
            },
          },
        }
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-menu-trigger="settings"]')
      await page.click('[data-menu-trigger="settings"]')
      await page.waitForSelector('[data-testid="titlebar-settings-general"]', { visible: true })
      await page.click('[data-testid="titlebar-settings-general"]')
      await page.waitForSelector("#configResizer")
      const semantics = await page.evaluate(() => {
        const resizer = document.querySelector<HTMLElement>("#configResizer")
        return {
          role: resizer?.getAttribute("role"),
          orientation: resizer?.getAttribute("aria-orientation"),
          controls: resizer?.getAttribute("aria-controls"),
          tabIndex: resizer?.tabIndex,
          min: Number(resizer?.getAttribute("aria-valuemin")),
          max: Number(resizer?.getAttribute("aria-valuemax")),
          now: Number(resizer?.getAttribute("aria-valuenow")),
        }
      })
      assert.equal(semantics.role, "separator")
      assert.equal(semantics.orientation, "vertical")
      assert.equal(semantics.controls, "configSidebar")
      assert.equal(semantics.tabIndex, 0)
      assert.ok(semantics.min < semantics.max)
      assert.ok(semantics.now >= semantics.min)
      assert.ok(semantics.now <= semantics.max)

      await page.focus("#configResizer")
      await page.keyboard.press("Home")
      await page.waitForFunction(() => {
        const resizer = document.querySelector<HTMLElement>("#configResizer")
        const sidebar = document.querySelector<HTMLElement>("#configSidebar")
        const min = Number(resizer?.getAttribute("aria-valuemin"))
        return !!sidebar && Math.abs(sidebar.getBoundingClientRect().width - min) <= 1
      })
      const before = await page.evaluate(
        () => document.querySelector<HTMLElement>("#configSidebar")!.getBoundingClientRect().width,
      )
      await page.keyboard.press("ArrowRight")
      await page.waitForFunction(
        (previous) => document.querySelector<HTMLElement>("#configSidebar")!.getBoundingClientRect().width > previous,
        before,
      )
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
