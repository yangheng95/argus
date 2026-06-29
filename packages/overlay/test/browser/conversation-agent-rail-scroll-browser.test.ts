import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testMessageOrderKey, testPartOrderKey, testSessionOrderKey, testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_conversation_agent_rail_scroll"
const ASSISTANT_SESSION_ID = "ses_conversation_agent_rail_assistant"
const ABSORBED_SESSION_ID = "ses_agent_rail_absorbed"
const ABSORBED_FIRST_MESSAGE_ID = "msg_agent_rail_absorbed_first"
const ABSORBED_LAST_MESSAGE_ID = "msg_agent_rail_absorbed_last"
const ABSORBED_FIRST_CARD_ID = `build:session:${ABSORBED_SESSION_ID}:message:${ABSORBED_FIRST_MESSAGE_ID}`
const ABSORBED_LAST_CARD_ID = `build:session:${ABSORBED_SESSION_ID}:message:${ABSORBED_LAST_MESSAGE_ID}`
const PROJECT_ROOT = "D:/overlay/workspace/conversation-agent-rail-scroll"
const T0 = 1_776_100_000_000
const SCREENSHOT_PATH = resolve(".scratch", "conversation-agent-rail-scroll-browser", "rail-after-drag.png")
const ASSISTANT_SCREENSHOT_PATH = resolve(
  ".scratch",
  "conversation-agent-rail-scroll-browser",
  "rail-coding-assistant.png",
)
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
  const stage = ["requirements", "architect", "frontend-design", "build", "visual-qa", "integrity"][index % 6]!
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
        text: `Agent rail scroll fixture turn ${index}`,
      },
    ],
  }
}

const assistantSession = {
  id: ASSISTANT_SESSION_ID,
  kind: "coding-assistant",
  title: "Agent rail assistant",
  directory: PROJECT_ROOT,
  time: { created: T0 + 9_000, updated: T0 + 9_500 },
}

const assistantMessage = {
  info: {
    id: "msg_agent_rail_assistant",
    sessionID: ASSISTANT_SESSION_ID,
    orderKey: testMessageOrderKey("msg_agent_rail_assistant", T0 + 9_250),
    channel: "assistant",
    role: "assistant",
    resolvedRole: "assistant",
    agent: "assistant",
    time: { created: T0 + 9_250 },
    providerID: "openai",
    modelID: "gpt-5-mini",
  },
  parts: [
    {
      id: "part_msg_agent_rail_assistant",
      orderKey: testPartOrderKey("part_msg_agent_rail_assistant", T0 + 9_251),
      messageID: "msg_agent_rail_assistant",
      sessionID: ASSISTANT_SESSION_ID,
      type: "text",
      text: "Coding assistant session rail fixture message.",
    },
  ],
}

