import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { deflateSync } from "node:zlib"

import { SCREENSHOT_BROWSER_THUMBNAIL_VARIANT } from "@opencorvus-ai/transport-protocol"
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

const SCREENSHOT_IMAGE_WIDTH = 1440
const SCREENSHOT_IMAGE_HEIGHT = 900
const SCREENSHOT_THUMBNAIL_IMAGE_WIDTH = 360
const SCREENSHOT_THUMBNAIL_IMAGE_HEIGHT = 225
const screenshotPngCache = new Map<string, Buffer>()

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const typeBuffer = Buffer.from(type, "ascii")
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))])
}

function screenshotPngBytes(index: number, width = SCREENSHOT_IMAGE_WIDTH, height = SCREENSHOT_IMAGE_HEIGHT): Buffer {
  const cacheKey = `${index}:${width}x${height}`
  const cached = screenshotPngCache.get(cacheKey)
  if (cached) return cached
  const bytesPerPixel = 3
  const rowStride = 1 + width * bytesPerPixel
  const raw = Buffer.alloc(rowStride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * rowStride
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * bytesPerPixel
      raw[offset] = (x + index * 17) & 255
      raw[offset + 1] = (y + index * 29) & 255
      raw[offset + 2] = ((x >> 2) + (y >> 1) + index * 41) & 255
    }
  }
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 1 })),
    pngChunk("IEND"),
  ])
  screenshotPngCache.set(cacheKey, png)
  return png
}

function screenshotIndex(path: string): number | null {
  const match = /^\/attachment\/project\/screenshot-(\d+)\.png$/.exec(path)
  return match ? Number.parseInt(match[1], 10) : null
}

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

