import assert from "node:assert/strict"
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

async function separatorState(page: OverlayPage) {
  return await page.$eval("#centerWorkbenchSeparatorWorkflow", (node) => {
    const separator = node as HTMLElement
    const workflow = document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!
    const inspector = document.querySelector<HTMLElement>("#centerWorkbenchInspector")!
    const min = separator.getAttribute("aria-valuemin")
    const max = separator.getAttribute("aria-valuemax")
    const now = separator.getAttribute("aria-valuenow")
    return {
      hidden: separator.hidden,
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
      workflowWidth: Math.round(workflow.getBoundingClientRect().width),
      inspectorWidth: Math.round(inspector.getBoundingClientRect().width),
    }
  })
}

test(
  "center workbench panel separator owns pointer and keyboard resizing",
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
      if (path === "/mission") return send([])
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
      if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
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
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: location.origin,
                  autoServer: false,
                  locale: "en-US",
                  theme: "dark",
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
      })
      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]', {
        visible: true,
      })
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })

      const initial = await separatorState(page)
      assert.equal(initial.hidden, false)
      assert.equal(initial.disabled, "false")
      assert.equal(initial.role, "separator")
      assert.equal(initial.orientation, "vertical")
      assert.equal(initial.controls, "centerWorkbenchWorkflow centerWorkbenchInspector")
      assert.equal(initial.tabIndex, 0)
      assert.ok(initial.minValue! < initial.maxValue!)
      assert.ok(initial.nowValue! >= initial.minValue!)
      assert.ok(initial.nowValue! <= initial.maxValue!)
      assert.ok(Math.abs(initial.workflowWidth - initial.inspectorWidth) <= 2)

      const separatorPoint = await page.$eval("#centerWorkbenchSeparatorWorkflow", (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(separatorPoint.x, separatorPoint.y)
      await page.mouse.down()
      await page.mouse.move(separatorPoint.x + 120, separatorPoint.y, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(
        (previous) =>
          document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!.getBoundingClientRect().width >
          previous + 70,
        {},
        initial.workflowWidth,
      )
      const pointerResized = await separatorState(page)
      assert.ok(pointerResized.workflowWidth - pointerResized.inspectorWidth > 80)

      await page.focus("#centerWorkbenchSeparatorWorkflow")
      await page.keyboard.press("ArrowLeft")
      await page.waitForFunction(
        (previous) =>
          document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!.getBoundingClientRect().width <
          previous - 10,
        {},
        pointerResized.workflowWidth,
      )
      const keyboardResized = await separatorState(page)
      assert.equal(keyboardResized.focused, true)
      assert.ok(keyboardResized.workflowWidth < pointerResized.workflowWidth)

      await page.keyboard.press("Home")
      await page.waitForFunction(() => {
        const separator = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")!
        return Number(separator.getAttribute("aria-valuenow")) === Number(separator.getAttribute("aria-valuemin"))
      })
      await page.keyboard.press("End")
      await page.waitForFunction(() => {
        const separator = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")!
        return Number(separator.getAttribute("aria-valuenow")) === Number(separator.getAttribute("aria-valuemax"))
      })

      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")?.hidden)
      const hidden = await separatorState(page)
      assert.equal(hidden.hidden, true)
      assert.equal(hidden.disabled, "true")
      assert.equal(hidden.tabIndex, -1)
      assert.equal(hidden.min, null)
      assert.equal(hidden.max, null)
      assert.equal(hidden.now, null)

      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      await page.setViewport({ width: 500, height: 720 })
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")?.hidden)
      const compact = await separatorState(page)
      assert.equal(compact.hidden, true)
      assert.equal(compact.disabled, "true")
      assert.equal(compact.tabIndex, -1)

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
