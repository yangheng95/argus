import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import sharp from "sharp"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"

const SCREENSHOT_PATH = fileURLToPath(new URL("../../.scratch/browser-preview-native-surface.png", import.meta.url))

await ensureOverlayDist()

type NativeCommandRecord = {
  command: string
  args: Record<string, unknown>
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
  page: OverlayPage,
  predicate: () => boolean,
  label: string,
  diagnostics: () => unknown,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate(predicate)) return
    const signature = JSON.stringify({
      page: await page.evaluate(() => ({
        centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
        browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
        stageStatus:
          document.querySelector<HTMLElement>(
            "[data-ui='browser-preview-live'], [data-ui='browser-preview-native-error'], [data-ui='browser-preview-target-load-failed'], [data-ui='browser-preview-target-failed']",
          )?.dataset.status || "",
        nativeSurface: !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
        nativeCommands: ((window as any).__browserPreviewNativeCommands || []).length,
      })),
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

async function openBrowserPreviewFromTask(page: OverlayPage, taskID: string, diagnostics: () => unknown) {
  await page.waitForSelector(
    '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
    { visible: true },
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

async function nativeCommands(page: OverlayPage): Promise<NativeCommandRecord[]> {
  return await page.evaluate(() => ((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
}

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

test("browser preview native surface owns browser navigation without PNG live routes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")
  mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })

  const now = Date.now()
  const taskID = "tsk_browserpreview_native_surface"
  const targetID = "art_previewtarget_native_surface"
  const projectRoot = "D:/overlay/workspace/native-surface"
  const requestLog: string[] = []
  const errors: string[] = []
  const unexpectedRequests: string[] = []
  const captureBodies: unknown[] = []
  let releaseNativeCapture: (() => void) | undefined
  const nativeCaptureGate = new Promise<void>((resolve) => {
    releaseNativeCapture = resolve
  })
  let serverOrigin = ""
  const previewUrl = () => `${serverOrigin}/preview/native-surface`
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
    sessionID: "ses_native_surface",
    request: "Verify native browser preview surface",
    title: "Verify native browser preview surface",
    time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "native-surface-board",
    lastSequence: 0,
    task,
    overview: {
      headline: "Native browser preview",
      summary: "Backend-owned browser preview target is ready.",
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
    if (path === "/preview/native-surface")
      return new Response("<main>Native browser preview fixture target</main>", {
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
        branch: "native-surface",
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
        diagnostics: ["Resolved native browser preview target."],
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
      await nativeCaptureGate
      return json({
        status: "failed",
        projectRoot,
        target: {
          id: targetID,
          taskID,
          latestEvidenceIDs: {},
          kind: "task-url",
          status: "ready",
          projectRoot,
          url: previewUrl(),
          viewports,
          diagnostics: ["Resolved native browser preview target."],
          candidates: [],
          source: "task-artifact",
        },
        viewports,
        captures: {},
        evidenceIDs: {},
        diagnostics: ["native capture failed after loading assertion"],
      })
    }
    if (path.includes("/browser-preview/live/")) {
      unexpectedRequests.push(`${req.method} ${path}`)
      return json({ message: "PNG live preview route is retired" }, { status: 410 })
    }
    unexpectedRequests.push(`${req.method} ${path}`)
    return json({ message: `Unexpected native surface route ${req.method} ${path}` }, { status: 404 })
  })
  serverOrigin = server.origin

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/native-surface")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_workspace_task", "tsk_browserpreview_native_surface")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/native-surface")
      const settings = {
        serverUrl,
        autoServer: false,
        locale: "en-US",
        directory: "D:/overlay/workspace/native-surface",
        directoryMode: "custom",
        workspaceTaskID: "tsk_browserpreview_native_surface",
        workspaceDirectory: "D:/overlay/workspace/native-surface",
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
              if (
                (window as any).__browserPreviewFailNativeNavigate &&
                command === "overlay_browser_preview_navigate"
              ) {
                throw new Error("native navigation unavailable")
              }
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
      () =>
        !!document.querySelector('[data-ui="browser-preview-native-surface"]') &&
        ((window as any).__browserPreviewNativeCommands || []).some(
          (entry: NativeCommandRecord) => entry.command === "overlay_browser_preview_sync",
        ),
      "native browser preview sync",
      () => ({ errors, requestLog, nativeCommands: [] }),
    )

    const nativeLayout = await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('[data-ui="browser-preview-native-surface"]')
      const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
      const controls = document.querySelector<HTMLElement>('[data-ui="browser-preview-navigation-controls"]')
      const sync = ((window as any).__browserPreviewNativeCommands || []).find(
        (entry: NativeCommandRecord) => entry.command === "overlay_browser_preview_sync",
      )
      const surfaceRect = surface?.getBoundingClientRect()
      const stageRect = stage?.getBoundingClientRect()
      const controlsRect = controls?.getBoundingClientRect()
      return {
        surface: surfaceRect
          ? { x: surfaceRect.x, y: surfaceRect.y, width: surfaceRect.width, height: surfaceRect.height }
          : null,
        stage: stageRect ? { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height } : null,
        controls: controlsRect
          ? { x: controlsRect.x, y: controlsRect.y, width: controlsRect.width, height: controlsRect.height }
          : null,
        sync,
        backDisabled: (document.querySelector('[aria-label="Go back in the preview browser."]') as HTMLButtonElement)
          ?.disabled,
        forwardDisabled: (
          document.querySelector('[aria-label="Go forward in the preview browser."]') as HTMLButtonElement
        )?.disabled,
        reloadDisabled: (
          document.querySelector('[aria-label="Reload the current preview page."]') as HTMLButtonElement
        )?.disabled,
      }
    })
    assert.ok(nativeLayout.surface, `native surface missing: ${JSON.stringify(nativeLayout)}`)
    assert.ok(nativeLayout.stage, `preview stage missing: ${JSON.stringify(nativeLayout)}`)
    assert.ok(nativeLayout.controls, `navigation controls missing: ${JSON.stringify(nativeLayout)}`)
    assert.ok(nativeLayout.sync, `native sync command missing: ${JSON.stringify(await nativeCommands(page))}`)
    const syncArgs = nativeLayout.sync.args as { url?: unknown; bounds?: { width?: number; height?: number } }
    assert.equal(syncArgs.url, previewUrl())
    assert.ok(syncArgs.bounds, `sync bounds missing: ${JSON.stringify(nativeLayout.sync)}`)
    assert.ok((syncArgs.bounds.width || 0) >= nativeLayout.surface.width - 2)
    assert.ok((syncArgs.bounds.height || 0) >= nativeLayout.surface.height - 2)
    assert.ok(
      nativeLayout.surface.height > nativeLayout.surface.width * 0.65,
      `native preview should use panel height instead of a short viewport PNG ratio: ${JSON.stringify(nativeLayout)}`,
    )
    assert.ok(
      nativeLayout.surface.y >= nativeLayout.controls.y + nativeLayout.controls.height,
      `native surface must not overlap browser controls: ${JSON.stringify(nativeLayout)}`,
    )
    assert.equal(nativeLayout.backDisabled, false)
    assert.equal(nativeLayout.forwardDisabled, false)
    assert.equal(nativeLayout.reloadDisabled, false)

    await page.click('[aria-label="Go back in the preview browser."]')
    await page.click('[aria-label="Go forward in the preview browser."]')
    await page.click('[aria-label="Reload the current preview page."]')
    await waitForPageState(
      page,
      () => {
        const actions = ((window as any).__browserPreviewNativeCommands || [])
          .filter((entry: NativeCommandRecord) => entry.command === "overlay_browser_preview_navigate")
          .map((entry: NativeCommandRecord) => entry.args.action)
        return actions.includes("back") && actions.includes("forward") && actions.includes("reload")
      },
      "native browser navigation commands",
      () => ({ errors, requestLog, nativeCommands: [] }),
    )
    const actions = (await nativeCommands(page))
      .filter((entry) => entry.command === "overlay_browser_preview_navigate")
      .map((entry) => entry.args.action)
    assert.deepEqual(actions.slice(-3), ["back", "forward", "reload"])

    const panel = await page.$(".browser-preview-panel")
    assert.ok(panel)
    const screenshot = await panel.screenshot()
    writeFileSync(SCREENSHOT_PATH, screenshot)
    const metadata = await sharp(screenshot).metadata()
    assert.ok((metadata.width || 0) >= 360, `panel screenshot width should be meaningful: ${metadata.width}`)
    assert.ok((metadata.height || 0) >= 520, `panel screenshot height should show the tall native surface: ${metadata.height}`)
    const surfaceScreenshot = await page.screenshot({
      clip: {
        x: nativeLayout.surface.x,
        y: nativeLayout.surface.y,
        width: nativeLayout.surface.width,
        height: nativeLayout.surface.height,
      },
    })
    writeFileSync(
      fileURLToPath(new URL("../../.scratch/browser-preview-native-surface-crop.png", import.meta.url)),
      surfaceScreenshot,
    )
    const surfaceMetadata = await sharp(surfaceScreenshot).metadata()
    assert.ok(
      Math.abs((surfaceMetadata.width || 0) - nativeLayout.surface.width) <= 2,
      `native surface crop width should match sync bounds: ${JSON.stringify({ surfaceMetadata, nativeLayout })}`,
    )
    assert.ok(
      Math.abs((surfaceMetadata.height || 0) - nativeLayout.surface.height) <= 2,
      `native surface crop height should match sync bounds: ${JSON.stringify({ surfaceMetadata, nativeLayout })}`,
    )

    assert.equal(captureBodies.length, 0, "opening native live preview must not auto-capture evidence")

    await page.evaluate(() => {
      ;(window as any).__browserPreviewFailNativeNavigate = true
    })
    await page.click('[aria-label="Reload the current preview page."]')
    await waitForPageState(
      page,
      () =>
        document
          .querySelector<HTMLElement>('[data-ui="browser-preview-native-error"]')
          ?.textContent?.includes("native navigation unavailable") === true,
      "native preview navigation error",
      () => ({ errors, requestLog, nativeCommands: [] }),
    )
    await page.click(".browser-preview-capture-button")
    await waitForPageState(
      page,
      () => {
        const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
        const loading = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-capture-loading"]')
        const nativeError = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-native-error"]')
        return loading?.dataset.status === "loading" && !nativeError
      },
      "capture loading replaces stale native preview error",
      () => ({ errors, requestLog, nativeCommands: [] }),
    )
    const nativeErrorCapturePanel = await page.$(".browser-preview-panel")
    assert.ok(nativeErrorCapturePanel)
    writeFileSync(
      fileURLToPath(new URL("../../.scratch/browser-preview-native-error-capture-loading.png", import.meta.url)),
      await nativeErrorCapturePanel.screenshot(),
    )
    releaseNativeCapture?.()
    await waitForPageState(
      page,
      () =>
        document
          .querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          ?.textContent?.includes("native capture failed after loading assertion") === true,
      "native capture failure settles after loading assertion",
      () => ({ errors, requestLog, nativeCommands: [] }),
    )
    assert.deepEqual(captureBodies, [{ targetID, viewportIDs: ["desktop", "tablet", "mobile"] }])
    assert.deepEqual(
      requestLog.filter((entry) => entry.includes("/browser-preview/live/")),
      [],
      `native surface must not call retired PNG live routes: ${JSON.stringify(requestLog, null, 2)}`,
    )
    assert.deepEqual(unexpectedRequests, [])
    assert.equal(errors.length, 0, errors.join("\n"))
  } finally {
    releaseNativeCapture?.()
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
