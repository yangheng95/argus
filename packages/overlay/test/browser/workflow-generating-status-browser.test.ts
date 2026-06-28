import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testMessageOrderKey, testPartOrderKey, testSessionOrderKey } from "../fixtures/timeline-order.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const testDir = dirname(fileURLToPath(import.meta.url))
const overlayRoot = resolve(testDir, "../..")
const repoRoot = resolve(overlayRoot, "../..")
const enUSMessages = JSON.parse(readFileSync(resolve(overlayRoot, "src/i18n/en-US.json"), "utf8")) as Record<
  string,
  string
>

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

function streamingMessage(input: {
  id: string
  sessionID: string
  channel: string
  resolvedRole: string
  agent: string
  created: number
  reasoning: string
  text: string
}) {
  const reasoningPartID = `prt_${input.id}_reasoning`
  const textPartID = `prt_${input.id}_text`
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      channel: input.channel,
      role: "assistant",
      resolvedRole: input.resolvedRole,
      agent: input.agent,
      orderKey: testMessageOrderKey(input.id, input.created),
      time: { created: input.created },
      providerID: "openai",
      modelID: "gpt-5-mini",
    },
    parts: [
      {
        id: `prt_${input.id}_step_start`,
        messageID: input.id,
        sessionID: input.sessionID,
        orderKey: testPartOrderKey(`prt_${input.id}_step_start`, input.created - 2),
        type: "step-start",
      },
      {
        id: reasoningPartID,
        messageID: input.id,
        sessionID: input.sessionID,
        orderKey: testPartOrderKey(reasoningPartID, input.created - 1),
        type: "reasoning",
        text: input.reasoning,
      },
      {
        id: textPartID,
        messageID: input.id,
        sessionID: input.sessionID,
        orderKey: testPartOrderKey(textPartID, input.created),
        type: "text",
        text: input.text,
      },
      {
        id: `prt_${input.id}_step_finish`,
        messageID: input.id,
        sessionID: input.sessionID,
        orderKey: testPartOrderKey(`prt_${input.id}_step_finish`, input.created + 1),
        type: "step-finish",
      },
    ],
  }
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(repoRoot, ".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

test("workflow generating panels expose live busy status regions", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-workflow-generating-status"
  const projectRoot = "D:/overlay/workspace/workflow-status"
  const task = {
    id: taskID,
    title: "Workflow generating status",
    directory: projectRoot,
    status: "active",
    sessionID: "session-workflow-generating-status",
    time: { created: now - 30_000, started: now - 25_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "workflow-generating-status-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "requirements", status: "active" },
    overview: {
      headline: "Workflow generating status",
      summary: "Exercise workflow generating live-region contracts.",
      controls: {},
    },
    workflow: {
      id: "pipeline",
      label: "Pipeline",
      steps: [
        { id: "frontend_research", label: "Frontend Research", status: "running" },
        { id: "requirements", label: "Requirements", status: "running" },
        { id: "architect", label: "Architect", status: "running" },
        { id: "build", label: "Build", status: "pending" },
      ],
    },
    requirements: [],
    goalWorkflows: [],
    interactions: [],
  }
  const transcript = [
    streamingMessage({
      id: "msg_frontend_research_stream",
      sessionID: "ses_frontend_research_stream",
      channel: "frontend-research",
      resolvedRole: "frontend-research",
      agent: "frontend-research",
      created: now - 21_000,
      reasoning: "Checking frontend evidence before requirements.",
      text: "Frontend research streaming content is visible.",
    }),
    streamingMessage({
      id: "msg_requirements_stream",
      sessionID: "ses_requirements_stream",
      channel: "requirements",
      resolvedRole: "requirements",
      agent: "requirements",
      created: now - 20_000,
      reasoning: "Separating explicit and inferred requirements.",
      text: "Requirements streaming content is visible.",
    }),
  ]
  const sessions = [
    {
      sessionID: "ses_frontend_research_stream",
      stage: "frontend-research",
      messageIDs: ["msg_frontend_research_stream"],
      lastDisplayMessageID: "msg_frontend_research_stream",
      firstMessageTime: now - 21_000,
      lastMessageTime: now - 21_000,
      placement: "top_level",
      orderKey: testSessionOrderKey("ses_frontend_research_stream", now - 21_000),
    },
    {
      sessionID: "ses_requirements_stream",
      stage: "requirements",
      messageIDs: ["msg_requirements_stream"],
      lastDisplayMessageID: "msg_requirements_stream",
      firstMessageTime: now - 20_000,
      lastMessageTime: now - 20_000,
      placement: "top_level",
      orderKey: testSessionOrderKey("ses_requirements_stream", now - 20_000),
    },
  ]
  const messages = transcript.map((item) => ({
    messageID: item.info.id,
    sessionID: item.info.sessionID,
    stage: item.info.channel,
    orderKey: item.info.orderKey,
    time: item.info.time.created,
    placement: "top_level",
  }))
  const conversation = {
    board,
    transcript,
    timeline: [],
    events: [],
    view: {
      sessions,
      messages,
      topLevelSessionIDs: sessions.map((session) => session.sessionID),
    },
    agentView: {
      sessions,
      messages,
      topLevelSessionIDs: sessions.map((session) => session.sessionID),
    },
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
    history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
    lastSequence: 0,
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "workflow-generating-status" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/mission") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: projectRoot })
    if (path === "/vcs")
      return send({
        branch: "workflow-status",
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
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
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
      return send({ taskID, sessionID: "session-workflow-generating-status", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`) return send({ target: null, verification: null })
    if (path === `/task/${taskID}/conversation/events`)
      return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send(transcript)
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace` })
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
      (seed: { serverUrl: string; taskID: string; projectRoot: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID, projectRoot },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { state: "attached", timeout: 15_000 })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]', {
      visible: true,
      timeout: 15_000,
    })
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
    const waitVisible = async (selector: string) => {
      try {
        await page.waitForSelector(selector, { visible: true, timeout: 15_000 })
      } catch (error) {
        const diagnostics = await page.evaluate(() => ({
          bodyDataset: { ...document.body.dataset },
          selectedSource: (window as any).boardStore?.selectedSource,
          activeTaskID: (window as any).boardStore?.board?.task?.id || "",
          workflowText: document.querySelector('[data-ui="workflow-section-stack"]')?.textContent?.slice(0, 1200) || "",
          sectionIDs: Array.from(document.querySelectorAll<HTMLElement>(".oc-section")).map((section) => ({
            id: section.id,
            text: section.textContent?.slice(0, 240) || "",
            display: getComputedStyle(section).display,
            visibility: getComputedStyle(section).visibility,
          })),
          pageText: document.body.innerText.slice(0, 1600),
        }))
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
            { errors, diagnostics },
            null,
            2,
          )}`,
        )
      }
    }
    await waitVisible('[data-ui="workflow-section-stack"]')
    await waitVisible("#frontendResearchSection .req-streaming-indicator")
    await waitVisible("#requirementsSection .req-streaming-indicator")
    await page.waitForSelector("#architectSection .arch-generating", { visible: true, timeout: 15_000 })
    await page.waitForSelector("#frontendResearchBadge", { visible: true, timeout: 15_000 })
    await page.waitForSelector("#statusLabel", { visible: true, timeout: 15_000 })

    const statuses = await page.evaluate(() => {
      const read = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`missing ${selector}`)
        return {
          role: node.getAttribute("role"),
          live: node.getAttribute("aria-live"),
          busy: node.getAttribute("aria-busy"),
          text: node.textContent?.trim() ?? "",
          spinner: Boolean(node.querySelector(".card__spinner")),
        }
      }
      return {
        frontendResearch: read("#frontendResearchSection .req-streaming-indicator"),
        requirements: read("#requirementsSection .req-streaming-indicator"),
        architect: read("#architectSection .arch-generating"),
        frontendResearchBadge: {
          text: document.querySelector<HTMLElement>("#frontendResearchBadge")?.textContent?.trim() ?? "",
          tone: document.querySelector<HTMLElement>("#frontendResearchBadge")?.dataset.tone ?? "",
        },
        taskHeader: document.querySelector<HTMLElement>("#statusLabel")?.textContent?.trim() ?? "",
        taskRowBadge: (() => {
          const row = document.querySelector<HTMLElement>(
            '.task-row-mini[data-task-row-id="task-workflow-generating-status"]',
          )
          const badge = row?.querySelector<HTMLElement>(".task-row-badge")
          return {
            text: badge?.querySelector<HTMLElement>(".task-row-badge-text")?.textContent?.trim() ?? "",
            ariaLabel: badge?.getAttribute("aria-label") ?? "",
            title: badge?.getAttribute("title") ?? "",
          }
        })(),
        workflowText: document.querySelector<HTMLElement>('[data-ui="workflow-section-stack"]')?.textContent || "",
        workflowStreamMessageCount: document.querySelectorAll(
          "#frontendResearchSection .req-streaming-messages, #requirementsSection .req-streaming-messages",
        ).length,
      }
    })

    assert.deepEqual(statuses.frontendResearch, {
      role: "status",
      live: "polite",
      busy: "true",
      text: enUSMessages["workflow.frontend_research_generating"],
      spinner: true,
    })
    assert.deepEqual(statuses.requirements, {
      role: "status",
      live: "polite",
      busy: "true",
      text: enUSMessages["workflow.requirements_generating"],
      spinner: true,
    })
    assert.deepEqual(statuses.architect, {
      role: "status",
      live: "polite",
      busy: "true",
      text: enUSMessages["workflow.architect_generating"],
      spinner: true,
    })
    assert.equal(statuses.frontendResearchBadge.text, enUSMessages["workflow.status.running"])
    assert.equal(statuses.frontendResearchBadge.tone, "accent")
    assert.equal(statuses.taskHeader, enUSMessages["task.status.active"])
    assert.deepEqual(statuses.taskRowBadge, {
      text: enUSMessages["task.status.active"],
      ariaLabel: enUSMessages["task.status.active"],
      title: enUSMessages["task.status.active"],
    })
    assert.notEqual(statuses.frontendResearchBadge.text, "running")
    assert.notEqual(statuses.frontendResearchBadge.text, "workflow.status.running")
    assert.notEqual(statuses.taskHeader, "active")
    assert.notEqual(statuses.taskRowBadge.text, "active")
    assert.equal(statuses.workflowStreamMessageCount, 0)
    assert.equal(statuses.workflowText.includes("Frontend research streaming content is visible."), false)
    assert.equal(statuses.workflowText.includes("Requirements streaming content is visible."), false)
    assert.equal(statuses.workflowText.includes("step-finish"), false)
    assert.deepEqual(errors, [])

    const screenshot = await saveElementScreenshot(
      page,
      ".workflow-section-stack",
      "workflow-generating-status-live.png",
    )
    assert.ok(screenshot.endsWith("workflow-generating-status-live.png"))
    const workflowBadgeScreenshot = await saveElementScreenshot(
      page,
      "#frontendResearchSection .oc-section__head",
      "workflow-running-badge-label.png",
    )
    assert.ok(workflowBadgeScreenshot.endsWith("workflow-running-badge-label.png"))
    const taskRowScreenshot = await saveElementScreenshot(
      page,
      `.task-row-mini[data-task-row-id="${taskID}"]`,
      "workflow-task-row-active-label.png",
    )
    assert.ok(taskRowScreenshot.endsWith("workflow-task-row-active-label.png"))
    const taskHeaderScreenshot = await saveElementScreenshot(
      page,
      "#taskStatus",
      "workflow-task-header-active-label.png",
    )
    assert.ok(taskHeaderScreenshot.endsWith("workflow-task-header-active-label.png"))
  } finally {
    await browser.close()
    await server.close()
  }
})
