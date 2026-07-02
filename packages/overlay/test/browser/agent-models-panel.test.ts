import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const PROMPT_PROFILE_CATALOG = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [],
}

const EMPTY_SKILL_MOUNT_MATRIX = {
  scope: "project",
  skills: [],
  agents: [],
  matrix: [],
  project_mounts: {},
  unmounted_count: 0,
}

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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
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

function commonOverlayBootstrapResponse(path: string): Response | null {
  if (path === "/global/projects/discover") {
    return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
  }
  if (path === "/task/events") return eventStream()
  if (path === "/project/current/worktrees") return send([])
  if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
  if (path === "/mission") return send([])
  if (path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
  if (path === "/skill/mounts") return send(EMPTY_SKILL_MOUNT_MATRIX)
  return null
}

async function closeBrowserAndServer(browser: { close(): Promise<void> }, server: { close(): Promise<void> }) {
  let closeError: unknown
  try {
    await browser.close()
  } catch (error) {
    closeError = error
  } finally {
    await server.close()
  }
  if (closeError) throw closeError
}

async function chooseModelOption(page: any, triggerSelector: string, value: string) {
  await page.click(triggerSelector)
  const optionSelector = `.agent-model-select-option[data-model-value="${value}"]`
  await page.waitForSelector(optionSelector)
  await page.click(optionSelector)
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

async function assertPopupAboveConfigDialog(page: any, popupSelector: string) {
  return await page.$eval(popupSelector, (popup: HTMLElement, selector: string) => {
    const popupRect = popup.getBoundingClientRect()
    const centerX = popupRect.left + popupRect.width / 2
    const centerY = popupRect.top + Math.min(18, Math.max(1, popupRect.height / 2))
    const topElement = document.elementFromPoint(centerX, centerY) as HTMLElement | null
    const dialog = document.querySelector("#configDialog") as HTMLElement | null
    if (!dialog) throw new Error("config dialog must exist while checking popup stacking")
    return {
      popupZIndex: getComputedStyle(popup).zIndex,
      dialogZIndex: getComputedStyle(dialog).zIndex,
      popupVisible: popupRect.width > 0 && popupRect.height > 0,
      topElementClass: topElement?.className ?? "",
      topElementInsidePopup: !!topElement?.closest(selector),
    }
  }, popupSelector)
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
    const commonResponse = commonOverlayBootstrapResponse(path)
    if (commonResponse) return commonResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
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
      ;(window as any).__OPENCORVUS_LOCALE__ = "zh-CN"
      localStorage.setItem("oc_locale", "zh-CN")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "zh-CN",
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
    const menuLabel = await page.$eval('[data-testid="titlebar-open-agent-models"]', (node: HTMLElement) =>
      node.textContent?.trim(),
    )
    assert.equal(menuLabel, "Agent 模型")
    await page.click('[data-testid="titlebar-open-agent-models"]')
    await page.waitForSelector('[data-testid="agent-model-select-build"]')
    await page.waitForSelector('[data-testid="agent-model-select-integrity"]')
    const labels = await page.evaluate(() => ({
      sidebar: document.querySelector('[data-config-tab="agent-models"]')?.textContent?.trim(),
      title: document.querySelector('[data-config-panel="agent-models"] .s-group-head-title')?.textContent?.trim(),
      tiers: Array.from(document.querySelectorAll('[data-config-panel="agent-models"] .agent-model-tier-label')).map(
        (node) => node.textContent?.trim(),
      ),
      inheritTrigger: document.querySelector('[data-testid="agent-model-select-build"]')?.textContent?.trim(),
    }))
    assert.equal(labels.sidebar, "Agent 模型")
    assert.equal(labels.title, "Agent 模型")
    assert.deepEqual(labels.tiers, ["核心 — 主要编码 Agent"])
    assert.equal(labels.inheritTrigger, "— 继承项目默认 —")
    const screenshot = await saveElementScreenshot(page, '[data-config-panel="agent-models"]', "agent-models-zh-cn.png")
    assert.ok(screenshot.endsWith("agent-models-zh-cn.png"))

    const initialOptionCount = await page.$$eval(".agent-model-select-option", (nodes: HTMLElement[]) => nodes.length)
    assert.equal(initialOptionCount, 0)

    await page.click('[data-testid="agent-model-select-build"]')
    await page.waitForSelector('.agent-model-select-option[data-model-value=""]')
    const buildPopupStacking = await assertPopupAboveConfigDialog(page, ".agent-model-select-content")
    assert.equal(buildPopupStacking.popupZIndex, "10001")
    assert.equal(buildPopupStacking.dialogZIndex, "10000")
    assert.equal(buildPopupStacking.popupVisible, true)
    assert.equal(
      buildPopupStacking.topElementInsidePopup,
      true,
      `agent model popup should be above config dialog, top element was ${buildPopupStacking.topElementClass}`,
    )
    const popupScreenshot = await saveElementScreenshot(
      page,
      ".agent-model-select-content",
      "agent-models-select-popup-visible.png",
    )
    assert.ok(popupScreenshot.endsWith("agent-models-select-popup-visible.png"))
    const inheritOption = await page.$eval('.agent-model-select-option[data-model-value=""]', (node: HTMLElement) =>
      node.textContent?.trim(),
    )
    assert.equal(inheritOption, "— 继承项目默认 —")
    await page.click('.agent-model-select-option[data-model-value="anthropic/claude-sonnet-4-6"]')
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="agent-model-select-build"]')?.textContent?.includes("claude-sonnet-4-6"),
    )

    await page.waitForSelector('[data-testid="agent-model-select-integrity"]')
    await chooseModelOption(page, '[data-testid="agent-model-select-integrity"]', "openai/gpt-4.1")
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="agent-model-select-integrity"]')?.textContent?.includes("gpt-4.1"),
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
    await closeBrowserAndServer(browser, server)
  }
})

