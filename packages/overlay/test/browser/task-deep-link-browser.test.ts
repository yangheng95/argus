import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "task-deep-link"
const SAVED_TASK_ID = "task-saved-restore"
const DIRECTORY = "D:/deep-link/workspace"

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function task(id: string, title: string, updatedOffset: number): any {
  const created = 1_776_000_000_000 + updatedOffset
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: title, summary: title },
    task: {
      id,
      requestID: `req-${id}`,
      title,
      request: title,
      directory: DIRECTORY,
      status: "active",
      sessionID: `session-${id}`,
      time: { created, started: created + 1, updated: created + 2 },
    },
  }
}

function boardForTask(item: any): any {
  return {
    task: item.task,
    overview: item.overview,
    goalWorkflows: [],
    interactions: [],
    lastSequence: 1,
    snapshotVersion: `snapshot-${item.task.id}`,
  }
}

function conversationForTask(item: any): any {
  return {
    board: boardForTask(item),
    transcript: [],
    timeline: [],
    events: [],
    view: { sessions: [] },
    agentView: { sessions: [] },
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
    history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
    messageWatermark: 0,
    lastSequence: 0,
  }
}

async function deepLinkDiagnostics(page: any, badResponses: string[], conversationRequests: string[]): Promise<string> {
  const runtime = await page.evaluate(() => ({
    href: window.location.href,
    initSettled: (window as any).__overlayInitSettled,
    selectedSource: (window as any).boardStore?.selectedSource,
    activeTaskID: (window as any).boardStore?.board?.task?.id,
    taskCount: Array.isArray((window as any).boardStore?.tasks) ? (window as any).boardStore.tasks.length : null,
    tasksError: (window as any).boardStore?.tasksError,
    bodyText: document.body.textContent?.slice(0, 1_000) ?? "",
  }))
  return JSON.stringify({ runtime, badResponses, conversationRequests }, null, 2)
}

test("URL taskID deep link selects the linked task before persisted restore", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const linked = task(TASK_ID, "Deep linked task", 10)
  const saved = task(SAVED_TASK_ID, "Saved task that must not win", 1)
  const tasks = [linked, saved]
  const conversationRequests: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "task-deep-link-browser-test" })
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: DIRECTORY, exists: true, git: true })
    if (path === "/vcs") return send({ branch: "main", dirty: false })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config")
      return send({ server: {}, provider: {}, channel: {}, mcp: {}, model: "", directory: DIRECTORY })
    if (path === "/config/prompt")
      return send({ active: "general", project_active: "general", default: "general", targets: [], profiles: [] })
    if (path === "/config/prompt-profile")
      return send({ active: "general", project_active: "general", default: "general", targets: [], profiles: [] })
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(":\n\n", {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts") return send({ scope: "project", skills: [], agents: [], source: DIRECTORY })
    if (path === "/skill/directories")
      return send({
        global_config: "D:/deep-link/config",
        managed_skills: "D:/deep-link/skills",
        remote_cache: "D:/deep-link/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/agent") return send([])
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      return send({ taskID: TASK_ID, sessionID: linked.task.sessionID, agent: "orchestrator", model: null })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path))
      return send({
        taskID: TASK_ID,
        kind: "missing",
        status: "missing",
        projectRoot: DIRECTORY,
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
    if (path === `/task/${TASK_ID}/conversation`) {
      conversationRequests.push(url.href)
      return send(conversationForTask(linked))
    }
    if (path === `/task/${SAVED_TASK_ID}/conversation`) {
      conversationRequests.push(url.href)
      return send(conversationForTask(saved))
    }
    if (/^\/task\/[^/]+\/board$/.test(path)) return send(boardForTask(linked))
    return send({ error: `unhandled ${path}` }, 404)
  })

  const browser = await launchBrowser()
  const page = await browser.newPage()
  const badResponses: string[] = []
  page.on("response", (response: any) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })

  try {
    await page.evaluateOnNewDocument(
      ({ origin, directory }) => {
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_workspace_task", "task-saved-restore")
        localStorage.setItem("oc_workspace_directory", directory)
        localStorage.setItem("oc_theme", "light")
      },
      { origin: server.origin, directory: DIRECTORY },
    )
    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(TASK_ID)}`, { waitUntil: "load" })
    try {
      await page.waitForFunction(
        (taskID: string) =>
          (window as any).boardStore?.selectedSource?.kind === "task" &&
          (window as any).boardStore.selectedSource.id === taskID,
        { timeout: 15_000 },
        TASK_ID,
      )
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${await deepLinkDiagnostics(page, badResponses, conversationRequests)}`,
      )
    }

    const selected = await page.evaluate(() => ({
      selectedSource: (window as any).boardStore.selectedSource,
      activeTaskID: (window as any).boardStore.board?.task?.id,
      directory: (window as any).boardStore.board?.task?.directory,
    }))
    assert.deepEqual(selected, {
      selectedSource: { kind: "task", id: TASK_ID, directory: DIRECTORY },
      activeTaskID: TASK_ID,
      directory: DIRECTORY,
    })
    assert.equal(
      conversationRequests.some((request) => request.includes(`/task/${TASK_ID}/conversation`)),
      true,
    )
    assert.equal(
      conversationRequests.some((request) => request.includes(`/task/${SAVED_TASK_ID}/conversation`)),
      false,
    )
    assert.deepEqual(badResponses, [])

    const screenshotPath = resolve(".scratch", "task-deep-link-browser.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await page.screenshot({ fullPage: true }))
  } finally {
    await browser.close()
    await server.close()
  }
})

