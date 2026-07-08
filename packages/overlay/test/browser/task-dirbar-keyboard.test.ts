import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const PROJECT_DIRECTORY = "D:/overlay/workspace/app"
const DETECTED_PROJECT_ROOT = "C:/overlay/discovered-workspaces"

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function eventStream() {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(":\n\n"))
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
    },
  )
}

type BrowserErrorCollectorOptions = NonNullable<Parameters<typeof installBrowserErrorCollector>[1]>
type BrowserRequestFailure = Parameters<NonNullable<BrowserErrorCollectorOptions["allowRequestFailure"]>>[0]

function isTaskEventAbort(failure: BrowserRequestFailure): boolean {
  return (
    failure.errorText === "net::ERR_ABORTED" &&
    (failure.path === "/task/events" || /^\/task\/[^/]+\/events$/.test(failure.path))
  )
}

function installTaskDirbarErrorCollector(
  page: Parameters<typeof installBrowserErrorCollector>[0],
  options: BrowserErrorCollectorOptions = {},
) {
  return installBrowserErrorCollector(page, {
    ...options,
    allowRequestFailure(failure) {
      if (isTaskEventAbort(failure)) return true
      return options.allowRequestFailure?.(failure) ?? false
    },
  })
}

type TaskDirbarFixtureOptions = {
  discovery: { body: unknown; status?: number }
  projectDirectory?: string
  healthStatus?: () => number
  tasks?: unknown | (() => unknown)
  tasksStatus?: number | (() => number)
  tasksError?: unknown | (() => unknown)
  taskConversation?: { taskID: string; body: unknown; status?: number }
  taskBoard?: { taskID: string; body: unknown; status?: number }
  worktrees?:
    | unknown
    | (() => unknown)
    | ((input: { directory: string }) => unknown | { body: unknown; status?: number } | Promise<unknown>)
  worktreesStatus?: number | (() => number)
  worktreesError?: unknown | (() => unknown)
  deleteWorktree?:
    | { body: unknown; status?: number }
    | ((input: {
        directory: string
      }) => { body: unknown; status?: number } | Promise<{ body: unknown; status?: number }>)
  deleteTask?: { body: unknown; status?: number } | ((input: { taskID: string }) => { body: unknown; status?: number })
  renameTask?:
    | { body: unknown; status?: number }
    | ((input: { taskID: string; title: string }) => { body: unknown; status?: number })
  startQueuedTaskNow?:
    | { body: unknown; status?: number }
    | ((input: { taskID: string; directory: string }) => { body: unknown; status?: number })
  deleteProject?:
    | { body: unknown; status?: number }
    | ((input: { directory: string }) => { body: unknown; status?: number })
  renameProject?:
    | { body: unknown; status?: number }
    | ((input: { directory: string; name: string }) => { body: unknown; status?: number })
  reorderTaskQueue?:
    | { body: unknown; status?: number }
    | ((input: { directory: string; orderedTaskIDs: string[]; revision?: string }) => {
        body: unknown
        status?: number
      })
}

async function taskDirbarFixtureResponse(req: Request, options: TaskDirbarFixtureOptions): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  const projectDirectory = options.projectDirectory ?? PROJECT_DIRECTORY
  const directory = url.searchParams.get("directory")
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse
  if (path === "/global/health") return send({ version: "1.2.3" }, { status: options.healthStatus?.() ?? 200 })
  if (path === "/work-ledger") return send({ rows: [], nextCursor: null })
  if (path === "/global/tasks") {
    const tasksStatus = typeof options.tasksStatus === "function" ? options.tasksStatus() : (options.tasksStatus ?? 200)
    const body =
      tasksStatus >= 400
        ? typeof options.tasksError === "function"
          ? options.tasksError()
          : options.tasksError
        : typeof options.tasks === "function"
          ? options.tasks()
          : (options.tasks ?? { tasks: [] })
    if (tasksStatus >= 400 && body === undefined) {
      throw new Error("taskDirbarFixtureResponse requires tasksError when tasksStatus is >= 400")
    }
    return send(body, {
      status: tasksStatus,
    })
  }
  const deleteTaskMatch = path.match(/^\/task\/([^/]+)$/)
  if (deleteTaskMatch && req.method === "DELETE") {
    const taskID = decodeURIComponent(deleteTaskMatch[1]!)
    const result =
      typeof options.deleteTask === "function"
        ? options.deleteTask({ taskID })
        : (options.deleteTask ?? { body: true, status: 200 })
    return send(result.body, { status: result.status ?? 200 })
  }
  const renameTaskMatch = path.match(/^\/task\/([^/]+)\/title$/)
  if (renameTaskMatch && req.method === "PATCH") {
    const taskID = decodeURIComponent(renameTaskMatch[1]!)
    const body = (await req.json().catch(() => ({}))) as { title?: string }
    const result =
      typeof options.renameTask === "function"
        ? options.renameTask({ taskID, title: typeof body.title === "string" ? body.title : "" })
        : (options.renameTask ?? { body: true, status: 200 })
    return send(result.body, { status: result.status ?? 200 })
  }
  const startNowMatch = path.match(/^\/task\/([^/]+)\/start-now$/)
  if (startNowMatch && req.method === "POST") {
    const taskID = decodeURIComponent(startNowMatch[1]!)
    const directory = url.searchParams.get("directory") || projectDirectory
    const result =
      typeof options.startQueuedTaskNow === "function"
        ? options.startQueuedTaskNow({ taskID, directory })
        : (options.startQueuedTaskNow ?? {
            body: {
              task: { id: taskID, title: "Reload target task" },
              directory,
              status: "active",
              started: true,
              queuedTaskIDs: [],
            },
            status: 200,
          })
    return send(result.body, { status: result.status ?? 200 })
  }
  if (path === "/task-queue/reorder" && req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as {
      directory?: string
      orderedTaskIDs?: string[]
      revision?: string
    }
    const result =
      typeof options.reorderTaskQueue === "function"
        ? options.reorderTaskQueue({
            directory: typeof body.directory === "string" ? body.directory : "",
            orderedTaskIDs: Array.isArray(body.orderedTaskIDs) ? body.orderedTaskIDs : [],
            revision: typeof body.revision === "string" ? body.revision : undefined,
          })
        : (options.reorderTaskQueue ?? {
            body: {
              directory: body.directory ?? projectDirectory,
              revision: "fixture",
              queuedTaskIDs: body.orderedTaskIDs ?? [],
            },
            status: 200,
          })
    return send(result.body, { status: result.status ?? 200 })
  }
  if (path === "/project/current" && req.method === "DELETE") {
    const target = url.searchParams.get("directory") || projectDirectory
    const result =
      typeof options.deleteProject === "function"
        ? options.deleteProject({ directory: target })
        : (options.deleteProject ?? {
            body: {
              ok: true,
              projectID: "prj_fixture",
              directory: target,
              deletedTaskCount: 1,
            },
            status: 200,
          })
    return send(result.body, { status: result.status ?? 200 })
  }
  if (path === "/project/current" && req.method === "PATCH") {
    const target = url.searchParams.get("directory") || projectDirectory
    const body = (await req.json().catch(() => ({}))) as { name?: string }
    const name = typeof body.name === "string" ? body.name : ""
    const result =
      typeof options.renameProject === "function"
        ? options.renameProject({ directory: target, name })
        : (options.renameProject ?? {
            body: { id: "prj_fixture", worktree: target, name },
            status: 200,
          })
    return send(result.body, { status: result.status ?? 200 })
  }
  if (options.taskConversation && path === `/task/${options.taskConversation.taskID}/conversation`) {
    return send(options.taskConversation.body, { status: options.taskConversation.status ?? 200 })
  }
  if (options.taskBoard && path === `/task/${options.taskBoard.taskID}/board`) {
    return send(options.taskBoard.body, { status: options.taskBoard.status ?? 200 })
  }
  if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) return send({ selected: null, candidates: [] })
  if (path === "/session" || path === "/mission") return send([])
  if (path === "/project/current/worktrees") {
    if (req.method === "DELETE") {
      const body = (await req.json().catch(() => ({}))) as { directory?: string }
      const directory = typeof body.directory === "string" ? body.directory : ""
      const result =
        typeof options.deleteWorktree === "function"
          ? await options.deleteWorktree({ directory })
          : (options.deleteWorktree ?? { body: { ok: true }, status: 200 })
      return send(result.body, { status: result.status ?? 200 })
    }
    let worktreesStatus =
      typeof options.worktreesStatus === "function" ? options.worktreesStatus() : (options.worktreesStatus ?? 200)
    let body: unknown
    if (worktreesStatus >= 400) {
      body = typeof options.worktreesError === "function" ? options.worktreesError() : options.worktreesError
    } else if (typeof options.worktrees === "function") {
      const result = await (
        options.worktrees as (input: {
          directory: string
        }) => unknown | { body: unknown; status?: number } | Promise<unknown>
      )({
        directory: directory || projectDirectory,
      })
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        "body" in result &&
        (typeof (result as { status?: unknown }).status === "number" || (result as { status?: unknown }).status == null)
      ) {
        body = (result as { body: unknown; status?: number }).body
        worktreesStatus = (result as { body: unknown; status?: number }).status ?? 200
      } else {
        body = result
      }
    } else {
      body = options.worktrees ?? []
    }
    if (worktreesStatus >= 400 && body === undefined) {
      throw new Error("taskDirbarFixtureResponse requires worktreesError when worktreesStatus is >= 400")
    }
    return send(body, { status: worktreesStatus })
  }
  if (path === "/path") return send({ directory: directory ?? projectDirectory })
  if (path === "/vcs") {
    return send({
      initialized: true,
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
  if (path === "/global/projects/discover") {
    return send(options.discovery.body, { status: options.discovery.status ?? 200 })
  }
  if (path === "/provider") return send({ all: [], connected: [], default: {} })
  if (path === "/provider/auth") return send({})
  if (path === "/config/providers") return send({ providers: [], default: {} })
  if (path === "/config/prompt") return send([])
  if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
  if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) return send({ model: "" })
  if (path === "/skill/mounts")
    return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
  if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
  if (path === "/coding/cli/profiles") return send({ profiles: [] })
  if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
  if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
    return eventStream()
  }
  if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
  if (path === "/skill/installed" || path === "/skill") return send([])
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory") return send([])
  if (path === "/panel/knowledge/preference") return send([])
  if (path === "/log" && req.method === "POST") return send({ ok: true })
  return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
}

