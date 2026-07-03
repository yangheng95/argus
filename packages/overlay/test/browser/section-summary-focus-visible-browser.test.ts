import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
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
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

test("right task-scope acceptance Section summary exposes tokenized keyboard focus", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-section-summary-focus"
  const task = {
    id: taskID,
    title: "Section summary focus",
    directory: "D:/overlay/workspace/app",
    status: "active",
    sessionID: "session-section-summary",
    time: { created: now - 90_000, started: now - 80_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "section-summary-focus-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "deliver", status: "active" },
    workflow: {
      steps: [
        { id: "requirements", label: "Requirements", status: "running" },
        { id: "architect", label: "Architect", status: "pending" },
      ],
    },
    overview: {
      headline: "Section summary focus",
      summary: "Validate keyboard focus on shared Section summary headers.",
      controls: {},
    },
    requirements: [
      {
        id: "req-focus",
        title: "Keyboard affordance",
        status: "pending",
        detail: "Section summaries must show a visible tokenized focus ring.",
      },
    ],
    goalWorkflows: [
      {
        goalID: "goal-section-focus",
        goalTitle: "Validate shared Section focus",
        goalObjective: "Keyboard users should be able to locate the focused collapsible section.",
        goalStatus: "running",
        orderIndex: 0,
        retryCount: 0,
        priority: "blocking",
        acceptanceSpecs: [],
        steps: [{ stepID: "build", label: "Build", status: "running" }],
      },
    ],
    acceptance: {
      status: "candidate",
      verdict: "accepted",
      summary: "Acceptance summary focus remains visible inside the Goals panel.",
      evidenceManifest: {
        iteration: 1,
        checkResults: [],
        reviewEvidence: [],
      },
      result: {
        summary: "No files changed.",
        changedFiles: [],
      },
    },
    interactions: [],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "section-summary-focus" })
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
        branch: "section-summary-focus",
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
    if (path === "/config/prompt-profile")
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/channel") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
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
    if (path === `/task/${taskID}/conversation`)
      return send({
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 100 },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    if (path === `/task/${taskID}/operator-model-context`)
      return send({ taskID, sessionID: "session-section-summary", agent: "orchestrator", model: null })
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
    if (path === `/task/${taskID}/transcript`) return send([])
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
    const errors: string[] = []
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
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { state: "attached", timeout: 15_000 })
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { visible: true, timeout: 15_000 })
    await page.click(`.task-row-main[data-task-id="${taskID}"]`)
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="goals"]', {
      visible: true,
      timeout: 15_000,
    })
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="goals"]')
    await page.waitForSelector('#acceptanceSection .oc-section__head', {
      visible: true,
      timeout: 15_000,
    })
    assert.deepEqual(errors, [])

    let focusState: any = null
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab")
      focusState = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        const head = active?.classList.contains("oc-section__head") ? active : null
        const style = head ? getComputedStyle(head) : null
        return {
          focusedSection: head?.parentElement?.id || "",
          focusVisible: Boolean(head?.matches(":focus-visible")),
          boxShadow: style?.boxShadow || "",
          backgroundImage: style?.backgroundImage || "",
          activeClassName: active?.className || "",
          activeTagName: active?.tagName || "",
        }
      })
      if (focusState.focusedSection) break
    }

    assert.ok(focusState?.focusedSection, `Tab should reach a Section summary: ${JSON.stringify(focusState)}`)
    assert.equal(focusState.focusVisible, true, JSON.stringify(focusState))
    await page.waitForFunction(() => {
      const head = document.activeElement as HTMLElement | null
      if (!head?.classList.contains("oc-section__head")) return false
      const boxShadow = getComputedStyle(head).boxShadow
      const spread = boxShadow.match(/0px 0px 0px ([0-9.]+)px inset/)
      return boxShadow !== "none" && spread ? Number(spread[1]) >= 0.9 : false
    })
    focusState = await page.evaluate(() => {
      const head = document.activeElement as HTMLElement | null
      const style = head ? getComputedStyle(head) : null
      return {
        focusedSection: head?.parentElement?.id || "",
        focusVisible: Boolean(head?.matches(":focus-visible")),
        boxShadow: style?.boxShadow || "",
        backgroundImage: style?.backgroundImage || "",
        activeClassName: head?.className || "",
        activeTagName: head?.tagName || "",
      }
    })
    assert.notEqual(focusState.boxShadow, "none", JSON.stringify(focusState))
    assert.doesNotMatch(focusState.boxShadow, /0px 0px 0px 0px/, JSON.stringify(focusState))
    assert.match(focusState.boxShadow, /rgba?\(|color\(/, JSON.stringify(focusState))
    assert.match(focusState.backgroundImage, /linear-gradient|none/, JSON.stringify(focusState))

    const screenshot = await saveElementScreenshot(
      page,
      '#centerWorkbenchGoals [data-ui="workflow-section-stack"]',
      "section-summary-focus-visible.png",
    )
    assert.ok(screenshot.endsWith("section-summary-focus-visible.png"))
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
