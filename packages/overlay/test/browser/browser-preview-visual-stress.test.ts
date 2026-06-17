import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

const PORT = 7778
const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/browser-preview-visual-stress/", import.meta.url))

await ensureOverlayDist()

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

async function pngBytes(label: string, colors: [string, string]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset="1" stop-color="${colors[1]}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="32" y="38" width="576" height="88" rx="8" fill="rgba(255,255,255,.86)"/>
    <text x="54" y="94" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#0f172a">${escapeXml(label)}</text>
    <rect x="48" y="162" width="182" height="118" rx="6" fill="rgba(15,23,42,.78)"/>
    <rect x="252" y="162" width="148" height="118" rx="6" fill="rgba(255,255,255,.64)"/>
    <rect x="422" y="162" width="170" height="118" rx="6" fill="rgba(22,163,74,.72)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
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

async function waitForActivityState(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  predicate: () => boolean,
  label: string,
  diagnostics: () => unknown,
  idleTimeoutMs = 6_000,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate(predicate)) return
    const signature = JSON.stringify(
      await page.evaluate(() => ({
        text: document.body.textContent?.slice(0, 1800) || "",
        targetStatus: document.querySelector<HTMLElement>(".browser-preview-status")?.dataset.status || "",
        evidenceStatus: document.querySelector<HTMLElement>(".browser-preview-evidence-status")?.dataset.status || "",
        stageStatus:
          document.querySelector<HTMLElement>(
            "[data-ui='browser-preview-live'], [data-ui='browser-preview-live-error'], [data-ui='browser-preview-target-failed'], [data-ui='browser-preview-evidence'], [data-ui='browser-preview-evidence-missing']",
          )?.dataset.status || "",
        requestLogLength: (window as unknown as { __requestLogLength?: number }).__requestLogLength || 0,
      })),
    )
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > idleTimeoutMs) {
      const snapshot = await page.evaluate(() => ({
        centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
        browserOpen: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.open || "",
        browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
        bodyText: document.body.textContent?.slice(0, 2400) || "",
      }))
      assert.fail(`No page activity while waiting for ${label}\n${JSON.stringify({ snapshot, diagnostics: diagnostics() }, null, 2)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForText(page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>, text: string, label: string, diagnostics: () => unknown) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate((value) => document.body.textContent?.includes(value) ?? false, text)) return
    const diagnosticSnapshot = diagnostics() as { errors?: unknown }
    const signature = JSON.stringify({
      text: await page.evaluate(() => document.body.textContent?.slice(0, 1800) || ""),
      preview: await page.evaluate(() => ({
        targetStatus: document.querySelector<HTMLElement>(".browser-preview-status")?.dataset.status || "",
        evidenceStatus: document.querySelector<HTMLElement>(".browser-preview-evidence-status")?.dataset.status || "",
        stage:
          document.querySelector<HTMLElement>(
            "[data-ui='browser-preview-live'], [data-ui='browser-preview-live-error'], [data-ui='browser-preview-target-failed'], [data-ui='browser-preview-evidence'], [data-ui='browser-preview-evidence-missing']",
          )?.getAttribute("data-ui") || "",
      })),
      errors: Array.isArray(diagnosticSnapshot.errors) ? diagnosticSnapshot.errors : [],
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(
        `No page activity while waiting for ${label}\n${JSON.stringify(
          { state: JSON.parse(signature), diagnostics: diagnostics() },
          null,
          2,
        )}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForFixtureActivity(predicate: () => boolean, label: string, diagnostics: () => unknown) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (predicate()) return
    const signature = JSON.stringify(diagnostics())
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

async function writeAndAssertScreenshot(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  name: string,
  options: { minHeight?: number; minNonWhiteDensity?: number; minWidth?: number } = {},
) {
  await page.waitForSelector(".browser-preview-panel", { visible: true })
  const panel = await page.$(".browser-preview-panel")
  assert.ok(panel, `${name} browser preview panel should be available for visual capture`)
  const screenshot = await panel.screenshot({})
  assert.ok(screenshot.length > 0, `${name} screenshot should not be empty`)
  const file = resolve(SCREENSHOT_DIR, `${name}.png`)
  writeFileSync(file, screenshot)
  const stats = await analyzePng(screenshot)
  const layout = await page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector)
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: box(".browser-preview-panel"),
      panelBody: box("#panelBody"),
      workspaceMain: box("#workspaceMain"),
      conversationWorkspace: box("#conversationWorkspace"),
      centerWorkbench: box("#centerWorkbench"),
      centerWorkbenchBrowser: box("#centerWorkbenchBrowser"),
    }
  })
  assert.ok(
    stats.width >= (options.minWidth ?? 260) && stats.height >= (options.minHeight ?? 300),
    `${name} screenshot dimensions are invalid: ${JSON.stringify({ stats, layout }, null, 2)}`,
  )
  assert.ok(
    stats.nonWhiteDensity > (options.minNonWhiteDensity ?? 0.03),
    `${name} screenshot lacks visible UI pixels: ${JSON.stringify(stats)}`,
  )
  assert.ok(stats.uniqueColorBuckets > 24, `${name} screenshot is visually too sparse: ${JSON.stringify(stats)}`)
  return file
}

