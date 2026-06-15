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

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAALUlEQVR4nGNkYPj/n4GKgImaho0aNmzYsGHDBg0bNmzYsGHDBg0bNjQwMgAA1e4DNxFpUqQAAAAASUVORK5CYII=",
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
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: "board:tsk_screenshot_browser",
      task: TASK,
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [
      {
        info: {
          id: "msg_visual",
          sessionID: "ses_visual",
          role: "assistant",
          resolvedRole: "visual-qa",
          agent: "visual-qa",
          channel: "visual-qa",
          time: { created: 1_780_000_010_000, completed: 1_780_000_011_000 },
        },
        parts: [
          {
            id: "part_screenshot",
            messageID: "msg_visual",
            sessionID: "ses_visual",
            type: "file",
            mime: "image/png",
            url: "/attachment/project/screenshot.png",
            filename: "visual-check.png",
          },
        ],
      },
    ],
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

test("right screenshots activity opens grouped thumbnails from the visible card tree", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/attachment/project/screenshot.png") {
      return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } })
    }
    if (path === "/global/health") return json({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return json({ tasks: [{ task: TASK }] })
    if (path === "/task/tsk_screenshot_browser/conversation") return json(conversationPayload())
    if (path === "/task/tsk_screenshot_browser/events") {
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
    if (path === "/config") return json({ model: "" })
    if (path === "/agent") return json([])
    if (path === "/channel") return json([])
    if (path === "/executor") return json([])
    if (path === "/mission") return json([])
    if (path === "/session") return json([])
    if (path === "/coding/sessions") return json({ sessions: [] })
    if (path === "/skill/installed" || path === "/skill") return json([])
    if (path === "/mcp") return json({})
    if (path === "/file") return json({ entries: [] })
    if (path === "/find/file") return json({ entries: [] })
    return json({})
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
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
    await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']")
    await page.waitForSelector(".screenshot-browser-card")
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
      return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
    })

    const state = await page.evaluate(() => ({
      screenshotsOpen: document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open,
      buttonActive: document.querySelector<HTMLElement>(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]',
      )?.dataset.active,
      title: document.querySelector<HTMLElement>(".screenshot-browser-panel .oc-surface-header__title")
        ?.textContent,
      groupRole: document.querySelector<HTMLElement>(".screenshot-browser-group")?.dataset.agentRole,
      groupTitle: document.querySelector<HTMLElement>(".screenshot-browser-group__header span")?.textContent,
      cardTitle: document.querySelector<HTMLElement>(".screenshot-browser-card__body strong")?.textContent,
      cardCount: document.querySelectorAll(".screenshot-browser-card").length,
    }))

    assert.deepEqual(state, {
      screenshotsOpen: "true",
      buttonActive: "true",
      title: "Screenshots",
      groupRole: "visual-qa",
      groupTitle: "Visual QA",
      cardTitle: "visual-check.png",
      cardCount: 1,
    })

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

    const screenshotPath = resolve(".scratch/screenshot-browser-panel-browser.png")
    mkdirSync(resolve(".scratch"), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
  } finally {
    await browser.close()
    await server.close()
  }
}, { timeout: 180_000 })
