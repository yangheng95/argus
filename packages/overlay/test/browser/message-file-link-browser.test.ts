import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

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

async function focusSelector(page: any, selector: string, attempts = 200): Promise<boolean> {
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.keyboard.press("Tab")
    const focused = await page.$eval(selector, (node: HTMLElement) => document.activeElement === node)
    if (focused) return true
  }
  return false
}

async function linkFocusState(page: any, selector: string) {
  return page.$eval(selector, (node: HTMLElement) => {
    const style = getComputedStyle(node)
    return {
      focusVisible: node.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      color: style.color,
      textDecorationLine: style.textDecorationLine,
    }
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
      request: "Open `src/main.tsx` before editing. See [docs](https://example.com/docs).",
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
          text: "Open `src/main.tsx` before editing. See [docs](https://example.com/docs).",
        },
        {
          id: "part-file-download-user",
          messageID: "message-file-link-user",
          sessionID: "session-file-link-root",
          type: "file",
          url: "data:text/plain;base64,SGVsbG8=",
          mime: "text/plain",
          filename: "notes.txt",
        },
      ],
    },
    {
      info: {
        id: "message-tool-diff",
        sessionID: "session-file-link-root",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        time: { created: 1_776_200_001_200 },
      },
      parts: [
        {
          id: "part-tool-diff",
          messageID: "message-tool-diff",
          sessionID: "session-file-link-root",
          type: "tool",
          tool: "apply_patch",
          state: {
            status: "completed",
            input: { command: "apply patch" },
            output: "",
            metadata: {
              files: [
                {
                  path: "src/changed.tsx",
                  relativePath: "src/changed.tsx",
                  type: "modified",
                  before: "const value = 1\n",
                  after: "const value = 2\nconst done = true\n",
                  additions: 2,
                  deletions: 1,
                },
              ],
            },
            time: { start: 1_776_200_001_210, end: 1_776_200_001_220 },
          },
        },
      ],
    },
  ]
}

