import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
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

const promptProfileCatalog = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "General implementation profile.",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

test("command palette uses the shared Dialog primitive while preserving hotkey focus flow", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  const errors: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover") {
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    }
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/task/events") return eventStream()
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/provider/hexin/budget") return send({ ok: true })
    if (path === "/config/providers") return send({ providers: [] })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/config") return send({ model: "" })
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
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  })

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`)
    })
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
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
    }, server.port)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-menu-trigger="help"]')
    await page.focus('[data-menu-trigger="help"]')

    await page.keyboard.down("Control")
    await page.keyboard.press("k")
    await page.keyboard.up("Control")
    await page.waitForSelector(".cmdk-panel")

    const openState = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".cmdk-dialog")
      const panel = document.querySelector<HTMLElement>(".cmdk-panel")
      const header = document.querySelector<HTMLElement>(".cmdk-header")
      const panelRect = panel?.getBoundingClientRect()
      return {
        role: dialog?.getAttribute("role"),
        ariaModal: dialog?.getAttribute("aria-modal"),
        activeClass: (document.activeElement as HTMLElement | null)?.className || "",
        dialogClass: dialog?.className || "",
        panelClass: panel?.className || "",
        headerWidth: header?.getBoundingClientRect().width ?? 0,
        panelTop: panelRect?.top ?? 0,
        panelWidth: panelRect?.width ?? 0,
        viewportWidth: window.innerWidth,
      }
    })
    assert.equal(openState.role, "dialog")
    assert.equal(openState.ariaModal, "true")
    assert.match(String(openState.activeClass), /cmdk-input/)
    assert.match(String(openState.dialogClass), /dialog/)
    assert.match(String(openState.dialogClass), /cmdk-dialog/)
    assert.match(String(openState.panelClass), /dialog-form/)
    assert.match(String(openState.panelClass), /cmdk-panel/)
    assert.ok(openState.headerWidth <= 1, `expected command palette title header to be visually hidden: ${JSON.stringify(openState)}`)
    assert.ok(openState.panelTop > 48 && openState.panelTop < 160, `unexpected command palette top offset: ${JSON.stringify(openState)}`)
    assert.ok(
      openState.viewportWidth - openState.panelWidth >= 64,
      `expected command palette side breathing room: ${JSON.stringify(openState)}`,
    )
    const visibleErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.app-notification[data-tone="error"], .app-notification[data-tone="warning"]')).map(
        (item) => item.textContent?.replace(/\s+/g, " ").trim() || "",
      ),
    )
    assert.deepEqual(visibleErrors, [])

    const screenshotPath = resolve(".scratch/command-palette-dialog-primitive.png")
    mkdirSync(resolve(".scratch"), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)

    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector(".cmdk-panel"))
    const restored = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.menuTrigger || "",
    )
    assert.equal(restored, "help")
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
