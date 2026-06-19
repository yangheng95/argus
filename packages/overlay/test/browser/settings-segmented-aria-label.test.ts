import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

test("settings segmented controls expose per-row accessible names", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  const errors: string[] = []
  let config: Record<string, unknown> = {
    model: "",
    tool_permissions: { websearch: "allow" },
  }
  const configPatches: Record<string, unknown>[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/")
      return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover") {
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    }
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/task/events") return eventStream()
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
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      configPatches.push(body)
      config = {
        ...config,
        ...body,
        tool_permissions: {
          ...((config.tool_permissions as Record<string, unknown> | undefined) || {}),
          ...((body.tool_permissions as Record<string, unknown> | undefined) || {}),
        },
      }
      return send(config)
    }
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile")
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/executor") return send([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
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
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
    page.on("requestfailed", (request) => {
      if (/\/task\/events(?:\?.*)?$/.test(request.url())) return
      errors.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() === 404) errors.push(`response404: ${response.url()}`)
    })
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
    })
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
    await page.waitForSelector('[data-menu-trigger="settings"]')
    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-permissions"]')
    await page.click('[data-testid="titlebar-settings-permissions"]')
    await page.waitForSelector('[data-config-panel="permissions"] .s-segmented')

    const selectedTabState = await page.$eval('[data-config-tab="permissions"]', (node: HTMLElement) => {
      const controls = node.getAttribute("aria-controls") ?? ""
      const panel = controls ? document.getElementById(controls) : null
      const panelBox = panel?.getBoundingClientRect()
      const tablist = node.closest<HTMLElement>('[role="tablist"]')
      return {
        role: node.getAttribute("role") ?? "",
        selected: node.getAttribute("aria-selected") ?? "",
        controls,
        tabID: node.id,
        tablistRole: tablist?.getAttribute("role") ?? "",
        tablistOrientation: tablist?.getAttribute("aria-orientation") ?? "",
        panelRole: panel?.getAttribute("role") ?? "",
        labelledby: panel?.getAttribute("aria-labelledby") ?? "",
        panelVisible: Boolean(panelBox && panelBox.width > 0 && panelBox.height > 0),
      }
    })
    assert.equal(selectedTabState.role, "tab")
    assert.equal(selectedTabState.selected, "true")
    assert.equal(selectedTabState.tablistRole, "tablist")
    assert.equal(selectedTabState.tablistOrientation, "vertical")
    assert.ok(selectedTabState.controls)
    assert.equal(selectedTabState.panelRole, "tabpanel")
    assert.equal(selectedTabState.labelledby, selectedTabState.tabID)
    assert.equal(selectedTabState.panelVisible, true)

    await page.focus('[data-config-tab="permissions"]')
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-config-tab") === "prompt")
    await page.keyboard.press("Enter")
    await page.waitForSelector('[data-config-panel="prompt"] #promptBody')
    await page.keyboard.press("End")
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-config-tab") === "about")
    const focusedAboutTab = await page.$eval('[data-config-tab="about"]', (node: HTMLElement) => {
      const style = getComputedStyle(node)
      return {
        focused: document.activeElement === node,
        focusVisible: node.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
      }
    })
    assert.equal(focusedAboutTab.focused, true)
    assert.equal(focusedAboutTab.focusVisible, true)
    assert.notEqual(focusedAboutTab.outlineStyle, "none")
    assert.notEqual(focusedAboutTab.outlineWidth, "0px")
    const tabFocusScreenshot = await saveElementScreenshot(page, "#configDialog .dialog-form", "settings-tabs-focus-visible.png")
    assert.ok(tabFocusScreenshot.endsWith("settings-tabs-focus-visible.png"))
    await page.keyboard.press("Enter")
    await page.waitForSelector('[data-config-panel="about"] #aboutBody')
    await page.waitForFunction(() => !!document.querySelector('[data-config-tab="about"]')?.getAttribute("aria-controls"))
    const aboutTabState = await page.$eval('[data-config-tab="about"]', (node: HTMLElement) => ({
      selected: node.getAttribute("aria-selected") ?? "",
      controls: node.getAttribute("aria-controls") ?? "",
    }))
    assert.equal(aboutTabState.selected, "true")
    assert.ok(aboutTabState.controls)
    const aboutScreenshot = await saveElementScreenshot(page, "#configDialog .dialog-form", "settings-tabs-about-panel.png")
    assert.ok(aboutScreenshot.endsWith("settings-tabs-about-panel.png"))

    await page.click('[data-config-tab="permissions"]')
    await page.waitForSelector('[data-config-panel="permissions"] .s-segmented')

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-config-panel="permissions"] .s-row'))
        .map((row) => ({
          title: row.querySelector<HTMLElement>(".s-row-title")?.textContent?.trim() || "",
          segmentedLabel: row.querySelector<HTMLElement>(".s-segmented")?.getAttribute("aria-label") || "",
        }))
        .filter((row) => row.segmentedLabel),
    )
    assert.equal(rows.length, 6)
    for (const row of rows) {
      assert.ok(row.title, `missing visible row title for ${JSON.stringify(row)}`)
      assert.equal(row.segmentedLabel, row.title)
    }

    mkdirSync(resolve(".scratch"), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(resolve(".scratch/settings-segmented-aria-label.png"), screenshot)

    await page.click('[data-config-panel="permissions"] .s-segmented-btn[data-value="ask"]')
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-config-panel="permissions"]') as HTMLElement | null
      const ask = panel?.querySelector('.s-segmented-btn[data-value="ask"]') as HTMLElement | null
      return ask?.hasAttribute("data-pressed") && ask.getAttribute("aria-pressed") === "true"
    })
    assert.deepEqual(configPatches.at(-1), { tool_permissions: { websearch: "ask" } })
    assert.deepEqual(errors, [])
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