test("directory-only URL parameters keep task row operations usable", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const linked = task(TASK_ID, "Task to delete from directory URL", 10)
  const saved = task(SAVED_TASK_ID, "Remaining saved task", 1)
  let tasks = [linked, saved]
  const conversationRequests: string[] = []
  const deleteRequests: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "task-directory-delete-browser-test" })
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: DIRECTORY, exists: true, git: true })
    if (path === "/vcs") return send({ branch: "main", dirty: false })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config")
      return send({ server: {}, provider: {}, channel: {}, mcp: {}, model: "", directory: DIRECTORY })
    if (path === "/config/prompt")
      return send({ active: "general", project_active: "general", default: "general", targets: [], profiles: [] })
    if (path === "/config/prompt-profile")
      return send({ active: "general", project_active: "general", default: "general", targets: [], profiles: [] })
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(":\n\n", {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts") return send({ scope: "project", skills: [], agents: [], source: DIRECTORY })
    if (path === "/skill/directories")
      return send({
        global_config: "D:/deep-link/config",
        managed_skills: "D:/deep-link/skills",
        remote_cache: "D:/deep-link/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/agent") return send([])
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      return send({ taskID: TASK_ID, sessionID: linked.task.sessionID, agent: "orchestrator", model: null })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path))
      return send({
        taskID: TASK_ID,
        kind: "missing",
        status: "missing",
        projectRoot: DIRECTORY,
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
    if (path === `/task/${TASK_ID}/conversation`) {
      conversationRequests.push(url.href)
      return send(conversationForTask(linked))
    }
    if (path === `/task/${SAVED_TASK_ID}/conversation`) {
      conversationRequests.push(url.href)
      return send(conversationForTask(saved))
    }
    if (req.method === "DELETE" && path === `/task/${TASK_ID}`) {
      deleteRequests.push(url.href)
      tasks = tasks.filter((item) => item.task.id !== TASK_ID)
      return send({ ok: true })
    }
    if (/^\/task\/[^/]+\/board$/.test(path)) return send(boardForTask(linked))
    return send({ error: `unhandled ${path}` }, 404)
  })

  const browser = await launchBrowser()
  const page = await browser.newPage()
  const badResponses: string[] = []
  page.on("response", (response: any) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })

  try {
    await page.evaluateOnNewDocument(
      ({ origin, directory, taskID }) => {
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_workspace_task", taskID)
        localStorage.setItem("oc_workspace_directory", directory)
        localStorage.setItem("oc_theme", "light")
      },
      { origin: server.origin, directory: DIRECTORY, taskID: TASK_ID },
    )
    await page.goto(`${server.origin}/ui/index.html?directory=${encodeURIComponent(DIRECTORY)}`, { waitUntil: "load" })
    await page.waitForFunction(
      (taskID: string) =>
        (window as any).boardStore?.selectedSource?.kind === "task" &&
        (window as any).boardStore.selectedSource.id === taskID,
      { timeout: 15_000 },
      TASK_ID,
    )

    const deleteSelector = `[data-task-delete="${TASK_ID}"]`
    await page.hover(`.task-row-main[data-task-id="${TASK_ID}"]`)
    await page.waitForSelector(deleteSelector, { visible: true, timeout: 15_000 })
    await page.click(deleteSelector)
    await page.click(deleteSelector)
    await page.waitForFunction(
      (taskID: string) => !document.querySelector(`.task-row-main[data-task-id="${taskID}"]`),
      { timeout: 15_000 },
      TASK_ID,
    )

    const state = await page.evaluate(() => ({
      selectedSource: (window as any).boardStore.selectedSource,
      taskIDs: ((window as any).boardStore.tasks || []).map((item: any) => item?.task?.id),
    }))
    assert.deepEqual(state, {
      selectedSource: null,
      taskIDs: [SAVED_TASK_ID],
    })
    assert.equal(
      conversationRequests.some((request) => request.includes(`/task/${TASK_ID}/conversation`)),
      true,
    )
    assert.equal(deleteRequests.length, 1)
    assert.equal(new URL(deleteRequests[0]).searchParams.has("directory"), false)
    assert.deepEqual(badResponses, [])

    const screenshotPath = resolve(".scratch", "task-directory-url-delete-browser.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await page.screenshot({ fullPage: true }))
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${await deepLinkDiagnostics(page, badResponses, conversationRequests)}`,
    )
  } finally {
    await browser.close()
    await server.close()
  }
})
