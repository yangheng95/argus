import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_conversation_agent_rail_scroll"
const PROJECT_ROOT = "D:/overlay/workspace/conversation-agent-rail-scroll"
const T0 = 1_776_100_000_000
const SCREENSHOT_PATH = resolve(".scratch", "conversation-agent-rail-scroll-browser", "rail-after-drag.png")

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

function message(index: number) {
  const stage = ["requirements", "architect", "frontend-design", "build", "visual-qa", "integrity"][index % 6]!
  const sessionID = `ses_agent_rail_${index.toString().padStart(2, "0")}`
  const messageID = `msg_agent_rail_${index.toString().padStart(2, "0")}`
  return {
    info: {
      id: messageID,
      sessionID,
      channel: stage,
      role: "assistant",
      resolvedRole: stage,
      agent: stage,
      parentSessionID: "ses_root",
      time: { created: T0 + index * 100 },
      providerID: "openai",
      modelID: "gpt-5-mini",
    },
    parts: [
      {
        id: `part_${messageID}`,
        messageID,
        sessionID,
        type: "text",
        text: `Agent rail scroll fixture turn ${index}`,
      },
    ],
  }
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
  const transcript = Array.from({ length: 56 }, (_, index) => message(index + 1))
  const sessions = transcript.map((item) => ({
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
    messageIDs: [item.info.id],
    lastDisplayMessageID: item.info.id,
    firstMessageTime: item.info.time.created,
    lastMessageTime: item.info.time.created,
    placement: "top_level",
  }))
  const messages = transcript.map((item) => ({
    messageID: item.info.id,
    sessionID: item.info.sessionID,
    stage: item.info.resolvedRole,
    parentSessionID: item.info.parentSessionID,
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
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
    agentView: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }

  const errors: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return json({ version: "conversation-agent-rail-scroll" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover") return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
    if (path === "/global/tasks" || path === "/tasks") return json({ tasks: [{ task, updated_at: T0 + 3_000 }] })
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
    if (path === "/log" && req.method === "POST") return json({ ok: true })
    return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
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

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector(`.task-row-main[data-task-id="${TASK_ID}"]`, { visible: true, timeout: 15_000 })
    await page.click(`.task-row-main[data-task-id="${TASK_ID}"]`)
    await page.waitForSelector(".conversation-agent-rail .oc-button[data-ui=\"conversation-agent-rail-locate\"]", {
      visible: true,
      timeout: 15_000,
    })
    assert.deepEqual(errors, [])

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
    assert.ok(geometry.scrollWidth > geometry.clientWidth + 120, `rail should overflow horizontally: ${JSON.stringify(geometry)}`)

    await page.evaluate(() => {
      ;(window as any).__agentRailClickCount = 0
      const button = document.querySelector<HTMLElement>(
        '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]',
      )
      button?.addEventListener("click", () => {
        ;(window as any).__agentRailClickCount += 1
      })
    })
    await page.click('.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]')
    const clickCount = await page.evaluate(() => (window as any).__agentRailClickCount || 0)
    assert.equal(clickCount, 1, "plain click must still reach the locate button")

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
            if (rect.left < railRect.left || rect.right > Math.min(railRect.right - 8, window.innerWidth - 8)) return false
            if (rect.top < 0 || rect.bottom > window.innerHeight) return false
            const hit = document.elementFromPoint(rect.x, rect.y)
            return hit instanceof Element && hit.closest('.oc-button[data-ui="conversation-agent-rail-locate"]') === rect.button
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
    const draggingDuringMove = await page.$eval(".conversation-agent-rail__lanes", (el: HTMLElement) => el.dataset.dragging)
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
  } finally {
    await browser.close()
    await server.close()
  }
})
