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

test("GoalWorkflowGroup renders through GWG selectors after goal-item residue retirement", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-goal-workflow-residue"
  const task = {
    id: taskID,
    title: "Goal workflow CSS residue",
    directory: "D:/overlay/workspace/app",
    status: "active",
    sessionID: "session-goal-workflow",
    time: { created: now - 90_000, started: now - 80_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "goal-workflow-css-residue-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "build", status: "active" },
    overview: {
      headline: "Goal workflow CSS residue",
      summary: "Validate live GWG selectors after retiring old goal item CSS.",
      controls: {},
    },
    requirements: [],
    goalWorkflows: [
      {
        goalID: "goal-auth",
        goalTitle: "Implement authentication middleware with long readable title",
        goalObjective: "Keep the goal header, objective text, and status icon readable in the right goals panel.",
        goalStatus: "running",
        orderIndex: 0,
        retryCount: 1,
        priority: "blocking",
        workspaceDir: "D:/overlay/workspace/app/.opencorvus/worktrees/goal-auth",
        workspaceBranch: "goal-auth",
        acceptanceSpecs: [
          {
            id: "auth-spec",
            title: "Authentication endpoint contract",
            scorers: [{ type: "llm_judge", criteria: "Login, refresh, and logout paths remain covered by tests." }],
          },
        ],
        steps: [{ stepID: "build", label: "Build", status: "running" }],
      },
      {
        goalID: "goal-accessibility",
        goalTitle: "Validate accessibility affordances",
        goalObjective: "Keyboard focus and hover states should stay visually consistent.",
        goalStatus: "failed",
        orderIndex: 1,
        retryCount: 0,
        priority: "advisory",
        acceptanceSpecs: [
          {
            id: "a11y-spec",
            title: "Keyboard path",
            scorers: [
              { type: "heuristic", spec: { kind: "shell", cmd: "bun test packages/overlay/test/a11y.test.ts" } },
            ],
          },
        ],
        steps: [{ stepID: "review", label: "Review", status: "failed" }],
      },
    ],
    acceptance: null,
    interactions: [],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "goal-workflow-css-residue" })
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
        branch: "goal-workflow",
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
      return send({ taskID, sessionID: "session-goal-workflow", agent: "orchestrator", model: null })
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
    await page.waitForSelector(".gwg-list", { visible: true, timeout: 15_000 })
    assert.deepEqual(errors, [])

    const state = await page.$eval(".gwg-list", (list: HTMLElement) => {
      const oldSelectors = [".goals-list", ".goal-item", ".goal-status-icon", ".goal-priority", ".goal-actions"]
      const first = list.querySelector<HTMLElement>(".gwg")
      const header = list.querySelector<HTMLButtonElement>('[data-ui="gwg-header"]')
      const statusIcon = list.querySelector<HTMLElement>(".gwg-status-icon")
      return {
        oldSelectorCount: oldSelectors.reduce((sum, selector) => sum + document.querySelectorAll(selector).length, 0),
        goalCount: list.querySelectorAll(".gwg").length,
        firstDisplay: first ? getComputedStyle(first).display : "",
        headerTagName: header?.tagName ?? "",
        headerType: header?.getAttribute("type") ?? "",
        headerClass: header?.className ?? "",
        headerVariant: header?.getAttribute("data-variant") ?? "",
        headerSize: header?.getAttribute("data-size") ?? "",
        headerTone: header?.getAttribute("data-tone") ?? "",
        headerRole: header?.getAttribute("role") ?? null,
        headerTabindex: header?.getAttribute("tabindex") ?? null,
        headerExpanded: header?.getAttribute("aria-expanded") ?? "",
        statusIconDisplay: statusIcon ? getComputedStyle(statusIcon).display : "",
      }
    })
    assert.deepEqual(state, {
      oldSelectorCount: 0,
      goalCount: 2,
      firstDisplay: "block",
      headerTagName: "BUTTON",
      headerType: "button",
      headerClass: "oc-button",
      headerVariant: "ghost",
      headerSize: "mini",
      headerTone: "neutral",
      headerRole: null,
      headerTabindex: null,
      headerExpanded: "true",
      statusIconDisplay: "flex",
    })

    await page.focus('[data-ui="gwg-header"]')
    const focusState = await page.$eval('[data-ui="gwg-header"]', (header: HTMLButtonElement) => ({
      active: document.activeElement === header,
      tagName: header.tagName,
      type: header.type,
      className: header.className,
      ariaExpanded: header.getAttribute("aria-expanded"),
    }))
    assert.deepEqual(focusState, {
      active: true,
      tagName: "BUTTON",
      type: "button",
      className: "oc-button",
      ariaExpanded: "true",
    })

    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => document.querySelector('[data-ui="gwg-header"]')?.getAttribute("aria-expanded") === "false",
    )
    assert.equal(
      await page.$eval('[data-ui="gwg-header"]', (header: HTMLButtonElement) => header.getAttribute("aria-expanded")),
      "false",
    )

    await page.keyboard.press("Space")
    await page.waitForFunction(
      () => document.querySelector('[data-ui="gwg-header"]')?.getAttribute("aria-expanded") === "true",
    )
    assert.equal(
      await page.$eval('[data-ui="gwg-header"]', (header: HTMLButtonElement) => header.getAttribute("aria-expanded")),
      "true",
    )

    const screenshot = await saveElementScreenshot(page, ".gwg-list", "goal-workflow-header-button-primitive.png")
    assert.ok(screenshot.endsWith("goal-workflow-header-button-primitive.png"))
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
