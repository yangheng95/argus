import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import {
  testMessageOrderKey,
  testPartOrderKey,
  testSessionOrderKey,
  testTaskOrderKey,
} from "../fixtures/timeline-order.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(".scratch", "agent-summary-card", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const buffer = await element.screenshot({})
  writeFileSync(screenshotPath, buffer)
  assert.ok(buffer.length > 10_000, `summary screenshot is too small: ${buffer.length}`)
  return screenshotPath
}

test("collapsed agent card renders latest tool activity instead of terminal summary", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-agent-summary-card"
  const summaryText =
    "I checked the overlay projection, verified the collapsed card rendering, and recorded the passing screenshot evidence."
  const latestToolCommand = "rg collapsed-card-preview packages/overlay/src"
  const task = {
    id: taskID,
    title: "Agent summary card",
    directory: "D:/overlay/workspace/app",
    status: "active",
    sessionID: "session-root",
    orderKey: testTaskOrderKey(taskID, now - 90_000),
    time: { created: now - 90_000, started: now - 80_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "agent-summary-card-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "architect", status: "active" },
    overview: {
      headline: "Agent summary card",
      summary: "Verify terminal summaries render on collapsed subagent cards.",
      controls: {},
    },
    requirements: [],
    acceptance: null,
    interactions: [],
  }
  const workLedgerTask = {
    kind: "task",
    id: taskID,
    title: task.title,
    directory: task.directory,
    created: task.time.created,
    updated: task.time.updated,
    lifecycleStatus: "active",
    executionStatus: "running",
    priority: "normal",
    source: "test",
  }
  const transcript = [
    {
      parts: [
        {
          id: "part-user",
          messageID: "msg-user",
          sessionID: "session-user",
          orderKey: testPartOrderKey("part-user", now - 9_999),
          type: "text",
          text: "Please add a visible summary for completed subagents.",
        },
      ],
      info: {
        id: "msg-user",
        sessionID: "session-user",
        role: "user",
        resolvedRole: "user",
        agent: "user",
        channel: "user",
        orderKey: testMessageOrderKey("msg-user", now - 10_000),
        time: { created: now - 10_000 },
      },
    },
    {
      parts: [
        {
          id: "part-architect",
          messageID: "msg-architect",
          sessionID: "session-architect-summary",
          orderKey: testPartOrderKey("part-architect", now - 6_999),
          type: "text",
          text:
            "The implementation projects the terminal lifecycle summary into the card tree and keeps the normal collapsed preview available below it.",
        },
        {
          id: "part-architect-tool",
          messageID: "msg-architect",
          sessionID: "session-architect-summary",
          orderKey: testPartOrderKey("part-architect-tool", now - 6_500),
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            time: { start: now - 6_500, end: now - 6_300 },
            input: { command: latestToolCommand },
            output: "",
          },
        },
      ],
      info: {
        id: "msg-architect",
        sessionID: "session-architect-summary",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        channel: "analysis",
        orderKey: testMessageOrderKey("msg-architect", now - 7_000),
        time: { created: now - 7_000 },
      },
    },
  ]
  const terminalEvents = [
    {
      type: "session.status",
      sequence: 1,
      emittedAt: now - 6_000,
      orderKey: testSessionOrderKey("session-architect-summary", now - 7_000),
      properties: {
        sessionID: "session-architect-summary",
        orderKey: testSessionOrderKey("session-architect-summary", now - 7_000),
        status: {
          type: "terminal",
          reason: "completed",
          summary: summaryText,
        },
      },
    },
  ]
  const viewMessages = transcript.map((message) => ({
    messageID: message.info.id,
    sessionID: message.info.sessionID,
    stage: message.info.resolvedRole,
    orderKey: message.info.orderKey,
    time: message.info.time.created,
    placement: "top_level",
  }))
  const viewSessions = [
    {
      sessionID: "session-architect-summary",
      stage: "architect",
      messageIDs: ["msg-architect"],
      lastDisplayMessageID: "msg-architect",
      firstMessageTime: now - 7_000,
      lastMessageTime: now - 7_000,
      firstObservedAt: now - 7_000,
      lastObservedAt: now - 7_000,
      orderKey: testSessionOrderKey("session-architect-summary", now - 7_000),
      status: "completed",
      placement: "top_level",
    },
  ]
  const conversation = {
    board,
    transcript,
    timeline: transcript,
    events: terminalEvents,
    view: {
      topLevelSessionIDs: ["session-architect-summary"],
      sessions: viewSessions,
      messages: viewMessages,
    },
    agentView: {
      topLevelSessionIDs: ["session-architect-summary"],
      sessions: viewSessions,
      messages: viewMessages.filter((message) => message.sessionID === "session-architect-summary"),
    },
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 100 },
    history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
    messageWatermark: 1,
    lastSequence: 1,
  }

  const errors: string[] = []
  const requests: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requests.push(`${req.method} ${url.pathname}${url.search}`)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "agent-summary-card" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/work-ledger") return send({ rows: [workLedgerTask], nextCursor: null })
    if (path === "/mission") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
      return send({
        branch: "coding-assistant",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/agent") return send([])
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/channel") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
    if (path === "/skill/directories")
      return send({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/session") return send([])
    if (path === "/control/timeline") return send([])
    if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"board-${now}"` } })
    if (path === `/task/${taskID}/conversation`) return send(conversation)
    if (path === `/task/${taskID}/operator-model-context`)
      return send({ taskID, sessionID: "session-root", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`)
      return send({
        taskID,
        kind: "missing",
        status: "missing",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    if (path === `/task/${taskID}/conversation/events`)
      return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send(transcript)
    if (path === `/task/${taskID}/trace`)
      return send({ events: [], traceDir: "D:/overlay/workspace/app/.opencorvus/trace" })
    if (path === "/work-ledger/events") return eventStream()
    if (path === "/task/events" || path === `/task/${taskID}/events`) return eventStream()
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    page.on("pageerror", (error: any) => errors.push(`pageerror: ${error.message || String(error)}`))
    page.on("console", (message: any) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`)
    })
    page.on("response", (response: any) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    const taskRowSelector = ".task-row-main"
    await page.waitForSelector(taskRowSelector, { visible: true, timeout: 15_000 })
    await page.click(taskRowSelector)
    try {
      await page.waitForSelector('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main', {
        visible: true,
        timeout: 15_000,
      })
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        activeRows: Array.from(document.querySelectorAll<HTMLElement>(".task-row-main")).map((node) => ({
          text: node.innerText,
          dataUi: node.dataset.ui,
          active: node.closest<HTMLElement>("[data-active]")?.dataset.active || "",
          rowKey: node.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey || "",
        })),
        agentRows: Array.from(document.querySelectorAll<HTMLElement>(".chat-bubble-row")).map((node) => ({
          kind: node.dataset.kind,
          text: node.innerText.slice(0, 400),
        })),
        bodyText: document.body.innerText.slice(0, 1200),
      }))
      assert.fail(
        `agent chat bubble did not render: ${String(error)}\n${JSON.stringify(
          { errors, requests, diagnostics },
          null,
          2,
        )}`,
      )
    }
    assert.deepEqual(errors, [])

    const expanded = await page.$eval(
      '.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main',
      (button: HTMLButtonElement) => button.getAttribute("aria-expanded"),
    )
    if (expanded === "true") {
      await page.click('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main')
    }
    await page.waitForSelector('.chat-bubble-row[data-kind="agent"] .card__collapsed-preview', {
      visible: true,
      timeout: 15_000,
    })

    const layout = await page.$eval(
      '.chat-bubble-row[data-kind="agent"]',
      (row: HTMLElement, expectedToolCommand: string) => {
        const button = row.querySelector<HTMLButtonElement>(".chat-bubble__head-main")
        const title = row.querySelector<HTMLElement>(".chat-bubble__identity")
        const summary = row.querySelector<HTMLElement>('[data-ui="agent-summary"]')
        const preview = row.querySelector<HTMLElement>(".card__collapsed-preview")
        const rect = (el: Element | null) => el?.getBoundingClientRect()
        const titleRect = rect(title)
        const previewRect = rect(preview)
        return {
          buttonExpanded: button?.getAttribute("aria-expanded") ?? "",
          summaryRendered: Boolean(summary),
          previewInsideButton: Boolean(button && preview && button.contains(preview)),
          previewText: preview?.textContent?.trim() ?? "",
          titleBeforePreview: Boolean(titleRect && previewRect && titleRect.bottom <= previewRect.top + 1),
          previewHeight: previewRect?.height ?? 0,
          previewWidth: previewRect?.width ?? 0,
          expectedToolCommand,
        }
      },
      latestToolCommand,
    )
    assert.equal(layout.buttonExpanded, "false")
    assert.equal(layout.summaryRendered, false)
    assert.equal(layout.previewInsideButton, true)
    assert.match(layout.previewText, /^bash:/)
    assert.ok(layout.previewText.includes(layout.expectedToolCommand), JSON.stringify(layout))
    assert.equal(layout.titleBeforePreview, true)
    assert.ok(layout.previewHeight >= 16, `preview section too short: ${JSON.stringify(layout)}`)
    assert.ok(layout.previewWidth >= 280, `preview section too narrow: ${JSON.stringify(layout)}`)

    const screenshot = await saveElementScreenshot(
      page,
      '.chat-bubble-row[data-kind="agent"]',
      "agent-latest-tool-collapsed.png",
    )
    assert.ok(screenshot.endsWith("agent-latest-tool-collapsed.png"), `requests: ${requests.join("\n")}`)
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
