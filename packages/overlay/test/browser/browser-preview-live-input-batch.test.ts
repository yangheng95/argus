import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import sharp from "sharp"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
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

const rightActivityOpenPredicates: Record<"browser" | "explorer" | "inspector" | "screenshots", () => boolean> = {
  browser: () => document.querySelector<HTMLElement>('[data-workbench-view="browser"]')?.dataset.open === "true",
  explorer: () => document.querySelector<HTMLElement>('[data-workbench-view="explorer"]')?.dataset.open === "true",
  inspector: () => document.querySelector<HTMLElement>('[data-workbench-view="inspector"]')?.dataset.open === "true",
  screenshots: () =>
    document.querySelector<HTMLElement>('[data-workbench-view="screenshots"]')?.dataset.open === "true",
}

async function openRightActivity(
  page: OverlayPage,
  activity: "browser" | "explorer" | "inspector" | "screenshots",
  diagnostics: () => unknown,
) {
  const selector = `[data-ui="side-activity-button"][data-side="right"][data-activity="${activity}"]`
  await page.waitForSelector(selector, { visible: true })
  const isOpen = await page.evaluate(
    (value) => document.querySelector<HTMLElement>(`[data-workbench-view="${value}"]`)?.dataset.open === "true",
    activity,
  )
  if (!isOpen) await page.click(selector)
  await waitForPageState(page, rightActivityOpenPredicates[activity], `${activity} right activity open`, diagnostics)
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

async function forceBrowserPreviewHorizontalScroll(page: OverlayPage, diagnostics: () => unknown) {
  await page.setViewport({ width: 1280, height: 900 })
  await openRightActivity(page, "screenshots", diagnostics)
  await openRightActivity(page, "inspector", diagnostics)
  await openRightActivity(page, "explorer", diagnostics)
  await openRightActivity(page, "browser", diagnostics)
  return await page.evaluate(async () => {
    const body = document.querySelector<HTMLElement>(".center-workbench-body")
    const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
    if (!body || !image) throw new Error("Browser preview scroll fixture is missing")
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const before = image.getBoundingClientRect()
    const maxScroll = body.scrollWidth - body.clientWidth
    if (maxScroll < 120) throw new Error(`Browser preview scroll fixture needs overflow, maxScroll=${maxScroll}`)
    body.scrollLeft = Math.min(maxScroll, body.scrollLeft + 120)
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const after = image.getBoundingClientRect()
    return {
      afterLeft: after.left,
      beforeLeft: before.left,
      deltaLeft: after.left - before.left,
      imageWidth: after.width,
      maxScroll,
      scrollLeft: body.scrollLeft,
      visible: after.right > 0 && after.left < window.innerWidth,
    }
  })
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
    if (path === "/global/tasks" || path === "/tasks") return json({ tasks: [{ task, updated_at: now - 1_000 }] })
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
        view: { rootID: "root", cards: {}, order: [] },
        agentView: { rootID: "root", cards: {}, order: [] },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
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
    await dispatchMixedInput(page)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "mixed click wheel key live input")
    await waitForFixtureActivity(
      () => liveInputBodies.length >= 1,
      "mixed click wheel key live input batch",
      () => ({ requestLog, liveInputBodies }),
    )
    const firstBody = liveInputBodies[0] as { input?: unknown; inputs?: Array<{ kind?: string; deltaY?: number }> }
    assert.equal(firstBody.input, undefined)
    assert.deepEqual(
      firstBody.inputs?.map((input) => input.kind),
      ["click", "wheel", "key"],
    )

    const beforeBurstCount = liveInputBodies.length
    const wheelEventCount = 20
    await dispatchWheelBurst(page, wheelEventCount)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "wheel burst live input")
    await waitForFixtureActivity(
      () => liveInputBodies.length > beforeBurstCount,
      "wheel burst live input batch",
      () => ({ requestLog, liveInputBodies }),
    )
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

    const scrollMetrics = await forceBrowserPreviewHorizontalScroll(page, () => ({
      liveInputBodies,
      liveSnapshotBodies,
      requestLog,
    }))
    assert.ok(
      scrollMetrics.visible,
      `browser preview live image should remain visible after scroll: ${JSON.stringify(scrollMetrics)}`,
    )
    assert.ok(
      Math.abs(scrollMetrics.deltaLeft) > 40,
      `browser preview scroll should move the live image viewport rect: ${JSON.stringify(scrollMetrics)}`,
    )
    const beforeScrolledClickCount = liveInputBodies.length
    await dispatchLiveClickAtVisualCenter(page)
    assertNoLiveInputEventLayoutReads(await liveInputLayoutProbeSummary(page), "scrolled visual-center live click")
    await waitForFixtureActivity(
      () => liveInputBodies.length > beforeScrolledClickCount,
      "scrolled visual-center live click",
      () => ({ requestLog, liveInputBodies, scrollMetrics }),
    )
    assertCenteredLiveClickInput(liveInputBodies.at(-1), viewports[0], "scrolled visual-center live click")

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
