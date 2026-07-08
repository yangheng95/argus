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
    squads: [
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
  "workspace command dock opens terminal launcher without coding CLI shortcut",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const openBodies: Record<string, unknown>[] = []
    const profileRequestDirectories: string[] = []
    const codingCliRequests: string[] = []

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
        codingCliRequests.push(path)
        return send({ profiles: [] })
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
        codingCliRequests.push(path)
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
      await page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-terminal-open"]')
        return !!button && !button.disabled
      })
      assert.equal(await page.$('[data-ui="workspace-coding-cli-open-default"]'), null)
      assert.equal(await page.$('[data-ui="workspace-coding-cli-menu"]'), null)
      assert.equal(await page.$(".workspace-coding-cli-launchers"), null)

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
      assert.deepEqual(codingCliRequests, [])
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "workspace command dock revalidates stale terminal selection before terminal opening",
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
    ]
    const openBodies: Record<string, unknown>[] = []

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
        throw new Error("coding CLI profiles should not be requested by the workspace command dock")
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
        throw new Error("coding CLI open should not be requested by the workspace command dock")
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
      assert.equal(await page.$('[data-ui="workspace-coding-cli-open-default"]'), null)

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
