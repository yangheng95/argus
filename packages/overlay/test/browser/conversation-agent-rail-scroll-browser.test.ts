import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testMessageOrderKey, testPartOrderKey, testSessionOrderKey, testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_conversation_agent_rail_scroll"
const ABSORBED_SESSION_ID = "ses_agent_rail_absorbed"
const ABSORBED_FIRST_MESSAGE_ID = "msg_agent_rail_absorbed_first"
const ABSORBED_LAST_MESSAGE_ID = "msg_agent_rail_absorbed_last"
const ABSORBED_FIRST_CARD_ID = `build:session:${ABSORBED_SESSION_ID}:message:${ABSORBED_FIRST_MESSAGE_ID}`
const ABSORBED_LAST_CARD_ID = `build:session:${ABSORBED_SESSION_ID}:message:${ABSORBED_LAST_MESSAGE_ID}`
const PROJECT_ROOT = "D:/overlay/workspace/conversation-agent-rail-scroll"
const T0 = 1_776_100_000_000
const RAIL_SCREENSHOT_PATH = resolve(".scratch", "conversation-agent-rail-scroll-browser", "left-rail.png")
const TOOLTIP_SCREENSHOT_PATH = resolve(".scratch", "conversation-agent-rail-scroll-browser", "left-rail-tooltip.png")
const CHAT_PANE_SCREENSHOT_PATH = resolve(
  ".scratch",
  "conversation-agent-rail-scroll-browser",
  "chat-pane-after-locate.png",
)
const ABSORBED_CARD_SCREENSHOT_PATH = resolve(
  ".scratch",
  "conversation-agent-rail-scroll-browser",
  "absorbed-card-after-locate.png",
)

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

function absorbedMessage(messageID: string, partID: string, created: number, textValue: string) {
  return {
    info: {
      id: messageID,
      sessionID: ABSORBED_SESSION_ID,
      orderKey: testMessageOrderKey(messageID, created),
      channel: "build",
      role: "assistant",
      resolvedRole: "build",
      agent: "build",
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
        sessionID: ABSORBED_SESSION_ID,
        type: "text",
        text: textValue,
      },
    ],
  }
}

function message(index: number) {
  const stages = ["requirements", "architect", "build", "build", "visual-qa", "integrity", "build", "build"]
  const stage = stages[index % stages.length]!
  const sessionID = `ses_agent_rail_${index.toString().padStart(2, "0")}`
  const messageID = `msg_agent_rail_${index.toString().padStart(2, "0")}`
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
        text: `Agent rail left fixture turn ${index}`,
      },
    ],
  }
}

function sessionForMessage(item: ReturnType<typeof message>) {
  return {
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
    orderKey: testSessionOrderKey(item.info.sessionID, item.info.time.created),
    messageIDs: [item.info.id],
    lastDisplayMessageID: item.info.id,
    firstMessageTime: item.info.time.created,
    lastMessageTime: item.info.time.created,
    status: "completed",
    displaySummary: {
      text: `Completed ${item.info.resolvedRole} execution for ${item.info.id}.`,
      source: "session_status",
    },
    placement: "top_level",
  }
}

