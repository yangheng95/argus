import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_message_card_chronological_turns"
const PROJECT_ROOT = "D:/overlay/workspace/message-card-chronological-turns"
const T0 = 1_776_000_000_000
const SCREENSHOT_TOP_PATH = resolve(".scratch", "message-card-chronological-turns-browser", "timeline-top.png")
const SCREENSHOT_BOTTOM_PATH = resolve(".scratch", "message-card-chronological-turns-browser", "timeline-bottom.png")
const SCREENSHOT_FIRST_USER_PATH = resolve(
  ".scratch",
  "message-card-chronological-turns-browser",
  "first-user-card.png",
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

function message(input: {
  id: string
  sessionID: string
  channel: string
  role: "user" | "assistant"
  resolvedRole: string
  agent: string
  created: number
  text: string
  parentSessionID?: string
}) {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      channel: input.channel,
      role: input.role,
      resolvedRole: input.resolvedRole,
      agent: input.agent,
      time: { created: input.created },
      ...(input.parentSessionID ? { parentSessionID: input.parentSessionID } : {}),
      ...(input.role === "assistant" ? { providerID: "openai", modelID: "gpt-5-mini" } : {}),
    },
    parts: [
      {
        id: `part_${input.id}`,
        messageID: input.id,
        sessionID: input.sessionID,
        type: "text",
        text: input.text,
      },
    ],
  }
}

