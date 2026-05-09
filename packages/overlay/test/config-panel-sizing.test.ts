import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const PROVIDERS_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "ProvidersPanel.tsx"), "utf8")

function bodyOf(selector: string): string {
  const css = SETTINGS_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

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

describe("config panel sizing", () => {
  test("config dialog keeps a stable minimum height", () => {
    expect(bodyOf("#configDialog .dialog-form")).toMatch(/min-height\s*:/)
    expect(bodyOf(".config-dialog-layout")).toMatch(/flex\s*:\s*1 1 auto/)
    expect(bodyOf(".config-content")).toMatch(/min-height\s*:\s*0/)
  })

  test("settings content normalizes same-level small button dimensions", () => {
    expect(bodyOf('.config-content .oc-button[data-size="sm"]')).toMatch(/--oc-button-height\s*:/)
    expect(bodyOf(".config-content .provider-head-actions .oc-button[data-size=\"sm\"]")).toMatch(/min-width\s*:/)
    expect(bodyOf(".config-content .provider-api-key-row .oc-button[data-size=\"sm\"]")).toMatch(/align-self\s*:\s*stretch/)
    expect(PROVIDERS_TSX).toContain('data-ui="provider-refresh-button"')
  })

  test("providers panel renders stable height and equal same-row buttons", async () => {
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
          return send({
            all: [
              {
                id: "alibaba",
                name: "Alibaba",
                source: "custom",
                models: {
                  "alibaba-coding-plan-long-context": { id: "alibaba-coding-plan-long-context" },
                },
              },
            ],
            connected: [],
            default: {},
          })
        }
        if (path === "/provider/auth") return send({})
        if (path === "/config/providers") return send({ providers: [], default: {} })
        if (path === "/config" && req.method === "GET") return send({ model: "alibaba/alibaba-coding-plan-long-context" })
        if (path === "/config/prompt") return send([])
        if (path === "/agent") return send([])
        if (path === "/channel") return send([])
        if (path === "/executor") return send([{ id: "mirrorcode", label: "MirrorCode", selectable: true, discovered: true }])
        if (path === "/skill/installed" || path === "/skill") return send([])
        if (path === "/mcp") return send({})
        if (path === "/panel/knowledge/memory") return send([])
        if (path === "/panel/knowledge/preference") return send([])
        if (path === "/log" && req.method === "POST") return send({ ok: true })
        return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
      },
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 900 })
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
      await page.waitForSelector('[data-menu-trigger="agent"]')
      await page.click('[data-menu-trigger="agent"]')
      await page.waitForSelector('[data-testid="titlebar-open-providers"]')
      await page.click('[data-testid="titlebar-open-providers"]')
      await page.waitForSelector(".provider-head-actions .oc-button")
      await page.waitForSelector(".provider-api-key-row")

      const metrics = await page.evaluate(() => {
        const heights = Array.from(document.querySelectorAll(".provider-head-actions .oc-button"))
          .map((node) => Math.round((node as HTMLElement).getBoundingClientRect().height))
        const apiRow = document.querySelector(".provider-api-key-row") as HTMLElement
        const apiInput = apiRow.querySelector(".field-input") as HTMLElement
        const apiButton = apiRow.querySelector(".oc-button") as HTMLElement
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        return {
          headHeights: heights,
          apiInputHeight: Math.round(apiInput.getBoundingClientRect().height),
          apiButtonHeight: Math.round(apiButton.getBoundingClientRect().height),
          dialogHeight: Math.round(dialog.getBoundingClientRect().height),
        }
      })

      expect(new Set(metrics.headHeights).size).toBe(1)
      expect(Math.abs(metrics.apiInputHeight - metrics.apiButtonHeight)).toBeLessThanOrEqual(1)
      expect(metrics.dialogHeight).toBeGreaterThanOrEqual(600)

      const beforeDrag = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const header = document.querySelector("#configDialog .dialog-header") as HTMLElement
        const dialogRect = dialog.getBoundingClientRect()
        const headerRect = header.getBoundingClientRect()
        return {
          left: Math.round(dialogRect.left),
          top: Math.round(dialogRect.top),
          startX: Math.round(headerRect.left + 160),
          startY: Math.round(headerRect.top + headerRect.height / 2),
        }
      })

      await page.mouse.move(beforeDrag.startX, beforeDrag.startY)
      await page.mouse.down()
      await page.mouse.move(beforeDrag.startX + 120, beforeDrag.startY + 80, { steps: 10 })
      await page.mouse.up()

      const afterDrag = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const rect = dialog.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }
      })

      expect(afterDrag.left - beforeDrag.left).toBeGreaterThanOrEqual(100)
      expect(afterDrag.top - beforeDrag.top).toBeGreaterThanOrEqual(60)

      const edgeDrag = await page.evaluate(() => {
        const header = document.querySelector("#configDialog .dialog-header") as HTMLElement
        const headerRect = header.getBoundingClientRect()
        return {
          startX: Math.round(headerRect.left + 160),
          startY: Math.round(headerRect.top + headerRect.height / 2),
        }
      })

      await page.mouse.move(edgeDrag.startX, edgeDrag.startY)
      await page.mouse.down()
      await page.mouse.move(edgeDrag.startX - 2000, edgeDrag.startY - 2000, { steps: 10 })
      await page.mouse.up()

      const clamped = await page.evaluate(() => {
        const dialog = document.querySelector("#configDialog .dialog-form") as HTMLElement
        const rect = dialog.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        }
      })

      expect(clamped.left).toBeGreaterThanOrEqual(7)
      expect(clamped.top).toBeGreaterThanOrEqual(7)
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  }, { timeout: 60_000 })
})
