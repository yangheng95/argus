import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import sharp from "sharp"

import { SCREENSHOT_BROWSER_THUMBNAIL_VARIANT } from "@opencorvus-ai/transport-protocol"
import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import {
  testMessageOrderKey,
  testPartOrderKey,
  testSessionOrderKey,
  testTaskOrderKey,
} from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_overlay_global_pressure"
const ROOT_SESSION_ID = "ses_overlay_global_pressure_root"
const PROJECT_ROOT = "D:/overlay/workspace/global-pressure"
const BASE_TIME = 1_776_400_000_000
const TASK_COUNT = 160
const TRANSCRIPT_MESSAGES = 180
const SCREENSHOT_ITEMS = 80
const FILE_ROOT_ROWS = 180
const SKILL_COUNT = 24
const AGENT_COUNT = 8
const SCREENSHOT_PATH = resolve(".scratch", "overlay-global-live-pressure.png")

const PERF_LIMITS = {
  maxRafGapMs: 120,
  maxLongTaskMs: 160,
  maxLongTaskCount: 8,
  mountedConversationCards: 100,
  screenshotCards: 36,
  fileRows: 70,
  screenshotAttachmentRequests: 48,
  retiredLiveRouteRequests: 0,
  fileListRequests: 4,
  fileSearchRequests: 2,
}

type SseClient = {
  path: string
  controller: ReadableStreamDefaultController<Uint8Array>
  closed: boolean
}

type InteractionPerf = {
  label: string
  elapsedMs: number
  longTaskCount: number
  maxLongTaskMs: number
  maxRafGapMs: number
}

type RequestLog = {
  method: string
  path: string
  search: string
}

type NativeCommandRecord = {
  command: string
  args: Record<string, unknown>
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function text(value: string, init?: ResponseInit): Response {
  return new Response(value, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function eventStream(clients: SseClient[], path: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients.push({ path, controller, closed: false })
      controller.enqueue(encoder.encode(":\n\n"))
    },
    cancel() {
      const client = clients.find((item) => item.path === path && !item.closed)
      if (client) client.closed = true
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

function closeStreams(clients: SseClient[]): void {
  for (const client of clients) {
    if (client.closed) continue
    client.closed = true
    try {
      client.controller.close()
    } catch {}
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    }
    return entities[char] ?? char
  })
}

async function pngBytes(label: string, width: number, height: number, colors: [string, string]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset="1" stop-color="${colors[1]}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.07)}" width="${Math.round(width * 0.9)}" height="${Math.round(height * 0.22)}" rx="8" fill="rgba(255,255,255,.88)"/>
    <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.2)}" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.045)}" font-weight="700" fill="#0f172a">${escapeXml(label)}</text>
    <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.42)}" width="${Math.round(width * 0.22)}" height="${Math.round(height * 0.26)}" rx="6" fill="rgba(15,23,42,.78)"/>
    <rect x="${Math.round(width * 0.39)}" y="${Math.round(height * 0.42)}" width="${Math.round(width * 0.22)}" height="${Math.round(height * 0.26)}" rx="6" fill="rgba(255,255,255,.7)"/>
    <rect x="${Math.round(width * 0.7)}" y="${Math.round(height * 0.42)}" width="${Math.round(width * 0.22)}" height="${Math.round(height * 0.26)}" rx="6" fill="rgba(22,163,74,.74)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function taskItem(index: number): any {
  const selected = index === 0
  const id = selected ? TASK_ID : `tsk_overlay_global_pressure_${String(index).padStart(3, "0")}`
  const created = BASE_TIME - index * 1_000
  return {
    updated_at: BASE_TIME + TASK_COUNT - index,
    pending_interactions: 0,
    overview: {
      headline: selected ? "Global overlay pressure selected task" : `Global pressure queued task ${index}`,
      summary: "Fixture row used by the global live-pressure benchmark.",
    },
    task: {
      id,
      requestID: `req-overlay-global-pressure-${index}`,
      title: selected ? "Global overlay pressure selected task" : `Global pressure queued task ${index}`,
      request: `Exercise overlay surfaces under combined GUI pressure ${index}. ${"request detail ".repeat(18)}`,
      directory: PROJECT_ROOT,
      status: selected ? "completed" : "queued",
      priority: "normal",
      sessionID: selected ? ROOT_SESSION_ID : `ses_overlay_global_pressure_${String(index).padStart(3, "0")}`,
      orderKey: testTaskOrderKey(id, created),
      time: selected
        ? { created, updated: created + 30_000, completed: created + 30_000 }
        : { created, updated: created + 10_000 },
      queue: { order: index, revision: "global-pressure" },
    },
  }
}

function board(task = taskItem(0).task): any {
  return {
    snapshotVersion: "overlay-global-pressure-board",
    lastSequence: 40,
    task,
    overview: {
      headline: "Global overlay pressure selected task",
      summary: "Conversation, workflow, task list, preview, screenshots, files, and settings are all exercised.",
      controls: {},
    },
    workflow: {
      steps: [
        { id: "requirements", status: "completed" },
        { id: "architect", status: "completed" },
        { id: "build", status: "completed" },
        { id: "visual-qa", status: "completed" },
      ],
    },
    requirements: [],
    goalWorkflows: [],
    interactions: [],
  }
}