test("ConversationAgentRail renders left stacked history, tooltip summaries, and locate behavior", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const task = {
    id: TASK_ID,
    title: "Conversation agent rail left history",
    directory: PROJECT_ROOT,
    status: "active",
    sessionID: "ses_root",
    orderKey: testTaskOrderKey(TASK_ID, T0 - 1_000),
    time: { created: T0 - 1_000, started: T0 - 500, updated: T0 + 3_000 },
  }
  const board = {
    snapshotVersion: "conversation-agent-rail-left-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "assistant", status: "active" },
    overview: {
      headline: "Conversation agent rail left",
      summary: "Fixture board for left rail stack and tooltip validation.",
      controls: {},
    },
    requirements: [],
    acceptance: null,
    interactions: [],
    goalWorkflows: [],
  }
  const absorbedTranscript = [
    absorbedMessage(
      ABSORBED_FIRST_MESSAGE_ID,
      "part_msg_agent_rail_absorbed_first",
      T0 + 25,
      "Absorbed rail first build message.",
    ),
    absorbedMessage(
      ABSORBED_LAST_MESSAGE_ID,
      "part_msg_agent_rail_absorbed_last",
      T0 + 50,
      "Absorbed rail continuation selected by lastDisplayMessageID.",
    ),
  ]
  const scrollTranscript = Array.from({ length: 56 }, (_, index) => message(index + 1))
  const transcript = [...absorbedTranscript, ...scrollTranscript]
  const absorbedSession = {
    sessionID: ABSORBED_SESSION_ID,
    stage: "build",
    parentSessionID: "ses_root",
    orderKey: testSessionOrderKey(ABSORBED_SESSION_ID, T0 + 25),
    messageIDs: [ABSORBED_FIRST_MESSAGE_ID, ABSORBED_LAST_MESSAGE_ID],
    lastDisplayMessageID: ABSORBED_LAST_MESSAGE_ID,
    firstMessageTime: T0 + 25,
    lastMessageTime: T0 + 50,
    status: "completed",
    displaySummary: {
      text: "Completed absorbed build execution and merged continuation output.",
      source: "session_status",
    },
    placement: "top_level",
  }
  const sessions = [absorbedSession, ...scrollTranscript.map(sessionForMessage)]
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
    messageWatermark: T0 + 3_200,
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
    if (path === "/global/health") return json({ version: "conversation-agent-rail-left" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover")
      return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
    if (path === "/coding/sessions") return json({ sessions: [], nextCursor: null })
    if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: T0 + 3_000 }] })
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
    if (path === `/task/${TASK_ID}/board`) return json(board, { headers: { etag: '"conversation-agent-rail-left"' } })
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
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/conversation-agent-rail-scroll")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/conversation-agent-rail-scroll")
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
    await page.waitForSelector('.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]', {
      visible: true,
      timeout: 15_000,
    })
    errors.assertNoUnexpectedErrors()

    const geometry = await page.$eval(".conversation-agent-rail-host", (host: HTMLElement) => {
      const hostRect = host.getBoundingClientRect()
      const rail = document.querySelector<HTMLElement>(".conversation-agent-rail")
      const lanes = document.querySelector<HTMLElement>(".conversation-agent-rail__lanes")
      const scrollShell = document.querySelector<HTMLElement>(".conversation-scroll-shell")
      const chatScroll = document.querySelector<HTMLElement>("#chatScroll")
      const body = document.querySelector<HTMLElement>("#conversationBody")
      const hostStyle = getComputedStyle(host)
      const lanesStyle = lanes ? getComputedStyle(lanes) : null
      const scrollRect = scrollShell?.getBoundingClientRect()
      const chatScrollRect = chatScroll?.getBoundingClientRect()
      const bodyRect = body?.getBoundingClientRect()
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        host: {
          left: hostRect.left,
          right: hostRect.right,
          top: hostRect.top,
          bottom: hostRect.bottom,
          width: hostRect.width,
          height: hostRect.height,
          flex: hostStyle.flex,
          borderRightWidth: hostStyle.borderRightWidth,
        },
        body: {
          left: bodyRect?.left || 0,
          right: bodyRect?.right || 0,
          height: bodyRect?.height || 0,
        },
        scrollShell: {
          left: scrollRect?.left || 0,
          right: scrollRect?.right || 0,
          width: scrollRect?.width || 0,
          height: scrollRect?.height || 0,
        },
        chatScroll: {
          left: chatScrollRect?.left || 0,
          right: chatScrollRect?.right || 0,
          width: chatScrollRect?.width || 0,
          height: chatScrollRect?.height || 0,
        },
        railButtons: rail?.querySelectorAll('.oc-button[data-ui="conversation-agent-rail-locate"]').length || 0,
        lanes: lanes
          ? {
              scrollTop: lanes.scrollTop,
              scrollHeight: lanes.scrollHeight,
              scrollWidth: lanes.scrollWidth,
              clientHeight: lanes.clientHeight,
              clientWidth: lanes.clientWidth,
              overflowX: lanesStyle?.overflowX || "",
              overflowY: lanesStyle?.overflowY || "",
              flexDirection: lanesStyle?.flexDirection || "",
            }
          : null,
      }
    })
    assert.ok(geometry.host.width >= 34 && geometry.host.width <= 54, `left rail width should stay compact: ${JSON.stringify(geometry)}`)
    assert.equal(geometry.host.borderRightWidth, "0px")
    assert.ok(
      geometry.host.right <= geometry.scrollShell.left + 1,
      `left rail must sit before the message scroll shell: ${JSON.stringify(geometry)}`,
    )
    assert.ok(
      geometry.chatScroll.width < geometry.scrollShell.width,
      `message scroll lane should shrink inside the message pane: ${JSON.stringify(geometry)}`,
    )
    assert.ok(
      Math.abs(
        geometry.chatScroll.left +
          geometry.chatScroll.width / 2 -
          (geometry.scrollShell.left + geometry.scrollShell.width / 2),
      ) <= 1.5,
      `message scroll lane should stay centered inside the message pane: ${JSON.stringify(geometry)}`,
    )
    assert.ok(geometry.host.height >= geometry.scrollShell.height - 4, `left rail should fill message pane height: ${JSON.stringify(geometry)}`)
    assert.equal(geometry.lanes?.overflowX, "hidden")
    assert.equal(geometry.lanes?.overflowY, "auto")
    assert.equal(geometry.lanes?.flexDirection, "column")
    assert.ok(
      (geometry.lanes?.scrollWidth || 0) <= (geometry.lanes?.clientWidth || 0) + 1,
      `left rail lanes must not have their own x overflow: ${JSON.stringify(geometry)}`,
    )
    assert.ok(geometry.railButtons > 40, `fixture should render many rail ticks: ${JSON.stringify(geometry)}`)

    const stackGeometry = await page.$$eval(".conversation-agent-rail__stack[data-agent='build'][data-count='2']", (stacks) => {
      return stacks.map((stack) => {
        const buttons = Array.from(stack.querySelectorAll<HTMLElement>('.oc-button[data-ui="conversation-agent-rail-locate"]'))
        const centers = buttons.map((button) => {
          const rect = button.getBoundingClientRect()
          return rect.left + rect.width / 2
        })
        return {
          count: buttons.length,
          min: Math.min(...centers),
          max: Math.max(...centers),
        }
      })
    })
    assert.ok(stackGeometry.length > 0, "adjacent build sessions should render shared stack groups")
    for (const stack of stackGeometry) {
      assert.equal(stack.count, 2)
      assert.ok(stack.max - stack.min <= 1, `same-agent stack should keep one horizontal lane: ${JSON.stringify(stackGeometry)}`)
    }

    const tooltipButtonSelector =
      '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"][data-session-id="ses_agent_rail_02"]'
    await page.hover(tooltipButtonSelector)
    await page.waitForSelector(".conversation-agent-rail-tooltip", { visible: true, timeout: 15_000 })
    const tooltipText = await page.$eval(".conversation-agent-rail-tooltip", (element: HTMLElement) => element.textContent || "")
    assert.match(tooltipText, /Agent: build/)
    assert.match(tooltipText, /Status: Completed/)
    assert.match(tooltipText, /Summary: Completed build execution for msg_agent_rail_02\./)
    const tooltip = await page.$(".conversation-agent-rail-tooltip")
    assert.ok(tooltip, "agent rail tooltip should exist for screenshot review")
    mkdirSync(dirname(TOOLTIP_SCREENSHOT_PATH), { recursive: true })
    writeFileSync(TOOLTIP_SCREENSHOT_PATH, await tooltip.screenshot({}))

    const lanesScroll = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => {
      el.scrollTop = 9999
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }
    })
    assert.ok(lanesScroll.scrollHeight > lanesScroll.clientHeight, `left rail should scroll vertically when history is long: ${JSON.stringify(lanesScroll)}`)
    assert.ok(lanesScroll.scrollTop > 0, `left rail vertical scrollTop should move: ${JSON.stringify(lanesScroll)}`)

    await page.evaluate(() => {
      ;(window as any).__agentRailClickCount = 0
    })
    const absorbedLocateSelector = `.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"][data-session-id="${ABSORBED_SESSION_ID}"]`
    await page.waitForSelector(absorbedLocateSelector, { visible: true, timeout: 15_000 })
    await page.evaluate((selector: string) => {
      const button = document.querySelector<HTMLElement>(selector)
      button?.addEventListener("click", () => {
        ;(window as any).__agentRailClickCount += 1
      })
    }, absorbedLocateSelector)
    await page.click(absorbedLocateSelector)
    const clickCount = await page.evaluate(() => (window as any).__agentRailClickCount || 0)
    assert.equal(clickCount, 1, "plain click must still reach the absorbed session locate button")
    const absorbedProjection = await page.evaluate(
      (target: {
        firstCardID: string
        lastCardID: string
        lastMessageID: string
      }) => {
        const tree = (window as any).cardTree
        const first = tree?.cards?.[target.firstCardID]
        const last = tree?.cards?.[target.lastCardID]
        const parts = Array.isArray(first?.parts) ? first.parts : []
        return {
          firstCardExists: Boolean(first),
          lastCardExists: Boolean(last),
          firstCardMessageID: String(first?.messageID || ""),
          partMessageIDs: parts.map((part: any) => String(part?.messageID || "")),
        }
      },
      {
        firstCardID: ABSORBED_FIRST_CARD_ID,
        lastCardID: ABSORBED_LAST_CARD_ID,
        lastMessageID: ABSORBED_LAST_MESSAGE_ID,
      },
    )
    assert.equal(absorbedProjection.firstCardExists, true, "absorbed segment should render the first message card")
    assert.equal(absorbedProjection.lastCardExists, false, "absorbed message must not render its own card")
    assert.equal(absorbedProjection.firstCardMessageID, ABSORBED_FIRST_MESSAGE_ID)
    assert.ok(
      absorbedProjection.partMessageIDs.includes(ABSORBED_LAST_MESSAGE_ID),
      `first card should own the absorbed message part: ${JSON.stringify(absorbedProjection)}`,
    )
    const locatedCardID = ABSORBED_FIRST_CARD_ID
    await page.waitForSelector(`[data-card-id="${locatedCardID}"]`, { visible: true, timeout: 15_000 })
    await page.waitForSelector(`[data-card-id="${locatedCardID}"].conversation-agent-target--pulse`, {
      visible: true,
      timeout: 15_000,
    })
    await page.waitForFunction(
      (cardID: string) => {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardID)}"]`)
        const scroll = document.getElementById("chatScroll")
        if (!card || !scroll) return false
        const cardRect = card.getBoundingClientRect()
        const scrollRect = scroll.getBoundingClientRect()
        return cardRect.top >= scrollRect.top - 4 && cardRect.top <= scrollRect.top + 80
      },
      { timeout: 15_000 },
      locatedCardID,
    )
    const firstCardText = await page.$eval(
      `[data-card-id="${locatedCardID}"]`,
      (element: HTMLElement) => element.textContent || "",
    )
    assert.ok(
      firstCardText.includes("Absorbed rail first build message."),
      `first card should show first message text: ${JSON.stringify({ ...absorbedProjection, firstCardText })}`,
    )
    assert.ok(
      firstCardText.includes("Absorbed rail continuation selected by lastDisplayMessageID."),
      `first card should show absorbed message text: ${JSON.stringify({ ...absorbedProjection, firstCardText })}`,
    )
    assert.equal(await page.$(`[data-card-id="${ABSORBED_LAST_CARD_ID}"]`), null)
    const absorbedCard = await page.$(`[data-card-id="${locatedCardID}"]`)
    assert.ok(absorbedCard, "absorbed build card should exist for direct screenshot review")
    mkdirSync(dirname(ABSORBED_CARD_SCREENSHOT_PATH), { recursive: true })
    writeFileSync(ABSORBED_CARD_SCREENSHOT_PATH, await absorbedCard.screenshot({}))
    const chatPane = await page.$("#chatMessagePane")
    assert.ok(chatPane, "chat pane should exist for full rail/card screenshot review")
    mkdirSync(dirname(CHAT_PANE_SCREENSHOT_PATH), { recursive: true })
    writeFileSync(CHAT_PANE_SCREENSHOT_PATH, await chatPane.screenshot({}))
    const rail = await page.$(".conversation-agent-rail")
    assert.ok(rail, "agent rail should exist for screenshot review")
    mkdirSync(dirname(RAIL_SCREENSHOT_PATH), { recursive: true })
    writeFileSync(RAIL_SCREENSHOT_PATH, await rail.screenshot({}))

    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
