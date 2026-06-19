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

async function tabToSelector(page: any, selector: string, maxTabs = 24) {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab")
    const active = await page.evaluate((value: string) => document.activeElement?.matches(value) === true, selector)
    if (active) return
  }
  const activeSnapshot = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return {
      tag: active?.tagName ?? "",
      id: active?.id ?? "",
      className: active?.className ?? "",
      dataUi: active?.dataset?.ui ?? "",
      text: active?.textContent?.slice(0, 120) ?? "",
    }
  })
  assert.fail(`failed to tab to ${selector}: ${JSON.stringify(activeSnapshot, null, 2)}`)
}

test("connection badge is a keyboard-focusable Button diagnostics trigger", async () => {
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
      localStorage.setItem("oc_directory", "D:/overlay/workspace/conn-badge")
      localStorage.setItem("oc_directory_mode", "custom")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/conn-badge")
    })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector("#connBadge", { visible: true, timeout: 15_000 })

    const initial = await page.$eval("#connBadge", (node: HTMLButtonElement) => ({
      tagName: node.tagName,
      type: node.type,
      id: node.id,
      className: node.className,
      dataUi: node.dataset.ui,
      variant: node.dataset.variant,
      size: node.dataset.size,
      tone: node.dataset.tone,
      role: node.getAttribute("role"),
      tabIndex: node.tabIndex,
      status: node.dataset.status,
      text: node.textContent?.trim(),
      title: node.getAttribute("title") || "",
      ariaLabel: node.getAttribute("aria-label") || "",
      live: node.getAttribute("aria-live"),
    }))
    assert.deepEqual(initial, {
      tagName: "BUTTON",
      type: "button",
      id: "connBadge",
      className: "oc-button conn-badge",
      dataUi: "connection-badge",
      variant: "ghost",
      size: "sm",
      tone: "neutral",
      role: null,
      tabIndex: 0,
      status: "offline",
      text: "Offline",
      title: "Connection Diagnostics · Offline",
      ariaLabel: "Connection Diagnostics · Offline",
      live: "polite",
    })

    await tabToSelector(page, "#connBadge")
    const focus = await page.$eval("#connBadge", (node: HTMLButtonElement) => {
      const style = getComputedStyle(node)
      return {
        active: document.activeElement === node,
        focusVisible: node.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        background: style.backgroundColor,
      }
    })
    assert.equal(focus.active, true)
    assert.equal(focus.focusVisible, true)
    assert.notEqual(focus.outlineStyle, "none")
    assert.notEqual(focus.outlineWidth, "0px")

    const screenshotPath = resolve(".scratch", "connection-badge-button-focus.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await (await page.$(".titlebar-utility"))!.screenshot({}))

    await page.keyboard.press("Enter")
    await page.waitForSelector("#configDialog", { visible: true, timeout: 15_000 })
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