function stageForIndex(index: number): string {
  const stages = ["requirements", "architect", "build", "frontend-research", "visual-qa", "integrity"]
  return stages[index % stages.length]!
}

function markdownBody(index: number): string {
  return [
    `### Global pressure transcript ${index}`,
    "",
    `Completed assistant output ${index} with **markdown**, a [reference](https://example.test/global/${index}), and enough copy to create real card height.`,
    "",
    "- Verified conversation virtualization remains bounded.",
    "- Verified workflow text is not duplicated into the inspector body.",
    "- Verified inactive panels do not own avoidable DOM work.",
    "",
    "| Surface | Result |",
    "| --- | --- |",
    `| Conversation | ${"content ".repeat(8)} |`,
    `| Preview | ${"event ".repeat(8)} |`,
    "",
    "```ts",
    `export const globalPressure${index} = ${index}`,
    "```",
    "",
    `Tail paragraph ${index}. ${"completed text ".repeat(16)}`,
  ].join("\n")
}

function transcriptMessage(index: number): any {
  const time = BASE_TIME + 100 + index * 50
  const sessionID = `ses_overlay_global_pressure_agent_${String(index).padStart(3, "0")}`
  const messageID = `msg_overlay_global_pressure_${String(index).padStart(3, "0")}`
  const textPartID = `part_overlay_global_pressure_text_${String(index).padStart(3, "0")}`
  const stage = stageForIndex(index)
  const parts: any[] = [
    {
      id: textPartID,
      messageID,
      sessionID,
      orderKey: testPartOrderKey(textPartID, time + 1),
      type: "text",
      resolvedRole: stage,
      channel: stage,
      text: markdownBody(index),
    },
  ]
  if (index < SCREENSHOT_ITEMS) {
    const screenshotPartID = `part_overlay_global_pressure_screenshot_${String(index).padStart(3, "0")}`
    parts.push({
      id: screenshotPartID,
      messageID,
      sessionID,
      orderKey: testPartOrderKey(screenshotPartID, time + 2),
      type: "tool",
      tool: "browser_observe",
      state: {
        status: "completed",
        time: { start: time + 2, end: time + 10 },
        metadata: {
          browser: {
            url: `https://example.test/global-pressure/${index}`,
            title: `global-pressure-${index}.png`,
            viewport: { width: 1440, height: 900 },
            screenshot: { attachmentUrl: `/attachment/project/global-pressure-${index}.png` },
          },
        },
      },
    })
  }
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      resolvedRole: stage,
      channel: stage,
      agent: stage,
      parentSessionID: ROOT_SESSION_ID,
      orderKey: testMessageOrderKey(messageID, time),
      time: { created: time, completed: time + 12 },
    },
    parts,
  }
}

function conversationPayload(transcript: any[], task = taskItem(0).task): any {
  const sessions = transcript.map((message) => ({
    sessionID: message.info.sessionID,
    stage: message.info.channel,
    parentSessionID: message.info.parentSessionID,
    messageIDs: [message.info.id],
    lastDisplayMessageID: message.info.id,
    firstMessageTime: message.info.time.created,
    lastMessageTime: message.info.time.created,
    firstObservedAt: message.info.time.created,
    lastObservedAt: message.info.time.completed,
    status: "completed",
    placement: "top_level",
    orderKey: testSessionOrderKey(message.info.sessionID, message.info.time.created),
  }))
  const messages = transcript.map((message) => ({
    messageID: message.info.id,
    sessionID: message.info.sessionID,
    stage: message.info.channel,
    parentSessionID: message.info.parentSessionID,
    time: message.info.time.created,
    orderKey: message.info.orderKey,
    placement: "top_level",
  }))
  return {
    lastSequence: 40,
    messageWatermark: 40,
    board: board(task),
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 40, latestSequence: 40, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 260 },
    view: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
    agentView: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }
}

function fileNodes(path: string): any[] {
  if (path === "") {
    return Array.from({ length: FILE_ROOT_ROWS }, (_, index) => ({
      name: index % 5 === 0 ? `feature-${String(index).padStart(3, "0")}` : `component-${String(index).padStart(3, "0")}.tsx`,
      path: index % 5 === 0 ? `src/feature-${String(index).padStart(3, "0")}` : `src/component-${String(index).padStart(3, "0")}.tsx`,
      type: index % 5 === 0 ? "directory" : "file",
      ignored: false,
    }))
  }
  return Array.from({ length: 18 }, (_, index) => ({
    name: `nested-${String(index).padStart(2, "0")}.ts`,
    path: `${path}/nested-${String(index).padStart(2, "0")}.ts`,
    type: "file",
    ignored: false,
  }))
}

function fileSearchResults(query: string): string[] {
  const normalized = query.toLowerCase()
  return Array.from({ length: 28 }, (_, index) => `src/component-${String(index + 100).padStart(3, "0")}.tsx`).filter(
    (path) => path.toLowerCase().includes(normalized) || normalized.includes("component"),
  )
}

