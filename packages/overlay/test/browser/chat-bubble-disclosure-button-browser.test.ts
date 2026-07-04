import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

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
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

test("ChatBubble collapsed preview is inside the Button disclosure target", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-chat-bubble-disclosure"
  const task = {
    id: taskID,
    title: "Chat bubble disclosure",
    directory: "D:/overlay/workspace/app",
    status: "active",
    sessionID: "session-root",
    time: { created: now - 90_000, started: now - 80_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "chat-bubble-disclosure-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "architect", status: "active" },
    overview: {
      headline: "Chat bubble disclosure",
      summary: "Verify preview clicks toggle the agent bubble disclosure.",
      controls: {},
    },
    requirements: [],
    acceptance: null,
    interactions: [],
  }
  const transcript = [
    {
      parts: [{ type: "text", text: "Please review the disclosure target." }],
      info: {
        id: "msg-user",
        sessionID: "session-user",
        role: "user",
        resolvedRole: "user",
        agent: "user",
        channel: "user",
        time: { created: now - 10_000 },
      },
    },
    {
      parts: [
        {
          id: "part-architect",
          type: "text",
          text: "The architecture review found that collapsed chat-bubble previews must stay inside the disclosure button so a single click on visible preview text expands the bubble.",
        },
      ],
      info: {
        id: "msg-architect",
        sessionID: "session-architect",
        role: "assistant",
        resolvedRole: "assistant",
        agent: "architect",
        channel: "analysis",
        time: { created: now - 7_000 },
      },
    },
  ]
  const terminalEvents = [
    {
      type: "session.status",
      sequence: 1,
      emittedAt: now - 6_000,
      properties: {
        sessionID: "session-architect",
        status: { type: "terminal", reason: "completed" },
      },
    },
  ]
  const conversation = {
    board,
    transcript,
    timeline: transcript,
    events: terminalEvents,
    view: {
      sessions: [
        {
          sessionID: "session-architect",
          stage: "architect",
          messageIDs: ["msg-architect"],
          firstMessageTime: now - 7_000,
          placement: "top_level",
        },
      ],
    },
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 100 },
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
    if (path === "/global/health") return send({ version: "chat-bubble-disclosure" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
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
    if (path === "/expert-squad/catalog")
      return send(generalExpertSquadCatalog())
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/channel") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
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
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { visible: true, timeout: 15_000 })
    await page.click(`.task-row-main[data-task-id="${taskID}"]`)
    await page.waitForSelector('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main', {
      visible: true,
      timeout: 15_000,
    })
    assert.deepEqual(errors, [])

    const expandedBefore = await page.$eval(
      '.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main',
      (button: HTMLButtonElement) => button.getAttribute("aria-expanded"),
    )
    assert.equal(expandedBefore, "true")

    await page.click('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main')
    await page.waitForSelector('.chat-bubble-row[data-kind="agent"] .card__collapsed-preview', {
      visible: true,
      timeout: 15_000,
    })

    const collapsedSemantics = await page.$eval('.chat-bubble-row[data-kind="agent"]', (row: HTMLElement) => {
      const button = row.querySelector<HTMLButtonElement>(".chat-bubble__head-main")
      const preview = row.querySelector<HTMLElement>(".card__collapsed-preview")
      const actions = row.querySelector<HTMLElement>(".chat-bubble__actions")
      const focusableControls = Array.from(row.querySelectorAll<HTMLElement>("button"))
      return {
        buttonTag: button?.tagName ?? "",
        buttonClass: button?.className ?? "",
        buttonVariant: button?.getAttribute("data-variant") ?? "",
        buttonSize: button?.getAttribute("data-size") ?? "",
        buttonTone: button?.getAttribute("data-tone") ?? "",
        buttonExpanded: button?.getAttribute("aria-expanded") ?? "",
        previewInsideButton: Boolean(button && preview && button.contains(preview)),
        actionsInsideButton: Boolean(button && actions && button.contains(actions)),
        siblingActionButtonCount: focusableControls.filter((control) => control !== button).length,
      }
    })
    const { siblingActionButtonCount, ...collapsedContract } = collapsedSemantics
    assert.deepEqual(collapsedContract, {
      buttonTag: "BUTTON",
      buttonClass: "oc-button chat-bubble__head-main",
      buttonVariant: "ghost",
      buttonSize: "mini",
      buttonTone: "neutral",
      buttonExpanded: "false",
      previewInsideButton: true,
      actionsInsideButton: false,
    })
    assert.ok(siblingActionButtonCount >= 1, `expected sibling action buttons, got ${siblingActionButtonCount}`)

    await page.focus('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main')
    const screenshot = await saveElementScreenshot(
      page,
      '.chat-bubble-row[data-kind="agent"]',
      "chat-bubble-disclosure-preview-click.png",
    )
    assert.ok(screenshot.endsWith("chat-bubble-disclosure-preview-click.png"))

    await page.click('.chat-bubble-row[data-kind="agent"] .card__collapsed-preview')
    await page.waitForFunction(
      () =>
        document
          .querySelector('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main')
          ?.getAttribute("aria-expanded") === "true",
    )
    assert.equal(
      await page.$eval('.chat-bubble-row[data-kind="agent"] .chat-bubble__head-main', (button: HTMLButtonElement) =>
        button.getAttribute("aria-expanded"),
      ),
      "true",
      `requests: ${requests.join("\n")}`,
    )
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
