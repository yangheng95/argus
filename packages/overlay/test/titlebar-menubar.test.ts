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

test(
  "titlebar menubar fits documented responsive widths and locales",
  async () => {
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
                      autoServer: true,
                      locale: value,
                      directory: "D:/overlay/workspace/app",
                    }
                  }
                  if (command === "overlay_server_info") {
                    return { url: location.origin, pid: 12345 }
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
          expect(workspaceMenu).toEqual({
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
              ".titlebar-status-chip",
              ".titlebar-setup-cta",
              '[data-ui="titlebar-status-icon"]',
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
          expect(geometry.triggers).not.toContain("model")
          expect(geometry.triggers).not.toContain("agent")
          expect(geometry.triggers).toContain("provider")
          expect(geometry.triggers).toContain("tools")
          expect(geometry.triggers).toContain("skill")
          expect(geometry.triggers).toContain("mcp")
          expect(geometry.triggers).toContain("memory")
          expect(geometry.triggers).toContain("settings")
          expect(geometry.outOfBounds).toEqual([])
          expect(geometry.overlaps).toEqual([])
          expect(geometry.brandWidth).toBeGreaterThan(24)
          expect(geometry.badgeText).not.toContain(`:${server.port}`)
          expect(geometry.badgeTitle).toContain(String(server.port))
          expect(geometry.badgeTitle).toContain("12345")
          expect(geometry.titlebarHeight).toBeGreaterThan(24)
          for (const menu of ["workspace", "provider", "run", "tools", "skill", "mcp", "memory", "settings", "view", "help"]) {
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
          await page.waitForFunction(
            () =>
              (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open === true &&
              document.querySelector('[data-config-panel="about"]')?.classList.contains("active") === true &&
              document.querySelector("#aboutRuntimeGrid")?.textContent?.includes("12345") === true,
          )
          await page.click("#btnCloseConfigDialog")
          await page.waitForFunction(
            () => (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open !== true,
          )
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
        const setupCount = await page.$$eval('[data-testid="titlebar-setup-cta"]', (nodes) => nodes.length)
        expect(setupCount).toBe(0)
        const workspaceBounds = await page.$eval('[data-menu-trigger="workspace"]', (node) => {
          const rect = node.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width }
        })
        expect(workspaceBounds.left).toBeGreaterThanOrEqual(0)
        expect(workspaceBounds.right).toBeLessThanOrEqual(width)
        expect(workspaceBounds.width).toBeGreaterThan(16)
        await page.close()
      }
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 120_000 },
)

test(
  "titlebar menubar uses theme-adaptive text color and supports Alt access keys",
  async () => {
    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
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
      },
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
      expect(await page.evaluate(() => localStorage.getItem("oc_theme"))).toBe("vscode-dark")

      const shellBackgrounds = await page.evaluate(() => {
        const sidebar = getComputedStyle(document.querySelector<HTMLElement>(".sidebar")!).backgroundColor
        const sections = getComputedStyle(document.querySelector<HTMLElement>(".sections")!).backgroundColor
        const panelBody = getComputedStyle(document.querySelector<HTMLElement>("#panelBody")!).backgroundColor
        return { sidebar, sections, panelBody }
      })
      expect(shellBackgrounds.sidebar).not.toBe("rgba(0, 0, 0, 0)")
      expect(shellBackgrounds.sections).not.toBe("rgba(0, 0, 0, 0)")
      expect(shellBackgrounds.panelBody).not.toBe("rgba(0, 0, 0, 0)")

      const vscodeDarkTriggerState = await page.$eval('[data-menu-trigger="workspace"]', (node) => {
        const el = node as HTMLElement
        return {
          color: getComputedStyle(el).color,
          accessKey: el.dataset.accessKey,
          ariaKeyshortcuts: el.getAttribute("aria-keyshortcuts"),
        }
      })
      expect(vscodeDarkTriggerState).toEqual({
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
      expect(darkTriggerColor).toBe("rgb(232, 236, 241)")

      await page.keyboard.down("Alt")
      await page.keyboard.up("Alt")
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.dataset.menuTrigger === "workspace",
      )

      await page.keyboard.down("Alt")
      await page.keyboard.press("v")
      await page.keyboard.up("Alt")
      await page.waitForSelector('[data-testid="titlebar-menu-view"]', { visible: true })
      expect(await page.$('[data-testid="titlebar-theme-vscode-dark"]')).not.toBeNull()
      const altOpenState = await page.evaluate(() => ({
        expanded: document.querySelector('[data-menu-trigger="view"]')?.getAttribute("aria-expanded"),
        focusedMenuText: (document.activeElement as HTMLElement | null)?.textContent?.trim() || "",
      }))
      expect(altOpenState.expanded).toBe("true")
      expect(altOpenState.focusedMenuText).toContain("Language")

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 120_000 },
)

test(
  "workspace intro owns first-run directory setup when no directory is set",
  async () => {
    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
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
      },
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
        const createProject = document.querySelector<HTMLElement>('[data-testid="workspace-onboarding-create-project"]')
        const title = document.querySelector<HTMLElement>(".workspace-onboarding-titleblock")
        const brandWordmark = document.querySelector<HTMLElement>(".brand-guide-wordmark")
        const brandLabel = document.querySelector<HTMLElement>(".brand-guide-label")
        const sections = document.querySelector<HTMLElement>(".sections-title")
        const startupInvokes = ((window as any).__startupInvokes || []) as string[]
        return {
          hasStartup: !!dialog,
          openFolderText: openFolder?.textContent || "",
          createProjectText: createProject?.textContent || "",
          title: title?.textContent || "",
          brandWordmark: brandWordmark?.textContent || "",
          brandLabel: brandLabel?.textContent || "",
          sections: sections?.textContent || "",
          pickDirInvokes: startupInvokes.filter((value) => value === "overlay_pick_dir").length,
        }
      })
      expect(intro.hasStartup).toBe(true)
      expect(intro.pickDirInvokes).toBe(0)
      expect(intro.openFolderText).toContain("Open Local Directory")
      expect(intro.createProjectText).toContain("Create New Project")
      expect(intro.title).toContain("Open a project directory")
      expect(intro.brandWordmark).toBe("OpenCorvus")
      expect(intro.brandLabel).toBe("Workspace")
      expect(intro.sections).toBe("Inspector")
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 60_000 },
)