test("agent models loading spinner animates through shared motion tokens and stops for reduced motion", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  let releaseAgents: ((response: Response) => void) | undefined
  const agentsHold = new Promise<Response>((resolve) => {
    releaseAgents = resolve
  })

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") {
      return Response.redirect(`${url.origin}/ui/index.html`, 302)
    }
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    const commonResponse = commonOverlayBootstrapResponse(path)
    if (commonResponse) return commonResponse
    if (path === "/global/health") return send({ version: "agent-model-spinner" })
    if (path === "/global/tasks") return send({ tasks: [] })
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
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/config") return send({ model: "openai/gpt-4o-mini", agent: {} })
    if (path === "/agent") return agentsHold
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
    await page.waitForSelector(".agent-models-loading-spinner", { visible: true, timeout: 15_000 })

    const motion = await page.$eval(".agent-models-loading-spinner", (node: HTMLElement) => {
      const style = getComputedStyle(node)
      return {
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationTimingFunction: style.animationTimingFunction,
        animationPlayState: style.animationPlayState,
      }
    })
    assert.deepEqual(motion, {
      animationName: "oc-spin",
      animationDuration: "0.7s",
      animationTimingFunction: "linear",
      animationPlayState: "running",
    })

    const screenshot = await saveElementScreenshot(
      page,
      '[data-config-panel="agent-models"] .agent-models-loading',
      "agent-models-loading-spinner.png",
    )
    assert.ok(screenshot.endsWith("agent-models-loading-spinner.png"))

    await page.emulateMedia({ reducedMotion: "reduce" })
    const reduced = await page.$eval(".agent-models-loading-spinner", (node: HTMLElement) => {
      const style = getComputedStyle(node)
      return {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
      }
    })
    assert.equal(reduced.reducedMotion, true)
    assert.equal(reduced.animationName, "none")
  } finally {
    releaseAgents?.(send([]))
    await closeBrowserAndServer(browser, server)
  }
})
