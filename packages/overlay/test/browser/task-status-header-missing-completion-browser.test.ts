import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const MISSING_TASK_ID = "tsk_missing_completed_time"
const INVALID_TASK_ID = "tsk_invalid_completed_time"
const ACTIVE_TASK_ID = "tsk_active_sse_time"
const QUEUED_TASK_ID = "tsk_queued_no_elapsed"
const DIRECTORY = "D:/overlay/workspace/status-header"
const sseEncoder = new TextEncoder()

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

function eventStream(taskID?: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        if (timer) clearTimeout(timer)
      },
      start(controller) {
        controller.enqueue(sseEncoder.encode(":\n\n"))
        if (taskID !== ACTIVE_TASK_ID) {
          controller.close()
          return
        }
        controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(taskMessageChangedEvent(taskID, 2))}\n\n`))
        timer = setTimeout(() => {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(taskMessageChangedEvent(taskID, 3))}\n\n`))
          controller.close()
        }, 1150)
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

function taskMessageChangedEvent(taskID: string, sequence: number): Record<string, unknown> {
  return {
    type: "task.messages.changed",
    taskID,
    sequence,
    orderKey: `v1:0001780000000000:0000000000000010:${String(sequence).padStart(16, "0")}:event:${taskID}`,
  }
}

function taskRecord(input: { taskID: string; title: string; status: string; time: Record<string, number> }) {
  return {
    id: input.taskID,
    title: input.title,
    status: input.status,
    directory: DIRECTORY,
    sessionID: `ses_${input.taskID}`,
    request: "show explicit terminal timestamp error",
    orderKey: `v1:0001780000000000:0000000000000010:0000000000000000:test:${input.taskID}`,
    time: input.time,
    attachments: [],
  }
}

const tasks = {
  [MISSING_TASK_ID]: taskRecord({
    taskID: MISSING_TASK_ID,
    title: "Missing completed time",
    status: "completed",
    time: { created: 1_780_000_000_000, updated: 1_780_000_010_000 },
  }),
  [INVALID_TASK_ID]: taskRecord({
    taskID: INVALID_TASK_ID,
    title: "Invalid completed time",
    status: "completed",
    time: {
      created: 1_780_000_010_000,
      completed: 1_780_000_000_000,
      updated: 1_780_000_010_000,
    },
  }),
  [ACTIVE_TASK_ID]: taskRecord({
    taskID: ACTIVE_TASK_ID,
    title: "Active SSE time",
    status: "active",
    time: {
      created: 1_780_000_020_000,
      started: 1_780_000_020_000,
      updated: 1_780_000_020_000,
    },
  }),
  [QUEUED_TASK_ID]: taskRecord({
    taskID: QUEUED_TASK_ID,
    title: "Queued no elapsed",
    status: "queued",
    time: {
      created: 1_780_000_030_000,
      updated: 1_780_000_030_000,
    },
  }),
}

function conversationPayload(taskID: string) {
  const task = tasks[taskID as keyof typeof tasks]
  assert.ok(task, `task fixture missing ${taskID}`)
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: `board:${taskID}`,
      task,
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { sessions: [], messages: [] },
    agentView: { sessions: [], messages: [], topLevelSessionIDs: [] },
    messageWatermark: 1,
  }
}