async function waitForVisibleScreenshotThumbnails(
  page: any,
  label: string,
  attachmentRequests: readonly string[],
): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>('.screenshot-browser-groups[data-virtualized="true"]')
      if (!root) return false
      const rootRect = root.getBoundingClientRect()
      const visibleCards = Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card")).filter(
        (card) => {
          const rect = card.getBoundingClientRect()
          return (
            rect.bottom > rootRect.top &&
            rect.top < rootRect.bottom &&
            rect.right > rootRect.left &&
            rect.left < rootRect.right
          )
        },
      )
      return (
        visibleCards.length > 1 &&
        visibleCards.every((card) => {
          const img = card.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        })
      )
    })
  } catch (error) {
    const state = await page.evaluate((attachmentRequests) => {
      const root = document.querySelector<HTMLElement>('.screenshot-browser-groups[data-virtualized="true"]')
      const rootRect = root?.getBoundingClientRect()
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card"))
      const visibleCards = rootRect
        ? cards.filter((card) => {
            const rect = card.getBoundingClientRect()
            return (
              rect.bottom > rootRect.top &&
              rect.top < rootRect.bottom &&
              rect.right > rootRect.left &&
              rect.left < rootRect.right
            )
          })
        : []
      return {
        panelOpen: document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open,
        rootPresent: Boolean(root),
        cardCount: cards.length,
        visibleCount: visibleCards.length,
        visibleCards: visibleCards.slice(0, 6).map((card) => {
          const img = card.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
          return {
            title: card.querySelector<HTMLElement>(".screenshot-browser-card__body strong")?.textContent ?? "",
            complete: img?.complete ?? false,
            naturalWidth: img?.naturalWidth ?? 0,
            naturalHeight: img?.naturalHeight ?? 0,
            attrSrc: img?.getAttribute("src") ?? "",
            src: img?.src ?? "",
            outerHTML: img?.outerHTML ?? "",
            triggerSrc:
              card
                .querySelector<HTMLElement>(".screenshot-browser__thumb-trigger")
                ?.getAttribute("data-image-preview-src") ?? "",
            hasPlaceholder: Boolean(card.querySelector(".screenshot-browser__thumb-placeholder")),
            errorText: card.querySelector<HTMLElement>(".screenshot-browser__thumb-error")?.textContent?.trim() ?? "",
          }
        }),
        attachmentRequests,
      }
    }, attachmentRequests)
    const message = error instanceof Error ? error.message : String(error)
    assert.fail(`${label}: ${message}; state=${JSON.stringify(state)}`)
  }
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
      const requestedScreenshotIndex = screenshotIndex(path)
      if (requestedScreenshotIndex != null) {
        const requestPath = `${path}${url.search}`
        attachmentRequests.push(requestPath)
        const queryKeys = Array.from(url.searchParams.keys())
        if (url.search) {
          if (queryKeys.length === 1 && url.searchParams.get("variant") === SCREENSHOT_BROWSER_THUMBNAIL_VARIANT) {
            return new Response(
              screenshotPngBytes(
                requestedScreenshotIndex,
                SCREENSHOT_THUMBNAIL_IMAGE_WIDTH,
                SCREENSHOT_THUMBNAIL_IMAGE_HEIGHT,
              ),
              { headers: { "content-type": "image/png" } },
            )
          }
          return json({ error: "unknown screenshot attachment variant", path: requestPath }, { status: 404 })
        }
        return new Response(screenshotPngBytes(requestedScreenshotIndex), { headers: { "content-type": "image/png" } })
      }
      if (path === "/global/health") return json({ version: "1.2.3" })
      if (path === "/global/projects/discover") return json([])
      if (path === "/project/current/worktrees") return json([])
      if (path === "/tasks" || path === "/global/tasks") return json({ tasks: [{ task: TASK }] })
      if (path === "/task/tsk_screenshot_browser/board") {
        return json(conversationPayload().board, { headers: { etag: '"board-screenshot-browser"' } })
      }
      if (path === "/task/tsk_screenshot_browser/operator-model-context")
        return json({ selected: null, candidates: [] })
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
        localStorage.setItem("oc_zoom", "1.6")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForSelector(`[data-task-id="${TASK.id}"]`, { visible: true })
      await page.waitForFunction(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.includes("/task/tsk_screenshot_browser/conversation")),
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      await page.evaluate(() => {
        const original = Element.prototype.scrollIntoView
        const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
        const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window)
        const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
        const clientWidthOwner = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")?.get
          ? HTMLElement.prototype
          : Element.prototype
        const clientWidthDescriptor = Object.getOwnPropertyDescriptor(clientWidthOwner, "clientWidth")
        if (!clientWidthDescriptor?.get) throw new Error("clientWidth getter was not found")
        let activeFrameID = 0
        let frameDepth = 0
        let nextFrameID = 1
        let sequence = 0
        ;(window as any).__screenshotBrowserLayoutEvents = []
        ;(window as any).__screenshotBrowserOpenPerf = {
          longTasks: [],
          rafGaps: [],
          supportedLongTasks: false,
        }
        let openPerfObserver: PerformanceObserver | undefined
        let openPerfFrame = 0
        let previousOpenPerfFrameTime = 0
        const sampleOpenPerfFrame = (time: number) => {
          const metrics = (window as any).__screenshotBrowserOpenPerf
          if (!metrics?.sampling) return
          if (previousOpenPerfFrameTime > 0) metrics.rafGaps.push(time - previousOpenPerfFrameTime)
          previousOpenPerfFrameTime = time
          openPerfFrame = originalRequestAnimationFrame(sampleOpenPerfFrame)
        }
        ;(window as any).__screenshotBrowserStartOpenPerf = () => {
          const metrics = (window as any).__screenshotBrowserOpenPerf
          metrics.longTasks = []
          metrics.rafGaps = []
          metrics.sampling = true
          previousOpenPerfFrameTime = 0
          openPerfFrame = originalRequestAnimationFrame(sampleOpenPerfFrame)
          if ("PerformanceObserver" in window) {
            const supported = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false
            metrics.supportedLongTasks = supported
            if (supported) {
              openPerfObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  metrics.longTasks.push({
                    duration: entry.duration,
                    name: entry.name,
                    startTime: entry.startTime,
                  })
                }
              })
              openPerfObserver.observe({ entryTypes: ["longtask"] })
            }
          }
        }
        ;(window as any).__screenshotBrowserStopOpenPerf = () => {
          const metrics = (window as any).__screenshotBrowserOpenPerf
          if (metrics) metrics.sampling = false
          if (openPerfFrame) originalCancelAnimationFrame(openPerfFrame)
          openPerfFrame = 0
          openPerfObserver?.disconnect()
          openPerfObserver = undefined
          return metrics
        }
        ;(window as any).__screenshotBrowserRestoreInstrumentation = () => {
          Object.defineProperty(clientWidthOwner, "clientWidth", clientWidthDescriptor)
          window.requestAnimationFrame = originalRequestAnimationFrame
          window.cancelAnimationFrame = originalCancelAnimationFrame
          Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
          Element.prototype.scrollIntoView = original
        }
        const recordLayoutEvent = (event: Record<string, unknown>) => {
          ;(window as any).__screenshotBrowserLayoutEvents.push({
            frameID: activeFrameID,
            inRaf: frameDepth > 0,
            sequence: ++sequence,
            ...event,
          })
        }
        Object.defineProperty(clientWidthOwner, "clientWidth", {
          configurable: true,
          get: function getClientWidthInstrumented(this: Element) {
            if (this instanceof HTMLElement && this.classList.contains("screenshot-browser-groups")) {
              recordLayoutEvent({ type: "screenshot-list-client-width" })
            }
            return clientWidthDescriptor.get!.call(this)
          },
        })
        Element.prototype.getBoundingClientRect = function getBoundingClientRectInstrumented() {
          const rect = originalGetBoundingClientRect.call(this)
          if (
            this instanceof HTMLElement &&
            (this.id === "centerWorkbenchWorkflow" ||
              this.id === "centerWorkbenchScreenshots" ||
              this.dataset.centerWorkbenchSeparator !== undefined)
          ) {
            recordLayoutEvent({ id: this.id, type: "center-workbench-rect-read" })
          }
          return rect
        }
        window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
          return originalRequestAnimationFrame((time) => {
            const previousFrameID = activeFrameID
            activeFrameID = nextFrameID++
            frameDepth += 1
            try {
              callback(time)
            } finally {
              frameDepth -= 1
              activeFrameID = previousFrameID
            }
          })
        }) as typeof requestAnimationFrame
        window.cancelAnimationFrame = originalCancelAnimationFrame
        Element.prototype.scrollIntoView = function scrollIntoViewInstrumented(
          this: Element,
          arg?: boolean | ScrollIntoViewOptions,
        ) {
          if (this instanceof HTMLElement && this.id === "centerWorkbenchScreenshots") {
            recordLayoutEvent({
              active: this.dataset.active,
              grow: this.style.getPropertyValue("--center-workbench-panel-grow"),
              open: this.dataset.open,
              selected: this.dataset.selected,
              separatorControls: document
                .querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")
                ?.getAttribute("aria-controls"),
              type: "screenshots-scroll-into-view",
              workbenchOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open,
            })
          }
          return (original as (this: Element, arg?: boolean | ScrollIntoViewOptions) => void).call(this, arg)
        }
      })
      const requestsBeforeOpen = attachmentRequests.length
      await page.evaluate(() => (window as any).__screenshotBrowserStartOpenPerf())
      const openStart = Date.now()
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']")
      await page.waitForFunction(() =>
        Array.from((window as any).__screenshotBrowserLayoutEvents ?? []).some(
          (event: any) => event.type === "screenshots-scroll-into-view",
        ),
      )
      const layoutEvents = await page.evaluate(() => (window as any).__screenshotBrowserLayoutEvents)
      const synchronousEvents = layoutEvents.filter(
        (event: any) =>
          (event.type === "screenshot-list-client-width" ||
            event.type === "screenshots-scroll-into-view" ||
            event.type === "center-workbench-rect-read") &&
          !event.inRaf,
      )
      assert.deepEqual(
        synchronousEvents,
        [],
        `screenshot open did layout work outside RAF: ${JSON.stringify(layoutEvents)}`,
      )
      const revealState = layoutEvents.filter((event: any) => event.type === "screenshots-scroll-into-view").at(-1)
      assert.ok(revealState, `screenshot open did not reveal the panel on RAF: ${JSON.stringify(layoutEvents)}`)
      assert.equal(typeof revealState.sequence, "number")
      assert.equal(typeof revealState.frameID, "number")
      const centerWorkbenchRectReads = layoutEvents.filter((event: any) => event.type === "center-workbench-rect-read")
      assert.ok(
        centerWorkbenchRectReads.length > 0,
        `screenshot open did not measure center workbench geometry: ${JSON.stringify(layoutEvents)}`,
      )
      const lastMeasurementBeforeReveal = centerWorkbenchRectReads
        .filter((event: any) => event.sequence < revealState.sequence)
        .at(-1)
      assert.ok(
        lastMeasurementBeforeReveal,
        `screenshot reveal happened before geometry measurement was observed: ${JSON.stringify(layoutEvents)}`,
      )
      assert.ok(
        revealState.frameID > lastMeasurementBeforeReveal.frameID,
        `screenshot reveal shared the measurement RAF: ${JSON.stringify(layoutEvents)}`,
      )
      const { frameID: _frameID, sequence: _sequence, ...revealStateStable } = revealState
      assert.deepEqual(revealStateStable, {
        active: "true",
        grow: "1",
        inRaf: true,
        open: "true",
        selected: "true",
        separatorControls: "centerWorkbenchWorkflow centerWorkbenchScreenshots",
        type: "screenshots-scroll-into-view",
        workbenchOpen: "true",
      })
      const widthReads = layoutEvents.filter((event: any) => event.type === "screenshot-list-client-width")
      assert.deepEqual(
        widthReads,
        [],
        `screenshot open should use ResizeObserver entries: ${JSON.stringify(layoutEvents)}`,
      )
      await page.waitForSelector(".screenshot-browser-card")
      const firstCardVisibleElapsed = Date.now() - openStart
      assert.ok(firstCardVisibleElapsed < 1_500, `screenshot browser first card took ${firstCardVisibleElapsed}ms`)
      await waitForVisibleScreenshotThumbnails(page, "initial open", attachmentRequests)
      const decodedElapsed = Date.now() - openStart
      const openPerf = await page.evaluate(() => (window as any).__screenshotBrowserStopOpenPerf())
      await page.evaluate(() => (window as any).__screenshotBrowserRestoreInstrumentation())
      const maxRafGap = Math.max(0, ...((openPerf?.rafGaps ?? []) as number[]))
      const longTaskDurations = ((openPerf?.longTasks ?? []) as Array<{ duration: number }>).map(
        (entry) => entry.duration,
      )
      const maxLongTask = Math.max(0, ...longTaskDurations)
      assert.equal(openPerf?.supportedLongTasks, true, `longtask observer unavailable: ${JSON.stringify(openPerf)}`)
      assert.ok(decodedElapsed < 5_000, `screenshot browser visible image decode took ${decodedElapsed}ms`)
      assert.ok(maxRafGap < 180, `screenshot browser open RAF gap was ${maxRafGap}ms: ${JSON.stringify(openPerf)}`)
      assert.ok(
        maxLongTask < 180,
        `screenshot browser open long task was ${maxLongTask}ms: ${JSON.stringify(openPerf)}`,
      )

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
        uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
      }))

      assert.equal(state.screenshotsOpen, "true")
      assert.equal(state.buttonActive, "true")
      assert.equal(state.title, "Screenshots")
      assert.equal(state.groupRole, "visual-qa")
      assert.equal(state.groupTitle, "Visual QA")
      assert.equal(state.cardTitle, "visual-check-119.png")
      assert.equal(state.virtualized, "true")
      assert.equal(state.virtualWindow, true)
      assert.ok(Number.parseFloat(state.uiScale) >= 1.55, JSON.stringify(state))
      assert.ok(state.cardCount > 0, JSON.stringify(state))
      assert.ok(state.cardCount < SCREENSHOT_COUNT, JSON.stringify(state))
      const openAttachmentRequests = attachmentRequests.length - requestsBeforeOpen
      assert.ok(
        openAttachmentRequests < 24,
        `initial screenshot open fetched too many attachments: ${openAttachmentRequests}`,
      )
      const initialAttachmentRequests = attachmentRequests.slice(requestsBeforeOpen)
      assert.ok(initialAttachmentRequests.length > 0, "initial screenshot open did not request visible thumbnails")
      assert.ok(
        initialAttachmentRequests.every((requestPath) =>
          requestPath.endsWith(`?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`),
        ),
        `thumbnail open requested non-thumbnail attachments: ${JSON.stringify(initialAttachmentRequests)}`,
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
      assert.ok(thumbLayout.triggerHeight >= 130, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.imageWidth >= thumbLayout.triggerWidth - 1, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.imageHeight >= thumbLayout.triggerHeight - 1, JSON.stringify(thumbLayout))
      assert.equal(thumbLayout.naturalWidth, SCREENSHOT_THUMBNAIL_IMAGE_WIDTH, JSON.stringify(thumbLayout))
      assert.equal(thumbLayout.naturalHeight, SCREENSHOT_THUMBNAIL_IMAGE_HEIGHT, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.naturalWidth < SCREENSHOT_IMAGE_WIDTH, JSON.stringify(thumbLayout))
      assert.ok(thumbLayout.naturalHeight < SCREENSHOT_IMAGE_HEIGHT, JSON.stringify(thumbLayout))

      const requestsBeforePreview = attachmentRequests.length
      await page.click(".screenshot-browser__thumb-trigger")
      await page.waitForSelector("#imagePreviewDialog .image-preview-dialog__image")
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>("#imagePreviewDialog .image-preview-dialog__image")
        return !!image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      })
      const previewLayout = await page.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>("#imagePreviewDialog .image-preview-dialog__image")
        return {
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
          src: image?.src ?? "",
        }
      })
      assert.equal(previewLayout.naturalWidth, SCREENSHOT_IMAGE_WIDTH, JSON.stringify(previewLayout))
      assert.equal(previewLayout.naturalHeight, SCREENSHOT_IMAGE_HEIGHT, JSON.stringify(previewLayout))
      const previewAttachmentRequests = attachmentRequests.slice(requestsBeforePreview)
      assert.equal(previewAttachmentRequests.length, 1, JSON.stringify(previewAttachmentRequests))
      assert.ok(!previewAttachmentRequests[0].includes("?variant="), JSON.stringify(previewAttachmentRequests))
      writeFileSync(
        resolve(".scratch/screenshot-browser-panel-browser-preview.png"),
        await page.screenshot({ fullPage: false }),
      )
      await page.click('#imagePreviewDialog [aria-label="Close"]')
      await page.waitForFunction(() => document.querySelector("#imagePreviewDialog") === null)

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
      const highZoomScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-high-zoom.png")
      writeFileSync(highZoomScreenshotPath, screenshot)

      await page.$eval('.screenshot-browser-groups[data-virtualized="true"]', (node) => {
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
          const scroll = document.querySelector<HTMLElement>('.screenshot-browser-groups[data-virtualized="true"]')
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

      const requestsBeforeCancellationStress = attachmentRequests.length
      await page.$eval('.screenshot-browser-groups[data-virtualized="true"]', (node) => {
        const scroll = node as HTMLElement
        const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
        for (const ratio of [0, 0.15, 0.35, 0.55, 0.8, 1, 0.45, 0]) {
          scroll.scrollTop = Math.round(maxTop * ratio)
        }
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          }),
      )
      await waitForVisibleScreenshotThumbnails(page, "cancellation stress", attachmentRequests)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open === "false",
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      const closedAttachmentRequests = attachmentRequests.length - requestsBeforeCancellationStress
      assert.ok(
        closedAttachmentRequests < 8,
        `closing screenshots left too many thumbnail loads active: ${closedAttachmentRequests}`,
      )
      const requestsBeforeReopen = attachmentRequests.length
      await page.evaluate(() => {
        const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
        const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window)
        let activeFrameID = 0
        let nextFrameID = 1
        const seenImages = new WeakSet<HTMLImageElement>()
        const imageInsertions: Array<{ frameID: number; src: string }> = []
        const recordImage = (image: HTMLImageElement) => {
          if (seenImages.has(image)) return
          seenImages.add(image)
          imageInsertions.push({
            frameID: activeFrameID,
            src: image.currentSrc || image.src,
          })
        }
        const recordNode = (node: Node) => {
          if (!(node instanceof Element)) return
          if (node.matches(".screenshot-browser__thumb-image")) recordImage(node as HTMLImageElement)
          for (const image of node.querySelectorAll<HTMLImageElement>(".screenshot-browser__thumb-image")) {
            recordImage(image)
          }
        }
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) recordNode(node)
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
          originalRequestAnimationFrame((time) => {
            activeFrameID = nextFrameID++
            callback(time)
          })) as typeof requestAnimationFrame
        window.cancelAnimationFrame = originalCancelAnimationFrame
        ;(window as any).__screenshotBrowserStopWarmCacheProbe = () => {
          observer.disconnect()
          window.requestAnimationFrame = originalRequestAnimationFrame
          window.cancelAnimationFrame = originalCancelAnimationFrame
          return { imageInsertions }
        }
      })
      const reopenStart = Date.now()
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']")
      await page.waitForSelector(".screenshot-browser-card")
      const reopenFirstCardElapsed = Date.now() - reopenStart
      assert.ok(reopenFirstCardElapsed < 1_500, `screenshot browser reopen first card took ${reopenFirstCardElapsed}ms`)
      await waitForVisibleScreenshotThumbnails(page, "warm-cache reopen", attachmentRequests)
      const warmCacheProbe = await page.evaluate(() => (window as any).__screenshotBrowserStopWarmCacheProbe())
      const insertions = (warmCacheProbe?.imageInsertions ?? []) as Array<{ frameID: number; src: string }>
      const insertionFrames = new Set(insertions.map((insertion) => insertion.frameID))
      const insertionsPerFrame = insertions.reduce<Record<string, number>>((counts, insertion) => {
        const key = String(insertion.frameID)
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      }, {})
      const maxInsertionsPerFrame = Math.max(0, ...Object.values(insertionsPerFrame))
      assert.ok(
        insertions.length > 1,
        `warm-cache reopen did not insert multiple images: ${JSON.stringify(insertions)}`,
      )
      assert.ok(
        [...insertionFrames].every((frameID) => frameID > 0),
        `warm-cache images bypassed RAF scheduling: ${JSON.stringify(insertions)}`,
      )
      assert.ok(insertionFrames.size > 1, `warm-cache images were inserted in one frame: ${JSON.stringify(insertions)}`)
      assert.ok(
        maxInsertionsPerFrame <= 1,
        `warm-cache image insertion exceeded one per frame: ${JSON.stringify(insertionsPerFrame)}`,
      )
      assert.equal(
        attachmentRequests.length - requestsBeforeReopen,
        0,
        `warm-cache reopen refetched attachments: ${attachmentRequests.length - requestsBeforeReopen}`,
      )
      assert.ok(
        attachmentRequests.length - requestsBeforeReopen < 24,
        `reopening screenshots materialized too many attachments: ${attachmentRequests.length - requestsBeforeReopen}`,
      )
      const reopenScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-reopen.png")
      writeFileSync(reopenScreenshotPath, await page.screenshot({ fullPage: false }))

      await page.setViewport({ width: 960, height: 1000 })
      await new Promise((resolve) => setTimeout(resolve, 100))

      const legalNarrowPanelWidth = await page.evaluate(() => {
        const panelMinProbe = document.createElement("div")
        panelMinProbe.style.position = "fixed"
        panelMinProbe.style.visibility = "hidden"
        panelMinProbe.style.width = "var(--ui-workbench-panel-min-width)"
        document.body.appendChild(panelMinProbe)
        const panelMinWidth = Math.ceil(panelMinProbe.getBoundingClientRect().width)
        panelMinProbe.remove()
        return panelMinWidth
      })
      await page.evaluate((width) => {
        const workbench = document.getElementById("centerWorkbench")
        const screenshots = document.getElementById("centerWorkbenchScreenshots")
        workbench?.style.setProperty("flex", `0 0 ${width}px`)
        workbench?.style.setProperty("width", `${width}px`)
        screenshots?.style.setProperty("flex", `0 0 ${width}px`)
        screenshots?.style.setProperty("width", `${width}px`)
      }, legalNarrowPanelWidth)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await page.$eval(".screenshot-browser-panel", (node: HTMLElement) => {
        node.scrollIntoView({ block: "center", inline: "center" })
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(".screenshot-browser-panel")
        if (!panel) return
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const rect = panel.getBoundingClientRect()
          if (rect.left >= 0 && rect.right <= window.innerWidth) return
          if (rect.left < 0) {
            window.scrollBy({ left: rect.left - 8, behavior: "auto" })
          } else if (rect.right > window.innerWidth) {
            window.scrollBy({ left: rect.right - window.innerWidth + 8, behavior: "auto" })
          }
        }
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
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
        const overlayMinProbe = document.createElement("div")
        overlayMinProbe.style.position = "fixed"
        overlayMinProbe.style.visibility = "hidden"
        overlayMinProbe.style.width = "var(--ui-overlay-min-width)"
        document.body.appendChild(overlayMinProbe)
        const overlayMinWidth = Math.round(overlayMinProbe.getBoundingClientRect().width)
        overlayMinProbe.remove()
        const panelMinProbe = document.createElement("div")
        panelMinProbe.style.position = "fixed"
        panelMinProbe.style.visibility = "hidden"
        panelMinProbe.style.width = "var(--ui-workbench-panel-min-width)"
        document.body.appendChild(panelMinProbe)
        const panelMinWidth = Math.round(panelMinProbe.getBoundingClientRect().width)
        panelMinProbe.remove()
        return {
          bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
          allowedBodyOverflowX: Math.max(0, overlayMinWidth - window.innerWidth),
          viewportWidth: window.innerWidth,
          panelMinWidth,
          panel,
          grid,
          card,
          thumb,
          cardEscaped: !!panel && !!card && (card.left < panel.left - 1 || card.right > panel.right + 1),
          thumbEscaped: !!panel && !!thumb && (thumb.left < panel.left - 1 || thumb.right > panel.right + 1),
        }
      })
      assert.ok(
        narrowLayout.panel?.width && narrowLayout.panel.width >= narrowLayout.panelMinWidth - 1,
        JSON.stringify(narrowLayout),
      )
      assert.ok(
        narrowLayout.panel?.left !== undefined &&
          narrowLayout.panel.left >= 0 &&
          narrowLayout.panel.right <= narrowLayout.viewportWidth,
        JSON.stringify(narrowLayout),
      )
      assert.ok(
        (narrowLayout.grid?.scrollWidth ?? 0) <= (narrowLayout.grid?.clientWidth ?? 0) + 1,
        JSON.stringify(narrowLayout),
      )
      assert.equal(narrowLayout.cardEscaped, false, JSON.stringify(narrowLayout))
      assert.equal(narrowLayout.thumbEscaped, false, JSON.stringify(narrowLayout))
      assert.ok(narrowLayout.bodyOverflowX <= narrowLayout.allowedBodyOverflowX + 1, JSON.stringify(narrowLayout))

      const narrowScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-narrow.png")
      const narrowScreenshot = await page.screenshot({ fullPage: false })
      assert.ok(narrowScreenshot.length > 0)
      writeFileSync(narrowScreenshotPath, narrowScreenshot)
      const narrowPanelScreenshotPath = resolve(".scratch/screenshot-browser-panel-browser-narrow-panel.png")
      const narrowPanelRect = await page.$eval(".screenshot-browser-panel", (node: HTMLElement) => {
        const panelRect = node.getBoundingClientRect()
        const titleNode = node.querySelector<HTMLElement>(".oc-surface-header__title")
        const listNode = node.querySelector<HTMLElement>(".screenshot-browser-groups")
        const titleRect = titleNode?.getBoundingClientRect()
        const listRect = listNode?.getBoundingClientRect()
        if (!titleRect || !listRect) {
          return {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            title: titleNode?.textContent ?? "",
            cardCount: node.querySelectorAll(".screenshot-browser-card").length,
            visibleTitle: false,
            visibleList: false,
          }
        }
        const left = Math.min(titleRect.left, listRect.left)
        const top = Math.min(titleRect.top, listRect.top)
        const right = Math.max(titleRect.right, listRect.right)
        const bottom = Math.max(titleRect.bottom, listRect.bottom)
        const clipLeft = Math.max(0, Math.floor(left - 8))
        const clipTop = Math.max(0, Math.floor(top - 8))
        const clipRight = Math.min(window.innerWidth, Math.ceil(right + 8))
        const clipBottom = Math.min(window.innerHeight, Math.ceil(bottom + 8))
        return {
          panelLeft: Math.round(panelRect.left),
          panelRight: Math.round(panelRect.right),
          x: clipLeft,
          y: clipTop,
          width: Math.max(1, clipRight - clipLeft),
          height: Math.max(1, clipBottom - clipTop),
          title: node.querySelector(".oc-surface-header__title")?.textContent ?? "",
          cardCount: node.querySelectorAll(".screenshot-browser-card").length,
          visibleTitle:
            titleRect.right > 0 &&
            titleRect.left < window.innerWidth &&
            titleRect.bottom > 0 &&
            titleRect.top < window.innerHeight,
          fullTitle:
            titleRect.left >= 0 &&
            titleRect.right <= window.innerWidth &&
            titleRect.top >= 0 &&
            titleRect.bottom <= window.innerHeight,
          visibleList:
            listRect.right > 0 &&
            listRect.left < window.innerWidth &&
            listRect.bottom > 0 &&
            listRect.top < window.innerHeight,
        }
      })
      assert.equal(narrowPanelRect.title, "Screenshots", JSON.stringify(narrowPanelRect))
      assert.ok(narrowPanelRect.cardCount > 0, JSON.stringify(narrowPanelRect))
      assert.equal(narrowPanelRect.visibleTitle, true, JSON.stringify(narrowPanelRect))
      assert.equal(narrowPanelRect.fullTitle, true, JSON.stringify(narrowPanelRect))
      assert.equal(narrowPanelRect.visibleList, true, JSON.stringify(narrowPanelRect))
      const narrowPanelScreenshot = await page.screenshot({
        clip: {
          x: narrowPanelRect.x,
          y: narrowPanelRect.y,
          width: narrowPanelRect.width,
          height: narrowPanelRect.height,
        },
      })
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
