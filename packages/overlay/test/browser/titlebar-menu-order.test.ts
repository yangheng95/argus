import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
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
  "titlebar removes Tools and renders Project Provider Run View Settings Help in order",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const promptProfiles = {
      active: "general",
      project_active: "general",
      session_active: null,
      default: "general",
      targets: [],
      profiles: [
        {
          id: "general",
          label: "General",
          description: "Baseline prompt set.",
          built_in: true,
          editable: false,
          agents: {},
        },
      ],
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") {
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      }
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") {
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
      }
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") return send(promptProfiles)
      if (path === "/config") return send({ model: "hexin/gpt-5.5" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path === "/log/tail") return send({ lines: [] })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1024, height: 180 })
      await page.evaluateOnNewDocument((serverUrl) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "dark")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  theme: "dark",
                  directory: "D:/overlay/workspace/app",
                }
              }
              if (command === "overlay_server_info") return { url: serverUrl, pid: 12345 }
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
      await page.waitForSelector('[data-menu-trigger="workspace"]', { visible: true })

      const titlebar = await page.$("#titlebar")
      assert.notEqual(titlebar, null)
      const screenshotPath = resolve(".scratch", "titlebar-menu-order.png")
      await mkdir(resolve(".scratch"), { recursive: true })
      await writeFile(screenshotPath, await titlebar!.screenshot({}))

      const geometry = await page.evaluate(() => {
        const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-trigger]"))
          .filter((node) => {
            const style = getComputedStyle(node)
            const rect = node.getBoundingClientRect()
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
          })
          .map((node) => {
            const rect = node.getBoundingClientRect()
            return {
              id: node.dataset.menuTrigger || "",
              text: node.textContent?.trim() || "",
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            }
          })
        const overlaps: string[] = []
        for (let index = 0; index < triggers.length - 1; index += 1) {
          const current = triggers[index]
          const next = triggers[index + 1]
          if (current.right > next.left + 0.5 || current.bottom < next.top || current.top > next.bottom) {
            overlaps.push(`${current.id} overlaps ${next.id}`)
          }
        }
        return { triggers, overlaps }
      })

      assert.deepEqual(
        geometry.triggers.map((item) => item.id),
        ["workspace", "provider", "run", "view", "settings", "help"],
      )
      assert.equal(
        geometry.triggers.some((item) => item.id === "tools" || item.text === "Tools"),
        false,
      )
      assert.deepEqual(geometry.overlaps, [])
      const view = geometry.triggers.find((item) => item.id === "view")!
      const settings = geometry.triggers.find((item) => item.id === "settings")!
      const help = geometry.triggers.find((item) => item.id === "help")!
      assert.ok(view.right <= settings.left + 0.5)
      assert.ok(settings.right <= help.left + 0.5)

      await page.click('[data-menu-trigger="settings"]')
      await page.waitForSelector('[data-testid="titlebar-settings-prompt"]', { visible: true })
      await page.click('[data-testid="titlebar-settings-prompt"]')
      await page.waitForSelector('[data-config-panel="prompt"].active', { visible: true })

      await page.keyboard.press("Escape")
      await page.keyboard.down("Alt")
      await page.keyboard.press("t")
      await page.keyboard.up("Alt")
      const toolsState = await page.evaluate(() => ({
        trigger: document.querySelector('[data-menu-trigger="tools"]') !== null,
        panel: document.querySelector('[data-testid="titlebar-menu-tools"]') !== null,
      }))
      assert.deepEqual(toolsState, { trigger: false, panel: false })

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
