import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import sharp from "sharp"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"

const SCREENSHOT_PATH = fileURLToPath(new URL("../../.scratch/browser-preview-live-input-batch.png", import.meta.url))

await ensureOverlayDist()

type OverlayPage = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>

interface LiveInputLayoutProbeSummary {
  totalRectReads: number
  inputEventRectReads: number
  rafRectReads: number
  events: Array<{
    inInputEvent: boolean
    inRaf: boolean
  }>
}

interface InteractionPerf {
  longTaskCount: number
  maxLongTaskMs: number
  maxRafGapMs: number
}

const PERF_LIMITS = {
  maxRafGapMs: 120,
  maxLongTaskMs: 160,
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

function eventStream() {
  return new Response(":\n\n", {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    }
    return entities[char]
  })
}

async function pngBytes(label: string, colors: [string, string]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset="1" stop-color="${colors[1]}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="30" y="34" width="580" height="82" rx="8" fill="rgba(255,255,255,.9)"/>
    <text x="54" y="86" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#0f172a">${escapeXml(label)}</text>
    <rect x="56" y="154" width="156" height="122" rx="6" fill="rgba(15,23,42,.78)"/>
    <rect x="244" y="154" width="156" height="122" rx="6" fill="rgba(255,255,255,.68)"/>
    <rect x="432" y="154" width="156" height="122" rx="6" fill="rgba(22,163,74,.74)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function activityDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (key === "requestLog" && Array.isArray(item)) {
      const meaningful = item.filter(
        (entry) =>
          typeof entry !== "string" ||
          (!/^GET \/task(?:\/[^/]+)?\/events(?:\?|$)/.test(entry) && !/^POST \/log$/.test(entry)),
      )
      out[key] = { length: meaningful.length, last: meaningful.at(-1) }
      continue
    }
    out[key] = Array.isArray(item) ? { length: item.length, last: item.at(-1) } : item
  }
  return out
}

async function waitForPageState(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  predicate: () => boolean,
  label: string,
  diagnostics: () => unknown,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate(predicate)) return
    const signature = JSON.stringify({
      page: await page.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
        return {
          centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
          browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
          stage:
            document.querySelector<HTMLElement>(".browser-preview-stage")?.textContent?.replace(/\s+/g, " ").trim() ??
            "",
          liveLoading: !!document.querySelector<HTMLElement>('[data-ui="browser-preview-live-loading"]'),
          liveImage: image
            ? {
                complete: image.complete,
                naturalHeight: image.naturalHeight,
                naturalWidth: image.naturalWidth,
              }
            : null,
          stageStatus:
            document.querySelector<HTMLElement>(
              "[data-ui='browser-preview-live'], [data-ui='browser-preview-live-error'], [data-ui='browser-preview-target-load-failed'], [data-ui='browser-preview-target-failed']",
            )?.dataset.status || "",
        }
      }),
      diagnostics: activityDiagnostics(diagnostics()),
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No page activity while waiting for ${label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForFixtureActivity(predicate: () => boolean, label: string, diagnostics: () => unknown) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (predicate()) return
    const signature = JSON.stringify(activityDiagnostics(diagnostics()))
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No fixture activity while waiting for ${label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function openBrowserPreviewFromTask(page: OverlayPage, taskID: string, diagnostics: () => unknown) {
  await page.waitForSelector(
    '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
    {
      visible: true,
    },
  )
  await page.click(
    '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
  )
  await waitForPageState(
    page,
    () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
    "task rail open",
    diagnostics,
  )
  const taskRow = `.task-row-main[data-task-id="${taskID}"]`
  await page.waitForSelector(taskRow, { visible: true })
  await page.click(taskRow)
  await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]', {
    visible: true,
  })
  await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
}

