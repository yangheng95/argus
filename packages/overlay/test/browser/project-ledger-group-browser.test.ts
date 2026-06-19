import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIR = "D:/ledger/workspace"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function taskItem(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_100_000_000 + index
  const id = `ledger-task-${index}`
  return {
    updated_at: created + 10,
    pending_interactions: 0,
    overview: {
      headline: `Ledger task ${index}`,
      summary: "Project group browser fixture task.",
    },
    task: {
      id,
      requestID: `req-${id}`,
      title: `Ledger task ${index}`,
      request: `Review project group ${index}`,
      directory,
      status: "queued",
      sessionID: `session-${id}`,
      time: {
        created,
        updated: created + 10,
      },
    },
  }
}

function missionRecord(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_200_000_000 + index
  return {
    missionID: `ledger-mission-${index}`,
    sessionID: `ledger-mission-session-${index}`,
    title: `Ledger mission ${index}`,
    directory,
    created,
    updated: created + 10,
    interruptible: true,
    tasks: [],
    taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  }
}

function codingAssistantSession(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_300_000_000 + index
  return {
    id: `ledger-assistant-session-${index}`,
    kind: "coding-assistant",
    title: `Ledger assistant ${index}`,
    directory,
    metadata: null,
    time: {
      created,
      updated: created + 10,
    },
  }
}

const tasks = [taskItem(1), taskItem(2)]
const missions = [missionRecord(1), missionRecord(2)]
const sessions = [codingAssistantSession(1), codingAssistantSession(2)]
const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
const sessionsByID = new Map(sessions.map((session) => [session.id, session]))

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

