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

test(
  "channel settings extension header field label is owned by settings surface",
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
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") return send({ active: "general", targets: [], profiles: [] })
      if (path === "/config") return send({ model: "", server: { publicUrl: "" } })
      if (path === "/agent") return send([])
      if (path === "/channel")
        return send([
          {
            id: "slack",
            name: "Slack",
            summary: "Post task updates to a Slack channel.",
            status: "missing",
            fields: [
              {
                key: "webhook_url",
                label: "Webhook URL",
                type: "text",
                placeholder: "https://hooks.slack.com/services/...",
              },
            ],
          },
        ])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
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
      await page.setViewport({ width: 1280, height: 820 })
      await page.evaluateOnNewDocument((serverUrl) => {
        localStorage.setItem("oc_locale", "en-US")
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
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
      await page.waitForSelector('[data-testid="titlebar-settings-channel"]', { visible: true })
      await page.click('[data-testid="titlebar-settings-channel"]')
      await page.waitForSelector('[data-config-panel="channel"] .extension-head .field-label')

      const metrics = await page.$eval('[data-config-panel="channel"] .extension-head .field-label', (node) => {
        const label = node as HTMLElement
        const style = getComputedStyle(label)
        const rect = label.getBoundingClientRect()
        return {
          text: label.textContent?.trim() ?? "",
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform,
          width: rect.width,
          height: rect.height,
        }
      })

      assert.equal(metrics.text, "Public Base URL")
      assert.equal(metrics.fontSize, "13px")
      assert.equal(metrics.textTransform, "none")
      assert.ok(Number(metrics.fontWeight) >= 600 || metrics.fontWeight === "bold")
      assert.ok(metrics.width > 40)
      assert.ok(metrics.height > 10)

      const head = await page.$('[data-config-panel="channel"] .extension-head')
      assert.ok(head)
      const screenshotPath = resolve(".scratch", "settings-channel-extension-head.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await head.screenshot({}))

      await page.waitForSelector('[data-config-panel="channel"] .channel-settings-row')
      const channelListMetrics = await page.$eval('[data-config-panel="channel"] #channelList', (node) => {
        const list = node as HTMLElement
        const rect = list.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          rowCount: list.querySelectorAll(".channel-settings-row").length,
        }
      })
      assert.equal(channelListMetrics.rowCount, 1)
      assert.ok(channelListMetrics.width > 120)
      assert.ok(channelListMetrics.height > 20)

      await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-config-panel="channel"] .channel-settings-row button'),
        )
        const editButton = buttons.find((button) => button.textContent?.trim() === "Edit")
        if (!editButton) throw new Error("Missing channel edit button")
        editButton.click()
      })
      await page.waitForSelector(".channel-doc-card")

      const cardMetrics = await page.$eval(".channel-doc-card", (node) => {
        const card = node as HTMLElement
        const style = getComputedStyle(card)
        const rect = card.getBoundingClientRect()
        const retiredDetailClasses = Array.from(document.querySelectorAll<HTMLElement>('[class*="detail-"]')).flatMap(
          (element) =>
            Array.from(element.classList).filter((className) =>
              /^(?:detail-stack|detail-card|detail-pre|detail-pre-json|detail-grid-row)$/.test(className),
            ),
        )
        return {
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          text: card.textContent?.trim() ?? "",
          width: rect.width,
          height: rect.height,
          retiredDetailClasses,
        }
      })
      assert.equal(cardMetrics.backgroundColor, "rgba(0, 0, 0, 0)")
      assert.equal(cardMetrics.borderTopWidth, "0px")
      assert.match(cardMetrics.text, /OpenClaw Docs/)
      assert.equal(cardMetrics.retiredDetailClasses.length, 0)
      assert.ok(cardMetrics.width > 120)
      assert.ok(cardMetrics.height > 20)

      const card = await page.$(".channel-doc-card")
      assert.ok(card)
      const cardScreenshotPath = resolve(".scratch", "channel-doc-card-retired-detail.png")
      writeFileSync(cardScreenshotPath, await card.screenshot({}))

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
