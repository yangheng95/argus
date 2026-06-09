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
  "providers panel renders stable height and equal same-row buttons",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
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
      if (path === "/provider") {
        return send({
          all: [
            {
              id: "alibaba",
              name: "Alibaba",
              source: "custom",
              models: {
                "alibaba-coding-plan-long-context": { id: "alibaba-coding-plan-long-context" },
              },
            },
          ],
          connected: [],
          default: {},
        })
      }
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config" && req.method === "GET")
        return send({ model: "alibaba/alibaba-coding-plan-long-context" })
      if (path === "/config" && req.method === "PATCH") return send({ ok: true })
      if (path === "/config/prompt") return send([])
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor")
        return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  directory: "D:/overlay/workspace/app",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
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
      await page.waitForSelector('[data-menu-trigger="provider"]')
      await page.click('[data-menu-trigger="provider"]')
      await page.waitForSelector('[data-testid="titlebar-open-providers"]')
      await page.click('[data-testid="titlebar-open-providers"]')
      await page.waitForSelector(".provider-head-actions .oc-button")
      await page.waitForSelector(".provider-api-key-row")

      const metrics = await page.evaluate(() => {
        const heights = Array.from(document.querySelectorAll(".provider-head-actions .oc-button")).map((node) =>
          Math.round((node as HTMLElement).getBoundingClientRect().height),
        )
        const apiRow = document.querySelector(".provider-api-key-row") as HTMLElement
        const apiInput = apiRow.querySelector(".field-input") as HTMLElement
        const apiButton = apiRow.querySelector(".oc-button") as HTMLElement
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        return {
          headHeights: heights,
          apiInputHeight: Math.round(apiInput.getBoundingClientRect().height),
          apiButtonHeight: Math.round(apiButton.getBoundingClientRect().height),
          dialogHeight: Math.round(dialog.getBoundingClientRect().height),
        }
      })

      assert.equal(new Set(metrics.headHeights).size, 1)
      assert.ok(Math.abs(metrics.apiInputHeight - metrics.apiButtonHeight) <= 1)
      assert.ok(metrics.dialogHeight >= 600)

      const beforeDrag = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const header = document.querySelector("#configDialog .dialog-header") as HTMLElement
        const dialogRect = dialog.getBoundingClientRect()
        const headerRect = header.getBoundingClientRect()
        return {
          left: Math.round(dialogRect.left),
          top: Math.round(dialogRect.top),
          startX: Math.round(headerRect.left + 160),
          startY: Math.round(headerRect.top + headerRect.height / 2),
        }
      })

      await page.mouse.move(beforeDrag.startX, beforeDrag.startY)
      await page.mouse.down()
      await page.mouse.move(beforeDrag.startX + 120, beforeDrag.startY + 80, { steps: 10 })
      await page.mouse.up()

      const afterDrag = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const rect = dialog.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }
      })

      assert.ok(afterDrag.left - beforeDrag.left >= 100)
      assert.ok(afterDrag.top - beforeDrag.top >= 60)

      const edgeDrag = await page.evaluate(() => {
        const header = document.querySelector("#configDialog .dialog-header") as HTMLElement
        const headerRect = header.getBoundingClientRect()
        return {
          startX: Math.round(headerRect.left + 160),
          startY: Math.round(headerRect.top + headerRect.height / 2),
        }
      })

      await page.mouse.move(edgeDrag.startX, edgeDrag.startY)
      await page.mouse.down()
      await page.mouse.move(edgeDrag.startX - 2000, edgeDrag.startY - 2000, { steps: 10 })
      await page.mouse.up()

      const clamped = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const rect = dialog.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }
      })

      assert.ok(clamped.left >= 7)
      assert.ok(clamped.top >= 7)
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