function skillMountMatrix(): any {
  const agents = Array.from({ length: AGENT_COUNT }, (_, index) => ({
    name: ["coding-assistant", "requirements", "architect", "build", "frontend-research", "visual-qa", "integrity", "research"][
      index
    ],
    description: `Agent ${index}`,
    mode: index < 2 ? "primary" : "subagent",
    hidden: false,
    native: true,
    skill_mountable: true,
    skill_tool_available: true,
  }))
  const skills = Array.from({ length: SKILL_COUNT }, (_, index) => ({
    name: `pressure-skill-${String(index).padStart(2, "0")}`,
    description: `Skill row ${index} for global overlay pressure.`,
    location: `${PROJECT_ROOT}/.opencorvus/skills/pressure-skill-${String(index).padStart(2, "0")}/SKILL.md`,
    source_type: "config_path",
    source: `${PROJECT_ROOT}/.opencorvus/skills/pressure-skill-${String(index).padStart(2, "0")}`,
    mounted_agents: agents.filter((_agent, agentIndex) => (agentIndex + index) % 5 === 0).map((agent) => agent.name),
    unmounted: index % 7 === 0,
    warning: index % 7 === 0 ? "unmounted" : undefined,
  }))
  return {
    scope: "project",
    skills,
    agents,
    matrix: agents.map((agent, agentIndex) => ({
      agent: agent.name,
      mounted: skills
        .filter((_skill, skillIndex) => (agentIndex + skillIndex) % 5 === 0)
        .map((skill, skillIndex) => ({
          name: skill.name,
          description: skill.description,
          location: skill.location,
          enabled: skillIndex % 6 !== 0,
          reason: skillIndex % 6 === 0 ? "policy_disabled" : undefined,
        })),
    })),
    project_mounts: {
      agents: Object.fromEntries(agents.map((agent) => [agent.name, skills.slice(0, 3).map((skill) => skill.name)])),
    },
    unmounted_count: skills.filter((skill) => skill.unmounted).length,
  }
}

function mcpPayload(): any {
  return Object.fromEntries(
    Array.from({ length: 18 }, (_, index) => [
      `mcp-pressure-${String(index).padStart(2, "0")}`,
      { status: index % 3 === 0 ? "connected" : index % 3 === 1 ? "disconnected" : "needs_auth" },
    ]),
  )
}

function expertSquadCatalog(): any {
  return generalExpertSquadCatalog()
}

