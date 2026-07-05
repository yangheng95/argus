import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"

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

function eventStream() {
  return new Response("", {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

function expertSquadCatalog() {
  return expertSquadCatalogFixture({
    active: "frontend-replica",
    projectActive: "frontend-replica",
    profiles: [
      {
        id: "general",
        label: "General",
        description: "General expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Expert Squad",
        description: "Default expert squad.",
        built_in: false,
      },
    ],
  })
}

async function waitFor<T>(read: () => T | null | Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

test(
  "workspace command dock opens coding CLI and terminal launchers",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const openBodies: Record<string, unknown>[] = []
    const codingOpenBodies: Record<string, unknown>[] = []
    const profileRequestDirectories: string[] = []

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
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
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/task/events") return eventStream()
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog())
      if (path === "/config") return send({ model: "" })
      if (path === "/mission") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/coding/cli/profiles") {
        profileRequestDirectories.push(url.searchParams.get("directory") || "")
        return send({
          profiles: [
            { id: "claude-code", label: "Claude Code", icon: "claude-code" },
            { id: "codex", label: "Codex CLI", icon: "codex" },
          ],
        })
      }
      if (path === "/terminal/profiles") {
        profileRequestDirectories.push(url.searchParams.get("directory") || "")
        return send({
          defaultProfileID: "default",
          profiles: [
            { id: "default", label: "PowerShell", icon: "powershell" },
            { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
          ],
        })
      }
      if (path === "/terminal/open" && req.method === "POST") {
        openBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      if (path === "/coding/cli/open" && req.method === "POST") {
        codingOpenBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      return send({})
    })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", serverUrl)
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="workspace-terminal-open"]')
      await page.waitForSelector('[data-ui="workspace-coding-cli-open-default"]')
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-terminal-open"]')
        return !!button && !button.disabled
      })
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-coding-cli-open-default"]')
        return !!button && !button.disabled
      })

      const screenshotPath = path.resolve(".scratch", "workspace-command-dock-launchers.png")
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
      const commandDock = await page.$(".workspace-command-dock")
      assert.notEqual(commandDock, null)
      await commandDock.screenshot({ path: screenshotPath })

      const initialPanelState = await page.evaluate(() => ({
        diffViewActive: document.querySelector<HTMLElement>("#centerWorkbenchDiff")?.dataset.active ?? "missing",
        centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open ?? "missing",
        terminalPresent: !!document.querySelector(".workspace-terminal"),
      }))
      const removedTogglePresent = await page.$("#btnWorkspaceToggle")
      assert.equal(removedTogglePresent, null)

      await page.click('[data-ui="workspace-terminal-menu"]')
      await page.waitForSelector('[data-terminal-profile="default"]')
      await page.waitForSelector('[data-terminal-profile="cmd"]')
      await page.keyboard.press("Escape")
      await page.click('[data-ui="workspace-coding-cli-menu"]')
      await page.waitForSelector('[data-coding-cli="claude-code"]')
      await page.waitForSelector('[data-coding-cli="codex"]')
      await page.keyboard.press("Escape")
      await page.click('[data-ui="workspace-coding-cli-open-default"]')
      const codingBody = await waitFor(() => codingOpenBodies[0] ?? null, "coding CLI open request")

      assert.equal(codingBody.cwd, "D:/overlay/workspace/app")
      assert.equal(codingBody.cliID, "claude-code")
      assert.equal(codingBody.terminalProfileID, "default")

      await page.click('[data-ui="workspace-terminal-open"]')
      const body = await waitFor(() => openBodies[0] ?? null, "terminal open request")

      assert.equal(body.cwd, "D:/overlay/workspace/app")
      assert.equal(body.profileID, "default")

      await page.click('[data-ui="workspace-terminal-menu"]')
      await page.click('[data-terminal-profile="cmd"]')
      const selectedBody = await waitFor(() => openBodies[1] ?? null, "selected terminal open request")

      assert.equal(selectedBody.cwd, "D:/overlay/workspace/app")
      assert.equal(selectedBody.profileID, "cmd")

      const panelState = await page.evaluate(() => ({
        diffViewActive: document.querySelector<HTMLElement>("#centerWorkbenchDiff")?.dataset.active ?? "missing",
        centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open ?? "missing",
        terminalPresent: !!document.querySelector(".workspace-terminal"),
      }))

      assert.equal(panelState.diffViewActive, initialPanelState.diffViewActive)
      assert.equal(panelState.centerOpen, initialPanelState.centerOpen)
      assert.equal(initialPanelState.terminalPresent, false)
      assert.equal(panelState.terminalPresent, false)
      assert.ok(profileRequestDirectories.length > 0)
      assert.equal(
        profileRequestDirectories.every((directory) => directory === "D:/overlay/workspace/app"),
        true,
      )
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "workspace command dock revalidates stale terminal selection before opening",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const terminalResponses = [
      {
        defaultProfileID: "bash",
        profiles: [
          { id: "bash", label: "Bash", icon: "bash" },
          { id: "powershell", label: "Windows PowerShell", icon: "powershell" },
        ],
      },
      {
        defaultProfileID: "powershell",
        profiles: [
          { id: "powershell", label: "Windows PowerShell", icon: "powershell" },
          { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
        ],
      },
      {
        defaultProfileID: "powershell",
        profiles: [
          { id: "powershell", label: "Windows PowerShell", icon: "powershell" },
          { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
        ],
      },
    ]
    const openBodies: Record<string, unknown>[] = []
    const codingOpenBodies: Record<string, unknown>[] = []

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
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
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/task/events") return eventStream()
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog())
      if (path === "/config") return send({ model: "" })
      if (path === "/mission") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/coding/cli/profiles") {
        return send({ profiles: [{ id: "claude-code", label: "Claude Code", icon: "claude-code" }] })
      }
      if (path === "/terminal/profiles") {
        const body = terminalResponses.shift()
        if (!body) throw new Error("unexpected terminal profile reload")
        return send(body)
      }
      if (path === "/terminal/open" && req.method === "POST") {
        openBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      if (path === "/coding/cli/open" && req.method === "POST") {
        codingOpenBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      return send({})
    })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", serverUrl)
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-terminal-open"]')
        return !!button && !button.disabled
      })
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-coding-cli-open-default"]')
        return !!button && !button.disabled
      })

      await page.click('[data-ui="workspace-coding-cli-open-default"]')
      const codingBody = await waitFor(() => codingOpenBodies[0] ?? null, "coding CLI open request")

      assert.equal(codingBody.terminalProfileID, "powershell")

      await page.click('[data-ui="workspace-terminal-open"]')
      const terminalBody = await waitFor(() => openBodies[0] ?? null, "terminal open request")

      assert.equal(terminalBody.profileID, "powershell")
      assert.equal(terminalResponses.length, 0)
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "workspace coding CLI menu drops stale profiles across directory switches",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const DIR_A = "D:/overlay/workspace/app-a"
    const DIR_B = "D:/overlay/workspace/app-b"
    const codingOpenBodies: Record<string, unknown>[] = []
    const profileRequestDirectories: string[] = []
    const requestLog: Array<{ path: string; directory: string; method: string }> = []

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      const directory = url.searchParams.get("directory") || DIR_A
      requestLog.push({ path, directory, method: req.method })
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory })
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
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/task/events") return eventStream()
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog())
      if (path === "/config") return send({ model: "" })
      if (path === "/mission") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/coding/cli/profiles") {
        profileRequestDirectories.push(directory)
        return send({
          profiles:
            directory === DIR_B
              ? [{ id: "gemini", label: "Gemini CLI", icon: "gemini" }]
              : [
                  { id: "claude-code", label: "Claude Code", icon: "claude-code" },
                  { id: "codex", label: "Codex CLI", icon: "codex" },
                ],
        })
      }
      if (path === "/terminal/profiles") {
        profileRequestDirectories.push(directory)
        return send({
          defaultProfileID: "default",
          profiles: [{ id: "default", label: "PowerShell", icon: "powershell" }],
        })
      }
      if (path === "/coding/cli/open" && req.method === "POST") {
        codingOpenBodies.push((await req.json()) as Record<string, unknown>)
        return send({ ok: true })
      }
      return send({})
    })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument(
        (input) => {
          const { serverUrl, directory } = input as { serverUrl: string; directory: string }
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_directory", directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", serverUrl)
        },
        { serverUrl: server.origin, directory: DIR_A },
      )
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-coding-cli-open-default"]')
        return !!button && !button.disabled
      })

      await page.click('[data-ui="workspace-coding-cli-menu"]')
      await page.waitForSelector('[data-coding-cli="claude-code"]')

      await page.evaluate(
        (nextDirectory) => (window as any).applyDirectory(nextDirectory, { persist: false, restoreWorkspace: false }),
        DIR_B,
      )
      await waitFor(
        () =>
          page.evaluate(
            (nextDirectory) => ((window as any).settingsStore?.directory === nextDirectory ? true : null),
            DIR_B,
          ),
        "settings directory switch",
      )
      await waitFor(
        async () => {
          const state = await page.evaluate(() => {
            const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-coding-cli-open-default"]')
            return {
              directory: (window as any).settingsStore?.directory,
              disabled: button?.disabled ?? null,
              title: button?.title ?? "",
              codingItems: Array.from(document.querySelectorAll("[data-coding-cli]")).map(
                (node) => (node as HTMLElement).dataset.codingCli,
              ),
            }
          })
          if (state.disabled === false) return true
          return null
        },
        `coding CLI button re-enable after directory switch ${JSON.stringify({ requestLog, profileRequestDirectories })}`,
      )
      await page.click('[data-ui="workspace-coding-cli-menu"]')
      await page.waitForSelector('[data-coding-cli="gemini"]')
      assert.equal(await page.$('[data-coding-cli="claude-code"]'), null)
      const visibleNotifications = await page.$$eval(".app-notification", (nodes) =>
        nodes.map((node) => ({
          id: (node as HTMLElement).dataset.notificationId || "",
          title: node.querySelector(".app-notification__title")?.textContent || "",
          message: node.querySelector(".app-notification__message")?.textContent || "",
          details: node.querySelector(".app-notification__details-body")?.textContent || "",
        })),
      )
      assert.deepEqual(visibleNotifications, [])

      const screenshotPath = path.resolve(".scratch", "workspace-coding-cli-menu-directory-owned.png")
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
      await page.screenshot({ path: screenshotPath, fullPage: true })

      await page.keyboard.press("Escape")
      await page.click('[data-ui="workspace-coding-cli-open-default"]')
      const codingBody = await waitFor(() => codingOpenBodies[0] ?? null, "directory-owned coding CLI open request")

      assert.equal(codingBody.cwd, DIR_B)
      assert.equal(codingBody.cliID, "gemini")
      assert.equal(profileRequestDirectories.includes(DIR_A) && profileRequestDirectories.includes(DIR_B), true)
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
