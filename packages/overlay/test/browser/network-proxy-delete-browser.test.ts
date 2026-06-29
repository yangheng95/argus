import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
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

async function saveNetworkPanelScreenshot(page: any, filename: string) {
  const root = fileURLToPath(new URL("../../../../.scratch/", import.meta.url))
  const target = `${root}${filename}`
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(".network-panel")
  assert.ok(element, "network panel should exist before screenshot")
  const image = await element.screenshot({})
  await writeFile(target, image)
  return target
}

test(
  "Network proxy settings expose an explicit delete action",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const configPatches: unknown[] = []
    let currentConfig = {
      model: "opencorvus/gpt-5-nano",
      version: "1.2.3",
      network: {
        proxy: {
          url: "http://127.0.0.1:7890",
          username: "proxy-user",
          password: "proxy-pass",
          llmProvider: true,
          webResearch: true,
        },
      },
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") {
        return send({
          branch: "proxy-delete",
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
      if (path === "/config/prompt-profile") {
        return send({
          active: "general",
          project_active: "general",
          session_active: null,
          default: "general",
          targets: [],
          profiles: [],
        })
      }
      if (path === "/config" && req.method === "GET") return send(currentConfig)
      if (path === "/config" && req.method === "PATCH") {
        const body = await req.json()
        configPatches.push(body)
        if ((body as any)?.network?.proxy === null) {
          currentConfig = {
            ...currentConfig,
            network: {},
          }
        }
        return send(currentConfig)
      }
      if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
      if (path === "/skill/directories") {
        return send({
          global_config: "D:/overlay/global/.opencorvus",
          managed_skills: "D:/overlay/global/.opencorvus/skills-market",
          remote_cache: "D:/overlay/global/.opencorvus/skill-cache",
        })
      }
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 960, height: 820 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          theme: "light",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceDirectory: "D:/overlay/workspace/app",
        }
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") return settings
              if (command === "overlay_settings_save") {
                Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                return true
              }
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
              if (command === "overlay_open_path" || command === "overlay_open_url") return true
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
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-menu-trigger="settings"]')
      await page.click('[data-menu-trigger="settings"]')
      await page.waitForSelector('[data-testid="titlebar-settings-network"]', { visible: true })
      await page.click('[data-testid="titlebar-settings-network"]')
      await page.waitForSelector(".network-panel")
      await page.waitForSelector('[data-ui="network-proxy-delete"]', { visible: true })

      assert.equal(
        await page.$eval('[data-ui="network-proxy-delete"]', (node: HTMLButtonElement) => node.disabled),
        false,
        "delete button should be enabled when a proxy is already configured",
      )
      assert.equal(
        await page.$eval('input[type="url"]', (node: HTMLInputElement) => node.value),
        "http://127.0.0.1:7890",
      )
      const screenshot = await saveNetworkPanelScreenshot(page, "network-proxy-delete-button.png")
      assert.ok(screenshot.endsWith("network-proxy-delete-button.png"))

      configPatches.length = 0
      await page.click('[data-ui="network-proxy-delete"]')
      await page.waitForFunction(() =>
        document
          .querySelector(".network-panel .provider-test-result")
          ?.textContent?.includes("Proxy settings deleted."),
      )

      assert.deepEqual(configPatches, [{ network: { proxy: null } }])
      assert.equal(
        await page.$eval('[data-ui="network-proxy-delete"]', (node: HTMLButtonElement) => node.disabled),
        true,
        "delete button should disable after the saved proxy has been removed",
      )
      assert.equal(await page.$eval('input[type="url"]', (node: HTMLInputElement) => node.value), "")
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
