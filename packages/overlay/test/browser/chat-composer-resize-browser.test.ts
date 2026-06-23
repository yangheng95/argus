import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const SCRATCH_ROOT = resolve(".scratch")

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

async function saveScreenshot(
  element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> },
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("chat composer resize separator supports keyboard focus and height adjustment", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const promptProfileCatalog = {
    active: "general",
    project_active: "general",
    session_active: null,
    default: "general",
    targets: [],
    profiles: [
      {
        id: "general",
        label: "General",
        description: "Default prompt profile.",
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
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/global/projects/discover") return send([])
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
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) {
      return send({
        model: "opencorvus/gpt-5-nano",
        prompt_profile: { active: "general" },
      })
    }
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task/events") return eventStream()
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") {
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    }
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
    const badResponses: string[] = []
    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    page.on("console", (message: any) => {
      consoleMessages.push(`${message.type}: ${message.text}`)
    })
    page.on("pageerror", (error: any) => {
      pageErrors.push(error.message || String(error))
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                theme: "light",
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
    await page.waitForSelector("#solidChatComposer .chat-resize-handle")
    await page.waitForSelector("#chatTextarea")

    const expectedBounds = await page.evaluate(() => {
      const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"))
      const factor = Number.isFinite(scale) && scale > 0 ? scale : 1
      const clamp = (value: number) => Math.round(value)
      return {
        min: String(clamp(72 * factor)),
        max: String(clamp(260 * factor)),
        step: 16 * factor,
      }
    })

    for (let index = 0; index < 80; index += 1) {
      if (await page.evaluate(() => document.activeElement?.classList.contains("chat-resize-handle"))) break
      await page.keyboard.press("Tab")
    }

    const focused = await page.$eval(".chat-resize-handle", (node: HTMLElement) => {
      const style = getComputedStyle(node)
      return {
        active: document.activeElement === node,
        focusVisible: node.matches(":focus-visible"),
        role: node.getAttribute("role"),
        controls: node.getAttribute("aria-controls"),
        min: node.getAttribute("aria-valuemin"),
        max: node.getAttribute("aria-valuemax"),
        now: node.getAttribute("aria-valuenow"),
        background: style.backgroundColor,
      }
    })
    assert.deepEqual(
      {
        active: focused.active,
        focusVisible: focused.focusVisible,
        role: focused.role,
        controls: focused.controls,
        min: focused.min,
        max: focused.max,
        now: focused.now,
      },
      {
        active: true,
        focusVisible: true,
        role: "separator",
        controls: "chatTextarea",
        min: expectedBounds.min,
        max: expectedBounds.max,
        now: expectedBounds.min,
      },
      JSON.stringify({ focused, badResponses, consoleMessages, pageErrors }, null, 2),
    )
    assert.notEqual(focused.background, "rgba(0, 0, 0, 0)")

    await page.keyboard.press("ArrowUp")
    const expectedArrowUp = String(Math.round(Number(expectedBounds.min) + expectedBounds.step))
    await page.waitForFunction(
      (expected) => document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow") === expected,
      {},
      expectedArrowUp,
    )
    const arrowUp = await page.$eval("#solidChatComposer form", (form: HTMLFormElement) => ({
      styleHeight: form.style.getPropertyValue("--chat-textarea-height"),
      now: document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow"),
      wrapHeight: Math.round(document.querySelector(".chat-textarea-wrap")!.getBoundingClientRect().height),
    }))
    assert.equal(arrowUp.styleHeight, `${expectedArrowUp}px`)
    assert.equal(arrowUp.now, expectedArrowUp)
    assert.ok(arrowUp.wrapHeight >= Number(expectedArrowUp))

    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(
      (expected) => document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow") === expected,
      {},
      expectedBounds.min,
    )
    const arrowDown = await page.$eval("#solidChatComposer form", (form: HTMLFormElement) => ({
      styleHeight: form.style.getPropertyValue("--chat-textarea-height"),
      now: document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow"),
    }))
    assert.equal(arrowDown.styleHeight, `${expectedBounds.min}px`)
    assert.equal(arrowDown.now, expectedBounds.min)

    await page.keyboard.press("End")
    await page.waitForFunction(
      (expected) => document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow") === expected,
      {},
      expectedBounds.max,
    )
    await page.keyboard.press("Home")
    await page.waitForFunction(
      (expected) => document.querySelector(".chat-resize-handle")?.getAttribute("aria-valuenow") === expected,
      {},
      expectedBounds.min,
    )

    const composer = await page.$("#solidChatComposer")
    assert.ok(composer)
    const screenshot = await saveScreenshot(composer, "chat-composer-resize-keyboard.png")
    assert.ok(screenshot.endsWith("chat-composer-resize-keyboard.png"))
  } finally {
    await browser.close()
    server.close()
  }
})
