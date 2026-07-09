import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"

const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/browser-preview-visual-stress/", import.meta.url))

await ensureOverlayDist()

type NativeCommandRecord = {
  command: string
  args: Record<string, unknown>
}

type BrowserPreviewTargetMode = "load-error" | "ready" | "failed"

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

function taskFixture(input: { id: string; title: string; directory: string; now: number }) {
  return {
    id: input.id,
    directory: input.directory,
    orderKey: testTaskOrderKey(input.id, input.now - 10_000),
    status: "active",
    sessionID: `ses_${input.id}`,
    request: input.title,
    title: input.title,
    time: { created: input.now - 10_000, started: input.now - 9_000, updated: input.now - 1_000 },
  }
}

function boardFixture(task: ReturnType<typeof taskFixture>) {
  return {
    snapshotVersion: `${task.id}-board`,
    lastSequence: 0,
    task,
    overview: {
      headline: task.title,
      summary: "Backend-owned browser preview target fixture.",
      controls: {},
    },
    lanes: [],
    interactions: [],
  }
}

function conversationFixture(board: ReturnType<typeof boardFixture>) {
  return {
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
  }
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
        const activeStage = document.querySelector<HTMLElement>(
          [
            "[data-ui='browser-preview-target-load-failed']",
            "[data-ui='browser-preview-native-error']",
            "[data-ui='browser-preview-live']",
            "[data-ui='browser-preview-target-failed']",
            "[data-ui='browser-preview-evidence']",
            "[data-status='missing']",
          ].join(", "),
        )
        return {
          centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
          browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
          activeUI: activeStage?.getAttribute("data-ui") || "",
          activeStatus: activeStage?.dataset.status || "",
          nativeSurface: !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
          nativeCommands: ((window as any).__browserPreviewNativeCommands || []).length,
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

async function nativeCommands(page: OverlayPage): Promise<NativeCommandRecord[]> {
  return await page.evaluate(() =>
    (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[]).map((entry) => {
      const args = (entry.args || {}) as Record<string, unknown>
      const bounds = args.bounds as Record<string, unknown> | undefined
      return {
        command: String(entry.command || ""),
        args: {
          ...(typeof args.action === "string" ? { action: args.action } : {}),
          ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
          ...(typeof args.url === "string" ? { url: args.url } : {}),
          ...(typeof args.scopeKey === "string" ? { scopeKey: args.scopeKey } : {}),
          ...(bounds && typeof bounds === "object"
            ? {
                bounds: {
                  x: typeof bounds.x === "number" ? bounds.x : 0,
                  y: typeof bounds.y === "number" ? bounds.y : 0,
                  width: typeof bounds.width === "number" ? bounds.width : 0,
                  height: typeof bounds.height === "number" ? bounds.height : 0,
                },
              }
            : {}),
        },
      }
    }),
  )
}

function nativeSyncCommands(commands: NativeCommandRecord[]): NativeCommandRecord[] {
  return commands.filter((entry) => entry.command === "overlay_browser_preview_sync")
}

async function waitForNativeSyncUrl(page: OverlayPage, url: string, minCount: number, label: string) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    const commands = await nativeCommands(page)
    const matches = nativeSyncCommands(commands).filter((entry) => entry.args.url === url)
    if (matches.length >= minCount) return commands
    const signature = JSON.stringify({ matches: matches.length, last: commands.at(-1) || null })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No native preview sync while waiting for ${label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForNativeNavigation(page: OverlayPage, action: string, minCount: number, label: string) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    const commands = (await nativeCommands(page)).filter(
      (entry) => entry.command === "overlay_browser_preview_navigate" && entry.args.action === action,
    )
    if (commands.length >= minCount) return
    const signature = JSON.stringify(commands)
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No native preview navigation while waiting for ${label}\n${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function saveAddressTarget(page: OverlayPage, url: string) {
  const input = '[data-ui="browser-preview-address-input"]'
  await page.waitForSelector(input, { visible: true })
  await page.focus(input)
  await page.$eval(
    input,
    (node: HTMLInputElement, nextURL) => {
      node.value = String(nextURL)
      node.dispatchEvent(new Event("input", { bubbles: true }))
    },
    url,
  )
  await page.keyboard.press("Enter")
}

async function writeAndAssertScreenshot(
  page: OverlayPage,
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
    stats.width >= (options.minWidth ?? 320) && stats.height >= (options.minHeight ?? 360),
    `${name} screenshot dimensions are invalid: ${JSON.stringify({ stats }, null, 2)}`,
  )
  assert.ok(
    stats.nonWhiteDensity > (options.minNonWhiteDensity ?? 0.018),
    `${name} screenshot lacks visible UI pixels: ${JSON.stringify(stats)}`,
  )
  assert.ok(stats.uniqueColorBuckets > 18, `${name} screenshot is visually too sparse: ${JSON.stringify(stats)}`)
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

async function previewLayout(page: OverlayPage) {
  return await page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector)
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      panel: box(".browser-preview-panel"),
      chrome: box('[data-ui="browser-preview-chrome"]'),
      toolbar: box('[data-ui="browser-preview-toolbar"]'),
      stage: box(".browser-preview-stage"),
      surface: box('[data-ui="browser-preview-native-surface"]'),
      address: box('[data-ui="browser-preview-address-form"]'),
      input: box('[data-ui="browser-preview-address-input"]'),
      reload: box('[aria-label="Reload the current preview page."]'),
      selection: box('[aria-label="Select a node in the live preview."]'),
      evidence: !!document.querySelector('[data-ui="browser-preview-evidence"]'),
    }
  })
}