test(
  "project menu close clears the current project and opens onboarding",
  async () => {
    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
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
      },
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
          selectedTaskID: (window as any).boardStore.selectedTaskID,
          tasks: (window as any).boardStore.tasks.length,
          pendingTasks: (window as any).boardStore.pendingTasks.length,
          path: (window as any).boardStore.path,
          vcs: (window as any).boardStore.vcs,
          config: (window as any).appStore?.config ?? null,
          recent: document.querySelector('[data-testid="workspace-onboarding-recent-0"]')?.textContent || "",
          persistedDirectory: latest.directory,
        }
      })

      expect(state.directory).toBe("")
      expect(state.savedDirectory).toBe("")
      expect(state.selectedTaskID).toBe("")
      expect(state.tasks).toBe(0)
      expect(state.pendingTasks).toBe(0)
      expect(state.path).toBeNull()
      expect(state.vcs).toBeNull()
      expect(state.config).toBeNull()
      expect(state.recent).toContain("D:/overlay/workspace/app")
      expect(state.persistedDirectory).toBeUndefined()
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 60_000 },
)

test(
  "column resizers allow broad widths without wide visual dividers",
  async () => {
    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
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
      },
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
      await page.waitForSelector("#rightPaneResizer", { visible: true })

      const initial = await page.evaluate(() => {
        const panelBody = document.querySelector<HTMLElement>("#panelBody")!
        const workspaceMain = document.querySelector<HTMLElement>("#workspaceMain")!
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const sections = document.querySelector<HTMLElement>(".sections")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const right = document.querySelector<HTMLElement>("#rightPaneResizer")!.getBoundingClientRect()
        const panelStyle = getComputedStyle(panelBody)
        const workspaceStyle = getComputedStyle(workspaceMain)
        return {
          panelGap: panelStyle.gap,
          panelPaddingTop: panelStyle.paddingTop,
          panelPaddingRight: panelStyle.paddingRight,
          panelPaddingBottom: panelStyle.paddingBottom,
          panelPaddingLeft: panelStyle.paddingLeft,
          workspaceGap: workspaceStyle.gap,
          leftDivider: chat.left - sidebar.right,
          rightDivider: sections.left - chat.right,
          leftHandleWidth: left.width,
          rightHandleWidth: right.width,
          leftCenterX: left.left + left.width / 2,
          leftCenterY: left.top + left.height / 2,
          rightCenterX: right.left + right.width / 2,
          rightCenterY: right.top + right.height / 2,
        }
      })
      expect(initial.panelGap).toBe("0px")
      expect(initial.panelPaddingTop).toBe("0px")
      expect(initial.panelPaddingRight).toBe("0px")
      expect(initial.panelPaddingBottom).toBe("0px")
      expect(initial.panelPaddingLeft).toBe("0px")
      expect(initial.workspaceGap).toBe("0px")
      expect(initial.leftDivider).toBeLessThanOrEqual(2)
      expect(initial.rightDivider).toBeLessThanOrEqual(2)
      expect(Math.abs(initial.leftDivider - initial.rightDivider)).toBeLessThanOrEqual(1)
      expect(initial.leftHandleWidth).toBeLessThanOrEqual(2)
      expect(initial.rightHandleWidth).toBeLessThanOrEqual(2)

      const controlsWithMargins = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          '[data-ui="sidebar-new-task-button"]',
          ".task-dir-shell",
          ".task-cwd-dropdown",
          ".btn.mini",
          '[data-ui="executor-chip"]',
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
      expect(controlsWithMargins).toEqual([])

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
          { selector: '[data-ui="sidebar-new-task-button"]', props: ["columnGap", "paddingLeft", "paddingRight"], max: 11 },
          { selector: ".task-dir-shell", props: ["columnGap", "paddingLeft", "paddingRight"], max: 4 },
          { selector: ".task-cwd-dropdown", props: ["columnGap", "paddingLeft", "paddingRight"], max: 8 },
          { selector: ".btn.mini", props: ["paddingLeft", "paddingRight"], max: 8 },
          { selector: '[data-ui="executor-chip"]', props: ["columnGap", "paddingLeft", "paddingRight"], max: 9 },
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
      expect(looseControlSpacing).toEqual([])

      const controlsWithBorders = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          '[data-ui="sidebar-new-task-button"]',
          ".btn.mini",
          '[data-ui="right-tabs"]',
          '[data-ui="right-tab"]',
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
      expect(controlsWithBorders).toEqual([])

      const looseRightPanelSpacing = await page.evaluate(() => {
        const checks = [
          { selector: ".sections-header", props: ["height", "paddingLeft", "paddingRight"], max: 42 },
          {
            selector: ".sections-stack",
            props: ["rowGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 7,
          },
          {
            selector: '[data-ui="right-tabs"]',
            props: ["columnGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            max: 3,
          },
          { selector: '[data-ui="right-tab"]', props: ["height", "paddingLeft", "paddingRight"], max: 24 },
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
            selector: ".delivery-panel",
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
      expect(looseRightPanelSpacing).toEqual([])

      const rightPanelDecorativeBorders = await page.evaluate(() => {
        const selectors = [
          ".sections",
          ".sections-header",
          '[data-ui="right-tabs"]',
          '[data-ui="right-tab"]',
          ".board-intro",
          ".board-intro__section",
          ".board-intro__mode",
          ".board-intro__agent",
          ".section",
          ".section-head",
          ".section-body > .empty-hint",
          ".delivery-panel",
          ".criteria-group",
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
      expect(rightPanelDecorativeBorders).toEqual([])

      const nonPrimaryControlsWithBackgrounds = await page.evaluate(() => {
        const selectors = [
          ".brand-guide",
          '[data-ui="titlebar-menubar-trigger"]',
          ".titlebar-btn",
          ".btn.mini",
          '[data-ui="right-tabs"]',
          '[data-ui="right-tab"]',
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
      expect(nonPrimaryControlsWithBackgrounds).toEqual([])

      const rightDrag = await page.evaluate(() => {
        const right = document.querySelector<HTMLElement>("#rightPaneResizer")!.getBoundingClientRect()
        const workspace = document.querySelector<HTMLElement>("#workspaceMain")!.getBoundingClientRect()
        return {
          centerX: right.left + right.width / 2,
          centerY: right.top + right.height / 2,
          targetX: workspace.right - 620,
        }
      })
      await page.mouse.move(rightDrag.centerX, rightDrag.centerY)
      await page.mouse.down()
      await page.mouse.move(rightDrag.targetX, rightDrag.centerY, { steps: 10 })
      await page.mouse.up()

      const afterRightDrag = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const sections = document.querySelector<HTMLElement>(".sections")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const right = document.querySelector<HTMLElement>("#rightPaneResizer")!.getBoundingClientRect()
        return {
          sidebar: sidebar.width,
          chat: chat.width,
          sections: sections.width,
          leftDivider: chat.left - sidebar.right,
          rightDivider: sections.left - chat.right,
          leftHandleWidth: left.width,
          rightHandleWidth: right.width,
        }
      })

      expect(afterRightDrag.sections).toBeGreaterThan(560)
      expect(afterRightDrag.chat).toBeGreaterThan(300)
      expect(afterRightDrag.leftDivider).toBeLessThanOrEqual(2)
      expect(afterRightDrag.rightDivider).toBeLessThanOrEqual(2)
      expect(Math.abs(afterRightDrag.leftDivider - afterRightDrag.rightDivider)).toBeLessThanOrEqual(1)
      expect(afterRightDrag.leftHandleWidth).toBeLessThanOrEqual(2)
      expect(afterRightDrag.rightHandleWidth).toBeLessThanOrEqual(2)

      await page.evaluate(() => {
        localStorage.removeItem("oc_sidebar_width")
        localStorage.removeItem("oc_sections_width")
      })
      await page.reload({ waitUntil: "load" })
      await page.waitForSelector("#leftPaneResizer", { visible: true })

      const leftDrag = await page.evaluate(() => {
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        return {
          centerX: left.left + left.width / 2,
          centerY: left.top + left.height / 2,
          targetX: 700,
        }
      })
      await page.mouse.move(leftDrag.centerX, leftDrag.centerY)
      await page.mouse.down()
      await page.mouse.move(leftDrag.targetX, leftDrag.centerY, { steps: 10 })
      await page.mouse.up()

      const afterLeftDrag = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect()
        const chat = document.querySelector<HTMLElement>(".chat")!.getBoundingClientRect()
        const sections = document.querySelector<HTMLElement>(".sections")!.getBoundingClientRect()
        const left = document.querySelector<HTMLElement>("#leftPaneResizer")!.getBoundingClientRect()
        const right = document.querySelector<HTMLElement>("#rightPaneResizer")!.getBoundingClientRect()
        return {
          sidebar: sidebar.width,
          chat: chat.width,
          leftDivider: chat.left - sidebar.right,
          rightDivider: sections.left - chat.right,
          leftHandleWidth: left.width,
          rightHandleWidth: right.width,
        }
      })
      expect(afterLeftDrag.sidebar).toBeGreaterThan(600)
      expect(afterLeftDrag.chat).toBeGreaterThan(300)
      expect(afterLeftDrag.leftDivider).toBeLessThanOrEqual(2)
      expect(afterLeftDrag.rightDivider).toBeLessThanOrEqual(2)
      expect(Math.abs(afterLeftDrag.leftDivider - afterLeftDrag.rightDivider)).toBeLessThanOrEqual(1)
      expect(afterLeftDrag.leftHandleWidth).toBeLessThanOrEqual(2)
      expect(afterLeftDrag.rightHandleWidth).toBeLessThanOrEqual(2)
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 60_000 },
)