async function clickBrowserPreviewViewport(page: OverlayPage, viewportID: "desktop" | "tablet" | "mobile") {
  const selector = `[data-ui="browser-preview-viewport"][data-viewport-id="${viewportID}"]`
  await page.waitForSelector(selector, { visible: true })
  await page.evaluate((value) => {
    const node = document.querySelector<HTMLElement>(String(value))
    if (!node) throw new Error(`Browser preview viewport trigger is missing: ${value}`)
    node.click()
  }, selector)
}

async function installLiveInputLayoutProbe(page: OverlayPage) {
  await page.evaluate(() => {
    const win = window as any
    if (win.__browserPreviewLiveInputLayoutProbeInstalled) return
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
    const originalGetBoundingClientRect = HTMLImageElement.prototype.getBoundingClientRect
    const probe = {
      inputEventDepth: 0,
      rafDepth: 0,
      events: [] as Array<{ inInputEvent: boolean; inRaf: boolean }>,
      reset() {
        this.events = []
      },
      enterInputEvent() {
        this.inputEventDepth += 1
      },
      exitInputEvent() {
        this.inputEventDepth = Math.max(0, this.inputEventDepth - 1)
      },
      summary(): LiveInputLayoutProbeSummary {
        const inputEventRectReads = this.events.filter((event) => event.inInputEvent).length
        const rafRectReads = this.events.filter((event) => event.inRaf).length
        return {
          totalRectReads: this.events.length,
          inputEventRectReads,
          rafRectReads,
          events: this.events.slice(),
        }
      },
    }
    win.__browserPreviewLiveInputLayoutProbe = probe
    win.__browserPreviewLiveInputLayoutProbeInstalled = true
    window.requestAnimationFrame = (callback: FrameRequestCallback) =>
      originalRequestAnimationFrame((time) => {
        probe.rafDepth += 1
        try {
          callback(time)
        } finally {
          probe.rafDepth = Math.max(0, probe.rafDepth - 1)
        }
      })
    HTMLImageElement.prototype.getBoundingClientRect = function getBoundingClientRectWithLiveInputProbe() {
      if ((this as HTMLElement).dataset.ui === "browser-preview-live-screenshot") {
        probe.events.push({
          inInputEvent: probe.inputEventDepth > 0,
          inRaf: probe.rafDepth > 0,
        })
      }
      return originalGetBoundingClientRect.call(this)
    }
  })
}

async function liveInputLayoutProbeSummary(page: OverlayPage): Promise<LiveInputLayoutProbeSummary> {
  return await page.evaluate(() => (window as any).__browserPreviewLiveInputLayoutProbe.summary())
}

function assertNoLiveInputEventLayoutReads(summary: LiveInputLayoutProbeSummary, label: string) {
  assert.equal(
    summary.inputEventRectReads,
    0,
    `${label}: live input event handler read screenshot layout: ${JSON.stringify(summary.events)}`,
  )
}

async function startInteractionPerfProbe(page: OverlayPage) {
  await page.evaluate(() => {
    const state = {
      longTasks: [] as number[],
      observer: undefined as PerformanceObserver | undefined,
      rafGaps: [] as number[],
      rafID: 0,
      sampling: true,
    }
    let previousFrame = performance.now()
    const tick = (time: number) => {
      if (!state.sampling) return
      state.rafGaps.push(time - previousFrame)
      previousFrame = time
      state.rafID = requestAnimationFrame(tick)
    }
    if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
      })
      state.observer.observe({ entryTypes: ["longtask"] })
    }
    state.rafID = requestAnimationFrame(tick)
    ;(window as any).__browserPreviewInteractionPerf = state
  })
}

async function stopInteractionPerfProbe(page: OverlayPage): Promise<InteractionPerf> {
  return await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const state = (window as any).__browserPreviewInteractionPerf
    if (!state) throw new Error("missing Browser Preview interaction perf probe")
    state.sampling = false
    cancelAnimationFrame(state.rafID)
    state.observer?.disconnect()
    return {
      longTaskCount: state.longTasks.length,
      maxLongTaskMs: state.longTasks.length > 0 ? Math.max(...state.longTasks) : 0,
      maxRafGapMs: Math.max(0, ...state.rafGaps),
    }
  })
}

