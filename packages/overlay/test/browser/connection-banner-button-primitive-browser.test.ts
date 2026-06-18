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

test("connection banner actions use the shared Button primitive", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 960, height: 720 })
    await page.evaluateOnNewDocument(() => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_server_url", "http://127.0.0.1:9")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/conn-banner")
      localStorage.setItem("oc_directory_mode", "custom")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/conn-banner")
    })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector(".conn-banner", { visible: true, timeout: 15_000 })

    const state = await page.$eval(".conn-banner", (node) => {
      const banner = node as HTMLElement
      const setup = banner.querySelector<HTMLButtonElement>('[data-ui="connection-banner-setup"]')
      const reload = banner.querySelector<HTMLButtonElement>('[data-ui="connection-banner-reload"]')
      return {
        role: banner.getAttribute("role"),
        live: banner.getAttribute("aria-live"),
        oldActionCount: banner.querySelectorAll(".conn-banner__action").length,
        setupTag: setup?.tagName ?? "",
        reloadTag: reload?.tagName ?? "",
        setupClass: setup?.className ?? "",
        reloadClass: reload?.className ?? "",
        setupVariant: setup?.dataset.variant ?? "",
        reloadVariant: reload?.dataset.variant ?? "",
        setupSize: setup?.dataset.size ?? "",
        reloadSize: reload?.dataset.size ?? "",
        setupTone: setup?.dataset.tone ?? "",
        reloadTone: reload?.dataset.tone ?? "",
        setupTestID: setup?.dataset.testid ?? "",
      }
    })
    assert.deepEqual(state, {
      role: "status",
      live: "polite",
      oldActionCount: 0,
      setupTag: "BUTTON",
      reloadTag: "BUTTON",
      setupClass: "oc-button",
      reloadClass: "oc-button",
      setupVariant: "ghost",
      reloadVariant: "ghost",
      setupSize: "sm",
      reloadSize: "sm",
      setupTone: "neutral",
      reloadTone: "neutral",
      setupTestID: "connection-banner-setup",
    })

    const focusStart = await page.evaluate(() => {
      const setup = document.querySelector<HTMLButtonElement>('[data-ui="connection-banner-setup"]')
      setup?.focus()
      const active = document.activeElement as HTMLElement | null
      const rect = setup?.getBoundingClientRect()
      return {
        activeDataUi: active?.dataset.ui ?? "",
        activeTag: active?.tagName ?? "",
        activeID: active?.id ?? "",
        activeClass: active?.className ?? "",
        setupDisabled: setup?.disabled ?? null,
        setupTabIndex: setup?.tabIndex ?? null,
        setupInert: setup?.closest("[inert]") !== null,
        setupPointerEvents: setup ? getComputedStyle(setup).pointerEvents : "",
        setupDisplay: setup ? getComputedStyle(setup).display : "",
        setupVisibility: setup ? getComputedStyle(setup).visibility : "",
        setupRect: rect ? { width: rect.width, height: rect.height } : null,
        documentHasFocus: document.hasFocus(),
      }
    })
    assert.equal(focusStart.activeDataUi, "connection-banner-setup", JSON.stringify(focusStart, null, 2))
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ui ?? ""), "connection-banner-reload")

    const screenshotPath = resolve(".scratch", "connection-banner-button-primitive.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await (await page.$(".conn-banner"))!.screenshot({}))

    await page.click('[data-ui="connection-banner-setup"]')
    await page.waitForFunction(() => document.querySelector("#configDialog") !== null)
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
