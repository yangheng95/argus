import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function saveElementScreenshot(page: any, selector: string, name: string): Promise<void> {
  const element = await page.$(selector)
  if (!element) throw new Error(`missing screenshot target ${selector}`)
  await writeFile(resolve(".scratch", name), await element.screenshot({}))
}

function taskItem(): any {
  const created = 1_776_100_001_000
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: "Runtime icon visual task", summary: "Runtime icon visual task" },
    task: {
      id: "task-runtime-icon-visual",
      requestID: "req-runtime-icon-visual",
      title: "Runtime icon visual task",
      request: "",
      directory: "D:/runtime-icon/workspace",
      status: "queued",
      sessionID: "session-runtime-icon-visual",
      time: { created, updated: created + 1 },
    },
  }
}

function boardForTask(item: any): any {
  return {
    task: item.task,
    overview: item.overview,
    goalWorkflows: [],
    interactions: [],
    lastSequence: 1,
    snapshotVersion: `snapshot-${item.task.id}`,
  }
}

async function installOverlaySettings(page: any, serverUrl: string): Promise<void> {
  await page.evaluateOnNewDocument((origin) => {
    localStorage.setItem("oc_locale", "en-US")
    localStorage.setItem("oc_theme", "light")
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", "D:/runtime-icon/workspace")
    window.__TAURI__ = {
      core: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "overlay_settings_load") {
            return {
              serverUrl: origin,
              autoServer: false,
              locale: "en-US",
              directory: "D:/runtime-icon/workspace",
              directoryMode: "custom",
            }
          }
          if (command === "overlay_settings_save") return true
          if (command === "overlay_open_url") return true
          if (command === "overlay_open_path") return true
          return null
        },
      },
      window: {
        getCurrentWindow() {
          return {
            close: async () => true,
            hide: async () => true,
            minimize: async () => true,
            startDragging: async () => true,
            isMaximized: async () => false,
            onResized: async () => ({ unlisten: async () => undefined }),
          }
        },
      },
    }
  }, serverUrl)
}

