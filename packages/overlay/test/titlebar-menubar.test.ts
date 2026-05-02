import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

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

test("titlebar menubar fits documented responsive widths and locales", async () => {
  let config: Record<string, unknown> = {
    model: "openai/super-long-provider-model-name-for-titlebar-geometry",
  }
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
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    for (const locale of locales) {
      for (const width of viewports) {
        const page = await browser.newPage()
        await page.setViewport({ width, height: 720 })
        await page.evaluateOnNewDocument((value) => {
          localStorage.setItem("oc_locale", value)
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: location.origin,
                    autoServer: false,
                    locale: value,
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
        }, locale)
        await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
        await page.waitForSelector('[data-menu-trigger="workspace"]')
        await page.waitForFunction((value) => document.documentElement.lang === value, {}, locale)
        await page.evaluate(() => {
          const app = window as typeof window & { state?: { serverPid?: number } }
          if (app.state) app.state.serverPid = 12345
        })

        const geometry = await page.evaluate(() => {
          const titlebar = document.querySelector("#titlebar") as HTMLElement | null
          if (!titlebar) throw new Error("Missing titlebar")
          const selectors = [
            ".titlebar-brand",
            '[data-menu-trigger]',
            ".titlebar-status-chip",
            ".titlebar-setup-cta",
            ".titlebar-status-icon",
            ".titlebar-window-controls button",
          ]
          const nodes = selectors.flatMap((selector) =>
            Array.from(document.querySelectorAll<HTMLElement>(selector)),
          ).filter((node) => {
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
              const intersects = a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
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
          return {
            overlaps,
            outOfBounds,
            brandWidth: brand?.width || 0,
            badgeText: badge?.textContent || "",
            badgeTitle: badge?.getAttribute("title") || "",
            titlebarHeight: titlebar.getBoundingClientRect().height,
            triggers,
          }
        })

        expect(geometry.triggers).not.toContain("product")
        expect(geometry.triggers).toContain("workspace")
        expect(geometry.triggers).toContain("model")
        expect(geometry.triggers).toContain("tools")
        expect(geometry.outOfBounds).toEqual([])
        expect(geometry.overlaps).toEqual([])
        expect(geometry.brandWidth).toBeGreaterThan(30)
        expect(geometry.badgeText).not.toContain(`:${server.port}`)
        expect(geometry.badgeTitle).toContain(String(server.port))
        expect(geometry.badgeTitle).toContain("12345")
        expect(geometry.titlebarHeight).toBeGreaterThan(24)
        for (const menu of ["workspace", "model", "run", "tools", "view", "help"]) {
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
          expect(panelBounds.left).toBeGreaterThanOrEqual(0)
          expect(panelBounds.right).toBeLessThanOrEqual(panelBounds.viewportWidth)
          expect(panelBounds.top).toBeGreaterThanOrEqual(0)
          expect(panelBounds.bottom).toBeLessThanOrEqual(panelBounds.viewportHeight)
          expect(panelBounds.width).toBeGreaterThan(120)
          expect(panelBounds.height).toBeGreaterThan(24)
          await page.keyboard.press("Escape")
          await page.waitForFunction(
            (value) => !document.querySelector(`[data-testid="titlebar-menu-${value}"]`),
            {},
            menu,
          )
        }
        await page.click('[data-menu-trigger="help"]')
        await page.waitForSelector('[data-testid="titlebar-connection-diagnostics"]', { visible: true })
        await page.click('[data-testid="titlebar-connection-diagnostics"]')
        await page.waitForFunction(() =>
          (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open === true &&
          document.querySelector('[data-config-panel="about"]')?.classList.contains("active") === true &&
          document.querySelector("#aboutRuntimeGrid")?.textContent?.includes("12345") === true,
        )
        await page.click("#btnCloseConfigDialog")
        await page.waitForFunction(() => (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open !== true)
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
      await page.waitForSelector('[data-testid="titlebar-setup-cta"]', { visible: true })
      const setupBounds = await page.$eval('[data-testid="titlebar-setup-cta"]', (node) => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      })
      expect(setupBounds.left).toBeGreaterThanOrEqual(0)
      expect(setupBounds.right).toBeLessThanOrEqual(width)
      expect(setupBounds.width).toBeGreaterThan(20)
      await page.close()
    }
  } finally {
    await browser.close().catch(() => undefined)
    server.stop(true)
  }
}, { timeout: 120_000 })

test("startup workspace dialog is the default project picker when no directory is set", async () => {
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
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 720 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_locale", "en-US")
      localStorage.removeItem("oc_directory")
      localStorage.setItem("oc_recent_directories", JSON.stringify([
        "D:/work/opencorvus",
        "D:/work/customer-portal",
      ]))
      window.__TAURI__ = {
        core: {
          invoke: async (command: string) => {
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
    await page.waitForSelector('[data-testid="startup-workspace-dialog"]', { visible: true })
    const dialog = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="startup-workspace-dialog"]')
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="startup-recent-project"]'))
      const browse = document.querySelector<HTMLElement>('[data-testid="startup-open-folder"]')
      const create = document.querySelector<HTMLElement>('[data-testid="startup-create-folder"]')
      return {
        title: root?.querySelector("h1")?.textContent || "",
        browseText: browse?.textContent || "",
        hasCreate: !!create,
        recent: buttons.map((node) => node.textContent || ""),
        modal: root?.querySelector("[role='dialog']")?.getAttribute("aria-modal") || "",
      }
    })
    expect(dialog.title).toBe("Choose a project to work in")
    expect(dialog.browseText).toBe("Open Folder")
    expect(dialog.hasCreate).toBe(false)
    expect(dialog.recent.join("\n")).toContain("opencorvus")
    expect(dialog.recent.join("\n")).toContain("customer-portal")
    expect(dialog.modal).toBe("true")
    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
    server.stop(true)
  }
}, { timeout: 60_000 })
