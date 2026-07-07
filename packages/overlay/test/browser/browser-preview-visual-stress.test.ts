import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"

const PORT = 7778
const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/browser-preview-visual-stress/", import.meta.url))

type NativeCommandRecord = {
  command: string
  args: Record<string, unknown>
}

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
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(":\n\n"))
      },
    }),
    {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    },
  )
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
    const diagnosticSnapshot = diagnostics()
    const signature = JSON.stringify({
      page: await page.evaluate(() => ({
        text: document.body.textContent?.slice(0, 1800) || "",
        targetStatus: document.querySelector<HTMLElement>(".browser-preview-status")?.dataset.status || "",
        evidenceStatus: document.querySelector<HTMLElement>(".browser-preview-evidence-status")?.dataset.status || "",
        stageStatus:
          document.querySelector<HTMLElement>(
            "[data-ui='browser-preview-selection-failed'], [data-ui='browser-preview-target-load-failed'], [data-ui='browser-preview-live'], [data-ui='browser-preview-native-error'], [data-ui='browser-preview-target-failed'], [data-ui='browser-preview-evidence'], [data-ui='browser-preview-evidence-missing']",
          )?.dataset.status || "",
      })),
      diagnostics: activityDiagnostics(diagnosticSnapshot),
    })
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
      assert.fail(
        `No page activity while waiting for ${label}\n${JSON.stringify({ snapshot, diagnostics: diagnostics() }, null, 2)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function activityDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    out[key] = Array.isArray(item) ? { length: item.length, last: item.at(-1) } : item
  }
  return out
}

async function waitForText(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  text: string,
  label: string,
  diagnostics: () => unknown,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate((value) => document.body.textContent?.includes(value) ?? false, text)) return
    const signature = JSON.stringify({
      text: await page.evaluate(() => document.body.textContent?.slice(0, 1800) || ""),
      diagnostics: activityDiagnostics(diagnostics()),
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      const preview = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
        const active = document.querySelector<HTMLElement>(
          "[data-ui='browser-preview-selection-failed'], [data-ui='browser-preview-native-error'], [data-ui='browser-preview-live'], [data-ui='browser-preview-evidence'], [data-ui='browser-preview-evidence-missing']",
        )
        return {
          selectedSource: (window as any).boardStore?.selectedSource ?? null,
          boardTaskID: (window as any).boardStore?.board?.task?.id ?? "",
          settingsDirectory: (window as any).settingsStore?.directory ?? "",
          activeRowTaskID:
            document.querySelector<HTMLElement>(".task-row-main[aria-current='page']")?.dataset.taskId || "",
          status: document.querySelector<HTMLElement>(".browser-preview-status")?.dataset.status || "",
          activeUI: active?.getAttribute("data-ui") || "",
          activeStatus: active?.dataset.status || "",
          text: stage?.textContent?.slice(0, 1200) || "",
        }
      })
      assert.fail(
        `No page activity while waiting for ${label}\n${JSON.stringify({ state: JSON.parse(signature), preview }, null, 2)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForNativePreviewSync(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  input: { url: string; minCount: number; label: string },
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    const commands = await page.evaluate(
      (url) =>
        (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[]).filter(
          (entry) => entry.command === "overlay_browser_preview_sync" && entry.args.url === url,
        ),
      input.url,
    )
    if (commands.length >= input.minCount) return
    const signature = JSON.stringify({ count: commands.length, last: commands.at(-1) || null })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No native preview sync while waiting for ${input.label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function clickBrowserPreviewViewport(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  viewportID: "desktop" | "tablet" | "mobile",
) {
  const selector = `[data-ui="browser-preview-viewport"][data-viewport-id="${viewportID}"]`
  await page.waitForSelector(selector, { visible: true })
  await page.evaluate((value) => {
    const node = document.querySelector<HTMLElement>(String(value))
    if (!node) throw new Error(`Browser preview viewport trigger is missing: ${value}`)
    setTimeout(() => node.click(), 0)
    return true
  }, selector)
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
  assert.ok(
    stats.width >= (options.minWidth ?? 260) && stats.height >= (options.minHeight ?? 300),
    `${name} screenshot dimensions are invalid: ${JSON.stringify({ stats }, null, 2)}`,
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

async function averageRgb(buffer: Buffer) {
  const raw = await sharp(buffer).resize(1, 1).removeAlpha().raw().toBuffer()
  return { r: raw[0], g: raw[1], b: raw[2] }
}

async function assertImageMatchesReference(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  selector: string,
  reference: Buffer,
  label: string,
) {
  const element = await page.$(selector)
  assert.ok(element, `${label} image should exist`)
  const actualBytes = Buffer.from(
    await page.$eval(selector, async (image: HTMLImageElement) => {
      if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        throw new Error(`Image ${image.getAttribute("data-ui") || image.src} is not decoded`)
      }
      const response = await fetch(image.src)
      if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`)
      return Array.from(new Uint8Array(await response.arrayBuffer()))
    }),
  )
  const [actualAverage, expectedAverage] = await Promise.all([averageRgb(actualBytes), averageRgb(reference)])
  const distance =
    Math.abs(actualAverage.r - expectedAverage.r) +
    Math.abs(actualAverage.g - expectedAverage.g) +
    Math.abs(actualAverage.b - expectedAverage.b)
  assert.ok(
    distance <= 72,
    `${label} image does not match expected visual signature\n${JSON.stringify({ actualAverage, expectedAverage, distance }, null, 2)}`,
  )
}

async function waitForImageMatchesReference(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  selector: string,
  reference: Buffer,
  label: string,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await assertImageMatchesReference(page, selector, reference, label)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw lastError
}

function assertNoPreviewLayoutBreakage(layout: {
  bodyOverflowX: number
  legalShellOverflowX: number
  shell: Box | null
  panel: Box | null
  command: Box | null
  stage: Box | null
  badBoxes: string[]
  badShellBoxes: string[]
  overlaps: string[]
  candidateEllipsis: boolean
  evidenceStatusPresent: boolean
  evidenceEllipsis: boolean
}) {
  assert.ok(layout.shell, `legal overlay shell should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.panel, `preview panel should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.command, `preview command surface should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(layout.stage, `preview stage should be visible\n${JSON.stringify(layout, null, 2)}`)
  assert.ok(
    layout.legalShellOverflowX <= 1,
    `page should not overflow the legal overlay shell\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.deepEqual(
    layout.badShellBoxes,
    [],
    `preview elements escaped the legal shell\n${JSON.stringify(layout, null, 2)}`,
  )
  assert.deepEqual(layout.badBoxes, [], `preview elements escaped their panel\n${JSON.stringify(layout, null, 2)}`)
  assert.deepEqual(layout.overlaps, [], `preview controls overlap incoherently\n${JSON.stringify(layout, null, 2)}`)
  assert.equal(
    layout.candidateEllipsis,
    true,
    `long preview candidate URL must truncate cleanly\n${JSON.stringify(layout, null, 2)}`,
  )
  if (layout.evidenceStatusPresent) {
    assert.equal(
      layout.evidenceEllipsis,
      true,
      `long evidence status must truncate cleanly\n${JSON.stringify(layout, null, 2)}`,
    )
  }
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
    const shell = box("shell", document.body)
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
    const shellWatched = [panel, command, stage, ...watched].filter((item): item is Box => Boolean(item))
    const badShellBoxes = shell
      ? shellWatched
          .filter((item) => item.left < shell.left - 2 || item.right > shell.right + 2 || item.top < shell.top - 2)
          .map((item) => item.label)
      : shellWatched.map((item) => item.label)
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
      legalShellOverflowX: shell
        ? document.documentElement.scrollWidth - shell.width
        : document.documentElement.scrollWidth,
      shell,
      panel,
      command,
      stage,
      badBoxes,
      badShellBoxes,
      overlaps,
      candidateEllipsis:
        !!candidateText &&
        getComputedStyle(candidateText).textOverflow === "ellipsis" &&
        candidateText.scrollWidth >= candidateText.clientWidth,
      evidenceStatusPresent: !!evidenceText,
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
    const otherTaskID = "tsk_browserpreview_visual_other"
    const primaryTargetID = "art_previewtarget_visual_primary"
    const alternateTargetID = "art_previewtarget_visual_alternate"
    const staleTargetID = "art_previewtarget_visual_stale"
    const projectRoot = "D:/overlay/workspace/preview-stress"
    const otherProjectRoot = "D:/overlay/workspace/preview-other"
    const requestLog: string[] = []
    const errors: string[] = []
    const captureBodies: unknown[] = []
    const selectedTargets: unknown[] = []
    const unexpectedRequests: string[] = []
    const logBodies: unknown[] = []
    let boardRequestCount = 0
    let previewTargetRequestCount = 0
    let serverOrigin = ""
    let targetMode: "load-error" | "missing" | "ready" | "failed" = "load-error"
    let selectedTargetID = primaryTargetID
    let expectedTargetLoadFailureConsoleCount = 0
    let expectedTargetSelectionFailureConsoleCount = 0
    const validTargetIDs = new Set([primaryTargetID, alternateTargetID])
    const png = {
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
      orderKey: testTaskOrderKey(taskID, now - 10_000),
      status: "active",
      sessionID: "ses_preview_visual_stress",
      request: "Build agent started a browser_preview service and the operator is validating the preview panel.",
      title: "Preview visual stress",
      time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
    }
    const otherTask = {
      id: otherTaskID,
      directory: otherProjectRoot,
      orderKey: testTaskOrderKey(otherTaskID, now - 20_000),
      status: "active",
      sessionID: "ses_preview_visual_other",
      request: "A second task verifies preview state does not leak across task switches.",
      title: "Preview visual other task",
      time: { created: now - 20_000, started: now - 19_000, updated: now - 2_000 },
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
    const otherBoard = {
      snapshotVersion: "preview-visual-other-board",
      lastSequence: 0,
      task: otherTask,
      overview: {
        headline: "Preview visual other task",
        summary: "This task has no saved browser preview target.",
        controls: {},
      },
      lanes: [],
      interactions: [],
    }
    const expertSquadCatalog = expertSquadCatalogFixture({
      active: "frontend-replica",
      projectActive: "frontend-replica",
      targets: [
        { id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false },
      ],
      squads: [
        {
          id: "general",
          label: "General",
          description: "General profile.",
          built_in: true,
        },
        {
          id: "frontend-replica",
          label: "Frontend Replica",
          description: "Frontend implementation profile.",
          built_in: false,
        },
      ],
    })
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
      if (targetMode === "failed") {
        return {
          id: selectedTargetID,
          taskID,
          kind: "failed",
          status: "failed",
          projectRoot,
          url: urlFor(selectedTargetID),
          viewports,
          diagnostics: ["Saved browser preview target is unreachable during stress validation."],
          candidates: [
            {
              id: selectedTargetID,
              url: urlFor(selectedTargetID),
              source: "task-artifact",
              selected: true,
              timeUpdated: now + 40,
            },
          ],
          source: "task-artifact",
        }
      }
      const candidates = [primaryTargetID, staleTargetID, alternateTargetID].map((id) => ({
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

    const server = await startBrowserFixture(
      async (req) => {
        const url = new URL(req.url)
        const path = route(url)
        requestLog.push(`${req.method} ${url.pathname}${url.search}`)
        if (path === "/" || path === "/ui" || path === "/ui/")
          return Response.redirect(`${url.origin}/ui/index.html`, 302)
        if (path === "/favicon.ico") return new Response(null, { status: 204 })
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
        if (path === `/task/${taskID}/operator-model-context` || path === `/task/${otherTaskID}/operator-model-context`)
          return json({ selected: null, candidates: [] })
        if (path === "/global/tasks")
          return json({
            tasks: [
              { task, updated_at: now - 1_000 },
              { task: otherTask, updated_at: now - 2_000 },
            ],
          })
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
        if (path === "/expert-squad/catalog") return json(expertSquadCatalog)
        if (path === "/config" && req.method === "PATCH")
          return json({ model: "", prompt_profile: { active: "frontend-replica" } })
        if (path === "/config") return json({ model: "", prompt_profile: { active: "frontend-replica" } })
        if (path === "/log" && req.method === "POST") {
          try {
            logBodies.push(await req.json())
          } catch {
            logBodies.push(await req.text())
          }
          return json({ ok: true })
        }
        if (path === "/channel") return json([])
        if (path === "/executor") return json([])
        if (path === "/agent") return json([])
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
        if (path === `/task/${taskID}/board`) {
          boardRequestCount += 1
          return json(board, { headers: { etag: `"board-${now}-${boardRequestCount}"` } })
        }
        if (path === `/task/${otherTaskID}/board`) {
          return json(otherBoard, { headers: { etag: `"other-board-${now}"` } })
        }
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
        if (path === `/task/${otherTaskID}/conversation`)
          return json({
            lastSequence: 0,
            board: otherBoard,
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
        if (path === `/task/${otherTaskID}/transcript`) return json([])
        if ((path === `/task/${taskID}/followup` || path === `/task/${otherTaskID}/followup`) && req.method === "POST")
          return json({ suggestion: "" })
        if (path === `/task/${taskID}/trace`)
          return json({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
        if (path === `/task/${otherTaskID}/trace`)
          return json({ events: [], traceDir: `${otherProjectRoot}/.opencorvus/trace`, enabled: true })
        if (path === "/task/events" || path === `/task/${taskID}/conversation/events`) {
          return eventStream()
        }
        if (path === `/task/${taskID}/events`) return eventStream()
        if (path === `/task/${otherTaskID}/events`) return eventStream()
        if (path === `/task/${otherTaskID}/browser-preview`)
          return json({
            kind: "missing",
            status: "missing",
            projectRoot: otherProjectRoot,
            taskID: otherTaskID,
            viewports,
            diagnostics: ["No browser preview target saved for this task."],
            candidates: [],
            source: "none",
          })
        if (path === `/task/${taskID}/browser-preview`) {
          previewTargetRequestCount += 1
          if (targetMode === "load-error") {
            expectedTargetLoadFailureConsoleCount += 1
            return json({ message: "browser preview target lookup failed during stress validation" }, { status: 503 })
          }
          return json(targetResponse())
        }
        if (path === `/task/${taskID}/browser-preview/target` && req.method === "PUT") {
          const body = await req.json()
          selectedTargets.push(body)
          const requestedTargetID = String((body as { targetID?: unknown }).targetID || "")
          if (!validTargetIDs.has(requestedTargetID)) {
            expectedTargetSelectionFailureConsoleCount += 1
            return json({ message: `Unknown browser preview target ${requestedTargetID}` }, { status: 404 })
          }
          selectedTargetID = requestedTargetID
          targetMode = "ready"
          return json(targetResponse())
        }
        if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
          const body = await req.json()
          const requestedTargetID = String((body as { targetID?: unknown }).targetID || selectedTargetID)
          if (!validTargetIDs.has(requestedTargetID)) {
            return json({ message: `Unknown browser preview target ${requestedTargetID}` }, { status: 404 })
          }
          captureBodies.push(body)
          return json({ message: "visual stress must not trigger hidden evidence capture" }, { status: 500 })
        }
        const evidenceMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)$`))
        if (evidenceMatch) return json(evidence(evidenceMatch[1]))
        const captureMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)/capture\\.png$`))
        if (captureMatch) return new Response(png.evidence, { headers: { "content-type": "image/png" } })
        unexpectedRequests.push(`${req.method} ${path}`)
        return json({ message: `Unexpected browser preview stress route ${req.method} ${path}` }, { status: 404 })
      },
      { port: PORT },
    )
    serverOrigin = server.origin
    assert.equal(server.port, PORT)
    const unknownCaptureResponse = await fetch(`${server.origin}/task/${taskID}/browser-preview/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetID: "art_previewtarget_unknown", viewportIDs: ["desktop"] }),
    })
    assert.equal(unknownCaptureResponse.status, 404)

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/preview-stress")
        localStorage.setItem("oc_server_url", serverUrl)
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
        const nativeCommands: NativeCommandRecord[] = []
        ;(window as any).__browserPreviewNativeCommands = nativeCommands
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
              if (command.startsWith("overlay_browser_preview_")) {
                nativeCommands.push({ command, args })
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
        if (expectedTargetLoadFailureConsoleCount > 0 && msg.text().includes("status of 503")) {
          expectedTargetLoadFailureConsoleCount -= 1
          return
        }
        if (expectedTargetSelectionFailureConsoleCount > 0 && msg.text().includes("status of 404")) {
          expectedTargetSelectionFailureConsoleCount -= 1
          return
        }
        errors.push(`console: ${msg.text()}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
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
      await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await waitForActivityState(
        page,
        () =>
          Array.from(document.querySelectorAll<HTMLElement>(".global-task-row")).some((node) => {
            const rect = node.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && (node.textContent || "").includes("Preview visual stress")
          }),
        "visible task row",
        () => ({ errors, requestLog }),
      )
      const taskRowSelector = `.task-row-main[data-task-id="${taskID}"]`
      await page.waitForSelector(taskRowSelector, { visible: true })
      const taskRowHitTest = await page.$eval(
        taskRowSelector,
        (node: HTMLElement, selector) => {
          const rect = node.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit?.closest(String(selector)) === node
        },
        taskRowSelector,
      )
      assert.equal(taskRowHitTest, true)
      await page.click(taskRowSelector)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      await waitForActivityState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-target-load-failed"]'),
        "target load failure state",
        () => ({
          errors,
          requestLog,
          previewTargetRequestCount,
        }),
      )
      if (!(await page.$('[data-ui="browser-preview-target-load-failed"]'))) {
        const state = await page.evaluate(() => ({
          status: document.querySelector<HTMLElement>(".browser-preview-status")?.outerHTML || "",
          stage: document.querySelector<HTMLElement>(".browser-preview-stage")?.outerHTML || "",
          text: document.body.textContent?.slice(0, 2400) || "",
        }))
        assert.fail(
          `target load failure must render in preview stage\n${JSON.stringify(
            { state, previewTargetRequestCount, requestLog },
            null,
            2,
          )}`,
        )
      }
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      await writeAndAssertScreenshot(page, "01-target-load-failure", { minNonWhiteDensity: 0.018 })

      targetMode = "missing"
      await page.click('[aria-label="Refresh the saved preview evidence."]')
      await waitForText(page, "No browser preview target is saved for this task.", "missing preview state", () => ({
        errors,
        requestLog,
      }))
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-candidate-trigger"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-viewports"]'), null)
      assert.equal(await page.$(".browser-preview-evidence-status"), null)
      await writeAndAssertScreenshot(page, "02-missing-target", { minNonWhiteDensity: 0.018 })

      targetMode = "ready"
      await page.click('[aria-label="Refresh the saved preview evidence."]')
      await waitForActivityState(
        page,
        () => {
          const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "ready persisted evidence screenshot",
        () => ({ errors, requestLog }),
      )
      assert.ok(previewTargetRequestCount > 0, `preview target should be requested: ${previewTargetRequestCount}`)
      await waitForText(page, "primary desktop evidence summary", "primary persisted evidence", () => ({
        errors,
        requestLog,
      }))
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await assertImageMatchesReference(
        page,
        '[data-ui="browser-preview-screenshot"]',
        png.evidence,
        "primary evidence",
      )
      await writeAndAssertScreenshot(page, "03-ready-desktop")

      await page.click('[data-ui="browser-preview-candidate-trigger"]')
      await page.waitForSelector(`[data-ui="browser-preview-candidate-option"][data-target-id="${staleTargetID}"]`)
      await page.click(`[data-ui="browser-preview-candidate-option"][data-target-id="${staleTargetID}"]`)
      await waitForText(
        page,
        `Unknown browser preview target ${staleTargetID}`,
        "stale candidate selection failure",
        () => ({
          errors,
          requestLog,
          selectedTargets,
        }),
      )
      assert.ok(await page.$('[data-ui="browser-preview-selection-failed"]'))
      assert.equal(
        await page.evaluate(() => document.querySelector<HTMLElement>(".browser-preview-status")?.dataset.status),
        "failed",
      )
      await writeAndAssertScreenshot(page, "04-stale-candidate-failure")

      const otherTaskRowSelector = `.task-row-main[data-task-id="${otherTaskID}"]`
      await page.waitForSelector(otherTaskRowSelector, { visible: true })
      await page.click(otherTaskRowSelector)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      await waitForText(
        page,
        "No browser preview target is saved for this task.",
        "other task missing preview after selection failure",
        () => ({
          errors,
          requestLog,
          logBodies,
        }),
      )
      assert.equal(await page.$('[data-ui="browser-preview-selection-failed"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-evidence"]'), null)
      assert.equal(await page.$(".browser-preview-evidence-status"), null)
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      await writeAndAssertScreenshot(page, "05-cross-task-missing-clears-selection", { minNonWhiteDensity: 0.018 })

      await page.click(taskRowSelector)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      await waitForText(page, "primary desktop evidence summary", "primary preview restored after task switch", () => ({
        errors,
        requestLog,
      }))
      assert.equal(await page.$('[data-ui="browser-preview-selection-failed"]'), null)

      await page.click('[data-ui="browser-preview-candidate-trigger"]')
      await page.waitForSelector(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await page.click(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await waitForActivityState(
        page,
        () => !(document.body.textContent || "").includes("primary desktop evidence summary"),
        "stale primary evidence hidden",
        () => ({ errors, requestLog, captureBodies, selectedTargets }),
      )
      await waitForNativePreviewSync(page, {
        url: urlFor(alternateTargetID),
        minCount: 1,
        label: "alternate desktop native webview sync after target selection",
      })
      await waitForActivityState(
        page,
        () =>
          !!document.querySelector('[data-ui="browser-preview-native-surface"]') &&
          !document.querySelector('[data-ui="browser-preview-evidence"]'),
        "alternate native webview before capture evidence",
        () => ({ errors, requestLog }),
      )
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await writeAndAssertScreenshot(page, "06-alternate-native", { minNonWhiteDensity: 0.018 })

      await clickBrowserPreviewViewport(page, "tablet")
      await waitForActivityState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
        "tablet native webview surface",
        () => ({ errors, requestLog }),
      )
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await writeAndAssertScreenshot(page, "07-tablet-native", { minNonWhiteDensity: 0.018 })

      await clickBrowserPreviewViewport(page, "mobile")
      await waitForActivityState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
        "mobile native webview surface",
        () => ({ errors, requestLog }),
      )
      await page.click('[aria-label="Go back in the preview browser."]')
      await page.click('[aria-label="Go forward in the preview browser."]')
      await page.click('[aria-label="Reload the current preview page."]')
      await waitForActivityState(
        page,
        () => {
          const actions = (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
            .filter((entry) => entry.command === "overlay_browser_preview_navigate")
            .map((entry) => entry.args.action)
          return actions.includes("back") && actions.includes("forward") && actions.includes("reload")
        },
        "native browser navigation commands",
        () => ({ errors, requestLog }),
      )
      await writeAndAssertScreenshot(page, "08-mobile-native", { minNonWhiteDensity: 0.018 })

      await page.setViewport({ width: 390, height: 760 })
      await new Promise((resolve) => setTimeout(resolve, 250))
      assertNoPreviewLayoutBreakage(await previewLayout(page))
      await writeAndAssertScreenshot(page, "09-narrow-layout", { minNonWhiteDensity: 0.018 })

      await page.setViewport({ width: 1440, height: 900 })
      await new Promise((resolve) => setTimeout(resolve, 250))
      targetMode = "failed"
      await page.click('[aria-label="Refresh the saved preview evidence."]')
      await waitForText(
        page,
        "Saved browser preview target is unreachable during stress validation.",
        "failed target replaces stale evidence",
        () => ({
          errors,
          requestLog,
        }),
      )
      assert.ok(await page.$('[data-ui="browser-preview-target-failed"]'))
      assert.equal(await page.$('[data-ui="browser-preview-evidence"]'), null)
      assert.equal(await page.$(".browser-preview-evidence-status"), null)
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      assert.equal(
        await page.$eval(
          '[aria-label="Capture Playwright evidence from the saved backend preview target."]',
          (node: Element) => (node as HTMLButtonElement).disabled,
        ),
        true,
      )
      await writeAndAssertScreenshot(page, "10-target-failed")

      assert.deepEqual(selectedTargets, [{ targetID: staleTargetID }, { targetID: alternateTargetID }])
      assert.equal(
        requestLog.some((entry) => entry.includes("/browser-preview/live/")),
        false,
        `visual stress must not call retired PNG live routes\n${JSON.stringify(requestLog, null, 2)}`,
      )
      const nativeActions = await page.evaluate(() =>
        (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
          .filter((entry) => entry.command === "overlay_browser_preview_navigate")
          .map((entry) => entry.args.action),
      )
      assert.deepEqual(nativeActions.slice(-3), ["back", "forward", "reload"])
      assert.equal(
        captureBodies.length,
        0,
        `visual stress must not auto-capture evidence\n${JSON.stringify(captureBodies, null, 2)}`,
      )
      assert.deepEqual(unexpectedRequests, [])
      assert.equal(errors.length, 0, errors.join("\n"))
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