function taskListItem(id: string, overrides: Record<string, unknown> = {}) {
  const task = {
    id,
    title: "Reload target task",
    status: "active",
    priority: "normal",
    request: "reload target task",
    directory: PROJECT_DIRECTORY,
    sessionID: `ses_${id}`,
    orderKey: `v1:0001779100000000:0000000000000000:0000000000000000:test:${id}`,
    time: { created: 1_779_100_000_000, updated: 1_779_100_000_100 },
    attachments: [],
    ...overrides,
  }
  return { task, overview: { title: task.title } }
}

function taskConversationPayload(item: { task: Record<string, unknown>; overview?: unknown }) {
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: `board:${item.task.id}`,
      task: item.task,
      overview: item.overview,
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { topLevelSessionIDs: [], sessions: [], messages: [] },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 100 },
    history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
    messageWatermark: 0,
  }
}

async function saveScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await page.screenshot({ fullPage: false }))
  return target
}

async function saveElementScreenshot(
  page: { $(selector: string): Promise<{ screenshot(options?: Record<string, unknown>): Promise<Buffer> } | null> },
  selector: string,
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${name} screenshot should not be empty`)
  await writeFile(target, screenshot)
  return target
}

async function revealRightToolbar(page: {
  $eval(selector: string, pageFunction: (node: Element) => { x: number; y: number }): Promise<{ x: number; y: number }>
  mouse: { move(x: number, y: number, options?: Record<string, unknown>): Promise<void> }
  waitForFunction(pageFunction: () => boolean): Promise<unknown>
}) {
  const point = await page.$eval("#solidRightActivityToolbar", (node) => {
    const rect = (node as HTMLElement).getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.bottom - Math.min(24, Math.max(4, rect.height / 2)),
    }
  })
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(() => {
    const toolbar = document.querySelector<HTMLElement>("#solidRightActivityToolbar .side-activity-toolbar")
    const trigger = document.querySelector<HTMLElement>('[data-ui="project-runtime-status-dropdown"]')
    if (!toolbar || !trigger) return false
    if (getComputedStyle(toolbar).pointerEvents !== "auto") return false
    const rect = trigger.getBoundingClientRect()
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return element === trigger || !!element?.closest('[data-ui="project-runtime-status-dropdown"]')
  })
}

async function openTasksActivity(page: {
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>
  click(selector: string): Promise<unknown>
}) {
  const tasksActivity = '[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]'
  await page.waitForSelector(tasksActivity, { visible: true })
  await page.click(tasksActivity)
  await page.waitForSelector('#leftPanelTasks[data-active="true"]', { visible: true })
}

function visibleNotificationPredicate(notificationID: string): () => boolean {
  const selector = `.app-notification[data-notification-id="${notificationID}"]`
  return new Function(`
    const selector = ${JSON.stringify(selector)};
    return [...document.querySelectorAll(selector)].some((node) => {
      const element = node;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
  `) as () => boolean
}

test(
  "right toolbar runtime status panel merges Git status with worktree controls",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [
              {
                directory: PROJECT_DIRECTORY,
                name: "app",
                marker: "package.json",
              },
            ],
          },
        },
        worktrees: [
          {
            name: "worktree",
            branch: "opencorvus/w/02n7Ucxv",
            directory: "D:/overlay/workspace/app/.opencorvus/r/w/02n7Ucxv/worktree",
            goalID: "gol_one_line_a",
            status: "expired",
            removable: true,
          },
          {
            name: "long-worktree-name-for-ellipsis",
            branch: "opencorvus/s/18ikOXOX",
            directory: "D:/overlay/workspace/app/.opencorvus/r/s/18ikOXOX/worktree",
            goalID: "gol_one_line_b",
            status: "active",
            removable: false,
          },
        ],
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem(
            "oc_recent_directories",
            JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
          )
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"][data-vcs-tone="good"]', {
        visible: true,
      })

      const triggerSemantics = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => {
        const element = node as HTMLElement
        return {
          tag: element.tagName,
          type: element.getAttribute("type") ?? "",
          className: element.className,
          chrome: element.dataset.chrome ?? "",
          toolbarCompact: element.dataset.toolbarCompact ?? "",
          vcsTone: element.dataset.vcsTone ?? "",
          label: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
          badge: element.querySelector(".project-runtime-trigger-badge")?.textContent?.trim() ?? "",
          dotTone: element.querySelector<HTMLElement>(".project-runtime-trigger-dot")?.dataset.tone ?? "",
          svgCount: element.querySelectorAll("svg").length,
        }
      })
      assert.equal(triggerSemantics.tag, "BUTTON")
      assert.equal(triggerSemantics.type, "button")
      assert.match(triggerSemantics.className, /\boc-button\b/)
      assert.equal(triggerSemantics.chrome, "icon-action")
      assert.equal(triggerSemantics.toolbarCompact, "true")
      assert.equal(triggerSemantics.vcsTone, "good")
      assert.match(triggerSemantics.label, /Project runtime/)
      assert.equal(triggerSemantics.title, triggerSemantics.label)
      assert.equal(triggerSemantics.badge, "2")
      assert.equal(triggerSemantics.dotTone, "good")
      assert.ok(triggerSemantics.svgCount >= 1, JSON.stringify(triggerSemantics))

      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector(".project-runtime-git-section[data-tone='good']", { visible: true })
      await page.waitForSelector(".project-worktree-row", { visible: true })

      const panelState = await page.evaluate(() => {
        const trigger = document.querySelector('[data-ui="project-runtime-status-dropdown"]') as HTMLElement | null
        const panel = document.querySelector(".project-runtime-status-panel") as HTMLElement | null
        const gitSection = document.querySelector(".project-runtime-git-section") as HTMLElement | null
        return {
          panelVisible: !!panel && !panel.hidden,
          panelRole: panel?.getAttribute("role") ?? "",
          ariaExpanded: trigger?.getAttribute("aria-expanded") ?? "",
          dataExpanded: trigger?.hasAttribute("data-expanded") ?? false,
          dataOpen: trigger?.getAttribute("data-open") ?? null,
          title: panel?.querySelector(".project-runtime-panel-title")?.textContent?.trim() ?? "",
          gitTitle: gitSection?.querySelector(".project-runtime-section-title")?.textContent?.trim() ?? "",
          gitState: gitSection?.querySelector(".project-runtime-git-state")?.textContent?.trim() ?? "",
          gitRows: [...document.querySelectorAll<HTMLElement>(".project-runtime-git-row")].map((row) =>
            row.textContent?.trim(),
          ),
          worktreeTitle:
            [...document.querySelectorAll<HTMLElement>(".project-runtime-section-title")]
              .map((node) => node.textContent?.trim() ?? "")
              .find((value) => value === "Project worktrees") ?? "",
          cleanupVisible: !!document.querySelector('[data-ui="project-worktree-cleanup-expired"]'),
          removeButtons: document.querySelectorAll('[data-ui="project-worktree-remove"]').length,
          initGitVisible: !!document.querySelector('[data-ui="project-init-git"]'),
        }
      })
      assert.deepEqual(
        {
          panelVisible: panelState.panelVisible,
          panelRole: panelState.panelRole,
          ariaExpanded: panelState.ariaExpanded,
          dataExpanded: panelState.dataExpanded,
          dataOpen: panelState.dataOpen,
          title: panelState.title,
          gitTitle: panelState.gitTitle,
          gitState: panelState.gitState,
          worktreeTitle: panelState.worktreeTitle,
          cleanupVisible: panelState.cleanupVisible,
          removeButtons: panelState.removeButtons,
          initGitVisible: panelState.initGitVisible,
        },
        {
          panelVisible: true,
          panelRole: "menu",
          ariaExpanded: "true",
          dataExpanded: true,
          dataOpen: null,
          title: "Project runtime",
          gitTitle: "Git status",
          gitState: "Working tree clean",
          worktreeTitle: "Project worktrees",
          cleanupVisible: true,
          removeButtons: 2,
          initGitVisible: false,
        },
      )
      assert.ok(
        panelState.gitRows.some((row) => row?.includes("Branch") && row.includes("dev")),
        panelState.gitRows,
      )
      assert.ok(
        panelState.gitRows.every((row) => !row?.includes("Git is not initialized")),
        panelState.gitRows,
      )

      const worktreeRows = await page.evaluate(() => {
        return [...document.querySelectorAll<HTMLElement>(".project-worktree-row")].map((row) => {
          const item = row.querySelector<HTMLElement>(".project-worktree-item")
          const path = row.querySelector<HTMLElement>(".project-worktree-path")
          const branch = row.querySelector<HTMLElement>(".project-worktree-branch")
          const state = row.querySelector<HTMLElement>(".project-worktree-state")
          const rowRect = row.getBoundingClientRect()
          const itemRect = item?.getBoundingClientRect()
          const pathRect = path?.getBoundingClientRect()
          return {
            rowHeight: Math.round(rowRect.height),
            itemHeight: Math.round(itemRect?.height ?? 0),
            pathHeight: Math.round(pathRect?.height ?? 0),
            itemTag: item?.tagName ?? "",
            itemRole: item?.getAttribute("role") ?? "",
            pathWhiteSpace: path ? getComputedStyle(path).whiteSpace : "",
            branchWhiteSpace: branch ? getComputedStyle(branch).whiteSpace : "",
            stateWhiteSpace: state ? getComputedStyle(state).whiteSpace : "",
            gridTemplateAreas: item ? getComputedStyle(item).gridTemplateAreas : "",
          }
        })
      })
      assert.ok(worktreeRows.length >= 2, JSON.stringify(worktreeRows))
      for (const row of worktreeRows) {
        assert.ok(row.rowHeight <= 34, JSON.stringify(row))
        assert.ok(row.itemHeight <= 34, JSON.stringify(row))
        assert.ok(row.pathHeight <= 20, JSON.stringify(row))
        assert.equal(row.itemTag, "BUTTON")
        assert.equal(row.itemRole, "menuitem")
        assert.equal(row.gridTemplateAreas, '"name path state branch"')
        assert.equal(row.pathWhiteSpace, "nowrap")
        assert.equal(row.branchWhiteSpace, "nowrap")
        assert.equal(row.stateWhiteSpace, "nowrap")
      }

      await page.hover('[data-ui="project-runtime-status-dropdown"]')
      const hoverState = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => {
        const style = getComputedStyle(node as HTMLElement)
        return {
          background: style.backgroundColor,
          color: style.color,
          expanded: (node as HTMLElement).hasAttribute("data-expanded"),
        }
      })
      assert.notEqual(hoverState.color, "rgba(0, 0, 0, 0)")
      assert.equal(hoverState.expanded, true)

      const panelScreenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-runtime-status-panel-merged.png",
      )
      assert.ok(panelScreenshot.endsWith("task-dirbar-runtime-status-panel-merged.png"))
      const pageScreenshot = await saveScreenshot(page, "task-dirbar-runtime-status-expanded-state.png")
      assert.ok(pageScreenshot.endsWith("task-dirbar-runtime-status-expanded-state.png"))

      await page.keyboard.press("Escape")
      await page.waitForFunction(() => document.querySelector(".project-runtime-status-panel") === null)
      await page.focus('[data-ui="project-runtime-status-dropdown"]')
      await page.keyboard.press("Enter")
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => document.querySelector(".project-runtime-status-panel") === null)
      const closedState = await page.$eval('[data-ui="project-runtime-status-dropdown"]', (node) => ({
        ariaExpanded: node.getAttribute("aria-expanded") ?? "",
        dataExpanded: (node as HTMLElement).hasAttribute("data-expanded"),
      }))
      assert.deepEqual(closedState, {
        ariaExpanded: "false",
        dataExpanded: false,
      })

      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "task delete failures surface a visible notification and keep the row",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_tasklist_delete_fail"
    const item = taskListItem(taskID)
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [item] },
        taskConversation: { taskID, body: taskConversationPayload(item) },
        deleteTask: ({ taskID: deletedTaskID }) => ({
          body: { error: `delete unavailable for ${deletedTaskID}` },
          status: 500,
        }),
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === `/task/${taskID}`
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      const rowSelector = `#taskListPanel .global-task-row[data-task-row-id="${taskID}"]`
      await page.waitForSelector(rowSelector, { visible: true })
      await page.hover(rowSelector)
      const deleteSelector = `${rowSelector} [data-ui="task-row-delete"]`
      await page.waitForSelector(deleteSelector, { visible: true })
      await page.click(deleteSelector)
      await page.click(deleteSelector)
      await page.waitForFunction(visibleNotificationPredicate("runtime:task.delete-from-list"))

      const state = await page.evaluate((id) => {
        const row = document.querySelector<HTMLElement>(`#taskListPanel .global-task-row[data-task-row-id="${id}"]`)
        const notification = document.querySelector<HTMLElement>(
          '.app-notification[data-notification-id="runtime:task.delete-from-list"]',
        )
        return {
          rowVisible: !!row,
          rowTitle: row?.textContent ?? "",
          noticeText: notification?.textContent ?? "",
        }
      }, taskID)
      assert.equal(state.rowVisible, true)
      assert.match(state.rowTitle, /Reload target task/)
      assert.match(state.noticeText, /API 500|delete unavailable/)
      const screenshot = await saveScreenshot(page, "task-list-delete-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-delete-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "task rename failures surface a visible notification and keep the original title",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_tasklist_rename_fail"
    const item = taskListItem(taskID)
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [item] },
        taskConversation: { taskID, body: taskConversationPayload(item) },
        renameTask: ({ taskID: renamedTaskID }) => ({
          body: { error: `rename unavailable for ${renamedTaskID}` },
          status: 500,
        }),
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === `/task/${taskID}/title`
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      const rowSelector = `#taskListPanel .global-task-row[data-task-row-id="${taskID}"]`
      await page.waitForSelector(rowSelector, { visible: true })
      await page.hover(rowSelector)
      await page.waitForSelector(`${rowSelector} [data-ui="task-row-rename"]`, { visible: true })
      await page.click(`${rowSelector} [data-ui="task-row-rename"]`)
      await page.waitForSelector(`${rowSelector} [data-ui="task-row-rename-input"]`, { visible: true })
      await page.$eval(`${rowSelector} [data-ui="task-row-rename-input"]`, (node) => {
        const input = node as HTMLInputElement
        input.value = "Renamed despite backend failure"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: input.value }))
      })
      await page.keyboard.press("Enter")
      await page.waitForFunction(visibleNotificationPredicate(`task:rename:${taskID}`))

      const state = await page.evaluate((id) => {
        const row = document.querySelector<HTMLElement>(`#taskListPanel .global-task-row[data-task-row-id="${id}"]`)
        const notification = document.querySelector<HTMLElement>(
          `.app-notification[data-notification-id="task:rename:${id}"]`,
        )
        return {
          rowVisible: !!row,
          rowTitle: row?.textContent ?? "",
          noticeText: notification?.textContent ?? "",
        }
      }, taskID)
      assert.equal(state.rowVisible, true)
      assert.match(state.rowTitle, /Reload target task/)
      assert.doesNotMatch(state.rowTitle, /Renamed despite backend failure/)
      assert.match(state.noticeText, /API 500|rename unavailable/)
      const screenshot = await saveScreenshot(page, "task-list-rename-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-rename-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "queued task reorder is disabled while the global queue source is paginated",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const queuedItems = Array.from({ length: 11 }, (_, index) =>
      taskListItem(`tsk_partial_reorder_${String(index).padStart(2, "0")}`, {
        title: `Partial reorder queued task ${index}`,
        status: "queued",
        queue: { order: index, revision: "rev-partial-reorder" },
        time: { created: 1_779_100_000_500 - index, updated: 1_779_100_001_000 + index },
      }),
    )
    const reorderRequests: Array<{ directory: string; orderedTaskIDs: string[]; revision?: string }> = []
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: queuedItems },
        taskConversation: { taskID: queuedItems[0]!.task.id, body: taskConversationPayload(queuedItems[0]!) },
        reorderTaskQueue: (input) => {
          reorderRequests.push(input)
          return { body: { directory: input.directory, revision: "rev-next", queuedTaskIDs: input.orderedTaskIDs } }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      await page.waitForSelector('[data-ui="task-list-load-more"]', { visible: true })
      const firstTaskID = queuedItems[0]!.task.id
      const secondTaskID = queuedItems[1]!.task.id
      const firstRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${firstTaskID}"]`
      const secondRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${secondTaskID}"]`
      await page.waitForSelector(firstRowSelector, { visible: true })
      await page.waitForSelector(secondRowSelector, { visible: true })
      const draggableRows = await page.$$eval("#taskListPanel .global-task-row[data-draggable='true']", (nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.taskRowId),
      )
      assert.deepEqual(draggableRows, [])
      await page.evaluate(
        (input: { sourceID: string; targetID: string }) => {
          const source = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.sourceID}"]`,
          )
          const target = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.targetID}"]`,
          )
          if (!source || !target) throw new Error("queued rows missing")
          const data = new DataTransfer()
          source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
          source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: data }))
        },
        { sourceID: secondTaskID, targetID: firstTaskID },
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.deepEqual(reorderRequests, [])
      const screenshot = await saveScreenshot(page, "task-list-reorder-disabled-paginated-source.png")
      assert.ok(screenshot.endsWith("task-list-reorder-disabled-paginated-source.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "queued task reorder failures surface a visible notification and keep queue rows",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const firstTaskID = "tsk_tasklist_reorder_first"
    const secondTaskID = "tsk_tasklist_reorder_second"
    const firstItem = taskListItem(firstTaskID, {
      title: "First queued task",
      status: "queued",
      priority: "normal",
      queue: { order: 0, revision: "rev-reorder" },
      time: { created: 1_779_100_000_200, updated: 1_779_100_000_200 },
    })
    const secondItem = taskListItem(secondTaskID, {
      title: "Second queued task",
      status: "queued",
      priority: "normal",
      queue: { order: 1, revision: "rev-reorder" },
      time: { created: 1_779_100_000_100, updated: 1_779_100_000_100 },
    })
    const reorderRequests: Array<{ directory: string; orderedTaskIDs: string[]; revision?: string }> = []
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [firstItem, secondItem] },
        taskConversation: { taskID: firstTaskID, body: taskConversationPayload(firstItem) },
        reorderTaskQueue: (input) => {
          reorderRequests.push(input)
          return { body: { error: "queue reorder unavailable" }, status: 500 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/task-queue/reorder"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      const firstRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${firstTaskID}"][data-draggable="true"]`
      const secondRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${secondTaskID}"][data-draggable="true"]`
      await page.waitForSelector(firstRowSelector, { visible: true })
      await page.waitForSelector(secondRowSelector, { visible: true })
      await page.evaluate(
        (input: { sourceID: string; targetID: string }) => {
          const source = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.sourceID}"]`,
          )
          const target = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.targetID}"]`,
          )
          if (!source || !target) throw new Error("queued rows missing")
          const data = new DataTransfer()
          source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
          source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: data }))
        },
        { sourceID: secondTaskID, targetID: firstTaskID },
      )
      await page.waitForFunction(visibleNotificationPredicate(`task:queue-reorder:${PROJECT_DIRECTORY}`))

      assert.deepEqual(reorderRequests, [
        { directory: PROJECT_DIRECTORY, orderedTaskIDs: [secondTaskID, firstTaskID], revision: "rev-reorder" },
      ])
      const state = await page.evaluate(
        (input: { firstTaskID: string; secondTaskID: string; notificationID: string }) => {
          const first = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.firstTaskID}"]`,
          )
          const second = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.secondTaskID}"]`,
          )
          const notification = document.querySelector<HTMLElement>(
            `.app-notification[data-notification-id="${input.notificationID}"]`,
          )
          return {
            firstText: first?.textContent ?? "",
            secondText: second?.textContent ?? "",
            noticeText: notification?.textContent ?? "",
          }
        },
        {
          firstTaskID,
          secondTaskID,
          notificationID: `task:queue-reorder:${PROJECT_DIRECTORY}`,
        },
      )
      assert.match(state.firstText, /First queued task/)
      assert.match(state.secondText, /Second queued task/)
      assert.match(state.noticeText, /Queue reorder failed|API 500|queue reorder unavailable/)
      const screenshot = await saveScreenshot(page, "task-list-reorder-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-reorder-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "queued task start-now reload failures use reload-failed copy and keep the row visible",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_tasklist_start_now_reload_fail"
    const item = taskListItem(taskID, {
      title: "Queued task to start",
      status: "queued",
      priority: "normal",
      queue: { order: 0, revision: "rev-start-now" },
    })
    let failTaskReload = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [item] },
        tasksStatus: () => (failTaskReload ? 500 : 200),
        tasksError: { message: "task list reload unavailable after start-now" },
        taskConversation: { taskID, body: taskConversationPayload(item) },
        startQueuedTaskNow: ({ directory }) => ({
          body: {
            task: { id: taskID, title: "Queued task to start" },
            directory,
            status: "active",
            started: true,
            queuedTaskIDs: [],
          },
          status: 200,
        }),
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/global/tasks"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      const rowSelector = `#taskListPanel .global-task-row[data-task-row-id="${taskID}"]`
      await page.waitForSelector(rowSelector, { visible: true })
      await page.hover(rowSelector)
      await page.waitForSelector(`${rowSelector} [data-ui="task-row-start-now"]`, { visible: true })
      failTaskReload = true
      await page.click(`${rowSelector} [data-ui="task-row-start-now"]`)
      await page.waitForFunction(visibleNotificationPredicate(`task:start-now:${taskID}`))

      const state = await page.evaluate((id) => {
        const row = document.querySelector<HTMLElement>(`#taskListPanel .global-task-row[data-task-row-id="${id}"]`)
        const notification = document.querySelector<HTMLElement>(
          `.app-notification[data-notification-id="task:start-now:${id}"]`,
        )
        return {
          rowVisible: !!row,
          rowTitle: row?.textContent ?? "",
          noticeText: notification?.textContent ?? "",
        }
      }, taskID)
      assert.equal(state.rowVisible, true)
      assert.match(state.rowTitle, /Queued task to start/)
      assert.match(state.noticeText, /Task list reload failed/)
      assert.match(state.noticeText, /Task started, but the task list could not be reloaded/)
      assert.doesNotMatch(state.noticeText, /Start now failed/)
      assert.doesNotMatch(state.noticeText, /\{"tasks"/)
      const screenshot = await saveScreenshot(page, "task-list-start-now-reload-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-start-now-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "project delete reload failures use reload-failed copy instead of mutation-failed copy",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const deleteProjectDirectory = "D:/overlay/workspace/archived-app"
    const currentTaskID = "tsk_project_delete_reload_current"
    const currentItem = taskListItem(currentTaskID, {
      title: "Current project task",
      directory: PROJECT_DIRECTORY,
    })
    const taskID = "tsk_project_delete_reload_fail"
    const item = taskListItem(taskID, { title: "Project delete reload target", directory: deleteProjectDirectory })
    let failTaskReload = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [currentItem, item] },
        tasksStatus: () => (failTaskReload ? 500 : 200),
        tasksError: { message: "task list reload unavailable after project delete" },
        taskConversation: { taskID: currentTaskID, body: taskConversationPayload(currentItem) },
        deleteProject: ({ directory }) => ({
          body: { ok: true, projectID: "prj_reload_delete", directory, deletedTaskCount: 1 },
          status: 200,
        }),
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/global/tasks"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string; currentTaskID: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_workspace_task", input.currentTaskID)
          localStorage.setItem("oc_workspace_directory", input.directory)
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin, currentTaskID },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      await page.waitForSelector(`#taskListPanel .global-task-row[data-task-row-id="${taskID}"]`, { visible: true })
      const deleteSelector = `#taskListPanel [data-ui="project-group-delete"][data-project-delete="${deleteProjectDirectory}"]`
      const projectGroupSelector = `#taskListPanel .project-group:has([data-project-delete="${deleteProjectDirectory}"])`
      await page.hover(projectGroupSelector)
      await page.waitForSelector(deleteSelector, { visible: true })
      failTaskReload = true
      await page.click(deleteSelector)
      await page.click(deleteSelector)
      await page.waitForFunction(visibleNotificationPredicate(`project:delete:${deleteProjectDirectory}`))

      const state = await page.evaluate(
        (input: { taskID: string; notificationID: string }) => {
          const row = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.taskID}"]`,
          )
          const notification = document.querySelector<HTMLElement>(
            `.app-notification[data-notification-id="${input.notificationID}"]`,
          )
          return {
            rowVisible: !!row,
            groupText: document.querySelector<HTMLElement>("#taskListPanel .project-group")?.textContent ?? "",
            noticeText: notification?.textContent ?? "",
          }
        },
        { taskID, notificationID: `project:delete:${deleteProjectDirectory}` },
      )
      assert.equal(typeof state.rowVisible, "boolean")
      assert.match(state.noticeText, /Project deleted, reload failed/)
      assert.match(state.noticeText, /but the task list could not be reloaded/)
      assert.doesNotMatch(state.noticeText, /Project delete failed/)
      assert.doesNotMatch(state.noticeText, /Deleted D:\/overlay\/workspace\/archived-app$/)
      assert.doesNotMatch(state.noticeText, /\{"tasks"/)
      const screenshot = await saveScreenshot(page, "task-list-project-delete-reload-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-project-delete-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "project rename reload failures use reload-failed copy and keep the stale project group visible",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_project_rename_reload_fail"
    const item = taskListItem(taskID, { title: "Project rename reload target" })
    let failTaskReload = false
    const nextName = "Renamed reload target"
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [item] },
        tasksStatus: () => (failTaskReload ? 500 : 200),
        tasksError: { message: "task list reload unavailable after project rename" },
        taskConversation: { taskID, body: taskConversationPayload(item) },
        renameProject: ({ directory, name }) => ({
          body: { id: "prj_reload_rename", worktree: directory, name },
          status: 200,
        }),
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/global/tasks"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      await page.waitForSelector(`#taskListPanel .global-task-row[data-task-row-id="${taskID}"]`, { visible: true })
      await page.hover("#taskListPanel .project-group")
      await page.waitForSelector('#taskListPanel [data-ui="project-group-rename"]', { visible: true })
      await page.click('#taskListPanel [data-ui="project-group-rename"]')
      await page.waitForSelector("#appDialogInput", { visible: true })
      await page.$eval(
        "#appDialogInput",
        (node, value) => {
          const input = node as HTMLInputElement
          input.value = String(value)
          input.dispatchEvent(new InputEvent("input", { bubbles: true, data: input.value }))
        },
        nextName,
      )
      failTaskReload = true
      await page.click("#btnAppDialogOk")
      await page.waitForFunction(visibleNotificationPredicate(`project:rename:${PROJECT_DIRECTORY}`))

      const state = await page.evaluate(
        (input: { taskID: string; notificationID: string }) => {
          const row = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.taskID}"]`,
          )
          const notification = document.querySelector<HTMLElement>(
            `.app-notification[data-notification-id="${input.notificationID}"]`,
          )
          return {
            rowVisible: !!row,
            groupText: document.querySelector<HTMLElement>("#taskListPanel .project-group")?.textContent ?? "",
            noticeText: notification?.textContent ?? "",
          }
        },
        { taskID, notificationID: `project:rename:${PROJECT_DIRECTORY}` },
      )
      assert.equal(state.rowVisible, true)
      assert.match(state.groupText, /Project rename reload target/)
      assert.match(state.noticeText, /Project renamed, reload failed/)
      assert.match(state.noticeText, /Renamed to Renamed reload target, but the task list could not be reloaded/)
      assert.doesNotMatch(state.noticeText, /Project rename failed/)
      assert.doesNotMatch(state.noticeText, /\{"tasks"/)
      const screenshot = await saveScreenshot(page, "task-list-project-rename-reload-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-project-rename-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "queued task reorder reload failures use reload-failed copy and keep queue rows",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const firstTaskID = "tsk_tasklist_reorder_reload_first"
    const secondTaskID = "tsk_tasklist_reorder_reload_second"
    const firstItem = taskListItem(firstTaskID, {
      title: "First reload queued task",
      status: "queued",
      priority: "normal",
      queue: { order: 0, revision: "rev-reorder-reload" },
      time: { created: 1_779_100_000_200, updated: 1_779_100_000_200 },
    })
    const secondItem = taskListItem(secondTaskID, {
      title: "Second reload queued task",
      status: "queued",
      priority: "normal",
      queue: { order: 1, revision: "rev-reorder-reload" },
      time: { created: 1_779_100_000_100, updated: 1_779_100_000_100 },
    })
    let failTaskReload = false
    const reorderRequests: Array<{ directory: string; orderedTaskIDs: string[]; revision?: string }> = []
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: { body: { root: "D:/overlay/workspace", defaultDirectory: PROJECT_DIRECTORY, projects: [] } },
        tasks: { tasks: [firstItem, secondItem] },
        tasksStatus: () => (failTaskReload ? 500 : 200),
        tasksError: { message: "task list reload unavailable after queue reorder" },
        taskConversation: { taskID: firstTaskID, body: taskConversationPayload(firstItem) },
        reorderTaskQueue: (input) => {
          reorderRequests.push(input)
          return {
            body: {
              directory: input.directory,
              revision: "rev-reorder-reload-next",
              queuedTaskIDs: input.orderedTaskIDs,
            },
            status: 200,
          }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/global/tasks"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await openTasksActivity(page)
      const firstRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${firstTaskID}"][data-draggable="true"]`
      const secondRowSelector = `#taskListPanel .global-task-row[data-task-row-id="${secondTaskID}"][data-draggable="true"]`
      await page.waitForSelector(firstRowSelector, { visible: true })
      await page.waitForSelector(secondRowSelector, { visible: true })
      failTaskReload = true
      await page.evaluate(
        (input: { sourceID: string; targetID: string }) => {
          const source = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.sourceID}"]`,
          )
          const target = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.targetID}"]`,
          )
          if (!source || !target) throw new Error("queued rows missing")
          const data = new DataTransfer()
          source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }))
          target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
          source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: data }))
        },
        { sourceID: secondTaskID, targetID: firstTaskID },
      )
      await page.waitForFunction(visibleNotificationPredicate(`task:queue-reorder:${PROJECT_DIRECTORY}`))

      assert.deepEqual(reorderRequests, [
        { directory: PROJECT_DIRECTORY, orderedTaskIDs: [secondTaskID, firstTaskID], revision: "rev-reorder-reload" },
      ])
      const state = await page.evaluate(
        (input: { firstTaskID: string; secondTaskID: string; notificationID: string }) => {
          const first = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.firstTaskID}"]`,
          )
          const second = document.querySelector<HTMLElement>(
            `#taskListPanel .global-task-row[data-task-row-id="${input.secondTaskID}"]`,
          )
          const notification = document.querySelector<HTMLElement>(
            `.app-notification[data-notification-id="${input.notificationID}"]`,
          )
          return {
            firstText: first?.textContent ?? "",
            secondText: second?.textContent ?? "",
            noticeText: notification?.textContent ?? "",
          }
        },
        {
          firstTaskID,
          secondTaskID,
          notificationID: `task:queue-reorder:${PROJECT_DIRECTORY}`,
        },
      )
      assert.match(state.firstText, /First reload queued task/)
      assert.match(state.secondText, /Second reload queued task/)
      assert.match(state.noticeText, /Queue reload failed/)
      assert.match(state.noticeText, /Queue reorder completed, but the task list could not be reloaded/)
      assert.doesNotMatch(state.noticeText, /Queue reorder failed/)
      assert.doesNotMatch(state.noticeText, /\{"tasks"/)
      const screenshot = await saveScreenshot(page, "task-list-reorder-reload-failure-visible.png")
      assert.ok(screenshot.endsWith("task-list-reorder-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "cwd switch failures keep the current directory and show a visible dialog",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let healthStatus = 200
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        healthStatus: () => healthStatus,
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem(
            "oc_recent_directories",
            JSON.stringify([input.directory, "D:/overlay/workspace/offline"]),
          )
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(".task-cwd-dropdown", { visible: true })
      healthStatus = 503
      await page.click('[data-ui="cwd-recent-trigger"]')
      await page.waitForSelector(".recent-dir-panel", { visible: true })
      await page.$eval(
        '[data-ui="cwd-path-input"]',
        (node, value) => {
          const input = node as HTMLInputElement
          input.value = value as string
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
        },
        "D:/overlay/workspace/offline",
      )
      await page.click('[data-ui="recent-dir-edit-submit"]')
      await page.waitForSelector("#appDialogBody", { visible: true })

      const dialogState = await page.evaluate(() => ({
        title: document.querySelector("#appDialogTitle")?.textContent?.trim() ?? "",
        body: document.querySelector("#appDialogBody")?.textContent?.trim() ?? "",
        currentTitle: document.querySelector<HTMLElement>(".task-cwd-dropdown")?.getAttribute("title") ?? "",
      }))

      assert.equal(dialogState.title, "Failed to set directory")
      assert.match(dialogState.body, /Directory was not changed/)
      assert.equal(dialogState.currentTitle, PROJECT_DIRECTORY)
      const screenshot = await saveElementScreenshot(page, "#appDialog", "task-dirbar-cwd-switch-failure-dialog.png")
      assert.ok(screenshot.endsWith("task-dirbar-cwd-switch-failure-dialog.png"))
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree dropdown ignores stale successful loads after directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const firstWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/stale-a/worktree"
    const secondWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const worktreeRequests: string[] = []
    let releaseFirstLoad: (() => void) | undefined
    const firstLoadReleased = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const waitForWorktreeRequest = async (directory: string) => {
      const start = Date.now()
      while (!worktreeRequests.includes(directory)) {
        if (Date.now() - start > 5_000) {
          throw new Error(`worktree request for ${directory} was not observed; got ${worktreeRequests.join(", ")}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees: async ({ directory }) => {
          worktreeRequests.push(directory)
          if (directory === PROJECT_DIRECTORY) {
            await firstLoadReleased
            return [
              {
                name: "stale-a",
                branch: "codex/stale-a",
                directory: firstWorktree,
                goalID: "gol_stale_a",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: secondWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForWorktreeRequest(PROJECT_DIRECTORY)
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await waitForWorktreeRequest(nextDirectory)
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${secondWorktree}"]`, { visible: true })
      releaseFirstLoad?.()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-stale-response-ignored.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-stale-response-ignored.png"))

      const panelState = await page.$eval(
        ".project-runtime-status-panel",
        (node, input: { firstWorktree: string; secondWorktree: string }) => ({
          staleVisible: !!node.querySelector(`.project-worktree-path[title="${input.firstWorktree}"]`),
          currentVisible: !!node.querySelector(`.project-worktree-path[title="${input.secondWorktree}"]`),
          text: node.textContent ?? "",
        }),
        { firstWorktree, secondWorktree },
      )
      assert.equal(panelState.currentVisible, true)
      assert.equal(panelState.staleVisible, false, panelState.text)
      errors.assertNoUnexpectedErrors()
    } finally {
      releaseFirstLoad?.()
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree dropdown ignores stale failed loads after directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleError = "stale project worktree load failed"
    const secondWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const worktreeRequests: string[] = []
    let releaseFirstLoad: (() => void) | undefined
    const firstLoadReleased = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    const waitForWorktreeRequest = async (directory: string) => {
      const start = Date.now()
      while (!worktreeRequests.includes(directory)) {
        if (Date.now() - start > 5_000) {
          throw new Error(`worktree request for ${directory} was not observed; got ${worktreeRequests.join(", ")}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees: async ({ directory }) => {
          worktreeRequests.push(directory)
          if (directory === PROJECT_DIRECTORY) {
            await firstLoadReleased
            return { body: { error: staleError }, status: 500 }
          }
          if (directory === nextDirectory) {
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: secondWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/project/current/worktrees"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForWorktreeRequest(PROJECT_DIRECTORY)
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await waitForWorktreeRequest(nextDirectory)
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${secondWorktree}"]`, { visible: true })
      releaseFirstLoad?.()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-stale-failure-ignored.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-stale-failure-ignored.png"))

      const panelState = await page.$eval(
        ".project-runtime-status-panel",
        (node, input: { secondWorktree: string; staleError: string }) => ({
          currentVisible: !!node.querySelector(`.project-worktree-path[title="${input.secondWorktree}"]`),
          staleErrorVisible: (node.textContent ?? "").includes(input.staleError),
          text: node.textContent ?? "",
        }),
        { secondWorktree, staleError },
      )
      assert.equal(panelState.currentVisible, true)
      assert.equal(panelState.staleErrorVisible, false, panelState.text)
      errors.assertNoUnexpectedErrors()
    } finally {
      releaseFirstLoad?.()
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree delete confirmation does not execute after project directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/delete-stale/worktree"
    const currentWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const deleteCalls: string[] = []
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees({ directory }) {
          if (directory === PROJECT_DIRECTORY) {
            return [
              {
                name: "delete-stale",
                branch: "codex/delete-stale",
                directory: staleWorktree,
                goalID: "gol_delete_stale",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: currentWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
        deleteWorktree({ directory }) {
          deleteCalls.push(directory)
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${staleWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-remove"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await page.waitForSelector(`.project-worktree-path[title="${currentWorktree}"]`, { visible: true })
      await page.click("#btnAppDialogOk")
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.deepEqual(deleteCalls, [])

      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-delete-confirmation-directory-switch.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-delete-confirmation-directory-switch.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "expired worktree cleanup confirmation does not execute after project directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/cleanup-stale/worktree"
    const currentWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const deleteCalls: string[] = []
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees({ directory }) {
          if (directory === PROJECT_DIRECTORY) {
            return [
              {
                name: "cleanup-stale",
                branch: "codex/cleanup-stale",
                directory: staleWorktree,
                goalID: "gol_cleanup_stale",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: currentWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
        deleteWorktree({ directory }) {
          deleteCalls.push(directory)
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${staleWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-cleanup-expired"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await page.waitForSelector(`.project-worktree-path[title="${currentWorktree}"]`, { visible: true })
      await page.click("#btnAppDialogOk")
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.deepEqual(deleteCalls, [])

      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-cleanup-confirmation-directory-switch.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-cleanup-confirmation-directory-switch.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree delete completion does not mutate panel after project directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/delete-inflight/worktree"
    const currentWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const deleteRelease = deferred()
    const deleteCalls: string[] = []
    let deleteObserved = false
    let failNextProjectBReload = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees({ directory }) {
          if (directory === PROJECT_DIRECTORY) {
            return [
              {
                name: "delete-inflight",
                branch: "codex/delete-inflight",
                directory: staleWorktree,
                goalID: "gol_delete_inflight",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            if (failNextProjectBReload) return { body: { error: "project B reload should not run" }, status: 500 }
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: currentWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
        async deleteWorktree({ directory }) {
          deleteCalls.push(directory)
          deleteObserved = true
          await deleteRelease.promise
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/project/current/worktrees"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${staleWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-remove"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      for (let i = 0; i < 100 && !deleteObserved; i += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(deleteObserved, true)
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await page.waitForSelector(`.project-worktree-path[title="${currentWorktree}"]`, { visible: true })
      failNextProjectBReload = true
      deleteRelease.resolve()
      await new Promise((resolve) => setTimeout(resolve, 400))

      assert.deepEqual(deleteCalls, [staleWorktree])
      const panelState = await page.$eval(
        ".project-runtime-status-panel",
        (node, input: { currentWorktree: string }) => ({
          currentVisible: !!node.querySelector(`.project-worktree-path[title="${input.currentWorktree}"]`),
          wrongError: (node.textContent ?? "").includes("project B reload should not run"),
          text: node.textContent ?? "",
        }),
        { currentWorktree },
      )
      assert.equal(panelState.currentVisible, true, panelState.text)
      assert.equal(panelState.wrongError, false, panelState.text)
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-delete-inflight-directory-switch.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-delete-inflight-directory-switch.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      deleteRelease.resolve()
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "expired worktree cleanup completion does not mutate panel after project directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/cleanup-inflight/worktree"
    const currentWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const cleanupRelease = deferred()
    const deleteCalls: string[] = []
    let cleanupObserved = false
    let failNextProjectBReload = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees({ directory }) {
          if (directory === PROJECT_DIRECTORY) {
            return [
              {
                name: "cleanup-inflight",
                branch: "codex/cleanup-inflight",
                directory: staleWorktree,
                goalID: "gol_cleanup_inflight",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            if (failNextProjectBReload) return { body: { error: "project B reload should not run" }, status: 500 }
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: currentWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
        async deleteWorktree({ directory }) {
          deleteCalls.push(directory)
          cleanupObserved = true
          await cleanupRelease.promise
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/project/current/worktrees"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${staleWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-cleanup-expired"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      for (let i = 0; i < 100 && !cleanupObserved; i += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(cleanupObserved, true)
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await page.waitForSelector(`.project-worktree-path[title="${currentWorktree}"]`, { visible: true })
      failNextProjectBReload = true
      cleanupRelease.resolve()
      await new Promise((resolve) => setTimeout(resolve, 400))

      assert.deepEqual(deleteCalls, [staleWorktree])
      const panelState = await page.$eval(
        ".project-runtime-status-panel",
        (node, input: { currentWorktree: string }) => ({
          currentVisible: !!node.querySelector(`.project-worktree-path[title="${input.currentWorktree}"]`),
          wrongError: (node.textContent ?? "").includes("project B reload should not run"),
          text: node.textContent ?? "",
        }),
        { currentWorktree },
      )
      assert.equal(panelState.currentVisible, true, panelState.text)
      assert.equal(panelState.wrongError, false, panelState.text)
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-cleanup-inflight-directory-switch.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-cleanup-inflight-directory-switch.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      cleanupRelease.resolve()
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "expired worktree cleanup busy state does not disable controls after project directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const nextDirectory = "D:/overlay/workspace/next-app"
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/cleanup-busy/worktree"
    const currentWorktree = "D:/overlay/workspace/next-app/.opencorvus/r/w/current-b/worktree"
    const cleanupRelease = deferred()
    let cleanupObserved = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees({ directory }) {
          if (directory === PROJECT_DIRECTORY) {
            return [
              {
                name: "cleanup-busy",
                branch: "codex/cleanup-busy",
                directory: staleWorktree,
                goalID: "gol_cleanup_busy",
                status: "expired",
                removable: true,
              },
            ]
          }
          if (directory === nextDirectory) {
            return [
              {
                name: "current-b",
                branch: "codex/current-b",
                directory: currentWorktree,
                goalID: "gol_current_b",
                status: "expired",
                removable: true,
              },
            ]
          }
          return []
        },
        async deleteWorktree() {
          cleanupObserved = true
          await cleanupRelease.promise
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") {
                  if (args.settings && typeof args.settings === "object") {
                    const next = args.settings as { directory?: string }
                    if (typeof next.directory === "string") localStorage.setItem("oc_directory", next.directory)
                  }
                  return true
                }
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(`.project-worktree-path[title="${staleWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-cleanup-expired"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      for (let i = 0; i < 100 && !cleanupObserved; i += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(cleanupObserved, true)
      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false })
      }, nextDirectory)
      await page.waitForSelector(`.project-worktree-path[title="${currentWorktree}"]`, { visible: true })

      const panelState = await page.$eval(".project-runtime-status-panel", (node) => {
        const cleanup = node.querySelector<HTMLButtonElement>('[data-ui="project-worktree-cleanup-expired"]')
        const remove = node.querySelector<HTMLButtonElement>('[data-ui="project-worktree-remove"]')
        return {
          cleanupBusy: cleanup?.dataset.busy ?? "",
          cleanupDisabled: cleanup?.disabled ?? true,
          removeBusy: remove?.dataset.busy ?? "",
          removeDisabled: remove?.disabled ?? true,
          text: node.textContent ?? "",
        }
      })
      assert.equal(panelState.cleanupBusy, "false", panelState.text)
      assert.equal(panelState.cleanupDisabled, false, panelState.text)
      assert.equal(panelState.removeBusy, "false", panelState.text)
      assert.equal(panelState.removeDisabled, false, panelState.text)
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-cleanup-busy-directory-scoped.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-cleanup-busy-directory-scoped.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      cleanupRelease.resolve()
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree delete failures stay visible in the worktree panel",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/old/worktree"
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees: [
          {
            name: "old",
            branch: "codex/old",
            directory: staleWorktree,
            goalID: "gol_old",
            status: "expired",
            removable: true,
          },
        ],
        deleteWorktree: { body: { ok: false, error: "remove failed" }, status: 500 },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector('[data-ui="project-worktree-remove"]', { visible: true })
      await page.click('[data-ui="project-worktree-remove"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForSelector('[data-ui="project-worktree-operation-error"]', { visible: true })

      const errorState = await page.$eval('[data-ui="project-worktree-operation-error"]', (node) => ({
        text: node.textContent?.trim() ?? "",
        color: getComputedStyle(node as HTMLElement).color,
      }))
      assert.match(errorState.text, /Delete failed/)
      assert.match(errorState.text, /remove failed/)
      assert.notEqual(errorState.color, "rgba(0, 0, 0, 0)")
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-delete-failure-visible.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-delete-failure-visible.png"))
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "expired worktree cleanup refreshes partial successes after a later delete fails",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const firstWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/old-a/worktree"
    const secondWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/old-b/worktree"
    const deleted = new Set<string>()
    const worktrees = () =>
      [
        {
          name: "old-a",
          branch: "codex/old-a",
          directory: firstWorktree,
          goalID: "gol_old_a",
          status: "expired",
          removable: true,
        },
        {
          name: "old-b",
          branch: "codex/old-b",
          directory: secondWorktree,
          goalID: "gol_old_b",
          status: "expired",
          removable: true,
        },
      ].filter((item) => !deleted.has(item.directory))

    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktrees,
        deleteWorktree({ directory }) {
          if (directory === firstWorktree) {
            deleted.add(directory)
            return { body: { ok: true }, status: 200 }
          }
          if (directory === secondWorktree) return { body: { ok: false, error: "second remove failed" }, status: 500 }
          return { body: { ok: false, error: "unexpected worktree" }, status: 500 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.path === "/project/current/worktrees" && response.status === 500
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector('[data-ui="project-worktree-cleanup-expired"]', { visible: true })
      await page.click('[data-ui="project-worktree-cleanup-expired"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForSelector('[data-ui="project-worktree-operation-error"]', { visible: true })
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '.project-worktree-path[title="D:/overlay/workspace/app/.opencorvus/r/w/old-a/worktree"]',
          ),
      )

      const panelState = await page.$eval(".project-runtime-status-panel", (node) => ({
        text: node.textContent ?? "",
        firstPresent: !!node.querySelector(
          '.project-worktree-path[title="D:/overlay/workspace/app/.opencorvus/r/w/old-a/worktree"]',
        ),
        secondPresent: !!node.querySelector(
          '.project-worktree-path[title="D:/overlay/workspace/app/.opencorvus/r/w/old-b/worktree"]',
        ),
        error: node.querySelector('[data-ui="project-worktree-operation-error"]')?.textContent ?? "",
      }))
      assert.equal(deleted.has(firstWorktree), true)
      assert.equal(panelState.firstPresent, false)
      assert.equal(panelState.secondPresent, true)
      assert.match(panelState.error, /Cleanup failed/)
      assert.match(panelState.error, /second remove failed/)

      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-cleanup-partial-failure-visible.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-cleanup-partial-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree delete surfaces selected-task board reload failures",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_board_reload"
    const selectedTask = taskListItem(taskID)
    const staleWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/reload/worktree"
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        tasks: { tasks: [selectedTask] },
        taskConversation: { taskID, body: taskConversationPayload(selectedTask) },
        taskBoard: { taskID, body: { error: "board reload failed after worktree delete" }, status: 500 },
        worktrees: [
          {
            name: "reload",
            branch: "codex/reload",
            directory: staleWorktree,
            goalID: "gol_reload",
            status: "expired",
            removable: true,
          },
        ],
        deleteWorktree: { body: { ok: true }, status: 200 },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.path === `/task/${taskID}/board` && response.status === 500
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string; taskID: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_workspace_task", input.taskID)
          localStorage.setItem("oc_workspace_directory", input.directory)
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                    workspaceTaskID: input.taskID,
                    workspaceTaskId: input.taskID,
                    workspaceDirectory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin, taskID },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector('[data-ui="project-worktree-remove"]', { visible: true })
      await page.click('[data-ui="project-worktree-remove"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForSelector('[data-ui="project-worktree-operation-error"]', { visible: true })

      const errorState = await page.$eval('[data-ui="project-worktree-operation-error"]', (node) => ({
        text: node.textContent?.trim() ?? "",
        color: getComputedStyle(node as HTMLElement).color,
      }))
      assert.match(errorState.text, /Deleted worktree, but the panel or board could not be reloaded/)
      assert.match(errorState.text, /board reload failed after worktree delete/)
      assert.doesNotMatch(errorState.text, /Delete failed/)
      assert.notEqual(errorState.color, "rgba(0, 0, 0, 0)")
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-delete-board-reload-failure-visible.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-delete-board-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree delete keeps remaining worktree rows visible when list reload fails after deletion",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const firstWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/delete-a/worktree"
    const secondWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/delete-b/worktree"
    let failWorktreeReload = false
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        worktreesStatus: () => (failWorktreeReload ? 500 : 200),
        worktreesError: { message: "worktree list reload unavailable after delete" },
        worktrees: [
          {
            name: "delete-a",
            branch: "codex/delete-a",
            directory: firstWorktree,
            goalID: "gol_delete_a",
            status: "expired",
            removable: true,
          },
          {
            name: "delete-b",
            branch: "codex/delete-b",
            directory: secondWorktree,
            goalID: "gol_delete_b",
            status: "expired",
            removable: true,
          },
        ],
        deleteWorktree: () => {
          failWorktreeReload = true
          return { body: { ok: true }, status: 200 }
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === "/project/current/worktrees"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector(`.project-worktree-path[title="${firstWorktree}"]`, { visible: true })
      await page.waitForSelector(`.project-worktree-path[title="${secondWorktree}"]`, { visible: true })
      await page.click('[data-ui="project-worktree-remove"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForSelector('[data-ui="project-worktree-operation-error"]', { visible: true })
      await page.waitForSelector('[data-ui="project-worktree-load-error"]', { visible: true })

      const panelState = await page.$eval(
        ".project-runtime-status-panel",
        (node, input: { firstWorktree: string; secondWorktree: string }) => ({
          firstVisible: !!node.querySelector(`.project-worktree-path[title="${input.firstWorktree}"]`),
          secondVisible: !!node.querySelector(`.project-worktree-path[title="${input.secondWorktree}"]`),
          operationError: node.querySelector('[data-ui="project-worktree-operation-error"]')?.textContent ?? "",
          loadError: node.querySelector('[data-ui="project-worktree-load-error"]')?.textContent ?? "",
        }),
        { firstWorktree, secondWorktree },
      )
      assert.equal(panelState.firstVisible, false)
      assert.equal(panelState.secondVisible, true)
      assert.match(panelState.operationError, /Deleted worktree, but the panel or board could not be reloaded/)
      assert.match(panelState.operationError, /worktree list reload unavailable after delete/)
      assert.match(panelState.loadError, /worktree list reload unavailable after delete/)
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-delete-list-reload-failure-keeps-remaining.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-delete-list-reload-failure-keeps-remaining.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "worktree cleanup surfaces selected-task board reload failures after successful cleanup",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const taskID = "tsk_cleanup_board_reload"
    const selectedTask = taskListItem(taskID)
    const expiredWorktree = "D:/overlay/workspace/app/.opencorvus/r/w/reload-cleanup/worktree"
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: "D:/overlay/workspace",
            defaultDirectory: PROJECT_DIRECTORY,
            projects: [],
          },
        },
        tasks: { tasks: [selectedTask] },
        taskConversation: { taskID, body: taskConversationPayload(selectedTask) },
        taskBoard: { taskID, body: { error: "board reload failed after worktree cleanup" }, status: 500 },
        worktrees: [
          {
            name: "reload-cleanup",
            branch: "codex/reload-cleanup",
            directory: expiredWorktree,
            goalID: "gol_reload_cleanup",
            status: "expired",
            removable: true,
          },
        ],
        deleteWorktree: { body: { ok: true }, status: 200 },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.path === `/task/${taskID}/board` && response.status === 500
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string; taskID: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_workspace_task", input.taskID)
          localStorage.setItem("oc_workspace_directory", input.directory)
          window.__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl: input.serverUrl,
                    autoServer: false,
                    locale: "en-US",
                    directory: input.directory,
                    workspaceTaskID: input.taskID,
                    workspaceTaskId: input.taskID,
                    workspaceDirectory: input.directory,
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_server_info") return { url: input.serverUrl, pid: 12345 }
                if (command === "overlay_pick_dir") return input.directory
                if (command === "overlay_open_path") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => undefined,
                  hide: async () => undefined,
                  minimize: async () => undefined,
                  startDragging: async () => undefined,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin, taskID },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="project-runtime-status-dropdown"]', { visible: true })
      await revealRightToolbar(page)
      await page.click('[data-ui="project-runtime-status-dropdown"]')
      await page.waitForSelector(".project-runtime-status-panel", { visible: true })
      await page.waitForSelector('[data-ui="project-worktree-cleanup-expired"]', { visible: true })
      await page.click('[data-ui="project-worktree-cleanup-expired"]')
      await page.waitForSelector("#appDialogBody", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForSelector('[data-ui="project-worktree-operation-error"]', { visible: true })

      const errorState = await page.$eval('[data-ui="project-worktree-operation-error"]', (node) => ({
        text: node.textContent?.trim() ?? "",
        color: getComputedStyle(node as HTMLElement).color,
      }))
      assert.match(errorState.text, /Cleaned expired worktrees, but the panel or board could not be reloaded/)
      assert.match(errorState.text, /board reload failed after worktree cleanup/)
      assert.doesNotMatch(errorState.text, /Cleanup failed/)
      assert.notEqual(errorState.color, "rgba(0, 0, 0, 0)")
      const screenshot = await saveElementScreenshot(
        page,
        ".project-runtime-status-panel",
        "task-dirbar-worktree-cleanup-board-reload-failure-visible.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-worktree-cleanup-board-reload-failure-visible.png"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "cwd popup surfaces project discovery failures instead of rendering an empty detected-project state",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          status: 503,
          body: { error: "discovery unavailable" },
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installTaskDirbarErrorCollector(page, {
        allowResponse(response) {
          return response.status === 503 && response.path === "/global/projects/discover"
        },
      })
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem(
            "oc_recent_directories",
            JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
          )
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(".task-cwd-dropdown", { visible: true })
      await page.waitForSelector('[data-ui="cwd-recent-trigger"]', { visible: true })
      await page.focus('[data-ui="cwd-recent-trigger"]')
      await page.keyboard.press("Enter")
      await page.waitForSelector('[data-testid="cwd-discovery-error"]', { visible: true })

      const state = await page.evaluate(() => ({
        text: document.querySelector('[data-testid="cwd-discovery-error"]')?.textContent || "",
        role: document.querySelector('[data-testid="cwd-discovery-error"]')?.getAttribute("role") || "",
        detectedRows: document.querySelectorAll(".recent-dir-section .recent-dir-row").length,
        recentRows: document.querySelectorAll('.recent-dir-list[data-kind="recent"] .recent-dir-row').length,
        hasManualPathInput: !!document.querySelector('[data-ui="cwd-path-input"]'),
        panelVisible: !!document.querySelector(".recent-dir-panel"),
      }))

      assert.deepEqual(state, {
        text: "Project discovery failed: API 503 global/projects/discover: discovery unavailable",
        role: "status",
        detectedRows: 0,
        recentRows: 3,
        hasManualPathInput: true,
        panelVisible: true,
      })
      errors.assertNoUnexpectedErrors()
      const errorScreenshot = await saveElementScreenshot(page, ".recent-dir-panel", "task-dirbar-discovery-error.png")
      assert.ok(errorScreenshot.endsWith("task-dirbar-discovery-error.png"))
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "cwd popup detected projects list scrolls inside the recent directory panel",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const projects = Array.from({ length: 12 }, (_, index) => ({
      name: `detected-${String(index + 1).padStart(2, "0")}`,
      directory: `${DETECTED_PROJECT_ROOT}/detected-${String(index + 1).padStart(2, "0")}`,
      marker: ".opencorvus",
    }))
    const server = await startBrowserFixture((req) =>
      taskDirbarFixtureResponse(req, {
        discovery: {
          body: {
            root: DETECTED_PROJECT_ROOT,
            defaultDirectory: "",
            projects,
          },
        },
      }),
    )

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 720 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_saved_directory", input.directory)
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_theme", "dark")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem(
            "oc_recent_directories",
            JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
          )
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(".task-cwd-dropdown", { visible: true })
      await page.click('[data-ui="cwd-recent-trigger"]')
      await page.waitForSelector('.recent-dir-list[data-kind="discovered"]', { visible: true })
      await page.waitForFunction(
        () => document.querySelectorAll('.recent-dir-list[data-kind="discovered"] .recent-dir-row').length === 12,
      )

      const before = await page.$eval('.recent-dir-list[data-kind="discovered"]', (node) => {
        const list = node as HTMLElement
        const style = getComputedStyle(list)
        const listRect = list.getBoundingClientRect()
        const panelRect = document.querySelector<HTMLElement>(".recent-dir-panel")!.getBoundingClientRect()
        const recentRect = document
          .querySelector<HTMLElement>('.recent-dir-list[data-kind="recent"]')
          ?.getBoundingClientRect()
        return {
          rowCount: list.querySelectorAll(".recent-dir-row").length,
          overflowY: style.overflowY,
          scrollbarWidth: style.scrollbarWidth,
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          panelBottom: Math.round(panelRect.bottom),
          listBottom: Math.round(listRect.bottom),
          recentBottom: Math.round(recentRect?.bottom ?? 0),
        }
      })

      assert.equal(before.rowCount, 12)
      assert.equal(before.overflowY, "auto")
      assert.equal(before.scrollbarWidth, "auto")
      assert.ok(before.scrollHeight > before.clientHeight, JSON.stringify(before))
      assert.ok(before.listBottom <= before.panelBottom, JSON.stringify(before))
      assert.ok(before.recentBottom <= before.panelBottom, JSON.stringify(before))

      await page.$eval('.recent-dir-list[data-kind="discovered"]', (node) => {
        const list = node as HTMLElement
        list.scrollTop = list.scrollHeight
        list.dispatchEvent(new Event("scroll", { bubbles: true }))
      })
      await page.waitForFunction(() => {
        const list = document.querySelector<HTMLElement>('.recent-dir-list[data-kind="discovered"]')
        return !!list && list.scrollTop > 0
      })

      const after = await page.$eval('.recent-dir-list[data-kind="discovered"]', (node) => {
        const list = node as HTMLElement
        const listRect = list.getBoundingClientRect()
        const rows = Array.from(list.querySelectorAll<HTMLElement>(".recent-dir-row"))
        const lastRect = rows.at(-1)!.getBoundingClientRect()
        return {
          scrollTop: list.scrollTop,
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          lastTop: Math.round(lastRect.top),
          lastBottom: Math.round(lastRect.bottom),
          listTop: Math.round(listRect.top),
          listBottom: Math.round(listRect.bottom),
        }
      })
      assert.ok(after.scrollTop > 0, JSON.stringify(after))
      assert.ok(after.scrollHeight > after.clientHeight, JSON.stringify(after))
      assert.ok(after.lastTop >= after.listTop, JSON.stringify(after))
      assert.ok(after.lastBottom <= after.listBottom, JSON.stringify(after))

      const screenshot = await saveElementScreenshot(
        page,
        ".recent-dir-panel",
        "task-dirbar-detected-project-scroll.png",
      )
      assert.ok(screenshot.endsWith("task-dirbar-detected-project-scroll.png"))
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
