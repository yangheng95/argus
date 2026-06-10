import assert from "node:assert/strict"
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
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
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
            "C:/Users/chuan/myhexin-local/vibecodingclient",
            "C:/Users/chuan/myhexin-local/demos/invest复刻",
            "C:/Users/chuan/myhexin-local/Hithink.PrefabLibrary",
          ]),
        )
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_right_panel_collapsed", "false")
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      assertAbsent(await page.$("#titlebar .workspace-layout-controls"))
      assertPresent(await page.$(".workspace-command-dock .workspace-layout-controls"))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-terminal-open"]'))
      assertPresent(await page.$('.workspace-command-dock [data-terminal-icon="powershell"] svg'))
      assertPresent(await page.$(".workspace-command-dock .workspace-coding-cli-launchers"))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-open-default"]'))
      assertPresent(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-menu"]'))
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '.workspace-command-dock [data-ui="workspace-coding-cli-open-default"]',
        )
        return !!button && !button.disabled
      })
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
          codingCli: measure(".workspace-command-dock .workspace-coding-cli-launchers"),
        }
      })
      assert.deepEqual(launcherDimensions.terminal, launcherDimensions.editor)
      assert.deepEqual(launcherDimensions.terminal, launcherDimensions.codingCli)
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
      await page.click('.workspace-command-dock [data-ui="workspace-editor-menu"]')
      const editorMenuState = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('.workspace-command-dock [data-ui="workspace-editor-menu"]')
        const menu = document.querySelector<HTMLElement>(".workspace-editor-menu")
        if (!button || !menu) throw new Error("Missing workspace editor dropdown")
        const buttonRect = button.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        return {
          expanded: button.getAttribute("aria-expanded"),
          hidden: menu.hidden,
          portaled: !menu.closest(".workspace-command-dock"),
          topBelowButton: Math.round(menuRect.top) >= Math.round(buttonRect.bottom),
          rightAligned: Math.abs(Math.round(menuRect.right) - Math.round(buttonRect.right)) <= 1,
        }
      })
      assert.equal(editorMenuState.expanded, "true")
      assert.equal(editorMenuState.hidden, false)
      assert.equal(editorMenuState.portaled, true)
      assert.equal(editorMenuState.topBelowButton, true)
      assert.equal(editorMenuState.rightAligned, true)
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
        (((await page.$eval('[data-editor="pycharm"]', (node) => node.textContent)) || "").trim()).includes("PyCharm"),
      )
      await page.keyboard.press("Escape")

      await page.click('[data-ui="workspace-coding-cli-open-default"]')
      for (let i = 0; i < 40 && codingCliOpenBodies.length === 0; i++) {
        await sleep(50)
      }
      assert.equal(codingCliOpenBodies.length, 1)
      assertPartialObject(codingCliOpenBodies[0], {
        cliID: "codex",
        terminalProfileID: "powershell",
        cwd: "D:/overlay/workspace/app",
      })

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

      await page.click(".workspace-command-dock [data-ui='workspace-coding-cli-menu']")
      const cliMenuState = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>(
          ".workspace-command-dock [data-ui='workspace-coding-cli-menu']",
        )
        const menu = document.querySelector<HTMLElement>(".workspace-coding-cli-menu")
        if (!button || !menu) throw new Error("Missing coding CLI dropdown")
        const buttonRect = button.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        return {
          expanded: button.getAttribute("aria-expanded"),
          hidden: menu.hidden,
          portaled: !menu.closest(".workspace-command-dock"),
          topBelowButton: Math.round(menuRect.top) >= Math.round(buttonRect.bottom),
          rightAligned: Math.abs(Math.round(menuRect.right) - Math.round(buttonRect.right)) <= 1,
        }
      })
      assert.equal(cliMenuState.expanded, "true")
      assert.equal(cliMenuState.hidden, false)
      assert.equal(cliMenuState.portaled, true)
      assert.equal(cliMenuState.topBelowButton, true)
      assert.equal(cliMenuState.rightAligned, true)
      assertPresent(await page.$('[data-coding-cli="codex"] svg'))
      await page.click('[data-coding-cli="claude-code"]')
      for (let i = 0; i < 40 && codingCliOpenBodies.length < 2; i++) {
        await sleep(50)
      }
      assert.equal(codingCliOpenBodies.length, 2)
      assertPartialObject(codingCliOpenBodies[1], {
        cliID: "claude-code",
        terminalProfileID: "cmd",
        cwd: "D:/overlay/workspace/app",
      })

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
      assert.equal(projectMenu.rows.every((row) => row.pathAlign === "left" || row.pathAlign === "start"), true)
      assert.equal(projectMenu.rows.every((row) => row.pathText.startsWith("C:/Users/chuan/myhexin-local")), true)
      await page.keyboard.press("Escape")

      const toolbarPlacement = await page.evaluate(() => {
        const rightButton = document.querySelector<HTMLElement>(
          '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
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
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')

      const inspectorWorkbench = await page.evaluate(() => {
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
          sections: measure("#sections"),
          centerInspectorActive: document.querySelector<HTMLElement>("#centerWorkbenchInspector")?.dataset.active || "",
          inspectorButtonActive:
            document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
            )?.dataset.active || "",
          workbenchStartsAtWorkspace: Math.abs(workbench.left - workspace.left) <= 1,
          sidebarContentVisible:
            getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
          sectionsContentVisible:
            getComputedStyle(document.querySelector<HTMLElement>("#sections .side-panel-content")!).display !== "none",
          dockLeftControlExists: exists('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]'),
          dockRightControlExists: exists('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]'),
        }
      })

      assert.equal(inspectorWorkbench.sidebar.hidden, false)
      assert.equal(inspectorWorkbench.sidebar.display, "flex")
      assert.equal(inspectorWorkbench.leftResizer.hidden, false)
      assert.equal(inspectorWorkbench.leftResizer.disabled, "false")
      assert.equal(inspectorWorkbench.sections.hidden, false)
      assert.equal(inspectorWorkbench.sections.display, "flex")
      assert.ok(inspectorWorkbench.sections.width > 300)
      assert.ok(Math.abs(inspectorWorkbench.sections.width - inspectorWorkbench.chat.width) <= 2)
      assert.equal(inspectorWorkbench.centerInspectorActive, "true")
      assert.equal(inspectorWorkbench.inspectorButtonActive, "true")
      assert.equal(inspectorWorkbench.workbenchStartsAtWorkspace, true)
      assert.equal(inspectorWorkbench.sidebarContentVisible, true)
      assert.equal(inspectorWorkbench.sectionsContentVisible, true)
      assert.equal(inspectorWorkbench.dockLeftControlExists, false)
      assert.equal(inspectorWorkbench.dockRightControlExists, false)
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
