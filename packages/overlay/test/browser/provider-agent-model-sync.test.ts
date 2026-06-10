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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch
  const base = isRecord(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key]
    } else {
      base[key] = mergePatch(base[key], value)
    }
  }
  return base
}

test(
  "saving a hexin api key updates provider stats and agent model options in the same settings session",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let config: Record<string, unknown> = {
      model: "openai/gpt-4o-mini",
    }
    let hexinConnected = false
    let hexinAuthKey = ""

    const openaiProvider = {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      models: {
        "gpt-4o-mini": { id: "gpt-4o-mini" },
      },
    }
    const hexinProvider = {
      id: "hexin",
      name: "Hexin OpenAI Gateway",
      env: ["HEXIN_API_KEY"],
      models: {
        "gpt-5.4-mini": { id: "gpt-5.4-mini" },
        "gpt-5.4": { id: "gpt-5.4" },
      },
    }

    function configuredProviders() {
      const configured = [openaiProvider]
      const overrideKey = (config.provider as Record<string, any> | undefined)?.hexin?.options?.apiKey
      if ((typeof overrideKey === "string" && overrideKey.trim() !== "") || hexinAuthKey) {
        configured.push({
          ...hexinProvider,
          ...(hexinAuthKey ? { key: hexinAuthKey } : {}),
        })
      }
      return configured
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
      if (path === "/provider") {
        return send({
          all: [openaiProvider, hexinProvider],
          connected: hexinConnected ? ["hexin"] : [],
          default: {
            openai: "gpt-4o-mini",
            hexin: "gpt-5.4-mini",
          },
        })
      }
      if (path === "/provider/auth") return send({})
      if (path === "/auth/hexin" && req.method === "PUT") {
        const body = (await req.json()) as { key?: string }
        hexinAuthKey = typeof body.key === "string" ? body.key : ""
        hexinConnected = hexinAuthKey.trim() !== ""
        return send(true)
      }
      if (path === "/provider/hexin/refresh" && req.method === "POST") {
        hexinConnected = true
        return send({
          ok: true,
          count: Object.keys(hexinProvider.models).length,
          ids: Object.keys(hexinProvider.models),
        })
      }
      if (path === "/config/providers") {
        const providers = configuredProviders()
        return send({
          providers,
          default: {
            openai: "gpt-4o-mini",
            ...(providers.some((item) => item.id === "hexin") ? { hexin: "gpt-5.4-mini" } : {}),
          },
        })
      }
      if (path === "/config/prompt") return send([])
      if (path === "/config" && req.method === "GET") return send(config)
      if (path === "/config" && req.method === "PATCH") {
        const body = (await req.json()) as Record<string, unknown>
        config = mergePatch(config, body) as Record<string, unknown>
        return send(config)
      }
      if (path === "/agent") {
        return send([{ name: "build", description: "Build agent", mode: "primary", native: true }])
      }
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
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
      await page.waitForSelector('[data-testid="provider-api-key-input-hexin"]')

      await page.type('[data-testid="provider-api-key-input-hexin"]', "sk-hexin-test")
      await page.click('[data-testid="provider-api-key-save-hexin"]')
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="provider-api-key-input-hexin"]') as HTMLInputElement | null)?.value ===
          "",
      )
      await page.waitForFunction(() => {
        const stats = Array.from(document.querySelectorAll(".provider-stat"))
        return stats.some((node) => {
          const label = node.querySelector(".provider-stat-label")?.textContent?.trim()
          const value = node.querySelector(".provider-stat-value")?.textContent?.trim()
          return label === "Configured" && value === "1"
        })
      })

      const configuredValue = await page.evaluate(() => {
        const stats = Array.from(document.querySelectorAll(".provider-stat"))
        const configured = stats.find(
          (node) => node.querySelector(".provider-stat-label")?.textContent?.trim() === "Configured",
        )
        return configured?.querySelector(".provider-stat-value")?.textContent?.trim() ?? ""
      })
      assert.equal(configuredValue, "1")

      await page.waitForSelector('[data-config-tab="agent-models"]')
      await page.click('[data-config-tab="agent-models"]')
      await page.waitForFunction(
        () => document.querySelector('[data-config-panel="agent-models"]')?.classList.contains("active") === true,
      )
      await page.waitForSelector('[data-testid="agent-model-select-build"]')
      await page.click('[data-testid="agent-model-select-build"]')
      await page.waitForSelector('.agent-model-select-option[data-model-value="hexin/gpt-5.4-mini"]')

      const optionValues = await page.$$eval(".agent-model-select-option", (nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.modelValue || ""),
      )
      assert.ok(optionValues.includes("hexin/gpt-5.4-mini"))
      assert.ok(optionValues.includes("hexin/gpt-5.4"))
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
