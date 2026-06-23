import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function installOverlaySettings(page: any, serverUrl: string): Promise<void> {
  await page.evaluateOnNewDocument((origin) => {
    localStorage.setItem("oc_locale", "en-US")
    localStorage.setItem("oc_theme", "light")
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", "D:/reduced-motion/workspace")
    window.__TAURI__ = {
      core: {
        invoke: async (command: string) => {
          if (command === "overlay_settings_load") {
            return {
              serverUrl: origin,
              autoServer: false,
              locale: "en-US",
              directory: "D:/reduced-motion/workspace",
              directoryMode: "custom",
            }
          }
          if (command === "overlay_settings_save") return true
          return null
        },
      },
      window: {
        getCurrentWindow() {
          return {
            close: async () => true,
            hide: async () => true,
            minimize: async () => true,
            startDragging: async () => true,
            isMaximized: async () => false,
            onResized: async () => ({ unlisten: async () => undefined }),
          }
        },
      },
    }
  }, serverUrl)
}

test(
  "task list loading skeleton is the reduced-motion owner after BoardIntro retirement",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let resolveTasks: ((response: Response) => void) | null = null
    const tasksResponse = new Promise<Response>((resolve) => {
      resolveTasks = resolve
    })
    const badResponses: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "reduced-motion-test" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks" || path === "/tasks") return tasksResponse
      if (path === "/mission") return send([])
      if (path === "/executor") return send([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: "D:/reduced-motion/workspace", exists: true, git: true })
      if (path === "/vcs") return send({ branch: "visual", clean: true, dirty: false })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ server: {}, provider: {}, channel: {}, mcp: {}, model: "" })
      if (path === "/config/prompt" || path === "/config/prompt-profile") {
        return send({
          active: "general",
          project_active: "general",
          session_active: null,
          default: "general",
          targets: [],
          profiles: [],
        })
      }
      if (path === "/channel") return send([])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/directories") {
        return send({
          global_config: "D:/reduced-motion/config",
          managed_skills: "D:/reduced-motion/config/skills-market",
          remote_cache: "D:/reduced-motion/cache",
        })
      }
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/agent") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
      if (path === "/task/events") {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }
      return send({ error: `unhandled ${req.method} ${path}` }, 404)
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      page.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.emulateMedia({ reducedMotion: "reduce" })
      await installOverlaySettings(page, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(() => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>(".task-list-skeleton-row"))
        return (
          rows.length === 3 &&
          rows.every((row) => {
            const rect = row.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
        )
      })

      const metrics = await page.$eval(".task-list-skeleton-row", (node: HTMLElement) => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const panel = document.querySelector("#taskListPanel") as HTMLElement | null
        const panelRect = panel?.getBoundingClientRect()
        return {
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          boardIntroCount: document.querySelectorAll('[class*="board-intro"]').length,
          rowCount: document.querySelectorAll(".task-list-skeleton-row").length,
          width: rect.width,
          height: rect.height,
          panelWidth: panelRect?.width ?? 0,
          panelHeight: panelRect?.height ?? 0,
          panelDisplay: panel ? getComputedStyle(panel).display : "",
          panelVisibility: panel ? getComputedStyle(panel).visibility : "",
        }
      })
      assert.equal(metrics.reducedMotion, true)
      assert.equal(metrics.animationName, "none")
      assert.equal(metrics.boardIntroCount, 0)
      assert.equal(metrics.rowCount, 3)
      assert.ok(metrics.width > 0, JSON.stringify(metrics))
      assert.ok(metrics.height > 0, JSON.stringify(metrics))

      const panel = await page.$("#taskListPanel")
      assert.ok(panel)
      const screenshotPath = resolve(".scratch", "task-list-reduced-motion-skeleton.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await panel.screenshot({}))

      resolveTasks?.(send({ tasks: [] }))
      await page.close()
      assert.deepEqual(badResponses, [])
    } finally {
      resolveTasks?.(send({ tasks: [] }))
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
