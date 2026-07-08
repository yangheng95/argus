import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertPresent(value: unknown, message?: string) {
  assert.notEqual(value, null, message)
}

function assertAbsent(value: unknown, message?: string) {
  assert.equal(value, null, message)
}

function assertPartialObject(actual: unknown, expected: Record<string, unknown>) {
  assert.ok(actual && typeof actual === "object" && !Array.isArray(actual))
  const record = actual as Record<string, unknown>
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(record[key], value)
  }
}

test(
  "panel header controls keep task panel expanded and right toolbar workbench layout",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const codingCliOpenBodies: Record<string, unknown>[] = []
    const terminalOpenBodies: Record<string, unknown>[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
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
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/terminal/profiles") {
        return send({
          defaultProfileID: "powershell",
          profiles: [
            { id: "powershell", label: "Windows PowerShell", icon: "powershell" },
            { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
          ],
        })
      }
      if (path === "/terminal/open" && req.method === "POST") {
        terminalOpenBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      if (path === "/coding/cli/profiles") {
        return send({
          profiles: [
            { id: "codex", label: "Codex", icon: "codex" },
            { id: "claude-code", label: "Claude Code", icon: "claude-code" },
            { id: "gemini", label: "Gemini", icon: "gemini" },
            { id: "glm", label: "GLM", icon: "glm" },
          ],
        })
      }
      if (path === "/coding/cli/open" && req.method === "POST") {
        codingCliOpenBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      return send({})
    })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  directory: "D:/overlay/workspace/app",
                  directoryMode: "custom",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_open_project_editor") return true
              if (command === "overlay_open_path") return true
              if (command === "overlay_open_url") return true
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                hide: async () => undefined,
                startDragging: async () => undefined,
                minimize: async () => undefined,
              }
            },
          },
        }
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem(
          "oc_recent_directories",
          JSON.stringify([
            "C:/Users/example/workspace/vibecodingclient",
            "C:/Users/example/workspace/demos/invest-replica",
            "C:/Users/example/workspace/Hithink.PrefabLibrary",
          ]),
        )
        localStorage.setItem("oc_server_url", serverUrl)
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      assertAbsent(await page.$("#titlebar .workspace-layout-controls"))
      assertPresent(await page.$(".workspace-command-dock .workspace-layout-controls"))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-terminal-open"]'))
      assertPresent(await page.$('.workspace-command-dock [data-terminal-icon="powershell"] svg'))
      assertAbsent(await page.$(".workspace-command-dock .workspace-coding-cli-launchers"))
      assertAbsent(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-open-default"]'))
      assertAbsent(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-menu"]'))
      assertAbsent(await page.$('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]'))
      assertAbsent(await page.$('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]'))
      assertAbsent(await page.$('.pane-edge-controls [data-ui="workspace-left-panel-toggle"]'))
      assertAbsent(await page.$('.pane-edge-controls [data-ui="workspace-right-panel-toggle"]'))
      assertAbsent(await page.$('[data-ui="sidebar-header-collapse-toggle"]'))
      assertPresent(await page.$("#solidLeftActivityToolbar"))
      assertPresent(await page.$('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]'))
      assertAbsent(await page.$('#solidRightActivityToolbar [data-ui="right-panel-header-collapse-toggle"]'))
      assertPresent(await page.$(".workspace-command-dock .workspace-editor-launchers"))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-editor-open-default"]'))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-editor-menu"]'))
      assertAbsent(await page.$('.workspace-command-dock .oc-button[data-ui="workspace-editor-launcher"]'))
      const editorSelectText = (
        (await page.$eval(
          '.workspace-command-dock [data-ui="workspace-editor-open-default"]',
          (node) => node.textContent,
        )) || ""
      ).trim()
      assert.equal(editorSelectText.includes("Open in IDE"), false)
      const editorSelectWidth = await page.$eval(
        '.workspace-command-dock [data-ui="workspace-editor-open-default"]',
        (node) => Math.round(node.getBoundingClientRect().width),
      )
      assert.ok(editorSelectWidth <= 32)
      const launcherDimensions = await page.evaluate(() => {
        const measure = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) throw new Error(`Missing ${selector}`)
          const rect = node.getBoundingClientRect()
          return { width: Math.round(rect.width), height: Math.round(rect.height) }
        }
        return {
          terminal: measure(".workspace-command-dock .workspace-layout-controls"),
          editor: measure(".workspace-command-dock .workspace-editor-launchers"),
        }
      })
      assert.deepEqual(launcherDimensions.terminal, launcherDimensions.editor)
      const launcherPrimitives = await page.evaluate(() => {
        const selectors = [
          '[data-ui="workspace-terminal-open"]',
          '[data-ui="workspace-terminal-menu"]',
          '[data-ui="workspace-editor-open-default"]',
          '[data-ui="workspace-editor-menu"]',
        ]
        return selectors.map((selector) => {
          const node = document.querySelector<HTMLElement>(`.workspace-command-dock ${selector}`)
          if (!node) throw new Error(`Missing workspace launcher ${selector}`)
          const rect = node.getBoundingClientRect()
          return {
            selector,
            button: node.tagName === "BUTTON",
            primitive: node.classList.contains("oc-button"),
            variant: node.dataset.variant || "",
            size: node.dataset.size || "",
            tone: node.dataset.tone || "",
            chrome: node.dataset.chrome || "",
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        })
      })
      assert.equal(launcherPrimitives.length, 4)
      for (const state of launcherPrimitives) {
        assert.equal(state.button, true, state.selector)
        assert.equal(state.primitive, true, state.selector)
        assert.equal(state.variant, "ghost", state.selector)
        assert.equal(state.size, "icon", state.selector)
        assert.equal(state.tone, "neutral", state.selector)
        assert.match(state.chrome, /^workspace-split-(primary|menu)$/, state.selector)
        assert.ok(state.width > 0, state.selector)
        assert.ok(state.height > 0, state.selector)
      }
      await page.focus('.workspace-command-dock [data-ui="workspace-editor-menu"]')
      const launcherFocus = await page.$eval('.workspace-command-dock [data-ui="workspace-editor-menu"]', (node) => {
        const style = getComputedStyle(node as HTMLElement)
        return {
          focusVisible: (node as HTMLElement).matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        }
      })
      assert.equal(launcherFocus.focusVisible, true)
      assert.notEqual(launcherFocus.outlineStyle, "none")
      assert.notEqual(launcherFocus.outlineWidth, "0px")
      mkdirSync(resolve(".scratch"), { recursive: true })
      const launcherClip = await page.$eval(".workspace-command-dock", (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return {
          x: Math.max(0, rect.x - 8),
          y: Math.max(0, rect.y - 8),
          width: rect.width + 16,
          height: rect.height + 16,
        }
      })
      const launcherScreenshot = await page.screenshot({ clip: launcherClip })
      assert.ok(launcherScreenshot.length > 0)
      writeFileSync(resolve(".scratch/workspace-split-launcher-button-primitive.png"), launcherScreenshot)
      assertPresent(await page.$('.workspace-editor-select-icon[data-editor="vscode"] svg'))
      await page.click('.workspace-command-dock [data-ui="workspace-terminal-open"]')
      for (let i = 0; i < 40 && terminalOpenBodies.length === 0; i++) {
        await sleep(50)
      }
      assert.equal(terminalOpenBodies.length, 1)
      assertPartialObject(terminalOpenBodies[0], {
        cwd: "D:/overlay/workspace/app",
        profileID: "powershell",
      })
      assertAbsent(await page.$(".workspace-terminal"))
      await page.evaluate(() => {
        for (const closeButton of document.querySelectorAll<HTMLButtonElement>('[data-ui="app-notification-close"]')) {
          closeButton.click()
        }
      })
      await page.click('.workspace-command-dock [data-ui="workspace-editor-menu"]')
      const editorMenuState = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('.workspace-command-dock [data-ui="workspace-editor-menu"]')
        const menu = document.querySelector<HTMLElement>(".workspace-editor-menu")
        if (!button || !menu) throw new Error("Missing workspace editor dropdown")
        const buttonRect = button.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        return {
          expanded: button.getAttribute("aria-expanded"),
          dataExpanded: button.hasAttribute("data-expanded"),
          dataOpen: button.getAttribute("data-open"),
          hidden: menu.hidden,
          portaled: !menu.closest(".workspace-command-dock"),
          topBelowButton: Math.round(menuRect.top) >= Math.round(buttonRect.bottom),
          rightAligned: Math.abs(Math.round(menuRect.right) - Math.round(buttonRect.right)) <= 1,
        }
      })
      assert.equal(editorMenuState.expanded, "true")
      assert.equal(editorMenuState.dataExpanded, true)
      assert.equal(editorMenuState.dataOpen, null)
      assert.equal(editorMenuState.hidden, false)
      assert.equal(editorMenuState.portaled, true)
      assert.equal(editorMenuState.topBelowButton, true)
      assert.equal(editorMenuState.rightAligned, true)
      const editorOpenElement = await page.$(".workspace-editor-menu")
      assert.ok(editorOpenElement)
      const editorOpenScreenshot = await editorOpenElement.screenshot({})
      assert.ok(editorOpenScreenshot.length > 0)
      writeFileSync(resolve(".scratch/workspace-split-launcher-expanded-state.png"), editorOpenScreenshot)
      await page.keyboard.press("ArrowDown")
      await page.waitForFunction(() => document.activeElement?.classList.contains("workspace-editor-option"))
      const editorMenuFocus = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        if (!active) throw new Error("Missing focused workspace editor option")
        const style = getComputedStyle(active)
        return {
          className: active.className,
          focusVisible: active.matches(":focus-visible"),
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
          background: style.backgroundColor,
        }
      })
      assert.match(editorMenuFocus.className, /\bworkspace-editor-option\b/)
      assert.equal(editorMenuFocus.focusVisible, true)
      assert.notEqual(editorMenuFocus.boxShadow, "none")
      assert.notEqual(editorMenuFocus.background, "rgba(0, 0, 0, 0)")
      const editorFocusClip = await page.$eval(".workspace-editor-menu", (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return {
          x: Math.max(0, rect.x - 8),
          y: Math.max(0, rect.y - 8),
          width: rect.width + 16,
          height: rect.height + 16,
        }
      })
      writeFileSync(
        resolve(".scratch/workspace-split-launcher-menu-item-focus.png"),
        await page.screenshot({ clip: editorFocusClip }),
      )
      const editorIconSizes = await page.evaluate(() => {
        const entries = Array.from(document.querySelectorAll<HTMLElement>(".workspace-editor-option")).map((option) => {
          const editor = option.dataset.editor || ""
          const svg = option.querySelector<SVGElement>("svg")
          if (!editor || !svg) throw new Error("Missing editor option icon")
          const rect = svg.getBoundingClientRect()
          return [editor, Math.round(rect.width)] as const
        })
        return Object.fromEntries(entries)
      })
      assert.ok(editorIconSizes.vscode >= 18)
      assert.ok(editorIconSizes.pycharm >= editorIconSizes.vscode)
      assert.ok(editorIconSizes.webstorm >= editorIconSizes.vscode)
      assert.ok(editorIconSizes.intellij >= editorIconSizes.vscode)
      assert.ok(editorIconSizes.cursor >= editorIconSizes.vscode)
      assertAbsent(await page.$("#taskDir [data-path-editor]"))
      assertPresent(await page.$('[data-editor="pycharm"] svg'))
      assert.ok(
        ((await page.$eval('[data-editor="pycharm"]', (node) => node.textContent)) || "").trim().includes("PyCharm"),
      )
      await page.keyboard.press("Escape")

      assert.equal(codingCliOpenBodies.length, 0)

      await page.click(".workspace-command-dock [data-ui='workspace-terminal-menu']")
      await page.click('[data-terminal-profile="cmd"]')
      for (let i = 0; i < 40 && terminalOpenBodies.length < 2; i++) {
        await sleep(50)
      }
      assert.equal(terminalOpenBodies.length, 2)
      assertPartialObject(terminalOpenBodies[1], {
        cwd: "D:/overlay/workspace/app",
        profileID: "cmd",
      })

      assert.equal(await page.$(".workspace-coding-cli-menu"), null)
      assert.equal(await page.$("[data-coding-cli]"), null)

      await page.click('[data-menu-trigger="workspace"]')
      await page.waitForSelector(".titlebar-menubar-recent-item")
      const projectMenu = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('[data-testid="titlebar-menu-workspace"]')
        if (!panel) throw new Error("Missing Project menu panel")
        const rows = Array.from(panel.querySelectorAll<HTMLElement>(".titlebar-menubar-recent-item")).map((item) => {
          const name = item.querySelector<HTMLElement>(".titlebar-menubar-recent-name")
          const path = item.querySelector<HTMLElement>(".titlebar-menubar-recent-path")
          if (!name || !path) throw new Error("Missing recent row columns")
          return {
            nameLeft: Math.round(name.getBoundingClientRect().left),
            pathLeft: Math.round(path.getBoundingClientRect().left),
            pathAlign: getComputedStyle(path).textAlign,
            pathText: path.textContent || "",
          }
        })
        return {
          text: panel.textContent || "",
          rows,
        }
      })
      assert.equal(projectMenu.text.includes("PyCharm"), false)
      assert.equal(projectMenu.text.includes("WebStorm"), false)
      assert.equal(projectMenu.rows.length, 3)
      assert.equal(new Set(projectMenu.rows.map((row) => row.pathLeft)).size, 1)
      assert.equal(
        projectMenu.rows.every((row) => row.pathAlign === "left" || row.pathAlign === "start"),
        true,
      )
      assert.equal(
        projectMenu.rows.every((row) => row.pathText.startsWith("C:/Users/example/workspace")),
        true,
      )
      await page.keyboard.press("Escape")

      const toolbarPlacement = await page.evaluate(() => {
        const rightButton = document.querySelector<HTMLElement>(
          '[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]',
        )!
        const right = rightButton.getBoundingClientRect()
        return {
          rightInsideActivityToolbar: Boolean(rightButton.closest("#solidRightActivityToolbar")),
          rightHeight: Math.round(right.height),
          rightWidth: Math.round(right.width),
        }
      })
      assert.equal(toolbarPlacement.rightInsideActivityToolbar, true)
      assert.ok(toolbarPlacement.rightWidth <= 40)
      assert.ok(toolbarPlacement.rightHeight <= 40)

      assertAbsent(await page.$("#rightPaneResizer"))
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]')

      const requirementsWorkbench = await page.evaluate(() => {
        const measure = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) throw new Error(`Missing ${selector}`)
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          return {
            hidden: node.hidden,
            display: style.display,
            width: rect.width,
            height: rect.height,
            disabled: node.dataset.disabled || "",
          }
        }
        const exists = (selector: string) => document.querySelector(selector) != null
        const workspace = document.querySelector<HTMLElement>("#conversationWorkspace")!.getBoundingClientRect()
        const workbench = document.querySelector<HTMLElement>("#centerWorkbench")!.getBoundingClientRect()
        return {
          sidebar: measure("#sidebar"),
          leftResizer: measure("#leftPaneResizer"),
          chat: measure("#chatSection"),
          requirements: measure("#centerWorkbenchRequirements"),
          centerRequirementsActive:
            document.querySelector<HTMLElement>("#centerWorkbenchRequirements")?.dataset.active || "",
          requirementsButtonActive:
            document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]',
            )?.dataset.active || "",
          workbenchStartsAtWorkspace: Math.abs(workbench.left - workspace.left) <= 1,
          sidebarContentVisible:
            getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
          requirementsContentVisible:
            getComputedStyle(document.querySelector<HTMLElement>("#centerWorkbenchRequirements .task-scope-panel")!)
              .display !== "none",
          dockLeftControlExists: exists('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]'),
          dockRightControlExists: exists('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]'),
        }
      })

      assert.equal(requirementsWorkbench.sidebar.hidden, false)
      assert.equal(requirementsWorkbench.sidebar.display, "flex")
      assert.equal(requirementsWorkbench.leftResizer.hidden, false)
      assert.equal(requirementsWorkbench.leftResizer.disabled, "false")
      assert.equal(requirementsWorkbench.requirements.hidden, false)
      assert.equal(requirementsWorkbench.requirements.display, "flex")
      assert.ok(requirementsWorkbench.requirements.width > 300)
      assert.equal(requirementsWorkbench.centerRequirementsActive, "true")
      assert.equal(requirementsWorkbench.requirementsButtonActive, "true")
      assert.equal(requirementsWorkbench.workbenchStartsAtWorkspace, true)
      assert.equal(requirementsWorkbench.sidebarContentVisible, true)
      assert.equal(requirementsWorkbench.requirementsContentVisible, true)
      assert.equal(requirementsWorkbench.dockLeftControlExists, false)
      assert.equal(requirementsWorkbench.dockRightControlExists, false)
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