async function analyzePng(buffer: Buffer) {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const raw = await image.ensureAlpha().raw().toBuffer()
  const buckets = new Set<number>()
  let nonWhite = 0
  let total = 0
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i]
    const g = raw[i + 1]
    const b = raw[i + 2]
    const a = raw[i + 3]
    if (a >= 16) {
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
      if (Math.max(r, g, b) < 250) nonWhite += 1
    }
    total += 1
  }
  return {
    width,
    height,
    nonWhiteDensity: total === 0 ? 0 : nonWhite / total,
    uniqueColorBuckets: buckets.size,
  }
}

function assertNoPreviewLayoutBreakage(layout: {
  bodyOverflowX: number
  panel: Box | null
  command: Box | null
  stage: Box | null
  badBoxes: string[]
  overlaps: string[]
  candidateEllipsis: boolean
  evidenceEllipsis: boolean
}) {
  assert.ok(layout.panel, `preview panel should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.command, `preview command surface should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.stage, `preview stage should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.bodyOverflowX <= 1, `page should not have body horizontal overflow\n${JSON.stringify(layout, null, 2)}`)
  assert.deepEqual(layout.badBoxes, [], `preview elements escaped their panel\n${JSON.stringify(layout, null, 2)}`)
  assert.deepEqual(layout.overlaps, [], `preview controls overlap incoherently\n${JSON.stringify(layout, null, 2)}`)
  assert.equal(layout.candidateEllipsis, true, `long preview candidate URL must truncate cleanly\n${JSON.stringify(layout, null, 2)}`)
  assert.equal(layout.evidenceEllipsis, true, `long evidence status must truncate cleanly\n${JSON.stringify(layout, null, 2)}`)
}

type Box = {
  label: string
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

async function previewLayout(page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>) {
  return page.evaluate(() => {
    const box = (label: string, node: Element | null): Box | null => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return {
        label,
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    const intersects = (a: Box, b: Box) =>
      a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
    const panel = box("panel", document.querySelector(".browser-preview-panel"))
    const command = box("command", document.querySelector(".browser-preview-command-surface"))
    const stage = box("stage", document.querySelector(".browser-preview-stage"))
    const watched = [
      box("status", document.querySelector(".browser-preview-status")),
      box("candidate", document.querySelector(".browser-preview-candidate-select")),
      box("viewports", document.querySelector(".browser-preview-viewport-controls")),
      box("evidence-status", document.querySelector(".browser-preview-evidence-status")),
    ].filter((item): item is Box => Boolean(item && item.width > 0 && item.height > 0))
    const badBoxes = panel
      ? watched
          .filter((item) => item.left < panel.left - 2 || item.right > panel.right + 2 || item.top < panel.top - 2)
          .map((item) => item.label)
      : watched.map((item) => item.label)
    const overlaps: string[] = []
    for (let i = 0; i < watched.length; i += 1) {
      for (let j = i + 1; j < watched.length; j += 1) {
        if (intersects(watched[i], watched[j])) overlaps.push(`${watched[i].label}/${watched[j].label}`)
      }
    }
    const candidateText = document.querySelector<HTMLElement>(".browser-preview-candidate-trigger > span:first-child")
    const evidenceText = document.querySelector<HTMLElement>(".browser-preview-evidence-status span:last-child")
    return {
      bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
      panel,
      command,
      stage,
      badBoxes,
      overlaps,
      candidateEllipsis:
        !!candidateText &&
        getComputedStyle(candidateText).textOverflow === "ellipsis" &&
        candidateText.scrollWidth >= candidateText.clientWidth,
      evidenceEllipsis:
        !!evidenceText &&
        getComputedStyle(evidenceText).textOverflow === "ellipsis" &&
        evidenceText.scrollWidth >= evidenceText.clientWidth,
    }
  })
}

test(
  `browser preview visual Playwright stress covers target, evidence, live, failure, and layout states on port ${PORT}`,
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")
    rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const now = Date.now()
    const taskID = "tsk_browserpreview_visual_stress"
    const primaryTargetID = "art_previewtarget_visual_primary"
    const alternateTargetID = "art_previewtarget_visual_alternate"
    const projectRoot = "D:/overlay/workspace/preview-stress"
    const requestLog: string[] = []
    const errors: string[] = []
    const captureBodies: unknown[] = []
    const liveSnapshotBodies: unknown[] = []
    const liveInputBodies: unknown[] = []
    const selectedTargets: unknown[] = []
    let serverOrigin = ""
    let targetMode: "missing" | "ready" = "missing"
    let selectedTargetID = primaryTargetID
    let failNextTabletSnapshot = false
    let failNextCapture = false
    let alternateCaptureHold: Promise<void> | undefined
    let releaseAlternateCapture: (() => void) | undefined
    let expectedLiveSnapshotFailureConsoleCount = 0
    const png = {
      primary: await pngBytes("primary live frame", ["#0f766e", "#1d4ed8"]),
      alternate: await pngBytes("alternate live frame", ["#7c2d12", "#be123c"]),
      input: await pngBytes("live input routed", ["#166534", "#15803d"]),
      evidence: await pngBytes("persisted evidence", ["#312e81", "#0f172a"]),
    }
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const task = {
      id: taskID,
      directory: projectRoot,
      status: "running",
      sessionID: "ses_preview_visual_stress",
      request: "Build agent started a browser_preview service and the operator is validating the preview panel.",
      title: "Preview visual stress",
      time: { created: now - 10_000, updated: now - 1_000 },
    }
    const board = {
      snapshotVersion: "preview-visual-stress-board",
      lastSequence: 0,
      task,
      overview: {
        headline: "Preview visual stress",
        summary: "Task-scoped browser preview target is controlled by backend artifacts.",
        controls: {},
      },
      lanes: [],
      interactions: [],
    }
    const promptProfileCatalog = {
      active: "frontend",
      project_active: "frontend",
      session_active: null,
      default: "frontend",
      targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
      profiles: [
        {
          id: "frontend",
          label: "Frontend",
          description: "Frontend implementation profile.",
          built_in: true,
          editable: false,
          agents: {},
        },
      ],
    }
    const urlFor = (id: string) =>
      id === alternateTargetID
        ? `${serverOrigin}/preview/alternate/${"very-long-segment-".repeat(18)}`
        : `${serverOrigin}/preview/primary/${"very-long-segment-".repeat(18)}`
    const targetResponse = () => {
      if (targetMode === "missing") {
        return {
          kind: "missing",
          status: "missing",
          projectRoot,
          taskID,
          viewports,
          diagnostics: ["No browser preview target saved for this task."],
          candidates: [],
          source: "none",
        }
      }
      const candidates = [primaryTargetID, alternateTargetID].map((id) => ({
        id,
        url: urlFor(id),
        source: "task-artifact",
        selected: id === selectedTargetID,
        timeUpdated: id === selectedTargetID ? now + 20 : now,
      }))
      const latestEvidenceIDs =
        selectedTargetID === primaryTargetID
          ? {
              desktop: "art_previewevidence_primary_desktop",
              tablet: "art_previewevidence_primary_tablet",
              mobile: "art_previewevidence_primary_mobile",
            }
          : {}
      return {
        id: selectedTargetID,
        taskID,
        latestEvidenceIDs,
        kind: "task-url",
        status: "ready",
        projectRoot,
        url: urlFor(selectedTargetID),
        viewports,
        diagnostics: [`Using task browser preview target ${selectedTargetID}.`],
        candidates,
        source: "task-artifact",
      }
    }
    const evidence = (id: string) => {
      const viewportID = id.includes("mobile") ? "mobile" : id.includes("tablet") ? "tablet" : "desktop"
      const targetID = id.includes("alternate") ? alternateTargetID : primaryTargetID
      return {
        id,
        taskID,
        targetID,
        viewportID,
        status: id.includes("failed") ? "failed" : "passed",
        summary: `${targetID === alternateTargetID ? "alternate" : "primary"} ${viewportID} ${"evidence summary ".repeat(16)}`,
        capture: { captured: true, passed: !id.includes("failed"), url: urlFor(targetID), sha: `${id}-sha` },
        diagnostics: [`${id} diagnostics ${"detail ".repeat(12)}`],
        timeCompleted: now,
        timeCreated: now - 100,
      }
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${url.pathname}${url.search}`)
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path.startsWith("/preview/")) {
        return new Response(
          `<!doctype html><html><head><title>${path}</title></head><body><main>${path} ${"visual content ".repeat(120)}</main><button>Action</button></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        )
      }
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
          branch: "preview-visual-stress",
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
      if (path === "/config" && req.method === "PATCH") return json({ model: "", prompt_profile: { active: "frontend" } })
      if (path === "/config") return json({ model: "", prompt_profile: { active: "frontend" } })
      if (path === "/channel") return json([])
      if (path === "/executor") return json([])
      if (path === "/agent") return json([])
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
      if (path === `/task/${taskID}/trace`) return json({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
      if (path === "/task/events" || path === `/task/${taskID}/events` || path === `/task/${taskID}/conversation/events`) {
        return eventStream()
      }
      if (path === `/task/${taskID}/browser-preview`) return json(targetResponse())
      if (path === `/task/${taskID}/browser-preview/target` && req.method === "PUT") {
        const body = await req.json()
        selectedTargets.push(body)
        selectedTargetID = String((body as { targetID?: unknown }).targetID || "")
        targetMode = "ready"
        return json(targetResponse())
      }
      if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
        const body = await req.json()
        captureBodies.push(body)
        if (failNextCapture) {
          failNextCapture = false
          return json({
            status: "failed",
            projectRoot,
            target: targetResponse(),
            viewports,
            captures: {
              desktop: {
                captured: false,
                passed: false,
                url: urlFor(selectedTargetID),
                summary: "capture failed because the build agent page crashed during stress validation",
              },
            },
            evidenceIDs: { desktop: "art_previewevidence_failed_desktop" },
            diagnostics: ["capture failed because the build agent page crashed during stress validation"],
          })
        }
        const hold = alternateCaptureHold
        if (selectedTargetID === alternateTargetID && hold) await hold
        return json({
          status: "passed",
          projectRoot,
          target: targetResponse(),
          viewports,
          captures: {
            desktop: { captured: true, passed: true, url: urlFor(selectedTargetID), summary: "alternate desktop capture passed" },
            tablet: { captured: true, passed: true, url: urlFor(selectedTargetID), summary: "alternate tablet capture passed" },
            mobile: { captured: true, passed: true, url: urlFor(selectedTargetID), summary: "alternate mobile capture passed" },
          },
          evidenceIDs: {
            desktop: "art_previewevidence_alternate_desktop",
            tablet: "art_previewevidence_alternate_tablet",
            mobile: "art_previewevidence_alternate_mobile",
          },
          diagnostics: ["alternate capture passed"],
        })
      }
      if (path === `/task/${taskID}/browser-preview/live/snapshot` && req.method === "POST") {
        const body = await req.json()
        liveSnapshotBodies.push(body)
        if ((body as { viewportID?: unknown }).viewportID === "tablet" && failNextTabletSnapshot) {
          failNextTabletSnapshot = false
          expectedLiveSnapshotFailureConsoleCount += 1
          return json({ message: "live snapshot failed during visual stress" }, { status: 503 })
        }
        const targetID = String((body as { targetID?: unknown }).targetID || "")
        return new Response(targetID === alternateTargetID ? png.alternate : png.primary, { headers: { "content-type": "image/png" } })
      }
      if (path === `/task/${taskID}/browser-preview/live/input` && req.method === "POST") {
        const body = await req.json()
        liveInputBodies.push(body)
        return new Response(png.input, { headers: { "content-type": "image/png" } })
      }
      const evidenceMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)$`))
      if (evidenceMatch) return json(evidence(evidenceMatch[1]))
      const captureMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)/capture\\.png$`))
      if (captureMatch) return new Response(png.evidence, { headers: { "content-type": "image/png" } })
      return json({})
    }, { port: PORT })
    serverOrigin = server.origin
    assert.equal(server.port, PORT)

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/preview-stress")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_right_panel_collapsed", "false")
        localStorage.setItem("oc_workspace_task", "tsk_browserpreview_visual_stress")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/preview-stress")
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/preview-stress",
          directoryMode: "custom",
          workspaceTaskID: "tsk_browserpreview_visual_stress",
          workspaceDirectory: "D:/overlay/workspace/preview-stress",
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
      page.on("console", (msg) => {
        if (msg.type() !== "error") return
        if (expectedLiveSnapshotFailureConsoleCount > 0 && msg.text().includes("status of 503")) {
          expectedLiveSnapshotFailureConsoleCount -= 1
          return
        }
        errors.push(`console: ${msg.text()}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => {
        ;(window as unknown as { __requestLogLength?: number }).__requestLogLength = 0
      })
      await waitForActivityState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "online connection",
        () => ({ errors, requestLog }),
      )
      await waitForActivityState(
        page,
        () => document.body.textContent?.includes("Preview visual stress") ?? false,
        "visible visual stress task",
        () => ({ errors, requestLog }),
      )
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      await waitForActivityState(
        page,
        () => Boolean(document.querySelector(".browser-preview-panel")),
        "browser preview panel mounted for workspace task",
        () => ({ errors, requestLog }),
      )
      await waitForText(page, "No browser preview target is saved for this task.", "missing preview state", () => ({
        errors,
        requestLog,
      }))
      assert.equal(await page.$(".browser-preview-candidate-select"), null)
      assert.equal(await page.$(".browser-preview-viewport-controls"), null)
      assert.equal(await page.$('[data-ui="browser-preview-live-screenshot"]'), null)
      await writeAndAssertScreenshot(page, "01-missing-target", { minNonWhiteDensity: 0.02 })

      targetMode = "ready"
      await page.click('.browser-preview-command-surface [aria-label="Refresh the saved preview evidence."]')
      await waitForActivityState(
        page,
        () => {
          const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "ready persisted evidence screenshot",
        () => ({ errors, requestLog, liveSnapshotBodies }),
      )
      await waitForText(page, "primary desktop evidence summary", "primary persisted evidence", () => ({
        errors,
        requestLog,
      }))
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await writeAndAssertScreenshot(page, "02-ready-desktop")

      alternateCaptureHold = new Promise<void>((resolve) => {
        releaseAlternateCapture = resolve
      })
      await page.click('[data-ui="browser-preview-candidate-trigger"]')
      await page.waitForSelector(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await page.click(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await waitForActivityState(
        page,
        () => !(document.body.textContent || "").includes("primary desktop evidence summary"),
        "stale primary evidence hidden",
        () => ({ errors, requestLog, captureBodies, selectedTargets }),
      )
      await waitForActivityState(
        page,
        () => {
          const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "alternate live screenshot before capture evidence",
        () => ({ errors, requestLog, liveSnapshotBodies }),
      )
      await writeAndAssertScreenshot(page, "03-alternate-live")

      await page.click('[data-ui="browser-preview-live-screenshot"]', { position: { x: 8, y: 8 } })
      await page.evaluate(() => {
        const image = document.querySelector<HTMLElement>('[data-ui="browser-preview-live-screenshot"]')
        const rect = image?.getBoundingClientRect()
        image?.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: rect ? rect.left + 10 : 10,
            clientY: rect ? rect.top + 10 : 10,
            deltaX: 0,
            deltaY: 120,
          }),
        )
      })
      await page.focus(".browser-preview-live-frame")
      await page.keyboard.press("A")
      await waitForActivityState(
        page,
        () => {
          const bodies = (window as unknown as { __liveInputCount?: number }).__liveInputCount || 0
          return bodies >= 0
        },
        "input event loop tick",
        () => ({ errors, requestLog }),
        400,
      ).catch(() => undefined)
      for (let index = 0; index < 100 && liveInputBodies.length < 3; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.deepEqual(liveInputBodies.map((body) => (body as any).input.kind).slice(0, 3), ["click", "wheel", "key"])
      assert.ok(
        liveInputBodies.every((body) => (body as any).targetID === alternateTargetID),
        `live input must be bound to the visible alternate target\n${JSON.stringify(liveInputBodies, null, 2)}`,
      )

      failNextTabletSnapshot = true
      await page.click('[data-ui="browser-preview-viewport"][data-viewport-id="tablet"]')
      await waitForActivityState(
        page,
        () =>
          document
            .querySelector<HTMLElement>('[data-ui="browser-preview-viewport"][data-viewport-id="tablet"]')
            ?.getAttribute("data-active") === "true",
        "tablet viewport selection",
        () => ({ errors, liveSnapshotBodies }),
      )
      await waitForFixtureActivity(
        () => liveSnapshotBodies.some((body) => (body as any).viewportID === "tablet"),
        "tablet live snapshot request",
        () => ({ errors, liveSnapshotBodies }),
      )
      await waitForText(page, "live snapshot failed during visual stress", "live snapshot error state", () => ({
        errors,
        requestLog,
        liveSnapshotBodies,
      }))
      const errorBeforeMissing = await page.evaluate(() => {
        const html = document.body.innerHTML
        const liveErrorIndex = html.indexOf('data-ui="browser-preview-live-error"')
        const missingIndex = html.indexOf('data-ui="browser-preview-evidence-missing"')
        return liveErrorIndex >= 0 && (missingIndex < 0 || liveErrorIndex < missingIndex)
      })
      assert.equal(errorBeforeMissing, true)
      await writeAndAssertScreenshot(page, "04-live-failure")

      releaseAlternateCapture?.()
      releaseAlternateCapture = undefined
      alternateCaptureHold = undefined
      await waitForText(page, "alternate tablet capture passed", "alternate tablet capture recovery", () => ({
        errors,
        requestLog,
        captureBodies,
      }))
      await page.click('[data-ui="browser-preview-viewport"][data-viewport-id="desktop"]')
      await waitForText(page, "alternate desktop capture passed", "alternate desktop after error recovery", () => ({
        errors,
        requestLog,
      }))
      await writeAndAssertScreenshot(page, "05-alternate-evidence")
      failNextCapture = true
      await page.click('[aria-label="Capture Playwright evidence from the saved backend preview target."]')
      await waitForText(page, "capture failed because the build agent page crashed during stress validation", "capture failure evidence", () => ({
        errors,
        requestLog,
        captureBodies,
      }))
      await writeAndAssertScreenshot(page, "06-capture-failure")

      await page.setViewport({ width: 390, height: 760 })
      await new Promise((resolve) => setTimeout(resolve, 250))
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await writeAndAssertScreenshot(page, "07-narrow-layout")

      assert.deepEqual(selectedTargets, [{ targetID: alternateTargetID }])
      assert.ok(
        liveSnapshotBodies.some((body) => (body as any).targetID === primaryTargetID),
        "primary target should be loaded through live snapshot",
      )
      assert.ok(
        liveSnapshotBodies.some((body) => (body as any).targetID === alternateTargetID),
        "alternate target should be loaded through live snapshot after selection",
      )
      assert.ok(
        captureBodies.every((body) => !("url" in ((body as Record<string, unknown>) || {}))),
        `capture bodies must not carry URL fallback data\n${JSON.stringify(captureBodies, null, 2)}`,
      )
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/live/snapshot`)),
        "live snapshot route should be exercised",
      )
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/live/input`)),
        "live input route should be exercised",
      )
      assert.equal(errors.length, 0, errors.join("\n"))
    } finally {
      releaseAlternateCapture?.()
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