function assertInteractionPerf(metric: InteractionPerf, label: string) {
  assert.ok(metric.maxRafGapMs <= PERF_LIMITS.maxRafGapMs, `${label} maxRafGapMs=${metric.maxRafGapMs}`)
  assert.ok(metric.maxLongTaskMs <= PERF_LIMITS.maxLongTaskMs, `${label} maxLongTaskMs=${metric.maxLongTaskMs}`)
}

async function livePreviewPaneLayout(page: OverlayPage) {
  return await page.evaluate(async () => {
    const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
    const live = document.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
    const frame = document.querySelector<HTMLElement>(".browser-preview-live-frame")
    const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!stage || !live || !frame || !image) throw new Error("Browser preview live pane layout fixture is missing")
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const liveStyle = getComputedStyle(live)
    const frameStyle = getComputedStyle(frame)
    const imageStyle = getComputedStyle(image)
    const liveContentWidth =
      live.clientWidth - parseFloat(liveStyle.paddingLeft || "0") - parseFloat(liveStyle.paddingRight || "0")
    const stageRect = stage.getBoundingClientRect()
    const liveRect = live.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    return {
      aspectRatio: frameStyle.aspectRatio,
      frameTransform: frameStyle.transform,
      frameWidth: frameRect.width,
      imageHeight: imageRect.height,
      imageTransform: imageStyle.transform,
      imageWidth: imageRect.width,
      liveContentWidth,
      liveFlex: liveStyle.flex,
      liveWidth: liveRect.width,
      stageClientWidth: stage.clientWidth,
      stageScrollWidth: stage.scrollWidth,
      stageWidth: stageRect.width,
    }
  })
}

function assertLivePreviewFitsPane(
  layout: Awaited<ReturnType<typeof livePreviewPaneLayout>>,
  label: string,
) {
  assert.ok(
    layout.stageScrollWidth - layout.stageClientWidth <= 1,
    `${label}: live preview stage must not create horizontal overflow\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.ok(
    Math.abs(layout.frameWidth - layout.liveContentWidth) <= 2,
    `${label}: live frame should fill the pane content width\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.ok(
    Math.abs(layout.imageWidth - layout.frameWidth) <= 2,
    `${label}: live screenshot should render at the frame width\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.ok(
    layout.imageHeight > 0,
    `${label}: live screenshot should remain visible after width-fit scaling\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.notEqual(layout.aspectRatio, "auto", `${label}: live frame must carry backend viewport aspect ratio`)
  assert.equal(layout.frameTransform, "none", `${label}: live frame must not use CSS transform scaling`)
  assert.equal(layout.imageTransform, "none", `${label}: live image must not use CSS transform scaling`)
}

async function dispatchLiveClickAtVisualCenter(page: OverlayPage) {
  return await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".browser-preview-live-frame")
    const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!frame || !image) throw new Error("Browser preview live frame is missing")
    const probe = (window as any).__browserPreviewLiveInputLayoutProbe
    probe?.reset()
    const rect = image.getBoundingClientRect()
    const clientX = rect.left + rect.width / 2
    const clientY = rect.top + rect.height / 2
    probe?.enterInputEvent()
    try {
      frame.focus()
      frame.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 7,
          pointerType: "mouse",
        }),
      )
    } finally {
      probe?.exitInputEvent()
    }
    return { clientX, clientY, height: rect.height, left: rect.left, top: rect.top, width: rect.width }
  })
}