async function saveElementScreenshot(
  page: OverlayPage,
  selector: string,
  filename: string,
) {
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const target = resolve(".scratch", filename)
  mkdirSync(dirname(target), { recursive: true })
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${filename} screenshot should not be empty`)
  writeFileSync(target, screenshot)
  return target
}

async function verifyProjectGroup(
  page: OverlayPage,
  input: {
    activity: "tasks" | "mission" | "assistant"
    groupSelector: string
    expectedCount: string
    screenshot: string
  },
) {
  await page.click(`[data-ui="side-activity-button"][data-side="left"][data-activity="${input.activity}"]`)
  await page.waitForSelector(`${input.groupSelector} [data-ui="project-group-toggle"]`, {
    visible: true,
    timeout: 10_000,
  })

  const openState = await page.$eval(input.groupSelector, (node) => {
    const group = node as HTMLElement
    const heading = group.querySelector<HTMLButtonElement>('[data-ui="project-group-toggle"]')
    const body = group.querySelector<HTMLElement>(".project-group-body")
    return {
      tag: group.tagName,
      className: group.className,
      collapsed: group.dataset.collapsed ?? "",
      headingTag: heading?.tagName ?? "",
      headingClass: heading?.className ?? "",
      headingVariant: heading?.dataset.variant ?? "",
      headingSize: heading?.dataset.size ?? "",
      headingTone: heading?.dataset.tone ?? "",
      headingExpanded: heading?.getAttribute("aria-expanded") ?? "",
      headingLabel: heading?.getAttribute("aria-label") ?? "",
      headingTabIndex: heading?.tabIndex ?? null,
      count: group.querySelector<HTMLElement>(".project-group-count")?.textContent?.trim() ?? "",
      bodyVisible: !!body && body.getClientRects().length > 0,
    }
  })

  assert.equal(openState.tag, "SECTION")
  assert.match(openState.className, /\bproject-group\b/)
  assert.equal(openState.collapsed, "")
  assert.equal(openState.headingTag, "BUTTON")
  assert.equal(openState.headingClass, "oc-button")
  assert.equal(openState.headingVariant, "ghost")
  assert.equal(openState.headingSize, "mini")
  assert.equal(openState.headingTone, "neutral")
  assert.equal(openState.headingExpanded, "true")
  assert.ok(openState.headingLabel.length > 0)
  assert.equal(openState.headingTabIndex, 0)
  assert.equal(openState.count, input.expectedCount)
  assert.equal(openState.bodyVisible, true)

  await page.focus(`${input.groupSelector} [data-ui="project-group-toggle"]`)
  await page.keyboard.press("Enter")
  await page.waitForFunction(
    (selector) => document.querySelector<HTMLElement>(selector)?.dataset.collapsed === "true",
    { timeout: 5_000 },
    input.groupSelector,
  )
  const collapsedState = await page.$eval(input.groupSelector, (node) => {
    const group = node as HTMLElement
    return {
      expanded:
        group.querySelector<HTMLButtonElement>('[data-ui="project-group-toggle"]')?.getAttribute("aria-expanded") ??
        "",
      bodyCount: group.querySelectorAll(".project-group-body").length,
    }
  })
  assert.deepEqual(collapsedState, { expanded: "false", bodyCount: 0 })

  await page.focus(`${input.groupSelector} [data-ui="project-group-toggle"]`)
  await page.keyboard.press(" ")
  await page.waitForFunction(
    (selector) => document.querySelector<HTMLElement>(selector)?.dataset.collapsed !== "true",
    { timeout: 5_000 },
    input.groupSelector,
  )
  await saveElementScreenshot(page, input.groupSelector, input.screenshot)
}

test("project ledger grouping is shared across Task, Mission, and Coding Assistant ledgers", { timeout: 90_000 }, async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })

    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse

    if (path === "/global/health") return json({ version: "project-ledger-group-test" })
    if (path === "/global/projects/discover") {
      return json({ root: "D:/ledger", defaultDirectory: PROJECT_DIR, projects: [] })
    }
    if (path === "/global/tasks" || path === "/tasks") return json({ tasks })
    if (path === "/mission") return json(missions)
    if (path === "/coding/sessions") return json({ sessions, nextCursor: null })
    if (path === "/log") return json({})
    if (path === "/log/tail") return json({ lines: [] })
    if (path === "/executor") return json([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return json({ profiles: [] })
    if (path === "/path") return json({ directory: PROJECT_DIR, exists: true, git: true })
    if (path === "/project/current/worktrees") return json({ worktrees: [] })
    if (path === "/vcs") return json({ branch: "coding-assistant", dirty: false })
    if (path === "/provider") return json({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return json({})
    if (path === "/config/providers") return json({ providers: [], default: {} })
    if (path === "/config") {
      return json({
        server: {},
        provider: {},
        channel: {},
        mcp: {},
        model: "",
        directory: PROJECT_DIR,
      })
    }
    if (path === "/config/prompt" || path === "/config/prompt-profile") {
      return json({
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
      })
    }
    if (path === "/channel") return json([])
    if (path === "/channel/runtime") return json({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return json({ active: 0, queued: tasks.length, completed: 0, failed: 0 })
    if (path === "/skill/installed" || path === "/skill") return json([])
    if (path === "/skill/directories") {
      return json({
        global_config: "D:/ledger/config",
        managed_skills: "D:/ledger/config/skills-market",
        remote_cache: "D:/ledger/cache",
      })
    }
    if (path === "/skill/market") return json([])
    if (path === "/mcp") return json({})
    if (path === "/agent") return json([])
    if (path === "/file") return json([])
    if (path === "/panel/knowledge/memory") return json([])
    if (path === "/panel/knowledge/preference") return json([])
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
      const item = tasksByID.get(taskID) || tasks[0]
      return json({
        taskID,
        sessionID: item.task.sessionID,
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
      return json({
        taskID,
        kind: "missing",
        status: "missing",
        projectRoot: PROJECT_DIR,
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    }
    const taskBoardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
    if (taskBoardMatch) {
      const item = tasksByID.get(decodeURIComponent(taskBoardMatch[1]))
      return item ? json(boardForTask(item)) : json({ error: "task not found" }, 404)
    }
    if (/^\/task\/[^/]+\/conversation$/.test(path)) {
      const taskID = decodeURIComponent(path.split("/")[2] || "")
      const item = tasksByID.get(taskID) || tasks[0]
      return json({
        board: boardForTask(item),
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    }
    const codingSessionMatch = /^\/coding\/session\/([^/]+)$/.exec(path)
    if (codingSessionMatch) {
      const session = sessionsByID.get(decodeURIComponent(codingSessionMatch[1]))
      return session ? json({ session }) : json({ error: "session not found" }, 404)
    }
    if (/^\/session\/[^/]+\/conversation$/.test(path)) {
      return json({
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
        messageWatermark: 0,
        lastSequence: 0,
      })
    }
    if (/^\/session\/[^/]+\/events$/.test(path)) {
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }

    return json({ error: `unhandled ${path}` }, 404)
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const badResponses: string[] = []

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) consoleErrors.push(msg.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))
  page.on("requestfailed", (request) => {
    if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
    if (/\/session\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
    failedRequests.push(request.url())
  })
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })

  try {
    await page.setViewport({ width: 1180, height: 760 })
    await page.evaluateOnNewDocument((origin) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", origin)
      localStorage.setItem("oc_auto_server", "true")
      localStorage.setItem("oc_directory", "D:/ledger/workspace")
      localStorage.setItem("oc_workspace_directory", "D:/ledger/workspace")
      localStorage.setItem("oc_directory_mode", "custom")
      localStorage.setItem("oc_theme", "light")
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")

    await verifyProjectGroup(page, {
      activity: "tasks",
      groupSelector: "#leftPanelTasks .project-group",
      expectedCount: "2",
      screenshot: "project-ledger-group-tasks.png",
    })
    await verifyProjectGroup(page, {
      activity: "mission",
      groupSelector: '[data-ui="mission-project-group"]',
      expectedCount: "2",
      screenshot: "project-ledger-group-mission.png",
    })
    await verifyProjectGroup(page, {
      activity: "assistant",
      groupSelector: '[data-ui="coding-assistant-project-group"]',
      expectedCount: "2",
      screenshot: "project-ledger-group-coding-assistant.png",
    })

    assert.deepEqual({ consoleErrors, failedRequests, badResponses }, { consoleErrors: [], failedRequests: [], badResponses: [] })
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
