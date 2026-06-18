import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const viewports = [320, 480, 600, 760, 1440]
const locales = ["en-US", "zh-CN"]

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
  "titlebar menubar fits documented responsive widths and locales",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")
    let config: Record<string, unknown> = {
      model: "openai/super-long-provider-model-name-for-titlebar-geometry",
    }
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
      if (path === "/config") return send(config)
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path === "/log/tail") return send({ lines: ['{"level":30,"time":"2026-06-15T00:00:00.000Z","msg":"ready"}'] })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      for (const locale of locales) {
        for (const width of viewports) {
          const page = await browser.newPage()
          await page.setViewport({ width, height: 720 })
          await page.evaluateOnNewDocument((value) => {
            localStorage.setItem("oc_locale", value)
            ;(window as any).__helpOpenUrls = []
            ;(window as any).__devtoolsToggleCount = 0
            window.__TAURI__ = {
              core: {
                invoke: async (command: string, args: Record<string, unknown> = {}) => {
                  if (command === "overlay_settings_load") {
                    return {
                      serverUrl: location.origin,
                      autoServer: true,
                      locale: value,
                      directory: "D:/overlay/workspace/app",
                    }
                  }
                  if (command === "overlay_server_info") {
                    return { url: location.origin, pid: 12345 }
                  }
                  if (command === "overlay_open_url") {
                    ;(window as any).__helpOpenUrls.push(String(args.url || ""))
                    return true
                  }
                  if (command === "overlay_toggle_devtools") {
                    ;(window as any).__devtoolsToggleCount += 1
                    return true
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
          }, locale)
          await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
          await page.waitForSelector('[data-menu-trigger="workspace"]')
          await page.waitForFunction((value) => document.documentElement.lang === value, {}, locale)
          await page.waitForFunction(
            (port) => {
              const title = document.querySelector("#connBadge")?.getAttribute("title") || ""
              return title.includes(String(port)) && title.includes("12345")
            },
            {},
            server.port,
          )
          const expectedWorkspaceMenu = locale === "zh-CN" ? "项目" : "Project"
          const workspaceMenu = await page.$eval('[data-menu-trigger="workspace"]', (node) => {
            const el = node as HTMLElement
            return {
              label: el.getAttribute("aria-label"),
              title: el.getAttribute("title"),
              compact: el.dataset.compact,
              accessKey: el.dataset.accessKey,
            }
          })
          assert.deepEqual(workspaceMenu, {
            label: expectedWorkspaceMenu,
            title: expectedWorkspaceMenu,
            compact: "P",
            accessKey: "p",
          })
          const geometry = await page.evaluate(() => {
            const titlebar = document.querySelector("#titlebar") as HTMLElement | null
            if (!titlebar) throw new Error("Missing titlebar")
            const selectors = [
              ".titlebar-brand",
              "[data-menu-trigger]",
              ".titlebar-window-controls button",
            ]
            const nodes = selectors
              .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
              .filter((node) => {
                const style = getComputedStyle(node)
                const rect = node.getBoundingClientRect()
                return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
              })
            const rects = nodes.map((node) => {
              const rect = node.getBoundingClientRect()
              return {
                label: node.id || node.dataset.menuTrigger || node.className || node.tagName,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              }
            })
            const overlaps: string[] = []
            for (let i = 0; i < rects.length; i += 1) {
              for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i]
                const b = rects[j]
                const intersects =
                  a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
                if (intersects) overlaps.push(`${a.label} overlaps ${b.label}`)
              }
            }
            const outOfBounds = rects
              .filter((rect) => rect.left < -0.5 || rect.right > window.innerWidth + 0.5)
              .map((rect) => `${rect.label}:${rect.left.toFixed(1)}-${rect.right.toFixed(1)}`)
            const brand = document.querySelector(".titlebar-brand")?.getBoundingClientRect()
            const badge = document.querySelector<HTMLElement>("#connBadge")
            const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-trigger]"))
              .filter((node) => getComputedStyle(node).display !== "none")
              .map((node) => node.dataset.menuTrigger || "")
            const triggerMetrics = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-trigger]"))
              .filter((node) => getComputedStyle(node).display !== "none")
              .map((node) => {
                const rect = node.getBoundingClientRect()
                const label = node.querySelector<HTMLElement>(".titlebar-menu-trigger-label")
                const compact = node.querySelector<HTMLElement>(".titlebar-menu-trigger-compact")
                return {
                  id: node.dataset.menuTrigger || "",
                  width: rect.width,
                  labelDisplay: label ? getComputedStyle(label).display : "",
                  compactDisplay: compact ? getComputedStyle(compact).display : "",
                  compactFontSize: compact ? getComputedStyle(compact).fontSize : "",
                  compactWidth: compact ? compact.getBoundingClientRect().width : 0,
                  compactHeight: compact ? compact.getBoundingClientRect().height : 0,
                  height: rect.height,
                }
              })
            return {
              overlaps,
              outOfBounds,
              brandWidth: brand?.width || 0,
              badgeText: badge?.textContent || "",
              badgeTitle: badge?.getAttribute("title") || "",
              titlebarHeight: titlebar.getBoundingClientRect().height,
              triggers,
              triggerMetrics,
            }
          })

          assert.equal(geometry.triggers.includes("product"), false)
          assert.ok(geometry.triggers.includes("workspace"))
          assert.equal(geometry.triggers.includes("model"), false)
          assert.equal(geometry.triggers.includes("agent"), false)
          assert.ok(geometry.triggers.includes("provider"))
          assert.ok(geometry.triggers.includes("tools"))
          assert.equal(geometry.triggers.includes("skill"), false)
          assert.equal(geometry.triggers.includes("mcp"), false)
          assert.equal(geometry.triggers.includes("memory"), false)
          assert.ok(geometry.triggers.includes("settings"))
          assert.deepEqual(geometry.outOfBounds, [])
          assert.deepEqual(geometry.overlaps, [])
          assert.ok(geometry.brandWidth > 24)
          assert.equal(geometry.badgeText.includes(`:${server.port}`), false)
          assert.ok(geometry.badgeTitle.includes(String(server.port)))
          assert.ok(geometry.badgeTitle.includes("12345"))
          assert.ok(geometry.titlebarHeight > 24)
          if (width <= 760) {
            assert.equal(
              geometry.triggerMetrics.every((item) => item.width <= 32),
              true,
            )
            assert.equal(new Set(geometry.triggerMetrics.map((item) => Math.round(item.height))).size, 1)
            assert.equal(
              geometry.triggerMetrics.every((item) => item.labelDisplay === "none"),
              true,
            )
            assert.equal(
              geometry.triggerMetrics.every((item) => item.compactDisplay !== "none"),
              true,
            )
            assert.equal(
              geometry.triggerMetrics.every((item) => Number.parseFloat(item.compactFontSize) > 0),
              true,
            )
            assert.equal(
              geometry.triggerMetrics.every((item) => item.compactWidth > 0 && item.compactHeight > 0),
              true,
            )
          }
          for (const menu of ["workspace", "provider", "run", "tools", "settings", "view", "help"]) {
            await page.click(`[data-menu-trigger="${menu}"]`)
            await page.waitForSelector(`[data-testid="titlebar-menu-${menu}"]`, { visible: true })
            const panelBounds = await page.$eval(`[data-testid="titlebar-menu-${menu}"]`, (node) => {
              const rect = node.getBoundingClientRect()
              return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
              }
            })
            assert.ok(panelBounds.left >= 0)
            assert.ok(panelBounds.right <= panelBounds.viewportWidth)
            assert.ok(panelBounds.top >= 0)
            assert.ok(panelBounds.bottom <= panelBounds.viewportHeight)
            assert.ok(panelBounds.width > 120)
            assert.ok(panelBounds.height > 24)
            await page.keyboard.press("Escape")
            await page.waitForFunction(
              (value) => !document.querySelector(`[data-testid="titlebar-menu-${value}"]`),
              {},
              menu,
            )
          }
          await page.click('[data-menu-trigger="help"]')
          await page.waitForSelector('[data-testid="titlebar-help-about"]', { visible: true })
          const helpContract = await page.$eval('[data-testid="titlebar-menu-help"]', (node) => {
            const labels = Array.from(node.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => ({
              testid: item.dataset.testid || "",
              text: item.textContent || "",
              title: item.getAttribute("title") || "",
              ariaLabel: item.getAttribute("aria-label") || "",
            }))
            return {
              labels,
              hasRefresh: labels.some((item) => item.text.includes("Refresh") || item.text.includes("刷新")),
              hasLogs: labels.some((item) => item.testid === "titlebar-help-logs"),
              hasDiagnostics: labels.some((item) => item.testid === "titlebar-connection-diagnostics"),
            }
          })
          assert.equal(helpContract.hasRefresh, false)
          assert.equal(helpContract.hasLogs, true)
          assert.equal(helpContract.hasDiagnostics, false)
          assert.deepEqual(
            helpContract.labels.map((item) => item.testid),
            [
              "titlebar-help-docs",
              "titlebar-help-sdk",
              "titlebar-help-logs",
              "titlebar-help-devtools",
              "titlebar-help-about",
            ],
          )
          assert.equal(
            helpContract.labels.every((item) => item.title && item.ariaLabel),
            true,
          )
          const helpVisual = await page.$eval('[data-testid="titlebar-menu-help"]', (node) => {
            const panelRect = node.getBoundingClientRect()
            const itemRects = Array.from(node.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => {
              const title = item.querySelector<HTMLElement>(".titlebar-menubar-item-title")
              const meta = item.querySelector<HTMLElement>(".titlebar-menubar-item-meta")
              if (!title || !meta) throw new Error(`Missing Help menu copy nodes for ${item.dataset.testid || ""}`)
              const itemRect = item.getBoundingClientRect()
              const titleRect = title.getBoundingClientRect()
              const metaRect = meta.getBoundingClientRect()
              const itemStyle = getComputedStyle(item)
              const metaStyle = getComputedStyle(meta)
              return {
                testid: item.dataset.testid || "",
                itemLeft: itemRect.left,
                itemRight: itemRect.right,
                titleLeft: titleRect.left,
                titleRight: titleRect.right,
                metaLeft: metaRect.left,
                metaRight: metaRect.right,
                metaHeight: metaRect.height,
                display: itemStyle.display,
                gridTemplateColumns: itemStyle.gridTemplateColumns,
                metaText: meta.textContent || "",
                metaWhiteSpace: metaStyle.whiteSpace,
                metaTextOverflow: metaStyle.textOverflow,
                metaOverflowX: meta.scrollWidth - meta.clientWidth,
                titleOverflowX: title.scrollWidth - title.clientWidth,
              }
            })
            return {
              panelLeft: panelRect.left,
              panelRight: panelRect.right,
              panelWidth: panelRect.width,
              viewportWidth: window.innerWidth,
              itemRects,
            }
          })
          assert.ok(helpVisual.panelLeft >= 0)
          assert.ok(helpVisual.panelRight <= helpVisual.viewportWidth)
          assert.ok(helpVisual.panelWidth > (width <= 320 ? 280 : 300))
          for (const item of helpVisual.itemRects) {
            assert.equal(item.display, "grid")
            assert.notEqual(item.gridTemplateColumns, "none")
            assert.ok(item.metaText.trim().length > 12)
            assert.notEqual(item.metaWhiteSpace, "nowrap")
            assert.notEqual(item.metaTextOverflow, "ellipsis")
            assert.ok(item.itemLeft >= helpVisual.panelLeft)
            assert.ok(item.itemRight <= helpVisual.panelRight)
            assert.ok(item.titleLeft >= item.itemLeft)
            assert.ok(item.metaRight <= item.itemRight)
            assert.ok(item.titleRight <= item.metaLeft)
            assert.ok(item.metaHeight > 10)
            assert.ok(item.metaOverflowX <= 1)
            assert.ok(item.titleOverflowX <= 1)
          }
          await page.click('[data-testid="titlebar-help-docs"]')
          await page.waitForFunction(() => (window as any).__helpOpenUrls.length === 1)
          await page.click('[data-menu-trigger="help"]')
          await page.waitForSelector('[data-testid="titlebar-help-sdk"]', { visible: true })
          await page.click('[data-testid="titlebar-help-sdk"]')
          await page.waitForFunction(() => (window as any).__helpOpenUrls.length === 2)
          await page.click('[data-menu-trigger="help"]')
          await page.waitForSelector('[data-testid="titlebar-help-logs"]', { visible: true })
          await page.click('[data-testid="titlebar-help-logs"]')
          await page.waitForSelector("#logDialog", { visible: true })
          await page.click("#btnCloseLog")
          await page.waitForFunction(() => document.querySelector("#logDialog") === null)
          await page.click('[data-menu-trigger="help"]')
          await page.waitForSelector('[data-testid="titlebar-help-devtools"]', { visible: true })
          await page.click('[data-testid="titlebar-help-devtools"]')
          await page.waitForFunction(() => (window as any).__devtoolsToggleCount === 1)
          await page.click('[data-menu-trigger="help"]')
          await page.waitForSelector('[data-testid="titlebar-help-about"]', { visible: true })
          await page.click('[data-testid="titlebar-help-about"]')
          await page.waitForFunction(
            () =>
              document.querySelector("#configDialog") !== null &&
              document.querySelector('[data-config-panel="about"]')?.classList.contains("active") === true &&
              document.querySelector("#aboutRuntimeGrid")?.textContent?.includes("12345") === true,
          )
          await page.click("#btnCloseConfigDialog")
          await page.waitForFunction(() => document.querySelector("#configDialog") === null)
          const openedUrls = await page.evaluate(() => (window as any).__helpOpenUrls as string[])
          const localePrefix = locale === "zh-CN" ? "/docs/zh-cn/" : "/docs/"
          assert.deepEqual(openedUrls, [
            `https://opencorvus.ai${localePrefix}start/quickstart/`,
            `https://opencorvus.ai${localePrefix}reference/sdk/`,
          ])
          await page.close()
        }
      }

      config = {}
      for (const width of [320, 480, 600, 760]) {
        const page = await browser.newPage()
        await page.setViewport({ width, height: 720 })
        await page.evaluateOnNewDocument(() => {
          localStorage.setItem("oc_locale", "en-US")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: location.origin,
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
        })
        await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
        await page.waitForSelector('[data-menu-trigger="workspace"]', { visible: true })
        const retiredTitlebarStatusCounts = await page.evaluate(() => {
          const selectors = [
            ".titlebar-status-chip",
            ".titlebar-setup-cta",
            ".titlebar-status-icon",
            ".titlebar-task-status",
            ".titlebar-status-label",
            ".titlebar-status-value",
            '[data-testid="titlebar-setup-cta"]',
            '[data-ui="titlebar-status-icon"]',
          ]
          return Object.fromEntries(selectors.map((selector) => [selector, document.querySelectorAll(selector).length]))
        })
        assert.deepEqual(
          retiredTitlebarStatusCounts,
          Object.fromEntries(Object.keys(retiredTitlebarStatusCounts).map((selector) => [selector, 0])),
        )
        const workspaceBounds = await page.$eval('[data-menu-trigger="workspace"]', (node) => {
          const rect = node.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width }
        })
        assert.ok(workspaceBounds.left >= 0)
        assert.ok(workspaceBounds.right <= width)
        assert.ok(workspaceBounds.width > 16)
        await page.close()
      }
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)