async function installOverlaySettings(page: any, serverUrl: string): Promise<void> {
  await page.evaluateOnNewDocument((origin) => {
    ;(window as any).__OPEN_PATH_CALLS__ = []
    localStorage.setItem("oc_locale", "en-US")
    localStorage.setItem("oc_theme", "light")
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", "D:/file-link/workspace")
    window.__TAURI__ = {
      core: {
        invoke: async (command: string, args?: unknown) => {
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
          if (command === "overlay_open_path" || command === "overlay_open_project_editor") {
            ;(window as any).__OPEN_PATH_CALLS__.push({ command, args })
            return true
          }
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
  "message links and file downloads expose visible focus states",
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
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "file-link-visual-test" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [item] })
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
      if (path === "/config/prompt" || path === "/expert-squad/catalog") {
        return send(generalExpertSquadCatalog())
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
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
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
      await page.waitForSelector('.chat-bubble .msg-text a[href="https://example.com/docs"]', { visible: true })
      await page.waitForSelector(".chat-bubble .msg-file-download", { visible: true })

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

      await page.mouse.move(0, 0)
      const fileLinkFocused = await focusSelector(page, ".chat-bubble code .file-link")
      assert.equal(fileLinkFocused, true)
      const fileLinkFocusState = await linkFocusState(page, ".chat-bubble code .file-link")
      assert.equal(fileLinkFocusState.focusVisible, true)
      assert.notEqual(fileLinkFocusState.outlineStyle, "none")
      assert.notEqual(fileLinkFocusState.outlineWidth, "0px")
      assert.match(fileLinkFocusState.textDecorationLine, /underline/)
      writeFileSync(resolve(".scratch", "message-file-link-focus-visible.png"), await bubble.screenshot({}))

      await page.keyboard.press("Enter")
      await page.waitForFunction(() => ((window as any).__OPEN_PATH_CALLS__ || []).length > 0)
      let openPathCalls = await page.evaluate(() => (window as any).__OPEN_PATH_CALLS__)
      assert.equal(openPathCalls.length, 1)
      assert.equal(openPathCalls[0].command, "overlay_open_project_editor")
      assert.equal(openPathCalls[0].args.path, "D:/file-link/workspace/src/main.tsx")
      await page.evaluate(() => {
        ;(window as any).__OPEN_PATH_CALLS__ = []
      })

      await page.mouse.move(0, 0)
      const markdownLinkSelector = '.chat-bubble .msg-text a[href="https://example.com/docs"]'
      const markdownLinkFocused = await focusSelector(page, markdownLinkSelector)
      assert.equal(markdownLinkFocused, true)
      const markdownLinkFocusState = await linkFocusState(page, markdownLinkSelector)
      assert.equal(markdownLinkFocusState.focusVisible, true)
      assert.notEqual(markdownLinkFocusState.outlineStyle, "none")
      assert.notEqual(markdownLinkFocusState.outlineWidth, "0px")
      assert.match(markdownLinkFocusState.textDecorationLine, /underline/)
      writeFileSync(resolve(".scratch", "message-markdown-link-focus-visible.png"), await bubble.screenshot({}))

      await page.mouse.move(0, 0)
      const fileDownloadFocused = await focusSelector(page, ".chat-bubble .msg-file-download")
      assert.equal(fileDownloadFocused, true)
      const fileDownloadFocusState = await linkFocusState(page, ".chat-bubble .msg-file-download")
      assert.equal(fileDownloadFocusState.focusVisible, true)
      assert.notEqual(fileDownloadFocusState.outlineStyle, "none")
      assert.notEqual(fileDownloadFocusState.outlineWidth, "0px")
      const fileDownloadState = await page.$eval(".chat-bubble .msg-file-download", (node: HTMLAnchorElement) => ({
        text: node.textContent?.trim() ?? "",
        download: node.getAttribute("download"),
      }))
      assert.deepEqual(fileDownloadState, { text: "Download", download: "notes.txt" })
      const fileDownloadChip = await page.$(".chat-bubble .msg-file-chip")
      assert.ok(fileDownloadChip)
      writeFileSync(
        resolve(".scratch", "message-file-download-focus-visible.png"),
        await fileDownloadChip.screenshot({}),
      )

      await page.mouse.move(0, 0)
      await page.waitForSelector('.card[data-kind="tool"] > .card__head [data-ui="card-head-main"]', { visible: true })
      await page.click('.card[data-kind="tool"] > .card__head [data-ui="card-head-main"]')
      await page.waitForSelector('[data-ui="tool-diff-open-file"]', { visible: true })

      const toolDiffButtonState = await page.$eval('[data-ui="tool-diff-open-file"]', (node: HTMLButtonElement) => {
        const style = getComputedStyle(node)
        return {
          tagName: node.tagName,
          className: node.className,
          variant: node.dataset.variant,
          size: node.dataset.size,
          tone: node.dataset.tone,
          path: node.getAttribute("data-file-path"),
          text: node.textContent?.trim() ?? "",
          textDecorationLine: style.textDecorationLine,
        }
      })
      assert.deepEqual(toolDiffButtonState, {
        tagName: "BUTTON",
        className: "oc-button",
        variant: "ghost",
        size: "sm",
        tone: "accent",
        path: "src/changed.tsx",
        text: "src/changed.tsx",
        textDecorationLine: "underline",
      })

      await page.evaluate(() => {
        const active = document.activeElement
        if (active instanceof HTMLElement) active.blur()
      })
      let toolDiffFocused = false
      for (let attempt = 0; attempt < 160; attempt += 1) {
        await page.keyboard.press("Tab")
        toolDiffFocused = await page.$eval(
          '[data-ui="tool-diff-open-file"]',
          (node: HTMLElement) => document.activeElement === node,
        )
        if (toolDiffFocused) break
      }
      assert.equal(toolDiffFocused, true)
      const toolDiffFocusState = await page.$eval('[data-ui="tool-diff-open-file"]', (node: HTMLButtonElement) => {
        const style = getComputedStyle(node)
        return {
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          backgroundColor: style.backgroundColor,
        }
      })
      assert.equal(toolDiffFocusState.focusVisible, true)
      assert.notEqual(toolDiffFocusState.outlineStyle, "none")
      assert.notEqual(toolDiffFocusState.outlineWidth, "0px")
      assert.notEqual(toolDiffFocusState.backgroundColor, "rgba(0, 0, 0, 0)")
      const toolDiffCard = await page.$(".msg-tool-diff-card")
      assert.ok(toolDiffCard)
      const toolDiffScreenshotPath = resolve(".scratch", "tool-diff-open-file-focus-visible.png")
      writeFileSync(toolDiffScreenshotPath, await toolDiffCard.screenshot({}))

      await page.keyboard.press("Enter")
      await page.waitForFunction(() => ((window as any).__OPEN_PATH_CALLS__ || []).length > 0)
      openPathCalls = await page.evaluate(() => (window as any).__OPEN_PATH_CALLS__)
      assert.equal(openPathCalls.length, 1)
      assert.equal(openPathCalls[0].command, "overlay_open_project_editor")
      assert.equal(openPathCalls[0].args.path, "D:/file-link/workspace/src/changed.tsx")
      await page.close()

      assert.deepEqual(badResponses, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