test(
  "browser preview visual stress follows task-scoped native preview ownership",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")
    rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const now = Date.now()
    const primaryTaskID = "tsk_browserpreview_visual_stress"
    const missingTaskID = "tsk_browserpreview_visual_missing"
    const primaryTargetID = "art_previewtarget_visual_primary"
    const savedTargetID = "art_previewtarget_visual_saved"
    const evidenceID = "art_previewevidence_visual_existing"
    const projectRoot = "D:/overlay/workspace/preview-stress"
    const requestLog: string[] = []
    const unexpectedRequests: string[] = []
    const saveBodies: unknown[] = []
    let serverOrigin = ""
    let targetMode: BrowserPreviewTargetMode = "load-error"
    let selectedTargetID = primaryTargetID
    let selectedURL = ""
    const previewURL = () => `${serverOrigin}/preview/visual-saved`
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const primaryTask = taskFixture({
      id: primaryTaskID,
      title: "Preview visual stress",
      directory: projectRoot,
      now,
    })
    const missingTask = taskFixture({
      id: missingTaskID,
      title: "Preview missing target",
      directory: projectRoot,
      now: now - 200,
    })
    const tasks = [primaryTask, missingTask]
    const boards = new Map(tasks.map((task) => [task.id, boardFixture(task)]))
    const targetResponse = () => ({
      id: selectedTargetID,
      taskID: primaryTaskID,
      latestEvidenceIDs: { desktop: evidenceID },
      kind: "task-url",
      status: "ready",
      projectRoot,
      url: selectedURL || previewURL(),
      viewports,
      diagnostics: ["Resolved saved browser preview target."],
      candidates: [
        {
          id: selectedTargetID,
          url: selectedURL || previewURL(),
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
      if (path === "/preview/visual-saved")
        return new Response("<main><h1>Native visual stress target</h1></main>", {
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
      if (path === "/global/tasks") return json({ tasks: tasks.map((task) => ({ task, updated_at: task.time.updated })) })
      if (path === "/work-ledger")
        return json({
          rows: tasks.map((task) => ({
            kind: "task",
            id: task.id,
            title: task.title,
            directory: task.directory,
            created: task.time.created,
            updated: task.time.updated,
            lifecycleStatus: task.status,
            executionStatus: "active",
            priority: "normal",
            source: "browser-preview-visual-stress-test",
          })),
          nextCursor: null,
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
      for (const task of tasks) {
        const board = boards.get(task.id)
        if (path === `/task/${task.id}/operator-model-context`) return json({ selected: null, candidates: [] })
        if (path === `/task/${task.id}/board`) return json(board, { headers: { etag: `"board-${task.time.updated}"` } })
        if (path === `/task/${task.id}/conversation`) return json(conversationFixture(board!))
        if (path === `/task/${task.id}/transcript`) return json([])
        if (path === `/task/${task.id}/trace`)
          return json({ events: [], traceDir: `${task.directory}/.opencorvus/trace`, enabled: true })
        if (path === `/task/${task.id}/followup` && req.method === "POST") return json({ suggestion: "" })
        if (
          path === "/work-ledger/events" ||
          path === "/task/events" ||
          path === `/task/${task.id}/events` ||
          path === `/task/${task.id}/conversation/events`
        )
          return eventStream()
      }
      if (path === `/task/${missingTaskID}/browser-preview`)
        return json({
          kind: "missing",
          status: "missing",
          projectRoot,
          taskID: missingTaskID,
          viewports,
          diagnostics: ["No browser preview target saved for this task."],
          candidates: [],
          source: "none",
        })
      if (path === `/task/${primaryTaskID}/browser-preview`) {
        if (targetMode === "load-error")
          return json({ message: "browser preview target lookup failed during visual stress" }, { status: 503 })
        if (targetMode === "failed")
          return json({
            id: selectedTargetID,
            taskID: primaryTaskID,
            kind: "failed",
            status: "failed",
            projectRoot,
            url: selectedURL || previewURL(),
            viewports,
            diagnostics: ["Saved browser preview target is unreachable during visual stress."],
            candidates: [],
            source: "task-artifact",
          })
        return json(targetResponse())
      }
      if (path === `/task/${primaryTaskID}/browser-preview/target` && req.method === "POST") {
        const body = (await req.json()) as { url?: unknown; viewports?: unknown }
        saveBodies.push(body)
        if (typeof body.url !== "string" || !body.url.trim())
          return json({ message: "url is required" }, { status: 400 })
        selectedURL = body.url.trim()
        selectedTargetID = savedTargetID
        targetMode = "ready"
        return json(targetResponse())
      }
      if (path === `/task/${primaryTaskID}/browser-preview/capture` && req.method === "POST")
        return json({ message: "visual stress must not trigger hidden evidence capture" }, { status: 500 })
      if (path === `/task/${primaryTaskID}/browser-preview/evidence/${evidenceID}`)
        return json({
          id: evidenceID,
          taskID: primaryTaskID,
          targetID: selectedTargetID,
          viewportID: "desktop",
          status: "passed",
          summary: "persisted evidence must not own the native visual preview",
          capture: { captured: true, passed: true, url: selectedURL || previewURL(), sha: "visual-stress-existing" },
          diagnostics: ["persisted evidence loaded for diagnostics"],
          timeCompleted: now - 100,
          timeCreated: now - 200,
        })
      if (path === `/task/${primaryTaskID}/browser-preview/evidence/${evidenceID}/capture.png`)
        return new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFgwJ/l3qJ6wAAAABJRU5ErkJggg==",
            "base64",
          ),
          { headers: { "content-type": "image/png" } },
        )
      if (path.includes("/browser-preview/live/")) {
        unexpectedRequests.push(`${req.method} ${path}`)
        return json({ message: "PNG live preview route is retired" }, { status: 410 })
      }
      unexpectedRequests.push(`${req.method} ${path}`)
      return json({ message: `Unexpected browser preview stress route ${req.method} ${path}` }, { status: 404 })
    })
    serverOrigin = server.origin
    selectedURL = previewURL()

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowConsoleError(message) {
          return message.text.includes("503")
        },
        allowResponse(response) {
          return response.status === 503 && response.path === `/task/${primaryTaskID}/browser-preview`
        },
      })
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument(
        ({ serverUrl, directory, taskID }) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_directory", directory)
          localStorage.setItem("oc_server_url", serverUrl)
          localStorage.setItem("oc_workspace_task", taskID)
          localStorage.setItem("oc_workspace_directory", directory)
          const settings = {
            serverUrl,
            autoServer: false,
            locale: "en-US",
            directory,
            directoryMode: "custom",
            workspaceTaskID: taskID,
            workspaceDirectory: directory,
          }
          const nativeCommands: NativeCommandRecord[] = []
          ;(window as any).__browserPreviewNativeCommands = nativeCommands
          ;(window as any).__browserPreviewFailNativeSync = false
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
                  if ((window as any).__browserPreviewFailNativeSync && command === "overlay_browser_preview_sync") {
                    throw new Error("native sync unavailable")
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
        },
        { serverUrl: server.origin, directory: projectRoot, taskID: primaryTaskID },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForPageState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "online connection",
        () => ({ errors: errors.unexpectedErrors, requestLog }),
      )

      await openBrowserPreviewFromTask(page, primaryTaskID, () => ({ errors: errors.unexpectedErrors, requestLog }))
      await waitForPageState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-target-load-failed"]'),
        "target load failure",
        () => ({ errors: errors.unexpectedErrors, requestLog }),
      )
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      await writeAndAssertScreenshot(page, "01-target-load-failure")

      await saveAddressTarget(page, previewURL())
      await waitForPageState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-native-surface"]'),
        "saved address native surface",
        () => ({ errors: errors.unexpectedErrors, requestLog, saveBodies }),
      )
      await waitForNativeSyncUrl(page, previewURL(), 1, "saved address native sync")
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')?.dataset.status === "ready",
        "saved address native surface ready",
        () => ({ errors: errors.unexpectedErrors, requestLog, saveBodies }),
      )
      assert.equal(await page.$('[data-ui="browser-preview-evidence"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-evidence-missing"]'), null)
      const layout = await previewLayout(page)
      assert.ok(layout.panel && layout.chrome && layout.stage && layout.surface, JSON.stringify(layout, null, 2))
      assert.ok(layout.overflowX <= 1, `preview must not overflow horizontally\n${JSON.stringify(layout, null, 2)}`)
      assert.ok(
        layout.surface.top >= layout.chrome.bottom - 1,
        `native surface must sit below browser chrome\n${JSON.stringify(layout, null, 2)}`,
      )
      assert.ok(
        layout.surface.height > layout.surface.width * 0.6,
        `native surface must use the panel height, not a PNG aspect-ratio frame\n${JSON.stringify(layout, null, 2)}`,
      )
      assert.equal(layout.evidence, false)
      assert.deepEqual(
        saveBodies.map((body) => ({
          url: (body as { url?: unknown }).url,
          viewportIDs: ((body as { viewports?: Array<{ id?: string }> }).viewports || []).map((item) => item.id),
        })),
        [{ url: previewURL(), viewportIDs: ["desktop", "tablet", "mobile"] }],
      )
      await writeAndAssertScreenshot(page, "02-ready-native")

      const reloadCountBefore = (await nativeCommands(page)).filter(
        (entry) => entry.command === "overlay_browser_preview_navigate" && entry.args.action === "reload",
      ).length
      await page.click('[aria-label="Reload the current preview page."]')
      await waitForNativeNavigation(page, "reload", reloadCountBefore + 1, "native reload command")
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')?.dataset.status === "ready",
        "native surface ready after reload",
        () => ({ errors: errors.unexpectedErrors, requestLog }),
      )

      await page.evaluate(() => {
        ;(window as any).__browserPreviewFailNativeSync = true
      })
      await page.click('[aria-label="Reload the current preview page."]')
      await waitForPageState(
        page,
        () =>
          document
            .querySelector<HTMLElement>('[data-ui="browser-preview-native-error"]')
            ?.textContent?.includes("native sync unavailable") === true,
        "native sync failure state",
        () => ({ errors: errors.unexpectedErrors, requestLog, nativeCommands: [] }),
      )
      await writeAndAssertScreenshot(page, "03-native-sync-failure")
      await page.evaluate(() => {
        ;(window as any).__browserPreviewFailNativeSync = false
      })

      await openBrowserPreviewFromTask(page, missingTaskID, () => ({ errors: errors.unexpectedErrors, requestLog }))
      await waitForPageState(
        page,
        () => document.body.textContent?.includes("No browser preview target is saved for this task.") === true,
        "missing preview target",
        () => ({ errors: errors.unexpectedErrors, requestLog }),
      )
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-evidence"]'), null)
      await writeAndAssertScreenshot(page, "04-missing-target")

      targetMode = "failed"
      await openBrowserPreviewFromTask(page, primaryTaskID, () => ({ errors: errors.unexpectedErrors, requestLog }))
      await waitForPageState(
        page,
        () => !!document.querySelector('[data-ui="browser-preview-target-failed"]'),
        "failed preview target",
        () => ({ errors: errors.unexpectedErrors, requestLog }),
      )
      assert.equal(await page.$('[data-ui="browser-preview-native-surface"]'), null)
      assert.equal(await page.$('[data-ui="browser-preview-evidence"]'), null)
      await writeAndAssertScreenshot(page, "05-target-failed")

      assert.deepEqual(
        requestLog.filter((entry) => entry.includes("/browser-preview/live/")),
        [],
        `visual stress must not call retired PNG live routes\n${JSON.stringify(requestLog, null, 2)}`,
      )
      assert.deepEqual(
        requestLog.filter((entry) => entry.includes("/browser-preview/capture")),
        [],
        `visual stress must not auto-capture evidence\n${JSON.stringify(requestLog, null, 2)}`,
      )
      assert.deepEqual(
        requestLog.filter((entry) => entry.includes("/capture.png")),
        [],
        `native preview must not fetch hidden evidence PNGs\n${JSON.stringify(requestLog, null, 2)}`,
      )
      assert.deepEqual(unexpectedRequests, [])
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