test("ConversationAgentRail keeps horizontal drag scrolling after primitive button migration", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const task = {
    id: TASK_ID,
    title: "Conversation agent rail scroll",
    directory: PROJECT_ROOT,
    status: "active",
    sessionID: "ses_root",
    orderKey: testTaskOrderKey(TASK_ID, T0 - 1_000),
    time: { created: T0 - 1_000, started: T0 - 500, updated: T0 + 3_000 },
  }
  const board = {
    snapshotVersion: "conversation-agent-rail-scroll-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "assistant", status: "active" },
    overview: {
      headline: "Conversation agent rail scroll",
      summary: "Fixture board for rail drag-scroll validation.",
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
    placement: "top_level",
  }
  const sessions = [
    absorbedSession,
    ...scrollTranscript.map((item) => ({
      sessionID: item.info.sessionID,
      stage: item.info.resolvedRole,
      parentSessionID: item.info.parentSessionID,
      orderKey: testSessionOrderKey(item.info.sessionID, item.info.time.created),
      messageIDs: [item.info.id],
      lastDisplayMessageID: item.info.id,
      firstMessageTime: item.info.time.created,
      lastMessageTime: item.info.time.created,
      placement: "top_level",
    })),
  ]
  const messages = transcript.map((item) => ({
    messageID: item.info.id,
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
    orderKey: item.info.orderKey,
    time: item.info.time.created,
    placement: "top_level",
  }))
  const agentMessages = messages.filter((item) => item.sessionID !== ABSORBED_SESSION_ID)
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
    agentView: { sessions, messages: agentMessages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }
  const assistantView = {
    sessions: [
      {
        sessionID: ASSISTANT_SESSION_ID,
        stage: "assistant",
        orderKey: testSessionOrderKey(ASSISTANT_SESSION_ID, T0 + 9_250),
        messageIDs: ["msg_agent_rail_assistant"],
        lastDisplayMessageID: "msg_agent_rail_assistant",
        firstMessageTime: T0 + 9_250,
        lastMessageTime: T0 + 9_250,
        placement: "top_level",
      },
    ],
    messages: [
      {
        messageID: "msg_agent_rail_assistant",
        sessionID: ASSISTANT_SESSION_ID,
        stage: "assistant",
        orderKey: testMessageOrderKey("msg_agent_rail_assistant", T0 + 9_250),
        time: T0 + 9_250,
        placement: "top_level",
      },
    ],
    topLevelSessionIDs: [ASSISTANT_SESSION_ID],
  }
  const assistantConversation = {
    messageWatermark: T0 + 9_500,
    board: {
      kind: "session",
      sessionID: ASSISTANT_SESSION_ID,
      status: "active",
      title: "Agent rail assistant",
      directory: PROJECT_ROOT,
    },
    transcript: [assistantMessage],
    timeline: [],
    events: [],
    view: assistantView,
    agentView: assistantView,
    history: { oldestTimestamp: T0 + 9_250, oldestMessageID: "msg_agent_rail_assistant", hasMore: false, limit: 1 },
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return json({ version: "conversation-agent-rail-scroll" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover")
      return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
    if (path === "/coding/sessions") return json({ sessions: [assistantSession], nextCursor: null })
    if (path === `/coding/session/${ASSISTANT_SESSION_ID}` && req.method === "GET")
      return json({ session: assistantSession })
    if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: T0 + 3_000 }] })
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
    if (path === "/config/prompt-profile")
      return json({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
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
    if (path === `/task/${TASK_ID}/board`) return json(board, { headers: { etag: '"conversation-agent-rail-scroll"' } })
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
    if (path === `/session/${ASSISTANT_SESSION_ID}/conversation`) return json(assistantConversation)
    if (path === `/session/${ASSISTANT_SESSION_ID}/events`) return eventStream()
    if (path === "/log" && req.method === "POST") return json({ ok: true })
    return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 520, height: 760 })
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

    const geometry = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const laneStyle = getComputedStyle(el)
      const host = document.querySelector<HTMLElement>(".conversation-agent-rail-host")
      const rail = document.querySelector<HTMLElement>(".conversation-agent-rail")
      const childLane = document.querySelector<HTMLElement>(".conversation-agent-rail__lane")
      const hostStyle = host ? getComputedStyle(host) : null
      const railStyle = rail ? getComputedStyle(rail) : null
      const childLaneStyle = childLane ? getComputedStyle(childLane) : null
      const ancestors = [
        "#chatMessagePane",
        "#chatContentFrame",
        "#chatSection",
        "#centerWorkbenchWorkflow",
        "#centerWorkbench",
        "#conversationWorkspace",
        "#workspaceMain",
      ].map((selector) => {
        const node = document.querySelector<HTMLElement>(selector)
        const box = node?.getBoundingClientRect()
        return {
          selector,
          width: Math.round(box?.width || 0),
          scrollWidth: node?.scrollWidth || 0,
          clientWidth: node?.clientWidth || 0,
          overflowX: node ? getComputedStyle(node).overflowX : "",
        }
      })
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        scrollLeft: el.scrollLeft,
        styles: {
          host: host
            ? {
                width: Math.round(host.getBoundingClientRect().width),
                flex: hostStyle?.flex,
                display: hostStyle?.display,
                maxWidth: hostStyle?.maxWidth,
                overflowX: hostStyle?.overflowX,
              }
            : null,
          rail: rail
            ? {
                width: Math.round(rail.getBoundingClientRect().width),
                flex: railStyle?.flex,
                display: railStyle?.display,
                maxWidth: railStyle?.maxWidth,
                overflowX: railStyle?.overflowX,
              }
            : null,
          lanes: {
            flex: laneStyle.flex,
            width: laneStyle.width,
            maxWidth: laneStyle.maxWidth,
            minWidth: laneStyle.minWidth,
            overflowX: laneStyle.overflowX,
          },
          childLane: childLane
            ? {
                width: Math.round(childLane.getBoundingClientRect().width),
                flex: childLaneStyle?.flex,
                maxWidth: childLaneStyle?.maxWidth,
              }
            : null,
        },
        ancestors,
      }
    })
    assert.ok(
      geometry.scrollWidth > geometry.clientWidth + 120,
      `rail should overflow horizontally: ${JSON.stringify(geometry)}`,
    )

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

    const dragStart = await page.$$eval(
      '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]',
      (buttons) => {
        const lanes = document.querySelector<HTMLElement>(".conversation-agent-rail__lanes")
        if (!lanes) return null
        const railRect = lanes.getBoundingClientRect()
        const visible = buttons
          .map((button) => {
            const rect = button.getBoundingClientRect()
            return {
              button,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            }
          })
          .filter((rect) => {
            if (rect.left < railRect.left || rect.right > Math.min(railRect.right - 8, window.innerWidth - 8))
              return false
            if (rect.top < 0 || rect.bottom > window.innerHeight) return false
            const hit = document.elementFromPoint(rect.x, rect.y)
            return (
              hit instanceof Element &&
              hit.closest('.oc-button[data-ui="conversation-agent-rail-locate"]') === rect.button
            )
          })
        const target = visible.at(-1)
        return target ? { x: target.x, y: target.y } : null
      },
    )
    assert.ok(dragStart, "drag must start on a visible rail locate button")
    const startX = Math.round(dragStart.x)
    const y = Math.round(dragStart.y)
    await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => {
      el.scrollLeft = 0
      delete el.dataset.dragging
    })
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    await page.mouse.move(startX - 64, Math.round(geometry.top - 32))
    const escapeDragDuringMove = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => ({
      scrollLeft: el.scrollLeft,
      dragging: el.dataset.dragging || "",
    }))
    await page.mouse.up()
    const escapeDragAfter = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => ({
      scrollLeft: el.scrollLeft,
      dragging: el.dataset.dragging || "",
    }))
    assert.equal(
      escapeDragDuringMove.dragging,
      "true",
      `first move outside rail must still set data-dragging: ${JSON.stringify(escapeDragDuringMove)}`,
    )
    assert.ok(
      escapeDragDuringMove.scrollLeft > 20,
      `first move outside rail must still scroll: ${JSON.stringify(escapeDragDuringMove)}`,
    )
    assert.equal(escapeDragAfter.dragging, "", "escape drag must clear data-dragging after pointerup")

    await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => {
      el.scrollLeft = 0
      delete el.dataset.dragging
    })
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX - 18, y)
    const draggingDuringMove = await page.$eval(
      ".conversation-agent-rail__lanes",
      (el: HTMLElement) => el.dataset.dragging,
    )
    await page.mouse.move(startX - 260, y)
    await page.mouse.up()

    const afterDrag = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => ({
      scrollLeft: el.scrollLeft,
      dragging: el.dataset.dragging || "",
    }))
    assert.equal(draggingDuringMove, "true", "drag must set data-dragging while active")
    assert.equal(afterDrag.dragging, "", "drag must clear data-dragging after pointerup")
    assert.ok(afterDrag.scrollLeft > 80, `drag should move the rail horizontally: ${JSON.stringify(afterDrag)}`)

    const rail = await page.$(".conversation-agent-rail")
    assert.ok(rail, "agent rail should exist for screenshot review")
    mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
    writeFileSync(SCREENSHOT_PATH, await rail.screenshot({}))

    await page.click('.oc-button[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
    await page.waitForSelector(`[data-ui="coding-assistant-row"][data-session-id="${ASSISTANT_SESSION_ID}"]`, {
      visible: true,
      timeout: 15_000,
    })
    await page.waitForSelector(
      `[data-ui="coding-assistant-row"][data-session-id="${ASSISTANT_SESSION_ID}"][data-active="true"]`,
      {
        visible: true,
        timeout: 15_000,
      },
    )
    await page.waitForFunction(
      () => {
        const rail = document.querySelector<HTMLElement>(".conversation-agent-rail")
        if (!rail) return false
        const rect = rail.getBoundingClientRect()
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rail.querySelectorAll('.oc-button[data-ui="conversation-agent-rail-locate"]').length > 0
        )
      },
      { timeout: 15_000 },
    )
    const assistantRailState = await page.$eval(".conversation-agent-rail", (el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const ancestors = [
        ".conversation-agent-rail-host",
        "#chatMessagePane",
        "#chatContentFrame",
        "#chatSection",
        "#centerWorkbenchWorkflow",
        "#centerWorkbench",
        "#conversationWorkspace",
        "#workspaceMain",
      ].map((selector) => {
        const node = document.querySelector<HTMLElement>(selector)
        const box = node?.getBoundingClientRect()
        const style = node ? getComputedStyle(node) : null
        return {
          selector,
          dataOpen: node?.dataset.open || "",
          dataActive: node?.dataset.active || "",
          dataWorkbenchView: node?.dataset.workbenchView || "",
          display: style?.display || "",
          overflowX: style?.overflowX || "",
          overflowY: style?.overflowY || "",
          width: Math.round(box?.width || 0),
          height: Math.round(box?.height || 0),
        }
      })
      return {
        buttons: el.querySelectorAll('.oc-button[data-ui="conversation-agent-rail-locate"]').length,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        ancestors,
      }
    })
    assert.ok(
      assistantRailState.buttons > 0,
      `coding assistant rail should have buttons: ${JSON.stringify(assistantRailState)}`,
    )
    assert.ok(
      assistantRailState.width > 0 && assistantRailState.height > 0,
      `coding assistant rail should be visible: ${JSON.stringify(assistantRailState)}`,
    )
    errors.assertNoUnexpectedErrors()
    const assistantRail = await page.$(".conversation-agent-rail")
    assert.ok(assistantRail, "coding assistant agent rail should exist for screenshot review")
    writeFileSync(ASSISTANT_SCREENSHOT_PATH, await assistantRail.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})
