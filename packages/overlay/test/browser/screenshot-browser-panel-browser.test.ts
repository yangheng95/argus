import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK = {
  id: "tsk_screenshot_browser",
  title: "Screenshot browser task",
  status: "active",
  directory: "D:/overlay/workspace/app",
  sessionID: "ses_screenshot_browser",
  time: { created: 1_780_000_000_000, updated: 1_780_000_060_000 },
}

const SCREENSHOT_COUNT = 120

const PNG_BYTES = Buffer.from(
  "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",
  "base64",
)

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function conversationPayload() {
  const transcript = Array.from({ length: SCREENSHOT_COUNT }, (_item, index) => ({
    info: {
      id: `msg_visual_${index}`,
      sessionID: "ses_visual",
      role: "assistant",
      resolvedRole: "visual-qa",
      agent: "visual-qa",
      channel: "visual-qa",
      time: { created: 1_780_000_010_000 + index, completed: 1_780_000_011_000 + index },
    },
    parts: [
      {
        id: `part_screenshot_${index}`,
        messageID: `msg_visual_${index}`,
        sessionID: "ses_visual",
        type: "tool",
        tool: "browser_observe",
        state: {
          status: "pending",
          metadata: {
            browser: {
              url: `https://example.test/visual-${index}`,
              title: `visual-check-${index}.png`,
              viewport: { width: 1280, height: 720 },
              screenshot: { attachmentUrl: `/attachment/project/screenshot-${index}.png` },
            },
          },
        },
      },
    ],
  }))
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: "board:tsk_screenshot_browser",
      task: TASK,
      goalWorkflows: [],
      interactions: [],
    },
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: {
      rootID: "root",
      order: [],
      cards: {},
      sessions: [],
    },
    agentView: { rootID: "root", cards: {}, order: [] },
    messageWatermark: 0,
  }
}

function promptProfileCatalog() {
  return {
    active: "frontend",
    project_active: "frontend",
    session_active: null,
    default: "frontend",
    targets: [],
    profiles: [
      {
        id: "frontend",
        label: "Frontend",
        description: "Frontend profile.",
        built_in: true,
        editable: false,
        agents: {},
      },
    ],
  }
}