test(
  "runtime icons render through Icon primitive in empty states and About panel",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const item = taskItem()
    let tasks: any[] = []
    const badResponses: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "runtime-icon-visual-test" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks })
      if (path === "/mission") return send([])
      if (path === "/executor") return send([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: "D:/runtime-icon/workspace", exists: true, git: true })
      if (path === "/vcs") return send({ branch: "visual", clean: true, dirty: false })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") {
        return send({
          server: {},
          provider: {},
          channel: {},
          mcp: {},
          model: "",
          directory: "D:/runtime-icon/workspace",
          version: "runtime-icon-visual-test",
        })
      }
      if (path === "/config/prompt" || path === "/config/prompt-profile") {
        return send({
          active: "general",
          project_active: "general",
          session_active: null,
          default: "general",
          targets: [],
          profiles: [],
        })
      }
      if (path === "/channel") return send([])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
      if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/directories") {
        return send({
          global_config: "D:/runtime-icon/config",
          managed_skills: "D:/runtime-icon/config/skills-market",
          remote_cache: "D:/runtime-icon/cache",
        })
      }
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/agent") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
      if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
      if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
        return send({
          taskID: item.task.id,
          sessionID: item.task.sessionID,
          agent: "orchestrator",
          model: { providerID: "openai", modelID: "gpt-4o-mini" },
        })
      }
      if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
        return send({
          taskID: item.task.id,
          kind: "missing",
          status: "missing",
          projectRoot: item.task.directory,
          viewports: [],
          diagnostics: [],
          candidates: [],
          source: "none",
        })
      }
      if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
      if (/^\/task\/[^/]+\/conversation$/.test(path)) {
        return send({
          board: boardForTask(item),
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          agentView: { sessions: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
          messageWatermark: 0,
          lastSequence: 0,
        })
      }
      if (/^\/task\/[^/]+\/board$/.test(path)) return send(boardForTask(item))
      return send({ error: `unhandled ${req.method} ${path}` }, 404)
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const noTaskPage = await browser.newPage()
      noTaskPage.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      await noTaskPage.setViewport({ width: 1280, height: 760 })
      await installOverlaySettings(noTaskPage, server.origin)
      await noTaskPage.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await noTaskPage.waitForSelector(".chat-empty .chat-empty-icon", { visible: true })
      const noTaskIcon = await noTaskPage.$eval(".chat-empty .chat-empty-icon", (node: SVGElement) => ({
        tag: node.tagName,
        hidden: node.getAttribute("aria-hidden"),
        box: Math.round(node.getBoundingClientRect().width),
      }))
      assert.equal(noTaskIcon.tag, "svg")
      assert.equal(noTaskIcon.hidden, "true")
      assert.ok(noTaskIcon.box >= 36)
      assert.ok(noTaskIcon.box <= 48)
      await saveElementScreenshot(noTaskPage, ".chat-empty", "runtime-icon-no-task-empty.png")
      await noTaskPage.close()

      tasks = [item]
      const taskPage = await browser.newPage()
      taskPage.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      await taskPage.setViewport({ width: 1280, height: 760 })
      await installOverlaySettings(taskPage, server.origin)
      await taskPage.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await taskPage.waitForSelector('.task-row-main[data-task-id="task-runtime-icon-visual"]', { visible: true })
      await taskPage.evaluate(async (taskID: string) => {
        const selectTask = (window as any).selectTask
        if (typeof selectTask !== "function") throw new Error("window.selectTask is not available")
        await selectTask(taskID)
      }, item.task.id)
      await taskPage.waitForSelector(".chat-empty--task .chat-empty-icon", { visible: true })
      const taskIcon = await taskPage.$eval(".chat-empty--task .chat-empty-icon", (node: SVGElement) => ({
        tag: node.tagName,
        hidden: node.getAttribute("aria-hidden"),
        box: Math.round(node.getBoundingClientRect().width),
      }))
      assert.equal(taskIcon.tag, "svg")
      assert.equal(taskIcon.hidden, "true")
      assert.ok(taskIcon.box >= 26)
      assert.ok(taskIcon.box <= 34)
      await saveElementScreenshot(taskPage, ".chat-empty--task", "runtime-icon-task-empty.png")

      await taskPage.click('[data-menu-trigger="help"]')
      await taskPage.waitForSelector('[data-testid="titlebar-help-about"]', { visible: true })
      await taskPage.click('[data-testid="titlebar-help-about"]')
      await taskPage.waitForSelector('[data-config-panel="about"] .about-author-avatar svg', { visible: true })
      const aboutIcon = await taskPage.$eval(".about-author-avatar svg", (node: SVGElement) => ({
        tag: node.tagName,
        hidden: node.getAttribute("aria-hidden"),
        box: Math.round(node.getBoundingClientRect().width),
        color: getComputedStyle(node).color,
      }))
      assert.equal(aboutIcon.tag, "svg")
      assert.equal(aboutIcon.hidden, "true")
      assert.equal(aboutIcon.box, 40)
      assert.notEqual(aboutIcon.color, "rgba(0, 0, 0, 0)")
      const aboutLinkStates = await taskPage.$$eval(".about-link", (nodes: HTMLAnchorElement[]) =>
        nodes.map((node) => {
          const style = getComputedStyle(node)
          return {
            authorLinkCount: document.querySelectorAll(".about-author-link").length,
            text: node.textContent?.trim() ?? "",
            href: node.href,
            color: style.color,
            background: style.backgroundColor,
            borderColor: style.borderColor,
          }
        }),
      )
      assert.equal(aboutLinkStates.length, 2)
      assert.equal(
        aboutLinkStates.every((link) => link.authorLinkCount === 0),
        true,
      )
      assert.deepEqual(
        aboutLinkStates.map((link) => link.text),
        ["GitHub", "Issues"],
      )
      assert.deepEqual(
        aboutLinkStates.map((link) => link.href),
        ["https://github.com/yangheng95", "https://github.com/yangheng95/opencorvus/issues"],
      )
      assert.notEqual(aboutLinkStates[0].href, aboutLinkStates[1].href)
      assert.equal(
        aboutLinkStates.every((link) => link.color !== "rgba(0, 0, 0, 0)"),
        true,
      )
      await saveElementScreenshot(taskPage, ".about-links", "runtime-icon-about-links.png")
      await taskPage.hover(".about-link")
      const hoveredAboutLinkState = await taskPage.$eval(".about-link", (node: HTMLAnchorElement) => {
        const style = getComputedStyle(node)
        return {
          color: style.color,
          background: style.backgroundColor,
          borderColor: style.borderColor,
        }
      })
      assert.notDeepEqual(hoveredAboutLinkState, {
        color: aboutLinkStates[0].color,
        background: aboutLinkStates[0].background,
        borderColor: aboutLinkStates[0].borderColor,
      })
      await taskPage.mouse.move(0, 0)
      await taskPage.evaluate(() => {
        const active = document.activeElement
        if (active instanceof HTMLElement) active.blur()
      })
      let aboutLinkFocused = false
      for (let attempt = 0; attempt < 160; attempt += 1) {
        await taskPage.keyboard.press("Tab")
        aboutLinkFocused = await taskPage.$eval(".about-link", (node: HTMLElement) => document.activeElement === node)
        if (aboutLinkFocused) break
      }
      assert.equal(aboutLinkFocused, true)
      const focusedAboutLinkState = await taskPage.$eval(".about-link", (node: HTMLAnchorElement) => {
        const style = getComputedStyle(node)
        return {
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          color: style.color,
          background: style.backgroundColor,
          borderColor: style.borderColor,
        }
      })
      assert.equal(focusedAboutLinkState.focusVisible, true)
      assert.notEqual(focusedAboutLinkState.outlineStyle, "none")
      assert.notEqual(focusedAboutLinkState.outlineWidth, "0px")
      assert.notDeepEqual(
        {
          color: focusedAboutLinkState.color,
          background: focusedAboutLinkState.background,
          borderColor: focusedAboutLinkState.borderColor,
        },
        {
          color: aboutLinkStates[0].color,
          background: aboutLinkStates[0].background,
          borderColor: aboutLinkStates[0].borderColor,
        },
      )
      await saveElementScreenshot(taskPage, ".about-links", "runtime-icon-about-link-focus-visible.png")
      await saveElementScreenshot(taskPage, "#configDialog", "runtime-icon-about-panel.png")
      await taskPage.close()

      assert.deepEqual(badResponses, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
