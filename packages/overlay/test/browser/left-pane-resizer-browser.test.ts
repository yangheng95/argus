import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
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

const PROMPT_PROFILE_CATALOG = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

async function leftPaneState(page: OverlayPage) {
  return await page.$eval("#leftPaneResizer", (node) => {
    const separator = node as HTMLElement
    const sidebar = document.querySelector<HTMLElement>("#sidebar")!
    const chat = document.querySelector<HTMLElement>("#chatSection")!
    const style = getComputedStyle(separator)
    const min = separator.getAttribute("aria-valuemin")
    const max = separator.getAttribute("aria-valuemax")
    const now = separator.getAttribute("aria-valuenow")
    return {
      hidden: separator.hidden,
      display: style.display,
      disabled: separator.dataset.disabled ?? "",
      role: separator.getAttribute("role"),
      orientation: separator.getAttribute("aria-orientation"),
      controls: separator.getAttribute("aria-controls"),
      tabIndex: separator.tabIndex,
      min,
      max,
      now,
      minValue: min === null ? null : Number(min),
      maxValue: max === null ? null : Number(max),
      nowValue: now === null ? null : Number(now),
      focused: document.activeElement === separator,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      chatWidth: Math.round(chat.getBoundingClientRect().width),
    }
  })
}

type LeftPaneState = Awaited<ReturnType<typeof leftPaneState>>

async function waitForLeftPaneState(
  page: OverlayPage,
  label: string,
  predicate: (state: LeftPaneState) => boolean,
): Promise<LeftPaneState> {
  let previousSignature = ""
  let lastActivity = Date.now()
  for (;;) {
    const state = await leftPaneState(page)
    if (predicate(state)) return state
    const signature = JSON.stringify(state)
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No left pane state activity while waiting for ${label}: ${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test(
  "left pane separator exposes keyboard resizing and live ARIA values",
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
      if (path === "/global/projects/discover") return send([])
      if (path === "/mission") return send([])
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
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
      if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
      if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/task/events") {
        return new Response(":\n\n", {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }
      if (path === "/agent") return send([])
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
      await page.setViewport({ width: 1280, height: 760 })
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
      await page.waitForSelector("#leftPaneResizer", { visible: true })

      const initial = await leftPaneState(page)
      assert.equal(initial.hidden, false)
      assert.equal(initial.display, "block")
      assert.equal(initial.disabled, "false")
      assert.equal(initial.role, "separator")
      assert.equal(initial.orientation, "vertical")
      assert.equal(initial.controls, "sidebar workspaceMain")
      assert.equal(initial.tabIndex, 0)
      assert.ok(initial.minValue! < initial.maxValue!)
      assert.ok(initial.nowValue! >= initial.minValue!)
      assert.ok(initial.nowValue! <= initial.maxValue!)

      await page.focus("#leftPaneResizer")
      await page.keyboard.press("ArrowRight")
      const expanded = await waitForLeftPaneState(
        page,
        "ArrowRight to increase sidebar width",
        (state) => state.sidebarWidth > initial.sidebarWidth + 10,
      )
      assert.equal(expanded.focused, true)
      assert.ok(expanded.sidebarWidth > initial.sidebarWidth)
      assert.ok(expanded.nowValue! > initial.nowValue!)

      await page.keyboard.press("ArrowLeft")
      await waitForLeftPaneState(
        page,
        "ArrowLeft to decrease sidebar width",
        (state) => state.sidebarWidth < expanded.sidebarWidth - 10,
      )

      await page.keyboard.press("Home")
      const atMin = await waitForLeftPaneState(
        page,
        "Home to move sidebar width to minimum",
        (state) => state.nowValue === state.minValue,
      )
      assert.equal(atMin.sidebarWidth, atMin.minValue)

      await page.keyboard.press("End")
      const atMax = await waitForLeftPaneState(
        page,
        "End to move sidebar width to maximum",
        (state) => state.nowValue === state.maxValue,
      )
      assert.equal(atMax.sidebarWidth, atMax.maxValue)

      await mkdir(resolve(".scratch"), { recursive: true })
      await writeFile(
        resolve(".scratch", "left-pane-resizer-accessibility.png"),
        await page.screenshot({ fullPage: true }),
      )

      await page.setViewport({ width: 700, height: 760 })
      const compact = await waitForLeftPaneState(
        page,
        "compact layout to hide and untab left pane separator",
        (state) => state.display === "none" && state.tabIndex === -1 && state.now === null,
      )
      assert.equal(compact.display, "none")
      assert.equal(compact.disabled, "true")
      assert.equal(compact.tabIndex, -1)
      assert.equal(compact.min, null)
      assert.equal(compact.max, null)
      assert.equal(compact.now, null)

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