test(
  "right screenshots activity opens grouped thumbnails from the visible card tree",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const unexpectedRequests: string[] = []
    const attachmentRequests: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/favicon.ico") return new Response(null, { status: 204 })
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (/^\/attachment\/project\/screenshot-\d+\.png$/.test(path)) {
        attachmentRequests.push(path)
        return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } })
      }
      if (path === "/global/health") return json({ version: "1.2.3" })
      if (path === "/global/projects/discover") return json([])
      if (path === "/project/current/worktrees") return json([])
      if (path === "/tasks" || path === "/global/tasks") return json({ tasks: [{ task: TASK }] })
      if (path === "/task/tsk_screenshot_browser/board") {
        return json(conversationPayload().board, { headers: { etag: '"board-screenshot-browser"' } })
      }
      if (path === "/task/tsk_screenshot_browser/operator-model-context") return json({ selected: null, candidates: [] })
      if (path === "/task/tsk_screenshot_browser/conversation") return json(conversationPayload())
      if (path === "/task/tsk_screenshot_browser/transcript") return json(conversationPayload().transcript)
      if (path === "/control/timeline") return json([])
      if (path === "/task/tsk_screenshot_browser/browser-preview") {
        return json({
          taskID: "tsk_screenshot_browser",
          kind: "missing",
          status: "missing",
          projectRoot: TASK.directory,
          viewports: [],
          diagnostics: ["No browser preview target for screenshot browser fixture."],
          candidates: [],
          source: "none",
        })
      }
      if (path === "/task/tsk_screenshot_browser/trace") {
        return json({ events: [], traceDir: "D:/overlay/workspace/app/.opencorvus/trace", enabled: true })
      }
      if (path === "/task/tsk_screenshot_browser/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/task/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/path") return json({ directory: TASK.directory })
      if (path === "/vcs") {
        return json({
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
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/config/providers") return json({ providers: [] })
      if (path === "/config/prompt-profile") return json(promptProfileCatalog())
      if (path === "/config") return json({ model: "" })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json({ profiles: [] })
      if (path === "/agent") return json([])
      if (path === "/channel") return json([])
      if (path === "/executor") return json([])
      if (path === "/mission") return json([])
      if (path === "/session") return json([])
      if (path === "/coding/sessions") return json({ sessions: [] })
      if (path === "/skill/installed" || path === "/skill") return json([])
      if (path === "/skill/market") return json([])
      if (path === "/mcp") return json({})
      if (path === "/panel/knowledge/memory") return json([])
      if (path === "/panel/knowledge/preference") return json([])
      if (path === "/file") return json({ entries: [] })
      if (path === "/find/file") return json({ entries: [] })
      if (path === "/log" && req.method === "POST") return json({ ok: true })
      unexpectedRequests.push(`${req.method} ${path}`)
      return json({ error: "unexpected screenshot browser fixture request", path }, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_workspace_task", "tsk_screenshot_browser")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_right_panel_collapsed", "false")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      const requestsBeforeOpen = attachmentRequests.length
      const openStart = Date.now()
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']")
      await page.waitForSelector(".screenshot-browser-card")
      await page.waitForFunction(() => {
        const img = document.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
        return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      })
      const openElapsed = Date.now() - openStart
      assert.ok(openElapsed < 5_000, `screenshot browser open took ${openElapsed}ms`)

      const state = await page.evaluate(() => ({
        screenshotsOpen: document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open,
        buttonActive: document.querySelector<HTMLElement>(
          '[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]',
        )?.dataset.active,
        title: document.querySelector<HTMLElement>(".screenshot-browser-panel .oc-surface-header__title")?.textContent,
        groupRole: document.querySelector<HTMLElement>(".screenshot-browser-group")?.dataset.agentRole,
        groupTitle: document.querySelector<HTMLElement>(".screenshot-browser-group__header span")?.textContent,
        cardTitle: document.querySelector<HTMLElement>(".screenshot-browser-card__body strong")?.textContent,
        cardCount: document.querySelectorAll(".screenshot-browser-card").length,
        virtualized: document.querySelector<HTMLElement>(".screenshot-browser-groups")?.dataset.virtualized,
        virtualWindow: !!document.querySelector(".screenshot-browser-virtual-window"),
      }))

      assert.equal(state.screenshotsOpen, "true")
      assert.equal(state.buttonActive, "true")
      assert.equal(state.title, "Screenshots")
      assert.equal(state.groupRole, "visual-qa")
      assert.equal(state.groupTitle, "Visual QA")
      assert.equal(state.cardTitle, "visual-check-119.png")
      assert.equal(state.virtualized, "true")
      assert.equal(state.virtualWindow, true)
      assert.ok(state.cardCount > 0, JSON.stringify(state))
      assert.ok(state.cardCount < SCREENSHOT_COUNT, JSON.stringify(state))
      const openAttachmentRequests = attachmentRequests.length - requestsBeforeOpen
      assert.ok(
        openAttachmentRequests < 24,
        `initial screenshot open fetched too many attachments: ${openAttachmentRequests}`,
      )

      const thumbLayout = await page.evaluate(() => {
        const trigger = document.querySelector<HTMLElement>(".screenshot-browser__thumb-trigger")
        const image = document.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
        const triggerRect = trigger?.getBoundingClientRect()
        const imageRect = image?.getBoundingClientRect()
        return {
          triggerWidth: triggerRect?.width ?? 0,
          triggerHeight: triggerRect?.height ?? 0,
          imageWidth: imageRect?.width ?? 0,
          imageHeight: imageRect?.height ?? 0,
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
        }
      })
      assert.ok(thumbLayout.triggerWidth >= 120, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.triggerHeight >= 80, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.imageWidth >= thumbLayout.triggerWidth - 1, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.imageHeight >= thumbLayout.triggerHeight - 1, JSON.stringify(thumbLayout))

      await page.setViewport({ width: 960, height: 760 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.ok(
        attachmentRequests.length - requestsBeforeOpen < 32,
        `viewport resize materialized too many screenshots: ${attachmentRequests.length - requestsBeforeOpen}`,
      )

      const screenshotPath = resolve(".scratch/screenshot-browser-panel-browser.png")
      mkdirSync(resolve(".scratch"), { recursive: true })
      const screenshot = await page.screenshot({ fullPage: false })
      assert.ok(screenshot.length > 0)
      writeFileSync(screenshotPath, screenshot)

      await page.$eval(".screenshot-browser-groups[data-virtualized=\"true\"]", (node) => {
        const scroll = node as HTMLElement
        scroll.scrollTo({ top: Math.max(0, scroll.scrollHeight - scroll.clientHeight), behavior: "auto" })
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      try {
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card__body strong")).some(
            (node) => node.textContent === "visual-check-0.png",
          ),
        )
      } catch (error) {
        const scrollState = await page.evaluate(() => {
          const scroll = document.querySelector<HTMLElement>(".screenshot-browser-groups[data-virtualized=\"true\"]")
          return {
            scrollTop: scroll?.scrollTop ?? 0,
            scrollHeight: scroll?.scrollHeight ?? 0,
            clientHeight: scroll?.clientHeight ?? 0,
            titles: Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card__body strong")).map(
              (node) => node.textContent,
            ),
          }
        })
        assert.fail(`virtual screenshot list did not materialize the oldest row: ${JSON.stringify(scrollState)}`)
      }
      assert.ok(
        attachmentRequests.length - requestsBeforeOpen < 64,
        `scrolling should not materialize the full screenshot history: ${attachmentRequests.length - requestsBeforeOpen}`,
      )

      await page.evaluate(() => {
        const workbench = document.getElementById("centerWorkbench")
        const screenshots = document.getElementById("centerWorkbenchScreenshots")
        workbench?.style.setProperty("flex", "0 0 128px")
        workbench?.style.setProperty("width", "128px")
        screenshots?.style.setProperty("flex", "0 0 128px")
        screenshots?.style.setProperty("width", "128px")
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      const narrowLayout = await page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector)
          if (!node) return null
          const rect = node.getBoundingClientRect()
          return {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          }
        }
        const panel = box("#centerWorkbenchScreenshots")
        const grid = box(".screenshot-browser-row-grid")
        const card = box(".screenshot-browser-card")
        const thumb = box(".screenshot-browser__thumb-trigger")
        return {
          bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
          panel,
          grid,
          card,
          thumb,
          cardEscaped: !!panel && !!card && (card.left < panel.left - 1 || card.right > panel.right + 1),
          thumbEscaped: !!panel && !!thumb && (thumb.left < panel.left - 1 || thumb.right > panel.right + 1),
        }
      })
      assert.ok(narrowLayout.panel?.width && narrowLayout.panel.width <= 130, JSON.stringify(narrowLayout))
      assert.ok((narrowLayout.grid?.scrollWidth ?? 0) <= (narrowLayout.grid?.clientWidth ?? 0) + 1, JSON.stringify(narrowLayout))
      assert.equal(narrowLayout.cardEscaped, false, JSON.stringify(narrowLayout))
      assert.equal(narrowLayout.thumbEscaped, false, JSON.stringify(narrowLayout))
      assert.ok(narrowLayout.bodyOverflowX <= 1, JSON.stringify(narrowLayout))

      const narrowScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-narrow.png")
      const narrowScreenshot = await page.screenshot({ fullPage: false })
      assert.ok(narrowScreenshot.length > 0)
      writeFileSync(narrowScreenshotPath, narrowScreenshot)
      const narrowPanel = await page.$("#centerWorkbenchScreenshots")
      assert.ok(narrowPanel)
      const narrowPanelScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-narrow-panel.png")
      const narrowPanelScreenshot = await narrowPanel.screenshot()
      assert.ok(narrowPanelScreenshot.length > 0)
      writeFileSync(narrowPanelScreenshotPath, narrowPanelScreenshot)
      assert.deepEqual(unexpectedRequests, [])
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 180_000 },
)
