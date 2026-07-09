import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import sharp from "sharp"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"

const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/browser-preview-evidence/", import.meta.url))

await ensureOverlayDist()

const expertSquadCatalog = expertSquadCatalogFixture({
  active: "default",
  projectActive: "default",
  defaultSquad: "general",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  squads: [
    {
      id: "general",
      label: "General",
      description: "General implementation profile.",
      built_in: true,
    },
    {
      id: "default",
      label: "Default",
      description: "Default implementation profile.",
      built_in: false,
    },
  ],
})

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

function activityDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (key === "requestLog" && Array.isArray(item)) {
      const meaningful = item.filter(
        (entry) =>
          typeof entry !== "string" ||
          (!/^GET \/task(?:\/[^/]+)?\/events(?:\?|$)/.test(entry) &&
            !/^GET \/work-ledger\/events(?:\?|$)/.test(entry) &&
            !/^POST \/log$/.test(entry)),
      )
      out[key] = { length: meaningful.length, last: meaningful.at(-1) }
      continue
    }
    out[key] = Array.isArray(item) ? { length: item.length, last: item.at(-1) } : item
  }
  return out
}

async function waitForPageState(
  page: OverlayPage,
  predicate: () => boolean,
  label: string,
  diagnostics: () => unknown,
  idleTimeoutMs = 6_000,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate<boolean>(predicate)) return
    const signature = JSON.stringify({
      page: await page.evaluate(() => {
        const evidence = document.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
        const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
        return {
          centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
          browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
          evidenceStatus: evidence?.dataset.status || "",
          imageLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
          nativeSurface: !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
          text: document.body.textContent?.slice(0, 1600) || "",
        }
      }),
      diagnostics: activityDiagnostics(diagnostics()),
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > idleTimeoutMs) {
      assert.fail(`No page activity while waiting for ${label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function openBrowserPreviewFromTask(page: OverlayPage, taskID: string, diagnostics: () => unknown) {
  const taskRow = `[data-row-key="task:${taskID}"] [data-ui="ledger-row-main"]`
  await page.waitForSelector(taskRow, { visible: true })
  await page.click(taskRow)
  const browserAlreadyActive = await page.evaluate(
    () => document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true",
  )
  if (!browserAlreadyActive) await clickRightBrowserActivity(page, diagnostics)
  await waitForPageState(
    page,
    () => document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true",
    `browser preview active for ${taskID}`,
    diagnostics,
  )
}

async function clickRightBrowserActivity(page: OverlayPage, diagnostics: () => unknown) {
  const browserButton = '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]'
  const toolbarToggle = '[data-ui="chat-header-right-toolbar-toggle"]'
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    const state = await page.evaluate(
      ({ buttonSelector, toggleSelector }) => {
        const visible = (node: HTMLElement | null) => {
          if (!node) return false
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        }
        return {
          buttonVisible: visible(document.querySelector<HTMLElement>(buttonSelector)),
          toggleVisible: visible(document.querySelector<HTMLElement>(toggleSelector)),
          toolbarVisible: document.querySelector<HTMLElement>("#solidRightActivityToolbar")?.dataset.visible || "",
          browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
        }
      },
      { buttonSelector: browserButton, toggleSelector: toolbarToggle },
    )
    if (state.buttonVisible) {
      await page.$eval(browserButton, (node: HTMLElement) => node.click())
      return
    }
    if (state.toggleVisible) await page.$eval(toolbarToggle, (node: HTMLElement) => node.click())
    const signature = JSON.stringify({ state, diagnostics: activityDiagnostics(diagnostics()) })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No page activity while opening right browser activity\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function analyzePng(buffer: Buffer) {
  const image = sharp(buffer)
  const metadata = await image.metadata()
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
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    nonWhiteDensity: total === 0 ? 0 : nonWhite / total,
    uniqueColorBuckets: buckets.size,
  }
}

async function writeAndAssertScreenshot(page: OverlayPage, name: string) {
  const panel = await page.$(".browser-preview-panel")
  assert.ok(panel, `${name} browser preview panel should be available for visual capture`)
  const screenshot = await panel.screenshot({})
  const file = resolve(SCREENSHOT_DIR, `${name}.png`)
  writeFileSync(file, screenshot)
  const stats = await analyzePng(screenshot)
  assert.ok(stats.width >= 320 && stats.height >= 360, `${name} screenshot dimensions are invalid: ${JSON.stringify(stats)}`)
  assert.ok(stats.nonWhiteDensity > 0.02, `${name} screenshot lacks visible UI pixels: ${JSON.stringify(stats)}`)
  assert.ok(stats.uniqueColorBuckets > 18, `${name} screenshot is visually too sparse: ${JSON.stringify(stats)}`)
  return file
}

test("browser preview renders persisted evidence as the non-native host preview surface", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
  mkdirSync(SCREENSHOT_DIR, { recursive: true })

  const now = Date.now()
  const taskID = "tsk_browserpreview_evidence_host"
  const targetID = "art_previewtarget_evidence_host"
  const evidenceID = "art_previewevidence_evidence_host_desktop"
  const projectRoot = "D:/overlay/workspace/evidence-host"
  const requestLog: string[] = []
  const unexpectedRequests: string[] = []
  let targetRequestCount = 0
  let serverOrigin = ""
  const previewURL = () => `${serverOrigin}/preview/evidence-host`
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
    sessionID: "ses_evidence_host",
    request: "Verify evidence-backed preview",
    title: "Evidence-backed preview",
    time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "browser-preview-evidence-host-board",
    lastSequence: 0,
    task,
    overview: {
      headline: "Evidence-backed preview",
      summary: "Persisted evidence is available for non-native host preview.",
      controls: {},
    },
    lanes: [],
    interactions: [],
  }
  const evidencePng = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#0f172a"/>
      <rect x="32" y="32" width="576" height="108" rx="8" fill="#e0f2fe"/>
      <text x="56" y="100" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#0f172a">Evidence host preview</text>
      <rect x="48" y="178" width="170" height="110" rx="6" fill="#22c55e"/>
      <rect x="242" y="178" width="154" height="110" rx="6" fill="#f59e0b"/>
      <rect x="420" y="178" width="172" height="110" rx="6" fill="#38bdf8"/>
    </svg>`),
  )
    .png()
    .toBuffer()

  const targetResponse = () => ({
    id: targetID,
    taskID,
    latestEvidenceIDs: { desktop: evidenceID },
    kind: "task-url",
    status: "ready",
    projectRoot,
    url: previewURL(),
    viewports,
    diagnostics: ["Resolved saved browser preview target."],
    candidates: [
      {
        id: targetID,
        url: previewURL(),
        source: "task-artifact",
        selected: true,
        timeUpdated: now - 500,
      },
    ],
    source: "task-artifact",
  })

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${url.pathname}${url.search}`)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/preview/evidence-host")
      return new Response("<main>Evidence host target</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return json({ version: "1.2.3" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover")
      return json({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json({ profiles: [] })
    if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: task.time.updated }] })
    if (path === "/work-ledger")
      return json({
        rows: [
          {
            kind: "task",
            id: taskID,
            title: task.title,
            directory: task.directory,
            created: task.time.created,
            updated: task.time.updated,
            lifecycleStatus: task.status,
            executionStatus: "active",
            priority: "normal",
            source: "browser-preview-evidence-host-test",
          },
        ],
        nextCursor: null,
      })
    if (path === "/path") return json({ directory: projectRoot })
    if (path === "/vcs")
      return json({
        branch: "preview-evidence-host",
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
    if (path === `/task/${taskID}/operator-model-context`) return json({ selected: null, candidates: [] })
    if (path === `/task/${taskID}/board`) return json(board, { headers: { etag: `"board-${task.time.updated}"` } })
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
    if (path === `/task/${taskID}/followup` && req.method === "POST") return json({ suggestion: "" })
    if (
      path === "/work-ledger/events" ||
      path === "/task/events" ||
      path === `/task/${taskID}/events` ||
      path === `/task/${taskID}/conversation/events`
    )
      return eventStream()
    if (path === `/task/${taskID}/browser-preview`) {
      targetRequestCount += 1
      return json(targetResponse())
    }
    if (path === `/task/${taskID}/browser-preview/evidence/${evidenceID}`)
      return json({
        id: evidenceID,
        taskID,
        targetID,
        viewportID: "desktop",
        status: "passed",
        summary: "persisted desktop evidence passed",
        capture: { captured: true, passed: true, url: previewURL(), sha: "evidence-host-sha", bytes: evidencePng.length },
        diagnostics: ["persisted evidence loaded from task-scoped backend evidence route"],
        timeCompleted: now - 100,
        timeCreated: now - 200,
      })
    if (path === `/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`)
      return new Response(evidencePng, { headers: { "content-type": "image/png" } })
    if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST")
      return json({ message: "evidence host test must not auto-capture" }, { status: 500 })
    if (path.includes("/browser-preview/live/")) {
      unexpectedRequests.push(`${req.method} ${path}`)
      return json({ message: "PNG live preview route is retired" }, { status: 410 })
    }
    unexpectedRequests.push(`${req.method} ${path}`)
    return json({ message: `Unexpected evidence host route ${req.method} ${path}` }, { status: 404 })
  })
  serverOrigin = server.origin

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(
      ({ serverUrl, directory, taskID }) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_workspace_task", taskID)
        localStorage.setItem("oc_workspace_directory", directory)
        delete (window as any).__TAURI__
      },
      { serverUrl: server.origin, directory: projectRoot, taskID },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await waitForPageState(
      page,
      () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
      "online connection",
      () => ({ errors: errors.unexpectedErrors, requestLog }),
    )
    await openBrowserPreviewFromTask(page, taskID, () => ({ errors: errors.unexpectedErrors, requestLog }))
    await waitForPageState(
      page,
      () => {
        const evidence = document.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
        const image = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
        return (
          evidence?.dataset.status === "passed" &&
          evidence.textContent?.includes("persisted desktop evidence passed") === true &&
          !document.querySelector('[data-ui="browser-preview-native-surface"]') &&
          !!image &&
          image.dataset.evidenceId === "art_previewevidence_evidence_host_desktop" &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0
        )
      },
      "persisted evidence preview",
      () => ({ errors: errors.unexpectedErrors, requestLog, targetRequestCount }),
    )
    await writeAndAssertScreenshot(page, "01-evidence-backed-preview")

    const targetRequestCountBeforeReload = targetRequestCount
    await page.click('[aria-label="Reload the current preview page."]')
    for (let attempt = 0; attempt < 60 && targetRequestCount <= targetRequestCountBeforeReload; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await waitForPageState(
      page,
      () => document.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')?.dataset.status === "passed",
      "evidence remains visible after non-native reload",
      () => ({ errors: errors.unexpectedErrors, requestLog, targetRequestCount }),
    )
    assert.ok(
      targetRequestCount > targetRequestCountBeforeReload,
      `reload should refetch the task-scoped preview target: ${JSON.stringify({ targetRequestCount, requestLog })}`,
    )
    assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
    assert.deepEqual(
      requestLog.filter((entry) => entry.includes("/browser-preview/capture")),
      [],
      `non-native evidence view must not auto-capture evidence\n${JSON.stringify(requestLog, null, 2)}`,
    )
    assert.deepEqual(
      requestLog.filter((entry) => entry.includes("/browser-preview/live/")),
      [],
      `non-native evidence view must not call retired PNG live routes\n${JSON.stringify(requestLog, null, 2)}`,
    )
    assert.ok(
      requestLog.some((entry) => entry.includes(`/browser-preview/evidence/${evidenceID}`)),
      `persisted evidence route should be the evidence source\n${JSON.stringify(requestLog, null, 2)}`,
    )
    assert.ok(
      requestLog.some((entry) => entry.includes(`/browser-preview/evidence/${evidenceID}/capture.png`)),
      `persisted evidence image should be loaded in the non-native evidence surface\n${JSON.stringify(requestLog, null, 2)}`,
    )
    assert.deepEqual(unexpectedRequests, [])
    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
