import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

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

test("task tree parent selection does not leave later task-row clicks trapped in the right-side chrome", async () => {
  const parent = taskItem("task-parent", "Parent with children", 1_776_000_000_003)
  const child = taskItem("task-child", "Nested child", 1_776_000_000_002, "task-parent")
  const sibling = taskItem("task-sibling", "Sibling task", 1_776_000_000_001)
  const tasks = [parent, child, sibling]
  const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
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
        return new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/directories") return send([])
      if (path === "/skill/market") return send({ items: [] })
      if (path === "/mcp") return send({})
      if (path === "/agent") return send([])
      if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
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
    },
  })

  const browser = await launchBrowser()
  const page = await browser.newPage()
  const badResponses: string[] = []
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })

  try {
    const app = `http://127.0.0.1:${server.port}`
    await page.evaluateOnNewDocument((origin) => {
      localStorage.setItem("oc_server_url", origin)
      localStorage.setItem("oc_auto_server", "true")
      localStorage.setItem("oc_directory", "D:/tree-click/workspace")
      localStorage.setItem("oc_theme", "light")
    }, app)
    await page.goto(`${app}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
    await page.waitForSelector('.task-row-main[data-task-id="task-parent"]')
    await page.click('.task-row-main[data-task-id="task-parent"]')
    await page.waitForFunction(() => document.querySelector('.task-row-main[data-task-id="task-parent"]')?.getAttribute("aria-current") === "page")

    const siblingHitPoint = await page.$eval('.task-row-mini[data-task-row-id="task-sibling"]', (row) => {
      const rect = (row as HTMLElement).getBoundingClientRect()
      return { x: rect.right - 96, y: rect.top + rect.height / 2 }
    })
    await page.mouse.click(siblingHitPoint.x, siblingHitPoint.y)
    await page.waitForFunction(() => document.querySelector('.task-row-main[data-task-id="task-sibling"]')?.getAttribute("aria-current") === "page")

    expect(badResponses).toEqual([])
  } finally {
    await browser.close()
    server.stop(true)
  }
})