test(
  "titlebar menubar uses theme-adaptive text color and supports Alt access keys",
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
      if (path === "/config") return send({})
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
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
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("oc_theme", "vscode-dark")
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: location.origin,
                  autoServer: false,
                  theme: "vscode-dark",
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
      })
      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-menu-trigger="workspace"]', { visible: true })
      await page.waitForFunction(() => document.documentElement.dataset.theme === "vscode-dark")
      assert.equal(await page.evaluate(() => localStorage.getItem("oc_theme")), "vscode-dark")

      const shellBackgrounds = await page.evaluate(() => {
        const sidebar = getComputedStyle(document.querySelector<HTMLElement>(".sidebar")!).backgroundColor
        const sections = getComputedStyle(document.querySelector<HTMLElement>(".sections")!).backgroundColor
        const panelBody = getComputedStyle(document.querySelector<HTMLElement>("#panelBody")!).backgroundColor
        return { sidebar, sections, panelBody }
      })
      assert.notEqual(shellBackgrounds.sidebar, "rgba(0, 0, 0, 0)")
      assert.notEqual(shellBackgrounds.sections, "rgba(0, 0, 0, 0)")
      assert.notEqual(shellBackgrounds.panelBody, "rgba(0, 0, 0, 0)")

      const vscodeDarkTriggerState = await page.$eval('[data-menu-trigger="workspace"]', (node) => {
        const el = node as HTMLElement
        return {
          color: getComputedStyle(el).color,
          accessKey: el.dataset.accessKey,
          ariaKeyshortcuts: el.getAttribute("aria-keyshortcuts"),
        }
      })
      assert.deepEqual(vscodeDarkTriggerState, {
        color: "rgb(212, 212, 212)",
        accessKey: "p",
        ariaKeyshortcuts: "Alt+P",
      })

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark"
        document.body.dataset.theme = "dark"
      })
      const darkTriggerColor = await page.$eval(
        '[data-menu-trigger="workspace"]',
        (node) => getComputedStyle(node as HTMLElement).color,
      )
      assert.equal(darkTriggerColor, "rgb(232, 236, 241)")

      await page.keyboard.down("Alt")
      await page.keyboard.up("Alt")
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.dataset.menuTrigger === "workspace",
      )

      await page.keyboard.down("Alt")
      await page.keyboard.press("v")
      await page.keyboard.up("Alt")
      await page.waitForSelector('[data-testid="titlebar-menu-view"]', { visible: true })
      assert.notEqual(await page.$('[data-testid="titlebar-theme-vscode-dark"]'), null)
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.getAttribute("role") === "menuitemradio",
      )
      const altOpenState = await page.evaluate(() => ({
        expanded: document.querySelector('[data-menu-trigger="view"]')?.getAttribute("aria-expanded"),
        focusedClass: (document.activeElement as HTMLElement | null)?.className || "",
        focusedRole: (document.activeElement as HTMLElement | null)?.getAttribute("role") || "",
        focusedTestid: (document.activeElement as HTMLElement | null)?.dataset.testid || "",
        focusedAriaChecked: (document.activeElement as HTMLElement | null)?.getAttribute("aria-checked") || "",
        focusedMenuText: (document.activeElement as HTMLElement | null)?.textContent?.trim() || "",
      }))
      assert.equal(altOpenState.expanded, "true")
      assert.equal(altOpenState.focusedRole, "menuitemradio", JSON.stringify(altOpenState))
      assert.match(altOpenState.focusedClass, /titlebar-theme-option/, JSON.stringify(altOpenState))
      assert.equal(altOpenState.focusedTestid, "titlebar-theme-vscode-dark", JSON.stringify(altOpenState))
      assert.equal(altOpenState.focusedAriaChecked, "true", JSON.stringify(altOpenState))
      assert.ok(altOpenState.focusedMenuText.includes("VS Code Dark"), JSON.stringify(altOpenState))
      const viewMenuElement = await page.$('[data-testid="titlebar-menu-view"]')
      assert.ok(viewMenuElement)
      const screenshotPath = resolve(".scratch/titlebar-view-radio-focus.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await viewMenuElement.screenshot({}))
      const themeRadioState = await page.$eval('[data-testid="titlebar-menu-view"]', (node) => {
        const items = Array.from(node.querySelectorAll<HTMLElement>(".titlebar-theme-option"))
        return {
          count: items.length,
          roles: items.map((item) => item.getAttribute("role")),
          checked: items.map((item) => ({
            testid: item.dataset.testid || "",
            ariaChecked: item.getAttribute("aria-checked"),
            active: item.dataset.active || "",
          })),
          legacyRadioCount: node.querySelectorAll('[role="radio"]').length,
        }
      })
      assert.ok(themeRadioState.count >= 3)
      assert.deepEqual(
        [...new Set(themeRadioState.roles)],
        ["menuitemradio"],
      )
      assert.equal(themeRadioState.legacyRadioCount, 0)
      assert.deepEqual(
        themeRadioState.checked.find((item) => item.testid === "titlebar-theme-vscode-dark"),
        {
          testid: "titlebar-theme-vscode-dark",
          ariaChecked: "true",
          active: "true",
        },
      )
      await page.click('[data-testid="titlebar-theme-light"]')
      await page.waitForSelector('[data-testid="titlebar-menu-view"]', { visible: true })
      await page.waitForSelector('[data-testid="titlebar-theme-light"][aria-checked="true"]', { visible: true })
      assert.equal(
        await page.$eval('[data-testid="titlebar-theme-light"]', (node) => (node as HTMLElement).dataset.active),
        "true",
      )

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)

