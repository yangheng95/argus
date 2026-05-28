import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const HEADER_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "header.css"), "utf8")
const PROVIDERS_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "ProvidersPanel.tsx"), "utf8")
const PROMPT_CATALOG_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "PromptCatalog.tsx"), "utf8")

function bodyOfSource(source: string, selector: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

function bodyOf(selector: string): string {
  return bodyOfSource(SETTINGS_CSS, selector)
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

  test("settings panels keep a flat borderless owner surface", () => {
    const layoutBody = bodyOf(".config-dialog-layout")
    expect(layoutBody).toContain("--settings-surface-base: var(--surface-inset)")
    expect(layoutBody).toContain("--settings-surface-hover:")
    expect(layoutBody).toContain("--settings-surface-muted:")
    expect(layoutBody).toContain("--settings-surface-emphasis:")

    for (const selector of [
      ".config-panel-card",
      ".provider-flat-row",
      ".provider-command",
      ".config-status-box",
      ".about-author-card",
      ".about-info-grid",
      ".about-shortcut-grid",
      ".prompt-card",
      ".prompt-preview-card",
      ".extension-head",
      ".extension-row",
      ".channel-doc-card",
      ".market-card",
      ".detail-card",
      ".config-section",
      ".config-subsection",
      ".agent-model-table",
      ".llm-summary-row",
    ]) {
      const body = bodyOf(selector)
      expect(body).toMatch(/background:\s*transparent/)
      expect(body).toMatch(/border:\s*0(?:\s+solid transparent)?/)
    }

    for (const selector of [
      ".config-nav-item:hover",
      ".config-toggle-list-item:hover",
      ".agent-model-row:hover",
      // PermissionsPanel migrated off .perm-row → .s-row on 2026-05-26.
      // The primitive's hover wash is opt-in via data-interactive; the
      // selector below is what every settings panel will use once its
      // rows migrate too.
      '.s-row[data-interactive="true"]:hover,\n.s-row[data-interactive="true"]:focus-within',
      ".provider-flat-row:hover,\n.provider-flat-row:focus-within",
    ]) {
      expect(bodyOf(selector)).toMatch(/background:\s*var\(--settings-surface-hover\)/)
    }

    expect(bodyOf(".knowledge-toolbar")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".config-sidebar")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".knowledge-toolbar")).toMatch(/border:\s*0 solid transparent/)
    expect(bodyOf(".config-section-head")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".config-section-body")).toMatch(/border:\s*0 solid transparent/)
    expect(bodyOfSource(HEADER_CSS, '.oc-surface-header[data-surface="settings-group"]')).toMatch(/background:\s*transparent/)
    expect(bodyOfSource(HEADER_CSS, '.oc-surface-header[data-surface="settings-group"]')).toMatch(/border-block-end:\s*0 solid transparent/)
  })

  test("settings content normalizes same-level small button dimensions", () => {
    expect(bodyOf('.config-content .oc-button[data-size="sm"]')).toMatch(/--oc-button-height\s*:/)
    expect(bodyOf(".config-content .provider-head-actions .oc-button[data-size=\"sm\"]")).toMatch(/min-width\s*:/)
    expect(bodyOf(".config-content .provider-api-key-row .oc-button[data-size=\"sm\"]")).toMatch(/align-self\s*:\s*stretch/)
    expect(PROVIDERS_TSX).toContain('data-ui="provider-refresh-button"')
  })

  test("memory tab owns a full-height scrollable list", () => {
    expect(bodyOf(".memory-panel")).toMatch(/flex\s*:\s*1 1 auto/)
    expect(bodyOf('.config-tab-panel[data-config-panel="memory"].active')).toMatch(/display:\s*flex/)
    expect(bodyOf("#memoryBody")).toMatch(/flex\s*:\s*1 1 auto/)

    const list = bodyOf(".knowledge-list")
    expect(list).toMatch(/flex\s*:\s*1 1 auto/)
    expect(list).toMatch(/max-height:\s*none/)
    expect(list).toMatch(/overflow-y:\s*auto/)
    expect(list).toMatch(/scrollbar-width:\s*auto/)
    expect(bodyOf(".knowledge-list::-webkit-scrollbar")).toContain("width: var(--session-scrollbar-size)")
  })

  test("prompt editor switches markdown code and preview in one tab surface", () => {
    expect(PROMPT_CATALOG_TSX).toContain('class="prompt-view-tabs" role="tablist"')
    expect(PROMPT_CATALOG_TSX).toContain('class="prompt-view-tab"')
    expect(PROMPT_CATALOG_TSX).toContain('type PromptViewMode = "code" | "preview" | "default"')
    expect(PROMPT_CATALOG_TSX).toContain('when={viewMode(entryID) !== "code"}')
    expect(PROMPT_CATALOG_TSX).toContain('class="field-input prompt-textarea"')
    expect(PROMPT_CATALOG_TSX).toContain('class="prompt-preview-card prompt-preview-card--attached"')
    expect(PROMPT_CATALOG_TSX).not.toContain('class="prompt-toolbar"')
    expect(PROMPT_CATALOG_TSX).not.toContain('<details class="prompt-diff-details">')
    expect(PROMPT_CATALOG_TSX).not.toContain('{t("prompt.show_default")}')
    expect(bodyOf(".prompt-view-tabs")).toMatch(/display:\s*inline-flex/)
    expect(bodyOf(".prompt-editor-actions")).toMatch(/display:\s*inline-flex/)
    expect(bodyOf('.prompt-view-tab[data-active="true"]')).toMatch(/background:\s*var\(--surface\)/)
    expect(bodyOf(".prompt-preview-card--attached")).toMatch(/min-height:\s*calc\(160px \* var\(--ui-scale\)\)/)
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
        if (path === "/config" && req.method === "PATCH") return send({ ok: true })
        if (path === "/config/prompt") return send([])
        if (path === "/agent") return send([])
        if (path === "/channel") return send([])
        if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
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
      await page.waitForSelector('[data-menu-trigger="provider"]')
      await page.click('[data-menu-trigger="provider"]')
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