test("message cards render as chronological message turns without same-session merging", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const task = {
    id: TASK_ID,
    title: "Message card chronological turns",
    directory: PROJECT_ROOT,
    status: "active",
    sessionID: "ses_orch",
    time: { created: T0 - 2_000, started: T0 - 1_000, updated: T0 + 900 },
  }
  const board = {
    snapshotVersion: "message-card-chronological-turns-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "assistant", status: "active" },
    overview: {
      headline: "Message card chronological turns",
      summary: "Verify cards keep per-message identity.",
      controls: {},
    },
    requirements: [],
    acceptance: null,
    interactions: [],
    goalWorkflows: [],
  }
  const transcript = [
    message({
      id: "msg_user_1",
      sessionID: "ses_coding",
      channel: "main",
      role: "user",
      resolvedRole: "user",
      agent: "coding-assistant",
      created: T0 + 100,
      text: "User turn one",
    }),
    message({
      id: "msg_assistant_1",
      sessionID: "ses_coding",
      channel: "assistant",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "coding-assistant",
      created: T0 + 200,
      text: "Coding assistant reply one",
    }),
    message({
      id: "msg_o1",
      sessionID: "ses_orch",
      channel: "assistant",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "orchestrator",
      created: T0 + 300,
      text: "Orchestrator turn one",
    }),
    message({
      id: "msg_child",
      sessionID: "ses_child",
      channel: "architect",
      role: "assistant",
      resolvedRole: "architect",
      agent: "architect",
      parentSessionID: "ses_orch",
      created: T0 + 400,
      text: "Architect child turn",
    }),
    message({
      id: "msg_o2",
      sessionID: "ses_orch",
      channel: "assistant",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "orchestrator",
      created: T0 + 500,
      text: "Orchestrator turn two",
    }),
    message({
      id: "msg_user_2",
      sessionID: "ses_coding",
      channel: "main",
      role: "user",
      resolvedRole: "user",
      agent: "coding-assistant",
      created: T0 + 600,
      text: "User turn two",
    }),
    message({
      id: "msg_assistant_2",
      sessionID: "ses_coding",
      channel: "assistant",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "coding-assistant",
      created: T0 + 700,
      text: "Coding assistant reply two",
    }),
  ]
  const sessions = [
    {
      sessionID: "ses_coding",
      stage: "user",
      messageIDs: ["msg_user_1", "msg_assistant_1", "msg_user_2", "msg_assistant_2"],
      lastDisplayMessageID: "msg_assistant_2",
      firstMessageTime: T0 + 100,
      lastMessageTime: T0 + 700,
      placement: "top_level",
    },
    {
      sessionID: "ses_orch",
      stage: "assistant",
      messageIDs: ["msg_o1", "msg_o2"],
      lastDisplayMessageID: "msg_o2",
      firstMessageTime: T0 + 300,
      lastMessageTime: T0 + 500,
      placement: "top_level",
    },
    {
      sessionID: "ses_child",
      stage: "architect",
      parentSessionID: "ses_orch",
      messageIDs: ["msg_child"],
      lastDisplayMessageID: "msg_child",
      firstMessageTime: T0 + 400,
      lastMessageTime: T0 + 400,
      placement: "top_level",
    },
  ]
  const messages = transcript.map((item) => ({
    messageID: item.info.id,
    sessionID: item.info.sessionID,
    stage: item.info.channel === "main" ? "user" : item.info.channel,
    parentSessionID: item.info.parentSessionID,
    time: item.info.time.created,
    placement: "top_level",
  }))
  const conversation = {
    lastSequence: 0,
    messageWatermark: T0 + 700,
    board,
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { sessions, messages, topLevelSessionIDs: ["ses_coding", "ses_orch", "ses_child"] },
    agentView: { sessions, messages, topLevelSessionIDs: ["ses_coding", "ses_orch", "ses_child"] },
  }

  const errors: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/global/health") return json({ version: "message-card-chronological-turns" })
    if (path === "/mission") return json([])
    if (path === "/global/projects/discover")
      return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
    if (path === "/project/current/worktrees") return json([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
    if (path === "/global/tasks" || path === "/tasks") return json({ tasks: [{ task, updated_at: T0 + 700 }] })
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
    if (path === `/task/${TASK_ID}/board`)
      return json(board, { headers: { etag: '"message-card-chronological-turns"' } })
    if (path === `/task/${TASK_ID}/conversation`) return json(conversation)
    if (path === `/task/${TASK_ID}/conversation/events`)
      return json({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${TASK_ID}/operator-model-context`)
      return json({ taskID: TASK_ID, sessionID: "ses_orch", agent: "orchestrator", model: null })
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
    await page.setViewport({ width: 1360, height: 1600 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/message-card-chronological-turns")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/message-card-chronological-turns")
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID: TASK_ID },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector(`.task-row-main[data-task-id="${TASK_ID}"]`, { visible: true, timeout: 15_000 })
    await page.click(`.task-row-main[data-task-id="${TASK_ID}"]`)

    const expectedCardIDs = [
      "user:session:ses_coding:message:msg_user_1",
      "assistant:session:ses_coding:message:msg_assistant_1",
      "assistant:session:ses_orch:message:msg_o1",
      "architect:session:ses_child:message:msg_child",
      "assistant:session:ses_orch:message:msg_o2",
      "user:session:ses_coding:message:msg_user_2",
      "assistant:session:ses_coding:message:msg_assistant_2",
    ]
    await page.waitForSelector(`[data-card-id="${expectedCardIDs.at(-1)}"]`, { visible: true, timeout: 15_000 })
    assert.deepEqual(errors, [])

    const readVisibleExpectedIDs = async () =>
      page.evaluate((ids: string[]) => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]"))
        return cards.map((card) => card.dataset.cardId || "").filter((id) => ids.includes(id))
      }, expectedCardIDs)

    const workspace = await page.$("#conversationWorkspace")
    assert.ok(workspace, "conversation workspace should exist")

    await page.$eval("#conversationWorkspace", (el: HTMLElement) => {
      el.scrollTop = 0
    })
    await page.waitForSelector(`[data-card-id="${expectedCardIDs[0]}"]`, { visible: true, timeout: 15_000 })
    const topIDs = await readVisibleExpectedIDs()
    assert.ok(topIDs.length >= 2, "top viewport should show the first chronological message cards")
    assert.deepEqual(topIDs, expectedCardIDs.slice(0, topIDs.length))
    mkdirSync(dirname(SCREENSHOT_TOP_PATH), { recursive: true })
    const firstUserCard = await page.$(`[data-card-id="${expectedCardIDs[0]}"]`)
    assert.ok(firstUserCard, "first user card should exist for element screenshot")
    writeFileSync(SCREENSHOT_FIRST_USER_PATH, await firstUserCard.screenshot({}))
    writeFileSync(SCREENSHOT_TOP_PATH, await workspace.screenshot({}))

    await page.$eval("#conversationWorkspace", (el: HTMLElement) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForSelector(`[data-card-id="${expectedCardIDs.at(-1)}"]`, { visible: true, timeout: 15_000 })
    const bottomIDs = await readVisibleExpectedIDs()
    assert.ok(bottomIDs.length >= 3, "bottom viewport should show the resumed chronological message cards")
    assert.deepEqual(bottomIDs, expectedCardIDs.slice(expectedCardIDs.length - bottomIDs.length))

    const visible = await page.evaluate((ids: string[]) => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]"))
      return ids.map((id) => {
        const element = cards.find((card) => card.dataset.cardId === id)
        const rect = element?.getBoundingClientRect()
        return {
          id,
          found: Boolean(element),
          top: rect?.top ?? -1,
          text: element?.innerText ?? "",
        }
      })
    }, expectedCardIDs)

    assert.deepEqual(bottomIDs.at(-3), "assistant:session:ses_orch:message:msg_o2")
    const visibleBottom = visible.filter((item) => item.found)
    for (let index = 1; index < visibleBottom.length; index++) {
      assert.ok(
        visibleBottom[index]!.top > visibleBottom[index - 1]!.top,
        `${visibleBottom[index]!.id} should render after ${visibleBottom[index - 1]!.id}`,
      )
    }
    assert.ok(
      visible
        .find((item) => item.id === "assistant:session:ses_orch:message:msg_o2")
        ?.text.includes("Orchestrator turn two"),
    )
    assert.ok(
      visible.find((item) => item.id === "user:session:ses_coding:message:msg_user_2")?.text.includes("User turn two"),
    )
    writeFileSync(SCREENSHOT_BOTTOM_PATH, await workspace.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})