async function waitForPageState(
  page: any,
  predicate: () => boolean,
  label: string,
  diagnostics: () => unknown,
): Promise<void> {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    if (await page.evaluate(predicate)) return
    const signature = JSON.stringify(
      await page.evaluate(() => ({
        bodyText: document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 600) ?? "",
        activeLeft: document.querySelector<HTMLElement>("[id^='leftPanel'][data-active='true']")?.id ?? "",
        openPanels: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']")).map(
          (node) => node.id,
        ),
        dialogOpen: !!document.querySelector("#configDialog"),
      })),
    )
    const externalSignature = JSON.stringify(diagnostics())
    const combinedSignature = `${signature}\n${externalSignature}`
    if (combinedSignature !== previousSignature) {
      previousSignature = combinedSignature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No page activity while waiting for ${label}\n${combinedSignature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function assertInteraction(metric: InteractionPerf): void {
  assert.ok(metric.maxRafGapMs <= PERF_LIMITS.maxRafGapMs, `${metric.label} maxRafGapMs=${metric.maxRafGapMs}`)
  assert.ok(metric.maxLongTaskMs <= PERF_LIMITS.maxLongTaskMs, `${metric.label} maxLongTaskMs=${metric.maxLongTaskMs}`)
  assert.ok(
    metric.longTaskCount <= PERF_LIMITS.maxLongTaskCount,
    `${metric.label} longTaskCount=${metric.longTaskCount}`,
  )
}

function requestCount(requests: RequestLog[], predicate: (entry: RequestLog) => boolean): number {
  return requests.filter(predicate).length
}

test(
  "overlay global GUI surfaces stay responsive under combined live pressure",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const tasks = Array.from({ length: TASK_COUNT }, (_, index) => taskItem(index))
    const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
    const transcript = Array.from({ length: TRANSCRIPT_MESSAGES }, (_item, index) => transcriptMessage(index))
    const conversation = conversationPayload(transcript)
    const clients: SseClient[] = []
    const requests: RequestLog[] = []
    const screenshotPngs = new Map<string, Buffer>()
    const screenshotBytes = async (index: number, thumbnail: boolean) => {
      const key = `${index}:${thumbnail ? "thumb" : "full"}`
      const cached = screenshotPngs.get(key)
      if (cached) return cached
      const bytes = await pngBytes(
        `global screenshot ${index}`,
        thumbnail ? 360 : 1440,
        thumbnail ? 225 : 900,
        index % 2 === 0 ? ["#4338ca", "#0f766e"] : ["#7c2d12", "#15803d"],
      )
      screenshotPngs.set(key, bytes)
      return bytes
    }
    let serverOrigin = ""
    const previewUrl = () => `${serverOrigin}/preview/global-pressure`
    const mountMatrix = skillMountMatrix()
    const mcp = mcpPayload()

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requests.push({ method: req.method, path, search: url.search })
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/preview/global-pressure") {
        return text("<main>Global pressure preview target</main>", { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      const screenshotMatch = /^\/attachment\/project\/global-pressure-(\d+)\.png$/.exec(path)
      if (screenshotMatch) {
        const index = Number.parseInt(screenshotMatch[1]!, 10)
        const thumbnail = url.searchParams.get("variant") === SCREENSHOT_BROWSER_THUMBNAIL_VARIANT
        if (url.search && !thumbnail) return json({ error: "unknown screenshot variant" }, { status: 404 })
        return new Response(await screenshotBytes(index, thumbnail), { headers: { "content-type": "image/png" } })
      }
      if (path === "/global/health") return json({ version: "global-pressure-test" })
      if (path === "/global/projects/discover") return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
      if (path === "/project/current/worktrees") return json([])
      if (path === "/global/tasks") return json({ tasks })
      if (path === "/path") return json({ directory: PROJECT_ROOT, exists: true, git: true })
      if (path === "/vcs") return json({ branch: "main", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/config") return json({ model: "openai/gpt-5-mini", directory: PROJECT_ROOT, assistant: { max_executor_groups: 3 }, mcp: {} })
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config/prompt" || path === "/expert-squad/catalog") return json(expertSquadCatalog())
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/channel") return json([])
      if (path === "/channel/runtime") return json({ status: "disabled", channels: [] })
      if (path === "/executor") return json([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
      if (path === "/agent") return json([])
      if (path === "/mission" || path === "/session") return json([])
      if (path === "/coding/sessions") return json({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json({ profiles: [] })
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return json([])
      if (path === "/log") return req.method === "POST" ? json({ ok: true }) : json({})
      if (path === "/log/tail") return json({ path: "D:/overlay/logs/server.log", lines: [] })
      if (path === "/skill/mounts") return json(mountMatrix)
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return json([])
      if (path === "/skill/directories") return json({ global_config: `${PROJECT_ROOT}/.opencorvus`, managed_skills: `${PROJECT_ROOT}/.opencorvus/skills-market`, remote_cache: `${PROJECT_ROOT}/.opencorvus/skill-cache` })
      if (path === "/mcp") return json(mcp)
      if (path === "/file") return json(fileNodes(url.searchParams.get("path") || ""))
      if (path === "/find/file") return json(fileSearchResults(url.searchParams.get("query") || ""))
      if (path === `/task/${TASK_ID}/board`) return json(board(tasks[0]!.task), { headers: { etag: '"global-pressure-board"' } })
      if (path === `/task/${TASK_ID}/conversation`) return json(conversation)
      if (path === `/task/${TASK_ID}/transcript`) return json(transcript)
      if (path === `/task/${TASK_ID}/conversation/events`)
        return json({ events: [], eventReplay: { cursor: 40, latestSequence: 40, complete: true, limit: 500 } })
      if (path === `/task/${TASK_ID}/trace`) return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace`, enabled: true })
      if (path === `/task/${TASK_ID}/operator-model-context`) return json({ selected: null, candidates: [] })
      if (path === `/task/${TASK_ID}/browser-preview`) {
        return json({
          id: "art_global_pressure_preview",
          taskID: TASK_ID,
          latestEvidenceIDs: {},
          kind: "task-url",
          status: "ready",
          projectRoot: PROJECT_ROOT,
          url: previewUrl(),
          viewports: [{ id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 }],
          diagnostics: ["Resolved global pressure preview target."],
          candidates: [{ id: "art_global_pressure_preview", url: previewUrl(), source: "task-artifact", selected: true, timeUpdated: BASE_TIME }],
          source: "task-artifact",
        })
      }
      if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream(clients, path)
      const taskBoardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
      if (taskBoardMatch) {
        const item = tasksByID.get(decodeURIComponent(taskBoardMatch[1]!))
        return item ? json(board(item.task)) : json({ error: "missing task" }, { status: 404 })
      }
      const taskConversationMatch = /^\/task\/([^/]+)\/conversation$/.exec(path)
      if (taskConversationMatch) {
        const id = decodeURIComponent(taskConversationMatch[1]!)
        const item = tasksByID.get(id)
        return json(conversationPayload([], item?.task ?? tasks[0]!.task))
      }
      if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) return json({ selected: null, candidates: [] })
      if (/^\/task\/[^/]+\/browser-preview$/.test(path)) return json({ taskID: path.split("/")[2], kind: "missing", status: "missing", projectRoot: PROJECT_ROOT, viewports: [], diagnostics: [], candidates: [], source: "none" })
      if (/^\/task\/[^/]+\/events$/.test(path)) return eventStream(clients, path)
      return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
    })
    serverOrigin = server.origin

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const expectedAborts: string[] = []
      const errors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          if (failure.errorText !== "net::ERR_ABORTED") return false
          if (/^\/task(?:\/[^/]+)?\/events(?:\?.*)?$/.test(failure.pathWithSearch)) {
            expectedAborts.push(failure.pathWithSearch)
            return true
          }
          if (/^\/attachment\/project\/global-pressure-\d+\.png\?variant=screenshot-browser-thumbnail$/.test(failure.pathWithSearch)) {
            expectedAborts.push(failure.pathWithSearch)
            return true
          }
          return false
        },
      })
      await page.setViewport({ width: 1920, height: 1080 })
      await page.evaluateOnNewDocument((origin) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/global-pressure")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/global-pressure")
        localStorage.setItem("oc_workspace_task", "tsk_overlay_global_pressure")
        const settings = {
          serverUrl: origin,
          autoServer: false,
          locale: "en-US",
          theme: "light",
          directory: "D:/overlay/workspace/global-pressure",
          workspaceDirectory: "D:/overlay/workspace/global-pressure",
          workspaceTaskID: "tsk_overlay_global_pressure",
        }
        const nativeCommands: NativeCommandRecord[] = []
        ;(window as any).__browserPreviewNativeCommands = nativeCommands
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") return settings
              if (command === "overlay_settings_save") {
                Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                return true
              }
              if (command === "overlay_open_path" || command === "overlay_open_url") return true
              if (command.startsWith("overlay_browser_preview_")) {
                nativeCommands.push({ command, args })
                return true
              }
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                hide: async () => undefined,
                minimize: async () => undefined,
                startDragging: async () => undefined,
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForPageState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "online connection",
        () => ({ requests: requests.length }),
      )
      await waitForPageState(
        page,
        () => document.querySelector(".chat-scroll")?.textContent?.includes("Global pressure transcript") ?? false,
        "selected task transcript hydration",
        () => ({ requests: requests.slice(-8) }),
      )
      await waitForPageState(
        page,
        () => (window as any).__ocMarkdownRenderPrewarmPending === undefined || (window as any).__ocMarkdownRenderPrewarmPending === 0,
        "markdown prewarm",
        () => ({ requests: requests.slice(-8) }),
      )

      await page.evaluate(() => {
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
        const waitFor = async (label: string, predicate: () => boolean) => {
          let previousSignature = ""
          let lastActivity = performance.now()
          for (;;) {
            if (predicate()) return
            const signature = JSON.stringify({
              openPanels: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']")).map(
                (node) => node.id,
              ),
              activeLeft: document.querySelector<HTMLElement>("[id^='leftPanel'][data-active='true']")?.id ?? "",
              rows:
                document.querySelectorAll(".task-row-main[data-task-id]").length +
                document.querySelectorAll(".file-explorer-row").length +
                document.querySelectorAll(".screenshot-browser-card").length,
              text: document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "",
            })
            if (signature !== previousSignature) {
              previousSignature = signature
              lastActivity = performance.now()
            }
            if (performance.now() - lastActivity > 6_000) throw new Error(`No page activity while waiting for ${label}: ${signature}`)
            await sleep(32)
          }
        }
        ;(window as any).__ocGlobalStartProbe = (label: string) => {
          const longTasks: number[] = []
          const rafGaps: number[] = []
          let observer: PerformanceObserver | undefined
          let rafID = 0
          let sampling = true
          let previousFrame = performance.now()
          const tick = (time: number) => {
            if (!sampling) return
            rafGaps.push(time - previousFrame)
            previousFrame = time
            rafID = requestAnimationFrame(tick)
          }
          if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) longTasks.push(entry.duration)
            })
            observer.observe({ entryTypes: ["longtask"] })
          }
          rafID = requestAnimationFrame(tick)
          ;(window as any).__ocGlobalActiveProbe = {
            clearBaseline: async () => {
              await frame()
              rafGaps.length = 0
              previousFrame = performance.now()
            },
            label,
            longTasks,
            rafGaps,
            rafID: () => rafID,
            start: performance.now(),
            stop: async (): Promise<InteractionPerf> => {
              await frame()
              await frame()
              const elapsedMs = performance.now() - (window as any).__ocGlobalActiveProbe.start
              sampling = false
              cancelAnimationFrame(rafID)
              observer?.disconnect()
              return {
                label,
                elapsedMs,
                longTaskCount: longTasks.length,
                maxLongTaskMs: Math.max(0, ...longTasks),
                maxRafGapMs: Math.max(0, ...rafGaps),
              }
            },
          }
        }
        ;(window as any).__ocGlobalMeasure = async (
          label: string,
          action: () => Promise<void>,
        ): Promise<InteractionPerf> => {
          ;(window as any).__ocGlobalStartProbe(label)
          await (window as any).__ocGlobalActiveProbe.clearBaseline()
          ;(window as any).__ocGlobalActiveProbe.start = performance.now()
          await action()
          return await (window as any).__ocGlobalActiveProbe.stop()
        }
        ;(window as any).__ocGlobalWaitFor = waitFor
      })

      const metrics: InteractionPerf[] = []
      const measure = async (label: string, action: () => Promise<void>) => {
        if (label === "open settings menu") {
          await page.evaluate((metricLabel) => {
            ;(window as any).__ocGlobalStartProbe(metricLabel)
          }, label)
          await page.evaluate(async () => {
            await (window as any).__ocGlobalActiveProbe.clearBaseline()
            ;(window as any).__ocGlobalActiveProbe.start = performance.now()
          })
          await page.click('[data-menu-trigger="settings"]')
          await waitForPageState(
            page,
            () => !!document.querySelector('[data-testid="titlebar-settings-skill"]'),
            "settings skill menu item",
            () => ({ requests: requests.slice(-8) }),
          )
          const metric = await page.evaluate(async () => await (window as any).__ocGlobalActiveProbe.stop())
          metrics.push(metric)
          await action()
          return
        }
        if (label === "open settings skill dialog shell") {
          await page.evaluate((metricLabel) => {
            ;(window as any).__ocGlobalStartProbe(metricLabel)
          }, label)
          await page.evaluate(async () => {
            await (window as any).__ocGlobalActiveProbe.clearBaseline()
            ;(window as any).__ocGlobalActiveProbe.start = performance.now()
          })
          await page.click('[data-testid="titlebar-settings-skill"]')
          await waitForPageState(
            page,
            () => !!document.querySelector("#configDialog"),
            "settings skill dialog shell",
            () => ({ requests: requests.slice(-8) }),
          )
          const metric = await page.evaluate(async () => await (window as any).__ocGlobalActiveProbe.stop())
          metrics.push(metric)
          await action()
          return
        }
        if (label === "complete settings skill panel") {
          await page.evaluate((metricLabel) => {
            ;(window as any).__ocGlobalStartProbe(metricLabel)
          }, label)
          await page.evaluate(async () => {
            await (window as any).__ocGlobalActiveProbe.clearBaseline()
            ;(window as any).__ocGlobalActiveProbe.start = performance.now()
          })
          await waitForPageState(
            page,
            () =>
              document.querySelectorAll('#configDialog [data-config-panel="skill"] [data-ui="agent-skill-tabs"] .agent-capability-tab')
                .length >= 8 &&
              document.querySelectorAll('#configDialog [data-config-panel="skill"] [data-ui="agent-skill-pool"] .agent-skill-pool-row')
                .length >= 24,
            "settings skill panel",
            () => ({ requests: requests.slice(-8) }),
          )
          const metric = await page.evaluate(async () => await (window as any).__ocGlobalActiveProbe.stop())
          metrics.push(metric)
          await action()
          return
        }
        const metric = await page.evaluate(
          async ({ label }) => {
            const measure = (window as any).__ocGlobalMeasure as (
              label: string,
              action: () => Promise<void>,
            ) => Promise<InteractionPerf>
            const waitFor = (window as any).__ocGlobalWaitFor as (label: string, predicate: () => boolean) => Promise<void>
            const clickActivity = (side: "left" | "right", activity: string) => {
              const button = document.querySelector<HTMLButtonElement>(
                `[data-ui="side-activity-button"][data-side="${side}"][data-activity="${activity}"]`,
              )
              if (!button) throw new Error(`Missing ${side} activity button: ${activity}`)
              button.click()
            }
            const actions: Record<string, () => Promise<void>> = {
              "open tasks": async () => {
                clickActivity("left", "tasks")
                await waitFor("task list compact rows", () => document.querySelectorAll(".task-row-main[data-task-id]").length >= 5)
                const expand = document.querySelector<HTMLButtonElement>(".project-group-show-more button")
                if (!expand) throw new Error("Missing task group show-more button")
                expand.click()
                await waitFor("task list expanded rows", () => document.querySelectorAll(".task-row-main[data-task-id]").length >= 10)
              },
              "open browser preview": async () => {
                clickActivity("right", "browser")
                await waitFor("browser preview native surface", () => {
                  return (
                    document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.open === "true" &&
                    !!document.querySelector('[data-ui="browser-preview-native-surface"]') &&
                    (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[]).some(
                      (entry) => entry.command === "overlay_browser_preview_sync",
                    )
                  )
                })
              },
              "open browser preview shell": async () => {
                clickActivity("right", "browser")
                await waitFor("browser preview panel", () =>
                  document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.open === "true"
                )
              },
              "complete browser preview native surface": async () => {
                await waitFor("browser preview native surface", () =>
                  !!document.querySelector('[data-ui="browser-preview-native-surface"]') &&
                  (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[]).some(
                    (entry) => entry.command === "overlay_browser_preview_sync",
                  )
                )
              },
              "browser native navigation": async () => {
                for (const label of [
                  "Go back in the preview browser.",
                  "Go forward in the preview browser.",
                  "Reload the current preview page.",
                ]) {
                  const button = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
                  if (!button) throw new Error(`Missing native browser navigation button: ${label}`)
                  button.click()
                }
                await waitFor("browser preview native navigation commands", () => {
                  const actions = (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
                    .filter((entry) => entry.command === "overlay_browser_preview_navigate")
                    .map((entry) => entry.args.action)
                  return actions.includes("back") && actions.includes("forward") && actions.includes("reload")
                })
              },
              "open screenshots": async () => {
                clickActivity("right", "screenshots")
                await waitFor("screenshot thumbnails", () => {
                  const cards = Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card"))
                  if (document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open !== "true") return false
                  if (cards.length < 4) return false
                  return cards.slice(0, 4).every((card) => {
                    const img = card.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
                    return !!img && img.complete && img.naturalWidth > 0
                  })
                })
              },
              "open screenshots shell": async () => {
                clickActivity("right", "screenshots")
                await waitFor("screenshot panel", () =>
                  document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open === "true"
                )
              },
              "complete screenshot thumbnails": async () => {
                await waitFor("screenshot thumbnails", () => {
                  const root = document.querySelector<HTMLElement>('.screenshot-browser-groups[data-virtualized="true"]')
                  const itemCount = Number(root?.dataset.itemCount ?? "0")
                  const renderedCount = Number(root?.dataset.renderedCount ?? "0")
                  const cards = Array.from(document.querySelectorAll<HTMLElement>(".screenshot-browser-card"))
                  if (itemCount <= 0 || renderedCount < itemCount) return false
                  if (cards.length < 4) return false
                  return cards.slice(0, 4).every((card) => {
                    const img = card.querySelector<HTMLImageElement>(".screenshot-browser__thumb-image")
                    return !!img && img.complete && img.naturalWidth > 0
                  })
                })
              },
              "open explorer": async () => {
                clickActivity("right", "explorer")
                await waitFor("file explorer rows", () =>
                  document.querySelector<HTMLElement>("#centerWorkbenchExplorer")?.dataset.open === "true" &&
                  document.querySelectorAll(".file-explorer-row").length > 8
                )
              },
              "file explorer search": async () => {
                const input = document.querySelector<HTMLInputElement>(".file-explorer-search-input")
                if (!input) throw new Error("Missing file explorer search input")
                input.value = "component"
                input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "component" }))
                await waitFor("file explorer search rows", () =>
                  document.querySelector<HTMLElement>(".file-explorer-list")?.dataset.searching === "true" &&
                  document.querySelectorAll(".file-explorer-row").length > 4
                )
              },
              "scroll conversation with panels": async () => {
                const scroll = document.querySelector<HTMLElement>(".chat-scroll")
                if (!scroll) throw new Error("Missing chat scroll")
                const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                for (const ratio of [0.1, 0.35, 0.7, 1, 0.55, 0.2, 0.85, 0]) {
                  scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * ratio
                  scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
                  await frame()
                  await frame()
                }
              },
              "scroll agent rail": async () => {
                const rail = document.querySelector<HTMLElement>(".conversation-agent-rail__lanes")
                if (!rail) throw new Error("Missing conversation agent rail")
                const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                for (const ratio of [0, 0.5, 1, 0.25, 0.75, 0]) {
                  rail.scrollLeft = (rail.scrollWidth - rail.clientWidth) * ratio
                  rail.dispatchEvent(new Event("scroll", { bubbles: true }))
                  await frame()
                }
              },
              "open settings skill panel": async () => {
                const settings = document.querySelector<HTMLButtonElement>('[data-menu-trigger="settings"]')
                if (!settings) throw new Error("Missing settings menu trigger")
                settings.dispatchEvent(
                  new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    cancelable: true,
                    isPrimary: true,
                    pointerId: 19,
                    pointerType: "mouse",
                  }),
                )
                await waitFor("settings menu", () => !!document.querySelector('[data-testid="titlebar-settings-skill"]'))
                const skillItem = document.querySelector<HTMLButtonElement>('[data-testid="titlebar-settings-skill"]')
                if (!skillItem) throw new Error("Missing settings skill menu item")
                skillItem.click()
                await waitFor("settings skill panel", () =>
                  document.querySelectorAll('#configDialog [data-config-panel="skill"] [data-ui="agent-skill-tabs"] .agent-capability-tab')
                    .length >= 8 &&
                  document.querySelectorAll('#configDialog [data-config-panel="skill"] [data-ui="agent-skill-pool"] .agent-skill-pool-row')
                    .length >= 24
                )
              },
            }
            const action = actions[label]
            if (!action) throw new Error(`Unknown global pressure action: ${label}`)
            return await measure(label, action)
          },
          { label },
        )
        metrics.push(metric)
        await action()
      }

      await measure("open tasks", async () => undefined)
      await measure("open browser preview shell", async () => undefined)
      await measure("complete browser preview native surface", async () => undefined)
      await measure("browser native navigation", async () => undefined)
      await waitForPageState(
        page,
        () => {
          const actions = (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
            .filter((entry) => entry.command === "overlay_browser_preview_navigate")
            .map((entry) => entry.args.action)
          return actions.includes("back") && actions.includes("forward") && actions.includes("reload")
        },
        "browser native navigation commands",
        () => ({ nativeCommands: [] }),
      )
      await measure("open screenshots shell", async () => undefined)
      await measure("complete screenshot thumbnails", async () => undefined)
      await measure("open explorer", async () => undefined)
      await measure("file explorer search", async () => undefined)
      await measure("scroll conversation with panels", async () => undefined)
      await measure("scroll agent rail", async () => undefined)
      await measure("open settings menu", async () => undefined)
      await measure("open settings skill dialog shell", async () => undefined)
      await measure("complete settings skill panel", async () => undefined)

      const domMetrics = await page.evaluate(() => ({
        mountedConversationCards: document.querySelectorAll(".conversation-virtual-item > [data-card-id]").length,
        workflowMessages: document.querySelectorAll('[data-ui="workflow-section-stack"] .msg-text').length,
        agentRailButtons: document.querySelectorAll('[data-ui="conversation-agent-rail-locate"]').length,
        screenshotCards: document.querySelectorAll(".screenshot-browser-card").length,
        fileRows: document.querySelectorAll(".file-explorer-row").length,
        skillTabs: document.querySelectorAll(
          '#configDialog [data-config-panel="skill"] [data-ui="agent-skill-tabs"] .agent-capability-tab',
        ).length,
        skillPoolRows: document.querySelectorAll(
          '#configDialog [data-config-panel="skill"] [data-ui="agent-skill-pool"] .agent-skill-pool-row',
        ).length,
        skillMountedRows: document.querySelectorAll(
          '#configDialog [data-config-panel="skill"] .agent-mounted-skill-row',
        ).length,
        openPanels: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']")).map(
          (node) => node.id,
        ),
        dialogOpen: !!document.querySelector("#configDialog"),
        bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
        visibleMarkdown: document.querySelector(".chat-scroll")?.textContent?.includes("Global pressure transcript") ?? false,
      }))
      mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
      const screenshot = await page.screenshot({ fullPage: false })
      writeFileSync(SCREENSHOT_PATH, screenshot)
      const screenshotMetadata = await sharp(screenshot).metadata()
      const screenshotStats = await sharp(screenshot).stats()
      const colorRange = screenshotStats.channels.slice(0, 3).reduce((total, channel) => total + channel.max - channel.min, 0)

      const attachmentRequestCount = requestCount(
        requests,
        (entry) =>
          /^\/attachment\/project\/global-pressure-\d+\.png$/.test(entry.path) &&
          entry.search === `?variant=${SCREENSHOT_BROWSER_THUMBNAIL_VARIANT}`,
      )
      const retiredLiveRouteRequestCount = requestCount(requests, (entry) => entry.path.includes("browser-preview/live"))
      const nativeBrowserCommandActions = await page.evaluate(() =>
        (((window as any).__browserPreviewNativeCommands || []) as NativeCommandRecord[])
          .filter((entry) => entry.command === "overlay_browser_preview_navigate")
          .map((entry) => entry.args.action),
      )
      const fileListRequestCount = requestCount(requests, (entry) => entry.path === "/file")
      const fileSearchRequestCount = requestCount(requests, (entry) => entry.path === "/find/file")

      console.log(
        `[perf] overlay-global-live-pressure ${metrics
          .map((metric) => `${metric.label}=${metric.maxRafGapMs.toFixed(1)}raf/${metric.maxLongTaskMs.toFixed(1)}lt/${metric.longTaskCount}long`)
          .join(" ")} dom=${JSON.stringify(domMetrics)} requests=${JSON.stringify({
          attachmentRequestCount,
          retiredLiveRouteRequestCount,
          fileListRequestCount,
          fileSearchRequestCount,
        })} nativeBrowserCommandActions=${JSON.stringify(nativeBrowserCommandActions)}`,
      )

      for (const metric of metrics) assertInteraction(metric)
      assert.equal(domMetrics.visibleMarkdown, true)
      assert.equal(domMetrics.workflowMessages, 0, JSON.stringify(domMetrics))
      assert.ok(domMetrics.mountedConversationCards <= PERF_LIMITS.mountedConversationCards, JSON.stringify(domMetrics))
      assert.ok(domMetrics.screenshotCards <= PERF_LIMITS.screenshotCards, JSON.stringify(domMetrics))
      assert.ok(domMetrics.fileRows <= PERF_LIMITS.fileRows, JSON.stringify(domMetrics))
      assert.equal(domMetrics.skillTabs, AGENT_COUNT, JSON.stringify(domMetrics))
      assert.equal(domMetrics.skillPoolRows, SKILL_COUNT, JSON.stringify(domMetrics))
      assert.ok(domMetrics.skillMountedRows >= 1, JSON.stringify(domMetrics))
      assert.ok(domMetrics.agentRailButtons >= TRANSCRIPT_MESSAGES - 5, JSON.stringify(domMetrics))
      assert.ok(domMetrics.openPanels.includes("centerWorkbenchWorkflow"), JSON.stringify(domMetrics))
      assert.ok(domMetrics.openPanels.includes("centerWorkbenchBrowser"), JSON.stringify(domMetrics))
      assert.ok(domMetrics.openPanels.includes("centerWorkbenchScreenshots"), JSON.stringify(domMetrics))
      assert.ok(domMetrics.openPanels.includes("centerWorkbenchExplorer"), JSON.stringify(domMetrics))
      assert.equal(domMetrics.dialogOpen, true, JSON.stringify(domMetrics))
      assert.ok(attachmentRequestCount <= PERF_LIMITS.screenshotAttachmentRequests, String(attachmentRequestCount))
      assert.equal(retiredLiveRouteRequestCount, PERF_LIMITS.retiredLiveRouteRequests)
      assert.deepEqual(nativeBrowserCommandActions.slice(-3), ["back", "forward", "reload"])
      assert.ok(fileListRequestCount <= PERF_LIMITS.fileListRequests, String(fileListRequestCount))
      assert.ok(fileSearchRequestCount <= PERF_LIMITS.fileSearchRequests, String(fileSearchRequestCount))
      assert.ok((screenshotMetadata.width || 0) > 900 && (screenshotMetadata.height || 0) > 600)
      assert.ok(colorRange > 120, `global pressure screenshot appears blank: colorRange=${colorRange}`)
      assert.ok(expectedAborts.length < 12, `too many expected aborts: ${JSON.stringify(expectedAborts)}`)
      errors.assertNoUnexpectedErrors()
    } finally {
      closeStreams(clients)
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 180_000 },
)
