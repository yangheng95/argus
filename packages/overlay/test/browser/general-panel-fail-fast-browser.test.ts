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

async function savePanelScreenshot(page: any, filename: string) {
  const root = fileURLToPath(new URL("../../../../.scratch/", import.meta.url))
  const target = `${root}${filename}`
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(".general-panel")
  assert.ok(element, "general panel should exist before screenshot")
  const image = await element.screenshot({})
  await writeFile(target, image)
  return target
}

async function readGeneralHeaderState(page: any) {
  return page.$$eval(
    ".general-panel .oc-surface-header[data-surface='settings-group'] .oc-surface-header__title",
    (nodes: HTMLElement[]) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        return {
          text: node.textContent?.trim() || "",
          textTransform: style.textTransform,
          letterSpacing: style.letterSpacing,
          fontWeight: style.fontWeight,
        }
      }),
  )
}

test("General Settings write failures stay visible and do not report saved state", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const configPatches: unknown[] = []
  const dbResetRequests: unknown[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [] })
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs") {
      return send({
        branch: "fail-fast",
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
      return send({ active: "general", project_active: "general", session_active: null, default: "general", targets: [], profiles: [] })
    }
    if (path === "/config" && req.method === "GET") {
      return send({
        model: "opencorvus/gpt-5-nano",
        assistant: { debug: { fail_on_information_missing: false } },
      })
    }
    if (path === "/config" && req.method === "PATCH") {
      configPatches.push(await req.json())
      return send({ error: "config write denied" }, { status: 503 })
    }
    if (path === "/global/db/reset" && req.method === "POST") {
      dbResetRequests.push(await req.json())
      return send({
        ok: true,
        targets: [{ label: "db", path: "D:/overlay/global/opencorvus.db", ok: true }],
      })
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
    await page.setViewport({ width: 960, height: 900 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      ;(window as any).__settingsSaveShouldFail = true
      ;(window as any).__dbResetConfirmMessage = ""
      window.confirm = (message: string) => {
        ;(window as any).__dbResetConfirmMessage = message
        return true
      }
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
              if ((window as any).__settingsSaveShouldFail) throw new Error("settings persistence denied")
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
    await page.waitForSelector('[data-testid="titlebar-settings-general"]', { visible: true })
    await page.click('[data-testid="titlebar-settings-general"]')
    await page.waitForSelector(".general-panel")
    await page.$eval(".general-panel", (node: HTMLElement) => {
      node.scrollTop = 0
    })
    assert.deepEqual(await readGeneralHeaderState(page), [
      { text: "Connection", textTransform: "none", letterSpacing: "normal", fontWeight: "550" },
      { text: "Database", textTransform: "none", letterSpacing: "normal", fontWeight: "550" },
      { text: "Behaviour", textTransform: "none", letterSpacing: "normal", fontWeight: "550" },
    ])
    const headerScreenshot = await savePanelScreenshot(page, "general-settings-surface-headers.png")
    assert.ok(headerScreenshot.endsWith("general-settings-surface-headers.png"))

    const dbResetButton = '[data-ui="settings-db-reset"]'
    await page.waitForSelector(dbResetButton, { visible: true })
    await page.click(dbResetButton)
    await page.waitForFunction(() =>
      document.querySelector(".general-panel .config-status-box")?.textContent?.includes("Database reset completed"),
    )
    assert.deepEqual(dbResetRequests, [{ projectDir: "D:/overlay/workspace/app" }])
    assert.match(
      await page.evaluate(() => (window as any).__dbResetConfirmMessage),
      /Reset the OpenCorvus database for D:\/overlay\/workspace\/app/,
    )

    const saveButton = "#configDialog .general-panel .dialog-actions .oc-button"
    await page.waitForSelector(saveButton, { visible: true })
    await page.click(saveButton)
    await page.waitForFunction(() =>
      document.querySelector(".general-panel .config-status-box")?.textContent?.includes("settings persistence denied"),
    )
    assert.equal(
      await page.$eval(saveButton, (node: HTMLElement) => node.textContent?.trim()),
      "Save",
      "failed settings save must not report Saved",
    )
    configPatches.length = 0

    await page.evaluate(() => {
      ;(window as any).__settingsSaveShouldFail = false
    })

    const debugToggle = ".general-panel .config-toggle-list-item:nth-of-type(2) input[type='checkbox']"
    await page.waitForSelector(debugToggle, { visible: true })
    assert.equal(await page.$eval(debugToggle, (node: HTMLInputElement) => node.checked), false)
    await page.click(debugToggle)
    await page.waitForFunction(() =>
      document.querySelector(".general-panel .config-status-box")?.textContent?.includes("config write denied"),
    )
    assert.equal(await page.$eval(debugToggle, (node: HTMLInputElement) => node.checked), false)
    assert.deepEqual(configPatches, [{ assistant: { debug: { fail_on_information_missing: true } } }])

    const screenshot = await savePanelScreenshot(page, "general-settings-fail-fast.png")
    assert.ok(screenshot.endsWith("general-settings-fail-fast.png"))
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
