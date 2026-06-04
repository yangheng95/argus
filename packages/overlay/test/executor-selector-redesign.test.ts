// Playwright-driven behavioral test for the dual-chip executor bar.
//
//   - Two chips (OpenCorvus + external) render side-by-side under the
//     composer.
//   - Clicking OpenCorvus opens its popover; only connected providers'
//     models appear.
//   - Clicking External opens its popover; all configured providers for
//     the active executor appear, but provider auth is not presented as
//     executor connectivity.
//   - Opening one popover closes the other.

import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

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

test("dual executor chip — mirror vs external popovers with availability", async () => {
  const projectModel = "openai/gpt-5.5-pro"
  const codexModel = "openai/gpt-5.5-codex"

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") {
        // openai is connected; anthropic is configured but NOT connected.
        // OpenCorvus should hide anthropic, while the external Claude Code
        // tab still lists anthropic models without mislabeling Claude Code
        // itself as disconnected.
        return send({
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.5-pro": { id: "gpt-5.5-pro" },
                "gpt-5.5-codex": { id: "gpt-5.5-codex" },
              },
            },
            {
              id: "anthropic",
              name: "Anthropic",
              models: {
                "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-5.5-pro" },
        })
      }
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") {
        return send({ providers: [], default: {} })
      }
      if (path === "/config" && req.method === "GET") {
        return send({ model: projectModel })
      }
      if (path === "/config" && req.method === "PATCH") {
        return send(await req.json())
      }
      if (path === "/config/prompt") return send([])
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") {
        return send([
          { id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true },
          { id: "codex", label: "Codex", selectable: true, discovered: true, model: codexModel },
          { id: "claude-code", label: "Claude Code", selectable: true, discovered: true },
        ])
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path.startsWith("/executor/") && path.endsWith("/model")) return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 960, height: 720 })
    await page.evaluateOnNewDocument((serverUrl) => {
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
                executor: "codex",
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
    }, `http://127.0.0.1:${server.port}`)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="executor-chip-mirror"]')
    await page.waitForSelector('[data-ui="executor-chip-external"]')
    await page.waitForFunction(() =>
      (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes("gpt-5.5-pro"),
    )

    // Both chips share one bar that spans the composer row.
    const layout = await page.evaluate(() => {
      const bar = document.querySelector('[data-ui="executor-dualbar"]') as HTMLElement | null
      const mirror = document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null
      const external = document.querySelector('[data-ui="executor-chip-external"]') as HTMLElement | null
      return {
        barWidth: bar ? bar.getBoundingClientRect().width : 0,
        mirrorLeft: mirror ? mirror.getBoundingClientRect().left : 0,
        mirrorRight: mirror ? mirror.getBoundingClientRect().right : 0,
        externalLeft: external ? external.getBoundingClientRect().left : 0,
        mirrorText: mirror?.innerText ?? "",
        externalText: external?.innerText ?? "",
      }
    })
    expect(layout.barWidth).toBeGreaterThan(400)
    expect(layout.externalLeft).toBeGreaterThan(layout.mirrorRight - 1)
    expect(layout.mirrorText).toContain("OpenCorvus")
    expect(layout.mirrorText).toContain("gpt-5.5-pro")
    expect(layout.externalText).toContain("Codex")
    expect(layout.externalText).toContain("gpt-5.5-codex")

    // Mirror popover: opens above the left chip and lists only connected
    // providers (openai). Anthropic stays hidden because it isn't connected.
    // innerText reflects text-transform; provider group headers are uppercased
    // for the picker, so we match case-insensitively.
    await page.click('[data-ui="executor-chip-mirror"]')
    await page.waitForSelector('[data-section="mirror"]')
    const mirrorBody = (
      await page.$eval('[data-section="mirror"]', (node) => (node as HTMLElement).innerText)
    ).toLowerCase()
    expect(mirrorBody).toContain("openai")
    expect(mirrorBody).not.toContain("anthropic")
    expect(mirrorBody).toContain("gpt-5.5-pro")
    expect(mirrorBody).toContain("gpt-5.5-codex")
    // The external popover should NOT be open while the mirror popover is.
    expect(await page.$('[data-section="external"]')).toBeNull()

    // Clicking the external chip closes the mirror popover and opens its own.
    // Dispatch via .click() directly because startup notifications can hover
    // over the bottom-right of the composer at low viewports and intercept a
    // pixel-based Playwright click.
    await page.evaluate(() =>
      (document.querySelector('[data-ui="executor-chip-external"]') as HTMLButtonElement).click(),
    )
    await page.waitForSelector('[data-section="external"]')
    expect(await page.$('[data-section="mirror"]')).toBeNull()

    // External popover defaults to the active executor (codex).
    const externalBody = (
      await page.$eval('[data-section="external"]', (node) => (node as HTMLElement).innerText)
    ).toLowerCase()
    expect(externalBody).toContain("openai")
    expect(externalBody).toContain("gpt-5.5-codex")

    // Switching the focused tab to Claude Code should list anthropic models
    // without inheriting overlay provider-auth wording.
    const claudeTab = await page.$$eval(
      '[data-section="external"] .executor-popover-tab',
      (nodes) =>
        nodes
          .map((node, index) => ({ index, text: (node as HTMLElement).innerText.trim() }))
          .find((row) => row.text === "Claude Code")?.index ?? -1,
    )
    expect(claudeTab).toBeGreaterThanOrEqual(0)
    const tabHandles = await page.$$('[data-section="external"] .executor-popover-tab')
    await tabHandles[claudeTab]!.click()
    await page.waitForFunction(() => {
      const body = document.querySelector('[data-section="external"]') as HTMLElement | null
      return (body?.innerText.toLowerCase().includes("anthropic")) ?? false
    })
    const claudeBody = (
      await page.$eval('[data-section="external"]', (node) => (node as HTMLElement).innerText)
    ).toLowerCase()
    expect(claudeBody).toContain("anthropic")
    expect(claudeBody).toContain("claude-sonnet-4-6")
    expect(claudeBody).not.toContain("not connected")
    const placement = await page.evaluate(() => {
      const slot = document.querySelector('[data-side="external"]') as HTMLElement | null
      const popover = document.querySelector('[data-section="external"]') as HTMLElement | null
      if (!slot || !popover) return null
      const slotRect = slot.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      return {
        slotLeft: slotRect.left,
        popoverLeft: popoverRect.left,
      }
    })
    expect(placement).not.toBeNull()
    expect(Math.abs((placement as any).popoverLeft - (placement as any).slotLeft)).toBeLessThanOrEqual(1)
    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
    server.stop(true)
  }
}, { timeout: 60_000 })
