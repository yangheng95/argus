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

async function chooseModelOption(page: any, triggerSelector: string, value: string) {
  await page.click(triggerSelector)
  const optionSelector = `.agent-model-select-option[data-model-value="${value}"]`
  await page.waitForSelector(optionSelector)
  await page.click(optionSelector)
}

test("agent model selects patch independent per-agent overrides", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  let config: Record<string, unknown> = {
    model: "openai/gpt-4o-mini",
    agent: {},
  }
  const patches: Record<string, unknown>[] = []

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
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") {
      return send({
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
            },
          },
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-4.1": { id: "gpt-4.1" },
              "gpt-4o-mini": { id: "gpt-4o-mini" },
            },
          },
        ],
        default: {
          anthropic: "claude-sonnet-4-6",
          openai: "gpt-4o-mini",
        },
      })
    }
    if (path === "/config/prompt") return send([])
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      patches.push(body)
      config = mergePatch(config, body) as Record<string, unknown>
      return send(config)
    }
    if (path === "/agent") {
      return send([
        { name: "build", description: "Build agent", mode: "primary", native: true, options: {} },
        { name: "integrity", description: "Integrity review agent", mode: "primary", native: true, options: {} },
      ])
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
      localStorage.setItem("oc_locale", "en-US")
      ;(window as any).__TAURI__ = {
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
    await page.waitForSelector('[data-testid="titlebar-open-agent-models"]')
    await page.click('[data-testid="titlebar-open-agent-models"]')
    await page.waitForSelector('[data-testid="agent-model-select-build"]')
    await page.waitForSelector('[data-testid="agent-model-select-integrity"]')

    const initialOptionCount = await page.$$eval(".agent-model-select-option", (nodes: HTMLElement[]) => nodes.length)
    assert.equal(initialOptionCount, 0)

    await chooseModelOption(page, '[data-testid="agent-model-select-build"]', "anthropic/claude-sonnet-4-6")
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="agent-model-select-build"]')?.textContent?.includes("claude-sonnet-4-6"),
    )

    await page.waitForSelector('[data-testid="agent-model-select-integrity"]')
    await chooseModelOption(page, '[data-testid="agent-model-select-integrity"]', "openai/gpt-4.1")
    await page.waitForFunction(
      () => document.querySelector('[data-testid="agent-model-select-integrity"]')?.textContent?.includes("gpt-4.1"),
    )

    const modelPatches = patches.filter((patch) => "agent" in patch)
    assert.deepEqual(modelPatches, [
      { agent: { build: { model: "anthropic/claude-sonnet-4-6" } } },
      { agent: { integrity: { model: "openai/gpt-4.1" } } },
    ])
    assert.equal(config.model, "openai/gpt-4o-mini")
    assert.deepEqual(config.agent, {
      build: { model: "anthropic/claude-sonnet-4-6" },
      integrity: { model: "openai/gpt-4.1" },
    })
  } finally {
    await browser.close()
    await server.close()
  }
})
