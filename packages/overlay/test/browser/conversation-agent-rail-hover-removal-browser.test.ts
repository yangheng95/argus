import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testMessageOrderKey, testPartOrderKey, testSessionOrderKey, testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_conversation_agent_rail_hover_removed"
const PROJECT_ROOT = "D:/overlay/workspace/conversation-agent-rail-hover"
const T0 = 1_776_200_000_000
const HOVER_SCREENSHOT_PATH = resolve(".scratch", "conversation-agent-rail-hover-removal", "no-hover-pane.png")

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

function text(value: string, init?: ResponseInit) {
  return new Response(value, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
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

function message(index: number, stage: string) {
  const sessionID = `ses_agent_rail_hover_${index.toString().padStart(2, "0")}`
  const messageID = `msg_agent_rail_hover_${index.toString().padStart(2, "0")}`
  const partID = `part_${messageID}`
  const created = T0 + index * 100
  return {
    info: {
      id: messageID,
      sessionID,
      orderKey: testMessageOrderKey(messageID, created),
      channel: stage,
      role: "assistant",
      resolvedRole: stage,
      agent: stage,
      parentSessionID: "ses_root",
      time: { created },
      providerID: "openai",
      modelID: "gpt-5-mini",
    },
    parts: [
      {
        id: partID,
        orderKey: testPartOrderKey(partID, created + 1),
        messageID,
        sessionID,
        type: "text",
        text: `Agent rail hover removal fixture turn ${index}`,
      },
    ],
  }
}

function sessionForMessage(item: ReturnType<typeof message>) {
  const status = item.info.id.endsWith("_03") ? "running" : "completed"
  return {
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
    orderKey: testSessionOrderKey(item.info.sessionID, item.info.time.created),
    messageIDs: [item.info.id],
    lastDisplayMessageID: item.info.id,
    firstMessageTime: item.info.time.created,
    lastMessageTime: item.info.time.created,
    status,
    displaySummary: {
      text: `Completed ${item.info.resolvedRole} execution for ${item.info.id}.`,
      source: "session_status",
    },
    placement: "top_level",
  }
}

test("ConversationAgentRail hover does not render summary overlay or native title", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const task = {
    id: TASK_ID,
    title: "Conversation agent rail hover removed",
    directory: PROJECT_ROOT,
    status: "active",
    sessionID: "ses_root",
    orderKey: testTaskOrderKey(TASK_ID, T0 - 1_000),
    time: { created: T0 - 1_000, started: T0 - 500, updated: T0 + 600 },
  }
  const board = {
    snapshotVersion: "conversation-agent-rail-hover-removed-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "assistant", status: "active" },
    overview: {
      headline: "Conversation agent rail hover removed",
      summary: "Fixture board for rail hover removal validation.",
      controls: {},
    },
    requirements: [],
    acceptance: null,
    interactions: [],
    goalWorkflows: [],
  }
  const transcript = [
    message(1, "requirements"),
    message(2, "build"),
    message(3, "build"),
    message(4, "integrity"),
  ]
  const sessions = transcript.map(sessionForMessage)
  const messages = transcript.map((item) => ({
    messageID: item.info.id,
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
    orderKey: item.info.orderKey,
    time: item.info.time.created,
    placement: "top_level",
  }))
  const conversation = {
    lastSequence: 0,
    messageWatermark: T0 + 800,
    board,
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
    agentView: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return json({ version: "conversation-agent-rail-hover-removed" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover")
      return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
    if (path === "/coding/sessions") return json({ sessions: [], nextCursor: null })
    if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: T0 + 600 }] })
    if (path === "/work-ledger") return json({ rows: [], nextCursor: null })
    if (path === "/work-ledger/events") return eventStream()
    if (path === "/path") return json({ directory: PROJECT_ROOT })
    if (path === "/vcs")
      return json({
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
    if (path === "/provider") return json({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return json({})
    if (path === "/config/providers") return json({ providers: [], default: {} })
    if (path === "/config/prompt") return json([])
    if (path === "/expert-squad/catalog") return json(generalExpertSquadCatalog())
    if (path === "/config") return json({ model: "openai/gpt-5-mini" })
    if (path === "/channel") return json([])
    if (path === "/executor") return json([])
    if (path === "/agent") return json([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return json([])
    if (path === "/skill/mounts")
      return json({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
    if (path === "/skill/directories")
      return json({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/mcp") return json({})
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return json([])
    if (path === "/session") return json([])
    if (path === "/control/timeline") return json([])
    if (path === `/task/${TASK_ID}/board`) return json(board, { headers: { etag: '"conversation-agent-rail-hover-removed"' } })
    if (path === `/task/${TASK_ID}/conversation`) return json(conversation)
    if (path === `/task/${TASK_ID}/conversation/events`)
      return json({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${TASK_ID}/operator-model-context`)
      return json({ taskID: TASK_ID, sessionID: "ses_root", agent: "orchestrator", model: null })
    if (path === `/task/${TASK_ID}/browser-preview`)
      return json({
        taskID: TASK_ID,
        kind: "missing",
        status: "missing",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    if (path === `/task/${TASK_ID}/transcript`) return json(transcript)
    if (path === `/task/${TASK_ID}/trace`) return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace` })
    if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream()
    if (path === "/log" && req.method === "POST") return json({ ok: true })
    return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1280, height: 720 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/conversation-agent-rail-hover")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/conversation-agent-rail-hover")
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID: TASK_ID },
    )

    await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(TASK_ID)}`, { waitUntil: "load" })
    await page.waitForFunction(
      (taskID: string) =>
        (window as any).boardStore?.selectedSource?.kind === "task" &&
        (window as any).boardStore.selectedSource.id === taskID,
      { timeout: 15_000 },
      TASK_ID,
    )
    const selector =
      '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"][data-session-id="ses_agent_rail_hover_02"]'
    await page.waitForSelector(selector, { visible: true, timeout: 15_000 })
    errors.assertNoUnexpectedErrors()

    const beforeHover = await page.$eval(selector, (button: HTMLElement) => {
      const tick = button.querySelector<HTMLElement>(".conversation-agent-rail__tick-line")
      const rect = tick?.getBoundingClientRect()
      return {
        title: button.getAttribute("title"),
        ariaLabel: button.getAttribute("aria-label") || "",
        tickWidth: rect?.width || 0,
        tickHeight: rect?.height || 0,
      }
    })
    assert.equal(beforeHover.title, null)
    assert.match(beforeHover.ariaLabel, /build/)
    assert.match(beforeHover.ariaLabel, /Completed/)
    assert.match(beforeHover.ariaLabel, /Completed build execution for msg_agent_rail_hover_02\./)

    await page.hover(selector)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const afterHover = await page.$eval(selector, (button: HTMLElement) => {
      const tick = button.querySelector<HTMLElement>(".conversation-agent-rail__tick-line")
      const rect = tick?.getBoundingClientRect()
      return {
        title: button.getAttribute("title"),
        tickWidth: rect?.width || 0,
        tickHeight: rect?.height || 0,
        tooltipCount: document.querySelectorAll(".conversation-agent-rail-tooltip").length,
      }
    })
    assert.equal(afterHover.title, null)
    assert.equal(afterHover.tooltipCount, 0)
    assert.ok(
      afterHover.tickWidth > beforeHover.tickWidth + 8,
      `rail hover should stretch the active tick: ${JSON.stringify({ beforeHover, afterHover })}`,
    )
    assert.ok(
      Math.abs(afterHover.tickHeight - beforeHover.tickHeight) <= 0.5,
      `rail hover must not change tick thickness: ${JSON.stringify({ beforeHover, afterHover })}`,
    )
    const tickGeometry = await page.$$eval(".conversation-agent-rail__tick-line", (ticks) =>
      ticks.map((tick) => {
        const rect = tick.getBoundingClientRect()
        const row = tick.closest<HTMLElement>(".conversation-agent-rail__row")
        const button = row?.querySelector<HTMLElement>('.oc-button[data-ui="conversation-agent-rail-locate"]')
        return {
          sessionID: button?.dataset.sessionId || "",
          proximity: row?.dataset.proximity || "",
          status: row?.dataset.status || "",
          width: rect.width,
          height: rect.height,
        }
      }),
    )
    assert.ok(tickGeometry.length >= 4, `fixture should render multiple rail ticks: ${JSON.stringify(tickGeometry)}`)
    const heights = tickGeometry.map((tick) => tick.height)
    const bySession = new Map(tickGeometry.map((tick) => [tick.sessionID, tick]))
    const hovered = bySession.get("ses_agent_rail_hover_02")
    const previous = bySession.get("ses_agent_rail_hover_01")
    const next = bySession.get("ses_agent_rail_hover_03")
    const secondNext = bySession.get("ses_agent_rail_hover_04")
    assert.ok(hovered && previous && next && secondNext, `fixture should expose proximity rows: ${JSON.stringify(tickGeometry)}`)
    assert.equal(hovered.proximity, "0")
    assert.equal(previous.proximity, "1")
    assert.equal(next.proximity, "1")
    assert.equal(secondNext.proximity, "2")
    assert.ok(
      hovered.width > previous.width && previous.width > secondNext.width,
      `rail hover should stretch in stepped proximity: ${JSON.stringify(tickGeometry)}`,
    )
    assert.ok(
      Math.abs(previous.width - next.width) <= 0.5,
      `same proximity rows should share width even when status differs: ${JSON.stringify(tickGeometry)}`,
    )
    assert.ok(
      Math.max(...heights) - Math.min(...heights) <= 0.5,
      `rail status must not change tick thickness: ${JSON.stringify(tickGeometry)}`,
    )

    const chatPane = await page.$("#chatMessagePane")
    assert.ok(chatPane, "chat pane should exist for hover-removal screenshot review")
    mkdirSync(dirname(HOVER_SCREENSHOT_PATH), { recursive: true })
    writeFileSync(HOVER_SCREENSHOT_PATH, await chatPane.screenshot({}))

    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