async function fixtureResponse(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse
  if (path === "/global/health") return send({ version: "1.2.3" })
  if (path === "/global/projects/discover") {
    return send({
      root: "D:/overlay/workspace",
      defaultDirectory: DIRECTORY,
      projects: [{ directory: DIRECTORY, name: "status-header", marker: "package.json" }],
    })
  }
  if (path === "/global/tasks") {
    return send({ tasks: Object.values(tasks).map((task) => ({ task, updated_at: task.time.updated })) })
  }
  if (path === "/session" || path === "/mission") return send([])
  if (path === "/project/current/worktrees") return send([])
  if (path === "/vcs") {
    return send({
      branch: "main",
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
  const taskConversationMatch = path.match(/^\/task\/([^/]+)\/conversation$/)
  if (taskConversationMatch) return send(conversationPayload(decodeURIComponent(taskConversationMatch[1]!)))
  if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) return send({ selected: null, candidates: [] })
  const taskEventsMatch = path.match(/^\/task\/([^/]+)\/events$/)
  if (path === "/task/events") return eventStream()
  if (taskEventsMatch) return eventStream(decodeURIComponent(taskEventsMatch[1]!))
  if (path === "/log") return send({ ok: true })
  if (path === "/path") return send({ directory: DIRECTORY })
  if (path === "/provider") return send({ all: [], connected: [], default: {} })
  if (path === "/provider/auth") return send({})
  if (path === "/config/providers") return send({ providers: [], default: {} })
  if (path === "/config/prompt") return send([])
  if (path === "/config/prompt-profile") return send({ active: "general", targets: [], profiles: [] })
  if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) return send({ model: "" })
  if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
  if (path === "/skill/installed" || path === "/skill") return send([])
  if (path === "/skill/mounts")
    return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory") return send([])
  if (path === "/panel/knowledge/preference") return send([])
  if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
  if (path === "/coding/cli/profiles") return send({ profiles: [] })
  if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
  return send({ error: `unhandled ${path}` }, { status: 404 })
}

async function withTaskStatusPage(
  taskID: string,
  run: (input: { page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>> }) => Promise<void>,
): Promise<void> {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(fixtureResponse)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1100, height: 720 })
    await page.evaluateOnNewDocument(
      (input: { serverUrl: string; taskID: string }) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", "D:/overlay/workspace/status-header")
        localStorage.setItem("oc_saved_directory", "D:/overlay/workspace/status-header")
        localStorage.setItem("oc_workspace_task", input.taskID)
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/status-header")
        localStorage.setItem("oc_server_url", input.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      },
      { serverUrl: server.origin, taskID },
    )

    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(taskID)}`, {
      waitUntil: "domcontentloaded",
    })
    try {
      await page.waitForFunction(
        (taskID) =>
          (window as any).boardStore?.selectedSource?.kind === "task" &&
          (window as any).boardStore.selectedSource.id === taskID,
        { timeout: 15_000 },
        taskID,
      )
      await page.waitForSelector("#taskStatus", { visible: true })
      await page.waitForFunction(() => document.querySelector("#taskElapsed") !== null, { timeout: 15_000 })
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        localStorageWorkspaceTask: localStorage.getItem("oc_workspace_task") || "",
        selectedSource: (window as any).boardStore?.selectedSource,
        activeTaskID: (window as any).boardStore?.board?.task?.id || "",
        tasksLoaded: (window as any).boardStore?.tasksLoaded,
        taskCount: (window as any).boardStore?.tasks?.length ?? -1,
        bodyDataset: { ...document.body.dataset },
        pageText: document.body.innerText.slice(0, 1200),
      }))
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
          { errors: errors.unexpectedErrors, diagnostics },
          null,
          2,
        )}`,
      )
    }
    await run({ page })
    errors.assertNoUnexpectedErrors()
  } finally {
    let closeError: unknown
    try {
      await browser.close()
    } catch (error) {
      closeError = error
    }
    await server.close()
    if (closeError) throw closeError
  }
}

async function saveTaskStatusScreenshot(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>,
  screenshotName: string,
): Promise<string> {
  const screenshotPath = resolve(`.scratch/${screenshotName}`)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$("#taskStatus")
  assert.ok(element)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

async function verifyTaskStatusElapsed(taskID: string, expectedText: string, screenshotName: string): Promise<void> {
  await withTaskStatusPage(taskID, async ({ page }) => {
    const elapsedText = await page.$eval("#taskElapsed", (node) => node.textContent?.trim())
    assert.equal(elapsedText, expectedText)
    await saveTaskStatusScreenshot(page, screenshotName)
  })
}

async function elapsedSeconds(page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>) {
  const text = await page.$eval("#taskElapsed", (node) => node.textContent?.trim() || "")
  const match = text.match(/^(\d+)s$/)
  assert.ok(match, `expected second-only elapsed text, got ${JSON.stringify(text)}`)
  return Number(match[1])
}

test(
  "TaskStatusHeader surfaces missing completed timestamp instead of using local time",
  async () => {
    await verifyTaskStatusElapsed(
      MISSING_TASK_ID,
      "missing completion time",
      "task-status-header-missing-completed-time.png",
    )
  },
  { timeout: 60_000 },
)

test(
  "TaskStatusHeader counts only active selected-task SSE update time",
  async () => {
    await withTaskStatusPage(ACTIVE_TASK_ID, async ({ page }) => {
      await page.waitForFunction(
        () => {
          const text = document.querySelector("#taskElapsed")?.textContent?.trim() || ""
          return /^([1-9]\d*)s$/.test(text)
        },
        { timeout: 5_000 },
      )
      const seconds = await elapsedSeconds(page)
      assert.ok(seconds >= 1 && seconds <= 2, `expected one SSE interval, got ${seconds}s`)
      await saveTaskStatusScreenshot(page, "task-status-header-active-sse-time.png")
    })
  },
  { timeout: 60_000 },
)

test(
  "TaskStatusHeader does not show queued elapsed time",
  async () => {
    await verifyTaskStatusElapsed(QUEUED_TASK_ID, "", "task-status-header-queued-no-elapsed.png")
  },
  { timeout: 60_000 },
)

test(
  "TaskStatusHeader surfaces invalid terminal timestamp instead of a negative duration",
  async () => {
    await verifyTaskStatusElapsed(
      INVALID_TASK_ID,
      "invalid completion time",
      "task-status-header-invalid-completed-time.png",
    )
  },
  { timeout: 60_000 },
)