function assertCenteredLiveClickInput(body: unknown, viewport: { width: number; height: number }, label: string) {
  const inputs = (body as { inputs?: Array<{ kind?: string; x?: number; y?: number }> }).inputs ?? []
  const click = inputs.find((input) => input.kind === "click")
  assert.ok(click, `${label}: expected click input in ${JSON.stringify(body)}`)
  assert.ok(
    Math.abs(Number(click.x) - viewport.width / 2) <= 2,
    `${label}: expected x near ${viewport.width / 2}, got ${JSON.stringify(click)}`,
  )
  assert.ok(
    Math.abs(Number(click.y) - viewport.height / 2) <= 2,
    `${label}: expected y near ${viewport.height / 2}, got ${JSON.stringify(click)}`,
  )
}

async function dispatchMixedInput(page: OverlayPage) {
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".browser-preview-live-frame")
    const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!frame || !image) throw new Error("Browser preview live frame is missing")
    const probe = (window as any).__browserPreviewLiveInputLayoutProbe
    probe?.reset()
    const rect = image.getBoundingClientRect()
    const clientX = rect.left + rect.width / 2
    const clientY = rect.top + rect.height / 2
    const dispatchInput = (event: Event) => {
      probe?.enterInputEvent()
      try {
        frame.dispatchEvent(event)
      } finally {
        probe?.exitInputEvent()
      }
    }
    frame.focus()
    dispatchInput(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX,
        clientY,
        pointerId: 1,
        pointerType: "mouse",
      }),
    )
    dispatchInput(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        deltaX: 2,
        deltaY: 24,
      }),
    )
    dispatchInput(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a" }))
  })
}

async function dispatchWheelBurst(page: OverlayPage, count: number) {
  await page.evaluate((eventCount) => {
    const frame = document.querySelector<HTMLElement>(".browser-preview-live-frame")
    const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!frame || !image) throw new Error("Browser preview live frame is missing")
    const probe = (window as any).__browserPreviewLiveInputLayoutProbe
    probe?.reset()
    const rect = image.getBoundingClientRect()
    const clientX = rect.left + rect.width / 2
    const clientY = rect.top + rect.height / 2
    const dispatchInput = (event: Event) => {
      probe?.enterInputEvent()
      try {
        frame.dispatchEvent(event)
      } finally {
        probe?.exitInputEvent()
      }
    }
    frame.focus()
    for (let index = 0; index < Number(eventCount); index += 1) {
      dispatchInput(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          deltaY: 10,
        }),
      )
    }
  }, count)
}

