import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function taskItem(id: string, title: string, created: number, parentTaskID?: string): any {
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: title, summary: title },
    task: {
      id,
      requestID: `req-${id}`,
      title,
      request: title,
      directory: "D:/tree-click/workspace",
      status: "queued",
      parentTaskID,
      metadata: parentTaskID ? { parent_task_id: parentTaskID } : {},
      queue: { order: created, revision: "rev-tree-click" },
      sessionID: `session-${id}`,
      time: { created, updated: created + 1 },
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

async function visibleTaskRows(page: any) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".task-row-main")).map((node) => ({
      id: node.dataset.taskId,
      current: node.getAttribute("aria-current"),
      text: node.textContent?.trim().slice(0, 80),
    })),
  )
}

async function waitForCurrentTask(page: any, taskID: string) {
  const selector = `.task-row-main[data-task-id="${taskID}"]`
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = await page.$eval(selector, (node: HTMLElement) => node.getAttribute("aria-current") || "")
    if (current === "page") return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const state = await visibleTaskRows(page)
  throw new Error(`Timed out waiting for selected task ${taskID}: ${JSON.stringify(state)}`)
}

test("task tree parent selection does not leave later task-row clicks trapped in the right-side chrome", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const parent = taskItem("task-parent", "Parent with children", 1_776_000_000_003)
  const child = taskItem("task-child", "Nested child", 1_776_000_000_002, "task-parent")
  const sibling = taskItem("task-sibling", "Sibling task", 1_776_000_000_001)
  const tasks = [parent, child, sibling]
  const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "task-tree-click-test" })
    if (path === "/global/tasks" || path === "/tasks") return send({ tasks })
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/tree-click/workspace", exists: true, git: true })
    if (path === "/vcs") return send({ branch: "main", dirty: false })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") {
      return send({
        server: {},
        provider: {},
        channel: {},
        mcp: {},
        model: "",
        directory: "D:/tree-click/workspace",
      })
    }
    if (path === "/config/prompt") return send({})
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 3, completed: 0, failed: 0 })
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(":\n\n", {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/directories") return send([])
    if (path === "/skill/market") return send({ items: [] })
    if (path === "/mcp") return send({})
    if (path === "/agent") return send([])
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
      const sessionID = tasksByID.get(taskID)?.task.sessionID || `session-${taskID}`
      return send({
        taskID,
        sessionID,
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
      return send({
        taskID,
        kind: "missing",
        status: "missing",
        projectRoot: "D:/tree-click/workspace",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    }
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
    const conversationMatch = /^\/task\/([^/]+)\/conversation$/.exec(path)
    if (conversationMatch) {
      const item = tasksByID.get(decodeURIComponent(conversationMatch[1])) ?? parent
      return send({
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
      })
    }
    const boardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
    if (boardMatch) {
      const item = tasksByID.get(decodeURIComponent(boardMatch[1]))
      return item ? send(boardForTask(item)) : send({ error: "not found" }, 404)
    }
    return send({ error: `unhandled ${path}` }, 404)
  })

  const browser = await launchBrowser()
  const page = await browser.newPage()
  const badResponses: string[] = []
  page.on("response", (response: any) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })

  try {
    await page.evaluateOnNewDocument((origin) => {
      localStorage.setItem("oc_server_url", origin)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/tree-click/workspace")
      localStorage.setItem("oc_theme", "light")
    }, server.origin)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('.task-row-main[data-task-id="task-parent"]')
    await page.click('.task-row-main[data-task-id="task-parent"]')
    await waitForCurrentTask(page, "task-parent")

    await page.hover('.task-row-mini[data-task-row-id="task-sibling"]')
    const siblingHitPoint = await page.$eval('.task-row-main[data-task-id="task-sibling"]', (row) => {
      const rect = (row as HTMLElement).getBoundingClientRect()
      return { x: rect.right - 96, y: rect.top + rect.height / 2 }
    })
    const siblingHitTarget = await page.evaluate((point) => {
      const target = document.elementFromPoint(point.x, point.y)
      if (!(target instanceof Element)) return ""
      const row = target.closest<HTMLElement>(".task-row-mini, .task-row-main")
      return {
        target: `${target.tagName}.${target.className}`,
        rowID: row?.dataset.taskRowId || row?.dataset.taskId || "",
      }
    }, siblingHitPoint)
    await page.mouse.click(siblingHitPoint.x, siblingHitPoint.y)
    try {
      await waitForCurrentTask(page, "task-sibling")
    } catch (error) {
      const rows = await visibleTaskRows(page)
      throw new Error(
        `Sibling click did not select task; hit=${JSON.stringify(siblingHitTarget)} rows=${JSON.stringify(rows)}`,
        { cause: error },
      )
    }

    assert.deepEqual(badResponses, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
