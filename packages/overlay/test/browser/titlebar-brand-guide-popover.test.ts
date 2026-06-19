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

async function installOverlaySettings(page: any, serverUrl: string, locale: string) {
  await page.evaluateOnNewDocument(
    (input: { serverUrl: string; locale: string }) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", input.serverUrl)
      localStorage.setItem("oc_locale", input.locale)
      window.__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl: input.serverUrl,
                autoServer: false,
                locale: input.locale,
                directory: "D:/overlay/workspace/app",
              }
            }
            if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
            if (command === "overlay_settings_save") return true
            return null
          },
        },
      }
    },
    { serverUrl, locale },
  )
}

async function verifyBrandGuide(page: any, url: string, viewport: { width: number; height: number }) {
  await page.setViewport(viewport)
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(".brand-guide", { visible: true })
  await page.click(".brand-guide")
  await page.waitForSelector(".brand-guide-card", { visible: true })
  const metrics = await page.evaluate(() => {
    const trigger = document.querySelector(".brand-guide")
    const card = document.querySelector(".brand-guide-card")
    const titlebar = document.querySelector(".titlebar")
    if (!trigger || !card || !titlebar) return { ok: false }
    const cardRect = card.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const titlebarRect = titlebar.getBoundingClientRect()
    const text = card.textContent || ""
    const styles = getComputedStyle(card)
    const hit = document.elementFromPoint(
      triggerRect.left + triggerRect.width / 2,
      triggerRect.top + triggerRect.height / 2,
    )
    return {
      ok: true,
      expanded: trigger.getAttribute("aria-expanded"),
      dataExpanded: trigger.hasAttribute("data-expanded"),
      controls: trigger.getAttribute("aria-controls"),
      cardRole: card.getAttribute("role") || "",
      cardHidden: card.getAttribute("aria-hidden"),
      cardVisible: styles.visibility !== "hidden" && styles.display !== "none" && cardRect.width > 0,
      cardRect: {
        x: Math.round(cardRect.x),
        y: Math.round(cardRect.y),
        w: Math.round(cardRect.width),
        h: Math.round(cardRect.height),
      },
      titlebarRect: {
        y: Math.round(titlebarRect.y),
        h: Math.round(titlebarRect.height),
        bottom: Math.round(titlebarRect.bottom),
      },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      belowTitlebar: Math.round(cardRect.top) >= Math.round(titlebarRect.bottom),
      withinViewport: cardRect.left >= 0 && cardRect.right <= window.innerWidth && cardRect.bottom <= window.innerHeight,
      mentionsTools: /\btools\b/i.test(text) || /工具/.test(text),
      hitMenu: hit?.getAttribute?.("data-menu-trigger") || "",
      localeTextPresent: text.includes("Quick Guide") || text.includes("快速指南"),
    }
  })
  assert.equal(metrics.ok, true)
  assert.equal(metrics.expanded, "true")
  assert.equal(metrics.dataExpanded, true)
  assert.ok(metrics.controls)
  assert.equal(metrics.cardRole, "dialog")
  assert.equal(metrics.cardHidden, null)
  const metricContext = JSON.stringify(metrics)
  assert.equal(metrics.cardVisible, true, metricContext)
  assert.equal(metrics.belowTitlebar, true, metricContext)
  assert.equal(metrics.withinViewport, true, metricContext)
  assert.equal(metrics.mentionsTools, false, metricContext)
  assert.equal(metrics.hitMenu, "", metricContext)
  assert.equal(metrics.localeTextPresent, true, metricContext)

  const screenshotPath = resolve(`.scratch/titlebar-brand-guide-popover-${viewport.width}.png`)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  writeFileSync(screenshotPath, await page.screenshot({ fullPage: false }))

  await page.keyboard.press("Escape")
  await page.waitForFunction(() => {
    const trigger = document.querySelector(".brand-guide")
    const card = document.querySelector(".brand-guide-card")
    if (trigger?.getAttribute("aria-expanded") !== "false") return false
    if (!card) return true
    const rect = card.getBoundingClientRect()
    const styles = getComputedStyle(card)
    return styles.display === "none" || styles.visibility === "hidden" || rect.width === 0 || rect.height === 0
  })
  assert.equal(await page.$eval(".brand-guide", (node: Element) => node.getAttribute("aria-expanded")), "false")
  assert.equal(await page.$eval(".brand-guide", (node: Element) => node.hasAttribute("data-expanded")), false)
}

test("titlebar brand guide popover stays accessible and clears compact titlebar", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/session" || path === "/mission" || path === "/project/current/worktrees") return send([])
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
    if (path === "/config/prompt-profile") return send({ active: "general", targets: [], profiles: [] })
    if (path === "/config") return send({ model: "" })
    if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    if (path === "/log/tail") return send({ lines: [] })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const desktop = await browser.newPage()
    await installOverlaySettings(desktop, server.origin, "en-US")
    await verifyBrandGuide(desktop, `${server.origin}/ui/index.html`, { width: 1280, height: 720 })
    await desktop.close()

    const mobile = await browser.newPage()
    await installOverlaySettings(mobile, server.origin, "zh-CN")
    await verifyBrandGuide(mobile, `${server.origin}/ui/index.html`, { width: 390, height: 720 })
    await mobile.close()
  } finally {
    await browser.close()
    await server.close()
  }
})