const promptProfileCatalog = {
  active: "default",
  project_active: "default",
  session_active: null,
  default: "default",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  profiles: [
    {
      id: "default",
      label: "Default",
      description: "Default implementation profile.",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

test("browser preview live surface batches input and coalesces wheel bursts", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })

  const now = Date.now()
  const taskID = "tsk_browserpreview_live_input_batch"
  const targetID = "art_previewtarget_live_input_batch"
  const projectRoot = "D:/overlay/workspace/live-input"
  const requestLog: string[] = []
  const errors: string[] = []
  const liveSnapshotBodies: unknown[] = []
  const liveInputBodies: unknown[] = []
  const captureBodies: unknown[] = []
  const unexpectedRequests: string[] = []
  const livePng = await pngBytes("live snapshot ready", ["#1d4ed8", "#0f766e"])
  const inputPng = await pngBytes("live input batch", ["#166534", "#15803d"])
  let serverOrigin = ""
  const previewUrl = () => `${serverOrigin}/preview/live-input`
  const viewports = [
    { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
    { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
    { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
  ]
  const task = {
    id: taskID,
    directory: projectRoot,
    orderKey: testTaskOrderKey(taskID, now - 10_000),
    status: "active",
    sessionID: "ses_live_input_batch",
    request: "Verify live input batching",
    title: "Verify live input batching",
    time: { created: now - 10_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "live-input-batch-board",
    lastSequence: 0,
    task,
    overview: {
      headline: "Live input batching",
      summary: "Backend-owned live browser preview target is ready.",
      controls: {},
    },
    lanes: [],
    interactions: [],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${url.pathname}${url.search}`)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/preview/live-input")
      return new Response("<main>Live input fixture target</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return json({ version: "1.2.3" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover") return json([])
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json({ profiles: [] })
    if (path === `/task/${taskID}/operator-model-context`) return json({ selected: null, candidates: [] })
    if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/path") return json({ directory: projectRoot })
    if (path === "/vcs")
      return json({
        branch: "live-input-batch",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return json({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return json({})
    if (path === "/config/prompt-profile") return json(promptProfileCatalog)
    if (path === "/config" && req.method === "PATCH") return json({ model: "", prompt_profile: { active: "default" } })
    if (path === "/config") return json({ model: "", prompt_profile: { active: "default" } })
    if (path === "/log" && req.method === "POST") return json({ ok: true })
    if (path === "/channel") return json([])
    if (path === "/executor") return json([])
    if (path === "/agent") return json([])
    if (path === "/file") return json([])
    if (path === "/find/file") return json([])
    if (path === "/skill/installed" || path === "/skill") return json([])
    if (path === "/skill/mounts")
      return json({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
    if (path === "/skill/market") return json([])
    if (path === "/mcp") return json({})
    if (path === "/panel/knowledge/memory") return json([])
    if (path === "/panel/knowledge/preference") return json([])
    if (path === `/task/${taskID}/board`) return json(board, { headers: { etag: `"board-${now}"` } })
    if (path === `/task/${taskID}/conversation`)
      return json({
        lastSequence: 0,
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        messageWatermark: 0,
      })
    if (path === `/task/${taskID}/transcript`) return json([])
    if (path === `/task/${taskID}/trace`)
      return json({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
    if (path === "/task/events" || path === `/task/${taskID}/events` || path === `/task/${taskID}/conversation/events`)
      return eventStream()
    if (path === `/task/${taskID}/browser-preview`)
      return json({
        id: targetID,
        taskID,
        latestEvidenceIDs: {},
        kind: "task-url",
        status: "ready",
        projectRoot,
        url: previewUrl(),
        viewports,
        diagnostics: ["Resolved live input batch preview target."],
        candidates: [
          {
            id: targetID,
            url: previewUrl(),
            source: "task-artifact",
            selected: true,
            timeUpdated: now - 500,
          },
        ],
        source: "task-artifact",
      })
    if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
      captureBodies.push(await req.json())
      return json({ message: "live input batch test must not auto-capture evidence" }, { status: 500 })
    }
    if (path === `/task/${taskID}/browser-preview/live/snapshot` && req.method === "POST") {
      liveSnapshotBodies.push(await req.json())
      return new Response(livePng, { headers: { "content-type": "image/png" } })
    }
    if (path === `/task/${taskID}/browser-preview/live/input` && req.method === "POST") {
      liveInputBodies.push(await req.json())
      return new Response(inputPng, { headers: { "content-type": "image/png" } })
    }
    unexpectedRequests.push(`${req.method} ${path}`)
    return json({ message: `Unexpected live input batch route ${req.method} ${path}` }, { status: 404 })
  })
  serverOrigin = server.origin

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/live-input")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_workspace_task", "tsk_browserpreview_live_input_batch")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/live-input")
      const settings = {
        serverUrl,
        autoServer: false,
        locale: "en-US",
        directory: "D:/overlay/workspace/live-input",
        directoryMode: "custom",
        workspaceTaskID: "tsk_browserpreview_live_input_batch",
        workspaceDirectory: "D:/overlay/workspace/live-input",
      }
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return settings
            if (command === "overlay_settings_save") {
              Object.assign(settings, (args.settings as Record<string, unknown>) || {})
              return true
            }
            if (command === "overlay_open_path") return true
            if (command === "overlay_open_url") return true
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => true,
              hide: async () => true,
              startDragging: async () => true,
              minimize: async () => true,
            }
          },
        },
      }
    }, server.origin)
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack || error.message}`))
    page.on("requestfailed", (request) => {
      if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      errors.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`response${response.status()}: ${response.url()}`)
    })
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
    })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await waitForPageState(
      page,
      () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
      "online connection",
      () => ({ errors, requestLog }),
    )
    await openBrowserPreviewFromTask(page, taskID, () => ({ errors, requestLog }))
    await waitForPageState(
      page,
      () => {
        const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
        return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      },
      "initial live screenshot",
      () => ({ errors, requestLog, liveSnapshotBodies, liveInputBodies }),
    )
    assert.equal(captureBodies.length, 0, "opening live preview must not auto-capture evidence")
    assert.equal(
      liveSnapshotBodies.filter((body) => (body as { targetID?: unknown; viewportID?: unknown }).targetID === targetID)
        .length,
      1,
      `initial live scope should request exactly one snapshot: ${JSON.stringify(liveSnapshotBodies)}`,
    )
    assert.deepEqual(liveSnapshotBodies[0], { targetID, viewportID: "desktop" })

    await installLiveInputLayoutProbe(page)
    await startInteractionPerfProbe(page)
    await dispatchMixedInput(page)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "mixed click wheel key live input")
    await waitForFixtureActivity(
      () => liveInputBodies.length >= 1,
      "mixed click wheel key live input batch",
      () => ({ requestLog, liveInputBodies }),
    )
    const mixedInputPerf = await stopInteractionPerfProbe(page)
    assertInteractionPerf(mixedInputPerf, "mixed click wheel key live input")
    const firstBody = liveInputBodies[0] as { input?: unknown; inputs?: Array<{ kind?: string; deltaY?: number }> }
    assert.equal(firstBody.input, undefined)
    assert.deepEqual(
      firstBody.inputs?.map((input) => input.kind),
      ["click", "wheel", "key"],
    )

    const beforeBurstCount = liveInputBodies.length
    const wheelEventCount = 20
    await startInteractionPerfProbe(page)
    await dispatchWheelBurst(page, wheelEventCount)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "wheel burst live input")
    await waitForFixtureActivity(
      () => liveInputBodies.length > beforeBurstCount,
      "wheel burst live input batch",
      () => ({ requestLog, liveInputBodies }),
    )
    const wheelBurstPerf = await stopInteractionPerfProbe(page)
    assertInteractionPerf(wheelBurstPerf, "wheel burst live input")
    const burstBodies = liveInputBodies.slice(beforeBurstCount) as Array<{
      inputs?: Array<{ kind?: string; deltaY?: number }>
    }>
    assert.ok(
      burstBodies.length < wheelEventCount,
      `wheel burst should create fewer live input requests than events\n${JSON.stringify(burstBodies, null, 2)}`,
    )
    const burstWheelDelta = burstBodies
      .flatMap((body) => body.inputs ?? [])
      .filter((input) => input.kind === "wheel")
      .reduce((total, input) => total + Number(input.deltaY || 0), 0)
    assert.equal(burstWheelDelta, wheelEventCount * 10)

    assertLivePreviewFitsPane(await livePreviewPaneLayout(page), "initial live preview pane fit")
    await page.setViewport({ width: 1120, height: 760 })
    await waitForPageState(
      page,
      () => {
        const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
        return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      },
      "live screenshot after pane resize",
      () => ({ errors, requestLog, liveInputBodies }),
    )
    assertLivePreviewFitsPane(await livePreviewPaneLayout(page), "resized live preview pane fit")
    const beforeResizedClickCount = liveInputBodies.length
    await startInteractionPerfProbe(page)
    await dispatchLiveClickAtVisualCenter(page)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "resized visual-center live click")
    await waitForFixtureActivity(
      () => liveInputBodies.length > beforeResizedClickCount,
      "resized visual-center live click",
      () => ({ requestLog, liveInputBodies }),
    )
    const resizedClickPerf = await stopInteractionPerfProbe(page)
    assertInteractionPerf(resizedClickPerf, "resized visual-center live click")
    assertCenteredLiveClickInput(liveInputBodies.at(-1), viewports[0], "resized visual-center live click")
    console.log(
      `[perf] browser-preview-live-input mixed=${mixedInputPerf.maxRafGapMs.toFixed(1)}raf/${mixedInputPerf.maxLongTaskMs.toFixed(1)}lt ` +
        `wheel=${wheelBurstPerf.maxRafGapMs.toFixed(1)}raf/${wheelBurstPerf.maxLongTaskMs.toFixed(1)}lt ` +
        `resizedClick=${resizedClickPerf.maxRafGapMs.toFixed(1)}raf/${resizedClickPerf.maxLongTaskMs.toFixed(1)}lt`,
    )

    await waitForPageState(
      page,
      () => {
        const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
        return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      },
      "live screenshot after input batch",
      () => ({ errors, requestLog, liveInputBodies }),
    )
    const panel = await page.$(".browser-preview-panel")
    assert.ok(panel)
    const screenshot = await panel.screenshot()
    writeFileSync(SCREENSHOT_PATH, screenshot)
    const panelMetrics = await page.evaluate(() => {
      const panelElement = document.querySelector<HTMLElement>(".browser-preview-panel")
      const tokenProbe = document.createElement("div")
      tokenProbe.style.position = "absolute"
      tokenProbe.style.visibility = "hidden"
      tokenProbe.style.width = "var(--ui-workbench-panel-min-width)"
      document.body.append(tokenProbe)
      const minWidth = tokenProbe.getBoundingClientRect().width
      tokenProbe.remove()
      return {
        minWidth,
        width: panelElement?.getBoundingClientRect().width ?? 0,
      }
    })
    const metadata = await sharp(screenshot).metadata()
    const stats = await sharp(screenshot).stats()
    assert.ok(
      panelMetrics.width >= panelMetrics.minWidth - 1,
      `browser preview panel width should stay legal: ${JSON.stringify(panelMetrics)}`,
    )
    assert.ok(
      (metadata.width || 0) >= panelMetrics.minWidth - 1,
      `browser preview screenshot width should stay legal: ${JSON.stringify({ metadata, panelMetrics })}`,
    )
    assert.ok((metadata.height || 0) >= 300)
    const colorRange = stats.channels.slice(0, 3).reduce((total, channel) => total + channel.max - channel.min, 0)
    assert.ok(colorRange > 80, `live input batch screenshot should be nonblank, color range ${colorRange}`)

    await clickBrowserPreviewViewport(page, "tablet")
    await waitForFixtureActivity(
      () =>
        liveSnapshotBodies.filter(
          (body) =>
            (body as { targetID?: unknown; viewportID?: unknown }).targetID === targetID &&
            (body as { viewportID?: unknown }).viewportID === "tablet",
        ).length === 1,
      "tablet live snapshot exact count",
      () => ({ requestLog, liveSnapshotBodies }),
    )
    assert.equal(
      liveSnapshotBodies.filter(
        (body) =>
          (body as { targetID?: unknown; viewportID?: unknown }).targetID === targetID &&
          (body as { viewportID?: unknown }).viewportID === "desktop",
      ).length,
      1,
      `desktop live scope should not repeat after load: ${JSON.stringify(liveSnapshotBodies)}`,
    )
    assert.equal(
      liveSnapshotBodies.filter(
        (body) =>
          (body as { targetID?: unknown; viewportID?: unknown }).targetID === targetID &&
          (body as { viewportID?: unknown }).viewportID === "tablet",
      ).length,
      1,
      `tablet live scope should request exactly one snapshot: ${JSON.stringify(liveSnapshotBodies)}`,
    )
    assert.equal(captureBodies.length, 0, "live input interactions must not trigger hidden evidence capture")
    assert.deepEqual(unexpectedRequests, [])
    assert.equal(errors.length, 0, errors.join("\n"))
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
