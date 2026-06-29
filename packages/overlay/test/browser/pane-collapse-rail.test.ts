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
  "left task panel has no collapse button and ignores stale collapsed storage",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
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
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      return send({})
    })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_sidebar_collapsed", "true")
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#sidebar")
      assert.equal(await page.$('[data-ui="sidebar-header-collapse-toggle"]'), null)
      assert.notEqual(await page.$("#solidLeftActivityToolbar"), null)
      assert.equal(await page.$('[data-ui="right-panel-header-collapse-toggle"]'), null)
      assert.equal(await page.$("#rightPaneResizer"), null)

      const expanded = await page.evaluate(() => {
        const measure = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) throw new Error(`Missing ${selector}`)
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          return {
            hidden: node.hidden,
            display: style.display,
            width: rect.width,
            height: rect.height,
            disabled: node.dataset.disabled || "",
          }
        }
        return {
          sidebar: measure("#sidebar"),
          leftResizer: measure("#leftPaneResizer"),
          leftRailPresent: !!document.querySelector(".sidebar-collapsed-rail"),
          chat: measure("#chatSection"),
          taskPanelMounted: !!document.querySelector("#leftPanelTasks"),
          sidebarContentVisible:
            getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
        }
      })

      assert.equal(expanded.sidebar.hidden, false)
      assert.equal(expanded.sidebar.display, "flex")
      assert.ok(expanded.sidebar.width > 200)
      assert.equal(expanded.leftResizer.hidden, false)
      assert.equal(expanded.leftResizer.disabled, "false")
      assert.equal(expanded.leftRailPresent, false)
      assert.equal(expanded.taskPanelMounted, true)
      assert.equal(expanded.sidebarContentVisible, true)
      assert.ok(expanded.chat.width > 200)
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
