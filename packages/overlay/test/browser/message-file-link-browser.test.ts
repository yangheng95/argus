import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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

function taskItem(): any {
  const created = 1_776_200_001_000
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: "File link visual task", summary: "File link visual task" },
    task: {
      id: "task-file-link-visual",
      requestID: "req-file-link-visual",
      title: "File link visual task",
      request: "Open `src/main.tsx` before editing.",
      directory: "D:/file-link/workspace",
      status: "active",
      sessionID: "session-file-link-root",
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

function transcript(): any[] {
  return [
    {
      info: {
        id: "message-file-link-user",
        sessionID: "session-file-link-root",
        role: "user",
        resolvedRole: "user",
        channel: "user",
        time: { created: 1_776_200_001_100 },
      },
      parts: [
        {
          id: "part-file-link-user",
          messageID: "message-file-link-user",
          sessionID: "session-file-link-root",
          type: "text",
          text: "Open `src/main.tsx` before editing.",
        },
      ],
    },
  ]
}

async function installOverlaySettings(page: any, serverUrl: string): Promise<void> {
  await page.evaluateOnNewDocument((origin) => {
    localStorage.setItem("oc_locale", "en-US")
    localStorage.setItem("oc_theme", "light")
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", "D:/file-link/workspace")
    window.__TAURI__ = {
      core: {
        invoke: async (command: string) => {
          if (command === "overlay_settings_load") {
            return {
              serverUrl: origin,
              autoServer: false,
              locale: "en-US",
              directory: "D:/file-link/workspace",
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
  "message file codespan renders through workspace file-link owner",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const item = taskItem()
    const messages = transcript()
    const badResponses: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "file-link-visual-test" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [item] })
      if (path === "/mission") return send([])
      if (path === "/executor") return send([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: item.task.directory, exists: true, git: true })
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
          directory: item.task.directory,
          version: "file-link-visual-test",
        })
      }
      if (path === "/config/prompt" || path === "/config/prompt-profile") {
        return send({ active: "general", project_active: "general", session_active: null, default: "general", targets: [], profiles: [] })
      }
      if (path === "/channel") return send([])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/directories") {
        return send({
          global_config: "D:/file-link/config",
          managed_skills: "D:/file-link/config/skills-market",
          remote_cache: "D:/file-link/cache",
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
          transcript: messages,
          timeline: messages,
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
      if (/^\/task\/[^/]+\/transcript$/.test(path)) return send(messages)
      if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }
      return send({ error: `unhandled ${req.method} ${path}` }, 404)
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      page.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      await page.setViewport({ width: 1280, height: 760 })
      await installOverlaySettings(page, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => typeof (window as any).selectTask === "function")
      await page.evaluate(async (taskID: string) => {
        const selectTask = (window as any).selectTask
        if (typeof selectTask !== "function") throw new Error("window.selectTask is not available")
        await selectTask(taskID)
      }, item.task.id)
      await page.waitForSelector(".chat-bubble code .file-link", { visible: true })

      const baseState = await page.$eval(".chat-bubble code .file-link", (node: HTMLAnchorElement) => {
        const style = getComputedStyle(node)
        return {
          text: node.textContent?.trim() ?? "",
          href: node.getAttribute("href"),
          path: node.getAttribute("data-file-path"),
          pathLinkCount: document.querySelectorAll(".path-link").length,
          pathBoxCount: document.querySelectorAll(".path-box").length,
          color: style.color,
          textDecorationLine: style.textDecorationLine,
        }
      })
      assert.equal(baseState.text, "src/main.tsx")
      assert.equal(baseState.href, "#")
      assert.equal(baseState.path, "src/main.tsx")
      assert.equal(baseState.pathLinkCount, 0)
      assert.equal(baseState.pathBoxCount, 0)
      assert.notEqual(baseState.color, "rgba(0, 0, 0, 0)")

      await page.hover(".chat-bubble code .file-link")
      const hoverState = await page.$eval(".chat-bubble code .file-link", (node: HTMLAnchorElement) => {
        const style = getComputedStyle(node)
        return {
          textDecorationLine: style.textDecorationLine,
          color: style.color,
        }
      })
      assert.notEqual(hoverState.color, "rgba(0, 0, 0, 0)")
      assert.match(hoverState.textDecorationLine, /underline/)

      const bubble = await page.$(".chat-bubble")
      assert.ok(bubble)
      const screenshotPath = resolve(".scratch", "message-file-link-hover.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await bubble.screenshot({}))
      await page.close()

      assert.deepEqual(badResponses, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
