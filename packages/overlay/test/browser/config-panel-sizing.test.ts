import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
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
  "providers panel renders stable height and equal same-row buttons",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let config: Record<string, unknown> = {
      model: "alibaba/alibaba-coding-plan-long-context",
      tool_permissions: { websearch: "allow" },
    }
    const configPatches: Record<string, unknown>[] = []
    let resolveRefreshResponse: ((response: Response) => void) | undefined
    let resolveRefreshStarted!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      resolveRefreshStarted = resolve
    })
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
      if (path === "/provider/refresh" && req.method === "POST") {
        resolveRefreshStarted()
        return new Promise<Response>((resolve) => {
          resolveRefreshResponse = resolve
        })
      }
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
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor")
        return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
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
      await page.setViewport({ width: 1280, height: 900 })
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
      await page.waitForSelector('[data-menu-trigger="provider"]')
      await page.click('[data-menu-trigger="provider"]')
      await page.waitForSelector('[data-testid="titlebar-open-providers"]')
      await page.click('[data-testid="titlebar-open-providers"]')
      await page.waitForSelector(".provider-head-actions .oc-button")
      await page.waitForSelector(".provider-api-key-row")

      const metrics = await page.evaluate(() => {
        const heights = Array.from(document.querySelectorAll(".provider-head-actions .oc-button")).map((node) =>
          Math.round((node as HTMLElement).getBoundingClientRect().height),
        )
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

      assert.equal(new Set(metrics.headHeights).size, 1)
      assert.ok(Math.abs(metrics.apiInputHeight - metrics.apiButtonHeight) <= 1)
      assert.ok(metrics.dialogHeight >= 600)

      await page.setViewport({ width: 760, height: 900 })
      await page.waitForFunction(() => {
        const actions = document.querySelector(".provider-head-actions") as HTMLElement | null
        return actions && getComputedStyle(actions).justifyContent === "flex-start"
      })
      const mobileActions = await page.evaluate(() => {
        const actions = document.querySelector(".provider-head-actions") as HTMLElement
        const command = document.querySelector(".provider-command") as HTMLElement
        const buttons = Array.from(actions.querySelectorAll(".oc-button")).map((node) =>
          Math.round((node as HTMLElement).getBoundingClientRect().height),
        )
        const actionsRect = actions.getBoundingClientRect()
        const commandRect = command.getBoundingClientRect()
        const style = getComputedStyle(actions)
        return {
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          leftOffset: Math.round(actionsRect.left - commandRect.left),
          buttonCount: buttons.length,
          headHeights: buttons,
        }
      })
      assert.deepEqual(mobileActions, {
        alignItems: "flex-start",
        justifyContent: "flex-start",
        leftOffset: 0,
        buttonCount: 2,
        headHeights: metrics.headHeights,
      })
      const providerCommand = await page.$(".provider-command")
      assert.ok(providerCommand)
      const mobileActionsScreenshot = resolve(".scratch", "provider-head-actions-mobile.png")
      mkdirSync(dirname(mobileActionsScreenshot), { recursive: true })
      await writeFile(mobileActionsScreenshot, await providerCommand.screenshot({}))

      await page.setViewport({ width: 1280, height: 900 })
      await page.waitForFunction(() => {
        const actions = document.querySelector(".provider-head-actions") as HTMLElement | null
        return actions && getComputedStyle(actions).justifyContent === "flex-end"
      })

      await page.click('.provider-head-actions .oc-button[data-ui="provider-refresh-button"]')
      await refreshStarted
      await page.waitForFunction(() => {
        const button = document.querySelector('.provider-head-actions .oc-button[data-ui="provider-refresh-button"]') as HTMLElement | null
        const icon = button?.querySelector(".provider-refresh-icon") as HTMLElement | null
        return button?.dataset.spinning === "true" && icon && getComputedStyle(icon).transform !== "none"
      })
      const refreshState = await page.evaluate(() => {
        const button = document.querySelector('.provider-head-actions .oc-button[data-ui="provider-refresh-button"]') as HTMLButtonElement
        const icon = button.querySelector(".provider-refresh-icon") as HTMLElement
        return {
          oldOwnerCount: document.querySelectorAll(".provider-refresh-btn").length,
          spinning: button.dataset.spinning,
          disabled: button.disabled,
          iconTransform: getComputedStyle(icon).transform,
        }
      })
      assert.equal(refreshState.oldOwnerCount, 0)
      assert.equal(refreshState.spinning, "true")
      assert.equal(refreshState.disabled, true)
      assert.notEqual(refreshState.iconTransform, "none")

      const refreshButton = await page.$('.provider-head-actions .oc-button[data-ui="provider-refresh-button"]')
      assert.ok(refreshButton)
      const refreshScreenshot = resolve(".scratch", "provider-refresh-spinner-button.png")
      mkdirSync(dirname(refreshScreenshot), { recursive: true })
      await writeFile(refreshScreenshot, await refreshButton.screenshot({}))

      assert.ok(resolveRefreshResponse)
      resolveRefreshResponse(send({ ok: true, fetchedAt: Date.now() }))
      await page.waitForFunction(() => {
        const button = document.querySelector('.provider-head-actions .oc-button[data-ui="provider-refresh-button"]') as HTMLElement | null
        return button?.dataset.spinning === "false"
      })

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

      assert.ok(afterDrag.left - beforeDrag.left >= 100)
      assert.ok(afterDrag.top - beforeDrag.top >= 60)

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

      assert.ok(clamped.left >= 7)
      assert.ok(clamped.top >= 7)

      await page.click('[data-config-tab="permissions"]')
      await page.waitForSelector('[data-config-panel="permissions"] .s-segmented-btn[data-value="ask"]')
      const beforePermissionClick = await page.evaluate(() => {
        const panel = document.querySelector('[data-config-panel="permissions"]') as HTMLElement
        const allow = panel.querySelector('.s-segmented-btn[data-value="allow"]') as HTMLElement
        const ask = panel.querySelector('.s-segmented-btn[data-value="ask"]') as HTMLElement
        return {
          allowActive: allow.dataset.active,
          allowPressed: allow.getAttribute("aria-pressed"),
          askActive: ask.dataset.active || "",
          askPressed: ask.getAttribute("aria-pressed"),
        }
      })
      assert.equal(beforePermissionClick.allowActive, "true")
      assert.equal(beforePermissionClick.allowPressed, "true")
      assert.equal(beforePermissionClick.askActive, "")
      assert.equal(beforePermissionClick.askPressed, "false")

      await page.click('[data-config-panel="permissions"] .s-segmented-btn[data-value="ask"]')
      await page.waitForFunction(() => {
        const panel = document.querySelector('[data-config-panel="permissions"]') as HTMLElement | null
        const ask = panel?.querySelector('.s-segmented-btn[data-value="ask"]') as HTMLElement | null
        return ask?.dataset.active === "true" && ask.getAttribute("aria-pressed") === "true"
      })
      assert.deepEqual(configPatches.at(-1), { tool_permissions: { websearch: "ask" } })
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