test(
  "workspace intro owns first-run directory setup when no directory is set",
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
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 900, height: 720 })
      await page.evaluateOnNewDocument((portValue) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.removeItem("oc_directory")
        ;(window as any).__startupInvokes = []
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              ;(window as any).__startupInvokes.push(command)
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: `http://127.0.0.1:${portValue}`,
                  autoServer: false,
                  locale: "en-US",
                  directory: "",
                }
              }
              if (command === "overlay_settings_save") return true
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
      }, server.port)

      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-testid="workspace-onboarding-dialog"]', { visible: true })
      const intro = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('[data-testid="workspace-onboarding-dialog"]')
        const openFolder = document.querySelector<HTMLElement>('[data-testid="workspace-onboarding-open-folder"]')
        const title = document.querySelector<HTMLElement>(".workspace-onboarding-titleblock")
        const removedCreateEntry = document.querySelector<HTMLElement>(
          '[data-testid="workspace-onboarding-create-directory"]',
        )
        const brandWordmark = document.querySelector<HTMLElement>(".brand-guide-wordmark")
        const brandLabel = document.querySelector<HTMLElement>(".brand-guide-label")
        const rightActivities = Array.from(
          document.querySelectorAll<HTMLElement>('[data-ui="side-activity-button"][data-side="right"]'),
        ).map((node) => ({
          activity: node.dataset.activity || "",
          active: node.dataset.active,
        }))
        const startupInvokes = ((window as any).__startupInvokes || []) as string[]
        return {
          hasStartup: !!dialog,
          openFolderText: openFolder?.textContent || "",
          hasCreateDirectory: !!removedCreateEntry,
          title: title?.textContent || "",
          brandWordmark: brandWordmark?.textContent || "",
          brandLabel: brandLabel?.textContent || "",
          rightActivities,
          pickDirInvokes: startupInvokes.filter((value) => value === "overlay_pick_dir").length,
        }
      })
      assert.equal(intro.hasStartup, true)
      assert.equal(intro.pickDirInvokes, 0)
      assert.ok(intro.openFolderText.includes("Open Local Directory"))
      assert.equal(intro.hasCreateDirectory, false)
      assert.ok(intro.title.includes("Open a workspace directory"))
      assert.equal(intro.brandWordmark, "OpenCorvus")
      assert.equal(intro.brandLabel, "Workspace")
      assert.deepEqual(intro.rightActivities, [
        { activity: "workflow", active: "true" },
        { activity: "inspector", active: "false" },
        { activity: "explorer", active: "false" },
        { activity: "diff", active: "false" },
        { activity: "browser", active: "false" },
        { activity: "screenshots", active: "false" },
        { activity: "notifications", active: "false" },
      ])
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "project menu close clears the current project and opens onboarding",
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
      if (path === "/config") return send({ model: "openai/test" })
      if (path === "/agent") return send([{ id: "codex", selectable: true }])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([{ id: "codex", selectable: true }])
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
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument((portValue) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_recent_directories", JSON.stringify(["D:/overlay/workspace/app"]))
        ;(window as any).__savedSettings = []
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args?: any) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: `http://127.0.0.1:${portValue}`,
                  autoServer: false,
                  locale: "en-US",
                  directory: "D:/overlay/workspace/app",
                }
              }
              if (command === "overlay_settings_save") {
                ;(window as any).__savedSettings.push(args?.settings ?? null)
                return true
              }
              if (command === "overlay_server_info") {
                return { url: `http://127.0.0.1:${portValue}`, pid: 12345 }
              }
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
      }, server.port)

      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-menu-trigger="workspace"]', { visible: true })
      await page.click('[data-menu-trigger="workspace"]')
      await page.waitForSelector('[data-testid="titlebar-close-project"]', { visible: true })
      await page.click('[data-testid="titlebar-close-project"]')
      await page.waitForSelector('[data-testid="workspace-onboarding-dialog"]', { visible: true })

      const state = await page.evaluate(() => {
        const saved = ((window as any).__savedSettings || []) as any[]
        const latest = saved.at(-1) || {}
        return {
          directory: (window as any).settingsStore.directory,
          savedDirectory: (window as any).settingsStore.savedDirectory,
          selectedSource: (window as any).boardStore.selectedSource,
          tasks: (window as any).boardStore.tasks.length,
          pendingTasks: (window as any).boardStore.pendingTasks.length,
          path: (window as any).boardStore.path,
          vcs: (window as any).boardStore.vcs,
          config: (window as any).appStore?.config ?? null,
          recent: document.querySelector('[data-testid="workspace-onboarding-recent-0"]')?.textContent || "",
          persistedDirectory: latest.directory,
        }
      })

      assert.equal(state.directory, "")
      assert.equal(state.savedDirectory, "")
      assert.equal(state.selectedSource, null)
      assert.equal(state.tasks, 0)
      assert.equal(state.pendingTasks, 0)
      assert.equal(state.path, null)
      assert.equal(state.vcs, null)
      assert.equal(state.config, null)
      assert.ok(state.recent.includes("D:/overlay/workspace/app"))
      assert.equal(state.persistedDirectory, null)
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "column resizers allow broad widths without wide visual dividers",
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
      if (path === "/config") return send({})
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
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
      await page.setViewport({ width: 1600, height: 900 })
      await page.evaluateOnNewDocument((portValue) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "dark")
        localStorage.removeItem("oc_sidebar_width")
        localStorage.removeItem("oc_sections_width")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: `http://127.0.0.1:${portValue}`,
                  autoServer: false,
                  locale: "en-US",
                  theme: "dark",
                  directory: "D:/overlay/workspace/app",
                  rightPanelCollapsed: false,
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
      }, server.port)

      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector("#leftPaneResizer", { visible: true })
      await page.waitForSelector("#solidRightActivityToolbar", { visible: true })

      const initial = await page.evaluate(() => {
        const panelBody = document.querySelector<HTMLElement>("#panelBody")!
        const workspaceMain = document.querySelector<HTMLElement>("#workspaceMain")!
        const workspace = workspaceMain.getBoundingClientRect()
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const workbench = document.querySelector<HTMLElement>("#centerWorkbench")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const toolbar = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const panelStyle = getComputedStyle(panelBody)
        const workspaceStyle = getComputedStyle(workspaceMain)
        return {
          panelGap: panelStyle.gap,
          panelPaddingTop: panelStyle.paddingTop,
          panelPaddingRight: panelStyle.paddingRight,
          panelPaddingBottom: panelStyle.paddingBottom,
          panelPaddingLeft: panelStyle.paddingLeft,
          workspaceGap: workspaceStyle.gap,
          leftDivider: workspace.left - sidebar.right,
          rightDivider: toolbar.left - workbench.right,
          workbenchStartsAtWorkspace: Math.abs(workbench.left - workspace.left) <= 1,
          leftHandleWidth: left.width,
          rightToolbarWidth: toolbar.width,
          leftCenterX: left.left + left.width / 2,
          leftCenterY: left.top + left.height / 2,
          rightPaneResizerExists: !!document.querySelector("#rightPaneResizer"),
        }
      })
      assert.equal(initial.panelGap, "0px")
      assert.equal(initial.panelPaddingTop, "0px")
      assert.equal(initial.panelPaddingRight, "0px")
      assert.equal(initial.panelPaddingBottom, "0px")
      assert.equal(initial.panelPaddingLeft, "0px")
      assert.equal(initial.workspaceGap, "0px")
      assert.ok(initial.leftDivider <= 2)
      assert.ok(initial.rightDivider <= 2)
      assert.ok(Math.abs(initial.leftDivider - initial.rightDivider) <= 1)
      assert.equal(initial.workbenchStartsAtWorkspace, true)
      assert.ok(initial.leftHandleWidth <= 2)
      assert.ok(initial.rightToolbarWidth > 32)
      assert.equal(initial.rightPaneResizerExists, false)

      const projectChromeHeights = await page.evaluate(() => {
        const selectors = [".task-cwd-dropdown", '[data-ui="project-worktree-dropdown"]']
        return selectors.map((selector) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return { selector, missing: true, height: 0 }
          const rect = node.getBoundingClientRect()
          return { selector, missing: false, height: Math.round(rect.height) }
        })
      })
      assert.equal(
        projectChromeHeights.every((item) => !item.missing),
        true,
      )
      assert.equal(new Set(projectChromeHeights.map((item) => item.height)).size, 1)

      const controlsWithMargins = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          '[data-ui="sidebar-new-task-button"]',
          ".task-dir-shell",
          ".task-cwd-dropdown",
          ".btn.mini",
          '[data-ui^="executor-chip-"]',
          ".chat-input",
          ".chat-send",
          ".board-intro__cta-action",
        ]
        return selectors.flatMap((selector) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          const margins = [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]
          return margins.every((value) => value === "0px") ? [] : [{ selector, margins }]
        })
      })
      assert.deepEqual(controlsWithMargins, [])

      const looseControlSpacing = await page.evaluate(() => {
        const checks = [
          { selector: ".titlebar", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".titlebar-left", props: ["columnGap"], max: 4 },
          { selector: ".titlebar-utility", props: ["columnGap"], max: 4 },
          { selector: ".titlebar-actions", props: ["columnGap"], max: 4 },
          { selector: ".titlebar-window-controls", props: ["columnGap"], max: 4 },
          { selector: ".task-bar", props: ["paddingLeft", "paddingRight"], max: 8 },
          { selector: ".sidebar-header", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".chat-header", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".sections-header", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".brand-guide", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: '[data-ui="titlebar-menubar-trigger"]', props: ["paddingLeft", "paddingRight"], max: 8 },
          {
            selector: '[data-ui="sidebar-new-task-button"]',
            props: ["columnGap", "paddingLeft", "paddingRight"],
            max: 11,
          },
          { selector: ".task-dir-shell", props: ["columnGap", "paddingLeft", "paddingRight"], max: 4 },
          { selector: ".task-cwd-dropdown", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".btn.mini", props: ["paddingLeft", "paddingRight"], max: 8 },
          { selector: '[data-ui^="executor-chip-"]', props: ["columnGap", "paddingLeft", "paddingRight"], max: 9 },
          {
            selector: ".chat-input",
            props: ["columnGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 8,
          },
          { selector: ".chat-send", props: ["paddingLeft", "paddingRight"], max: 9 },
          { selector: ".chat-send", props: ["columnGap", "paddingLeft", "paddingRight"], max: 9 },
        ]
        return checks.flatMap(({ selector, props, max }) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return props.flatMap((prop) => {
            const valueText = style[prop as keyof CSSStyleDeclaration] as string
            const value = Number.parseFloat(valueText)
            return Number.isFinite(value) && value <= max ? [] : [{ selector, prop, value: valueText, max }]
          })
        })
      })
      assert.deepEqual(looseControlSpacing, [])

      const controlsWithBorders = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          '[data-ui="sidebar-new-task-button"]',
          ".btn.mini",
          ".conn-banner__action",
          ".board-intro__cta-action",
        ]
        const props = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] as const
        return selectors.flatMap((selector) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return props.flatMap((prop) => {
            const value = Number.parseFloat(style[prop])
            return Number.isFinite(value) && value === 0 ? [] : [{ selector, prop, value: style[prop] }]
          })
        })
      })
      assert.deepEqual(controlsWithBorders, [])

      const looseRightPanelSpacing = await page.evaluate(() => {
        const checks = [
          { selector: ".sections-header", props: ["height", "paddingLeft", "paddingRight"], max: 42 },
          {
            selector: ".sections-stack",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: '[data-ui="side-activity-button"][data-side="right"]',
            props: ["height", "paddingLeft", "paddingRight"],
            max: 40,
          },
          {
            selector: ".board-intro",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          { selector: ".board-intro__head", props: ["rowGap"], max: 3 },
          {
            selector: ".board-intro__section",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: ".board-intro__mode",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: ".board-intro__agent",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: ".acceptance-panel",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: ".section-body > .empty-hint",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
        ]
        return checks.flatMap(({ selector, props, max }) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return props.flatMap((prop) => {
            const valueText = style[prop as keyof CSSStyleDeclaration] as string
            const value = Number.parseFloat(valueText)
            return Number.isFinite(value) && value <= max ? [] : [{ selector, prop, value: valueText, max }]
          })
        })
      })
      assert.deepEqual(looseRightPanelSpacing, [])

      const rightPanelDecorativeBorders = await page.evaluate(() => {
        const selectors = [
          ".sections",
          ".sections-header",
          ".board-intro",
          ".board-intro__section",
          ".board-intro__mode",
          ".board-intro__agent",
          ".section",
          ".section-head",
          ".section-body > .empty-hint",
          ".acceptance-panel",
        ]
        const props = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] as const
        return selectors.flatMap((selector) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return props.flatMap((prop) => {
            const value = Number.parseFloat(style[prop])
            return Number.isFinite(value) && value === 0 ? [] : [{ selector, prop, value: style[prop] }]
          })
        })
      })
      assert.deepEqual(rightPanelDecorativeBorders, [])

      const nonPrimaryControlsWithBackgrounds = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          ".btn.mini",
          ".conn-banner__action",
        ]
        const transparent = (value: string) =>
          value === "transparent" ||
          value === "rgba(0, 0, 0, 0)" ||
          value === "rgb(0 0 0 / 0)" ||
          value.endsWith("/ 0)")
        return selectors.flatMap((selector) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return transparent(style.backgroundColor) && style.backgroundImage === "none"
            ? []
            : [{ selector, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage }]
        })
      })
      assert.deepEqual(nonPrimaryControlsWithBackgrounds, [])

      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')

      const afterInspectorOpen = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const workspace = document.querySelector<HTMLElement>("#workspaceMain")!.getBoundingClientRect()
        const workbench = document.querySelector<HTMLElement>("#centerWorkbench")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const sections = document.querySelector<HTMLElement>(".sections")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const toolbar = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!.getBoundingClientRect()
        return {
          sidebar: sidebar.width,
          chat: chat.width,
          sections: sections.width,
          leftDivider: workspace.left - sidebar.right,
          rightDivider: toolbar.left - workbench.right,
          workbenchStartsAtWorkspace: Math.abs(workbench.left - workspace.left) <= 1,
          centerInspectorActive: document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.dataset.active || "",
          inspectorButtonActive:
            document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
            )?.dataset.active || "",
          leftHandleWidth: left.width,
          rightPaneResizerExists: !!document.querySelector("#rightPaneResizer"),
        }
      })

      assert.ok(afterInspectorOpen.sections > 300)
      assert.ok(Math.abs(afterInspectorOpen.sections - afterInspectorOpen.chat) <= 2)
      assert.ok(afterInspectorOpen.leftDivider <= 2)
      assert.ok(afterInspectorOpen.rightDivider <= 2)
      assert.ok(Math.abs(afterInspectorOpen.leftDivider - afterInspectorOpen.rightDivider) <= 1)
      assert.equal(afterInspectorOpen.workbenchStartsAtWorkspace, true)
      assert.equal(afterInspectorOpen.centerInspectorActive, "true")
      assert.equal(afterInspectorOpen.inspectorButtonActive, "true")
      assert.ok(afterInspectorOpen.leftHandleWidth <= 2)
      assert.equal(afterInspectorOpen.rightPaneResizerExists, false)

      await page.evaluate(() => {
        localStorage.removeItem("oc_sidebar_width")
        localStorage.removeItem("oc_sections_width")
      })
      await page.reload({ waitUntil: "load" })
      await page.waitForSelector("#leftPaneResizer", { visible: true })

      const leftDrag = await page.evaluate(() => {
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const max = document.querySelector<HTMLElement>("#leftPaneResizer")!.getAttribute("aria-valuemax")
        return {
          initialSidebar: sidebar.width,
          centerX: left.left + left.width / 2,
          centerY: left.top + left.height / 2,
          max: max === null ? null : Number(max),
          targetX: 700,
        }
      })
      await page.mouse.move(leftDrag.centerX, leftDrag.centerY)
      await page.mouse.down()
      await page.mouse.move(leftDrag.targetX, leftDrag.centerY, { steps: 10 })
      await page.mouse.up()

      const afterLeftDrag = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const workspace = document.querySelector<HTMLElement>("#workspaceMain")!.getBoundingClientRect()
        const workbench = document.querySelector<HTMLElement>("#centerWorkbench")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const leftResizer = document.querySelector<HTMLElement>("#leftPaneResizer")!
        const toolbar = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!.getBoundingClientRect()
        const max = leftResizer.getAttribute("aria-valuemax")
        const now = leftResizer.getAttribute("aria-valuenow")
        return {
          sidebar: sidebar.width,
          chat: chat.width,
          leftDivider: workspace.left - sidebar.right,
          rightDivider: toolbar.left - workbench.right,
          leftHandleWidth: left.width,
          leftMax: max === null ? null : Number(max),
          leftNow: now === null ? null : Number(now),
          rightPaneResizerExists: !!document.querySelector("#rightPaneResizer"),
        }
      })
      assert.equal(Number.isFinite(leftDrag.max), true)
      assert.equal(Number.isFinite(afterLeftDrag.leftMax), true)
      assert.equal(Number.isFinite(afterLeftDrag.leftNow), true)
      assert.ok(afterLeftDrag.sidebar > leftDrag.initialSidebar + 200)
      assert.ok(afterLeftDrag.sidebar >= afterLeftDrag.leftMax! - 2)
      assert.ok(afterLeftDrag.leftNow! >= afterLeftDrag.leftMax! - 1)
      assert.ok(afterLeftDrag.chat > 300)
      assert.ok(afterLeftDrag.leftDivider <= 2)
      assert.ok(afterLeftDrag.rightDivider <= 2)
      assert.ok(Math.abs(afterLeftDrag.leftDivider - afterLeftDrag.rightDivider) <= 1)
      assert.ok(afterLeftDrag.leftHandleWidth <= 2)
      assert.equal(afterLeftDrag.rightPaneResizerExists, false)
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
