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

function cancelledTask(): any {
  const created = 1_776_000_001_000
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: "Cancelled task", summary: "Cancelled task" },
    task: {
      id: "task-cancelled-compose",
      requestID: "req-task-cancelled-compose",
      title: "Cancelled task",
      request: "Cancelled task",
      directory: "D:/composer-existing/workspace",
      status: "cancelled",
      sessionID: "session-task-cancelled-compose",
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

const PROMPT_PROFILE_CATALOG = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

async function waitForCurrentTask(page: any, taskID: string) {
  const selector = `.task-row-main[data-task-id="${taskID}"]`
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = await page.$eval(selector, (node: HTMLElement) => node.getAttribute("aria-current") || "")
    if (current === "page") return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for selected task ${taskID}`)
}

test("selected cancelled task keeps the main composer focusable and editable", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const item = cancelledTask()
  const tasks = [item]

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "task-composer-existing-test" })
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/composer-existing/workspace", exists: true, git: true })
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
        directory: "D:/composer-existing/workspace",
      })
    }
    if (path === "/config/prompt" || path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(":\n\n", {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/directories")
      return send({
        global_config: "D:/existing-task/config",
        managed_skills: "D:/existing-task/config/skills-market",
        remote_cache: "D:/existing-task/cache",
      })
    if (path === "/skill/market") return send([])
    if (path === "/mcp") return send({})
    if (path === "/agent") return send([])
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      return send({
        taskID: item.task.id,
        sessionID: item.task.sessionID,
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
      return send({
        taskID: item.task.id,
        kind: "missing",
        status: "missing",
        projectRoot: item.task.directory,
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    }
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
    if (/^\/task\/[^/]+\/conversation$/.test(path)) {
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
    if (/^\/task\/[^/]+\/board$/.test(path)) return send(boardForTask(item))
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
      localStorage.setItem("oc_directory", "D:/composer-existing/workspace")
      localStorage.setItem("oc_theme", "light")
    }, server.origin)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]', {
      visible: true,
    })
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.waitForSelector('.task-row-main[data-task-id="task-cancelled-compose"]')
    await page.click('.task-row-main[data-task-id="task-cancelled-compose"]')
    await waitForCurrentTask(page, "task-cancelled-compose")

    const point = await page.$eval("#chatTextarea", (input: HTMLTextAreaElement) => {
      if (input.disabled) throw new Error("selected cancelled task composer is disabled")
      const rect = input.getBoundingClientRect()
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + Math.min(24, rect.height / 2) }
    })
    await page.mouse.click(point.x, point.y)
    await page.keyboard.type("continue cancelled task")
    const state = await page.$eval("#chatTextarea", (input: HTMLTextAreaElement) => ({
      active: document.activeElement === input,
      disabled: input.disabled,
      value: input.value,
    }))

    assert.deepEqual(state, {
      active: true,
      disabled: false,
      value: "continue cancelled task",
    })
    assert.deepEqual(badResponses, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
