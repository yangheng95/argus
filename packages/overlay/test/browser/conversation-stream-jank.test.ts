import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import {
  testEventOrderKey,
  testMessageOrderKey,
  testPartOrderKey,
  testSessionOrderKey,
  testTaskOrderKey,
} from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_overlay_stream_jank"
const ROOT_SESSION_ID = "ses_overlay_stream_root"
const ACTIVE_SESSION_ID = "ses_overlay_stream_active"
const ACTIVE_MESSAGE_ID = "msg_overlay_stream_active"
const ACTIVE_PART_ID = "part_overlay_stream_active"
const PROJECT_ROOT = "D:/overlay/workspace/stream-jank"
const BASE_TIME = 1_776_000_000_000
const HISTORY_MESSAGES = 120
const STREAM_DELTAS = 900
const STREAM_CHUNK = "stream token "
const PERF_LIMITS = {
  maxIntervalDriftMs: 180,
  longTaskCount: 8,
  maxLongTaskMs: 160,
  mountedConversationCards: 80,
}

type SseClient = {
  path: string
  controller: ReadableStreamDefaultController<Uint8Array>
  closed: boolean
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

function pushEvent(clients: SseClient[], event: unknown): void {
  const encoder = new TextEncoder()
  const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  for (const client of clients) {
    if (client.closed || client.path !== `/task/${TASK_ID}/events`) continue
    try {
      client.controller.enqueue(chunk)
    } catch {
      client.closed = true
    }
  }
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

async function waitForTaskEventStreamClient(clients: SseClient[], timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (clients.some((client) => client.path === `/task/${TASK_ID}/events` && !client.closed)) return
    await sleep(25)
  }
  throw new Error(`timed out waiting for /task/${TASK_ID}/events stream client`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function savePageScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }): Promise<string> {
  const screenshotPath = resolve(".scratch", "overlay-stream-jank-after-stream.png")
  mkdirSync(dirname(screenshotPath), { recursive: true })
  writeFileSync(screenshotPath, await page.screenshot({ fullPage: false }))
  return screenshotPath
}

function task() {
  return {
    id: TASK_ID,
    orderKey: testTaskOrderKey(TASK_ID, BASE_TIME),
    title: "Overlay stream jank benchmark",
    request: "Measure sustained overlay stream responsiveness.",
    directory: PROJECT_ROOT,
    status: "active",
    sessionID: ROOT_SESSION_ID,
    attachments: [],
    time: { created: BASE_TIME, updated: BASE_TIME + 10_000 },
  }
}

function board() {
  return {
    snapshotVersion: "overlay-stream-jank-board",
    lastSequence: 10,
    task: task(),
    overview: {
      headline: "Overlay stream jank benchmark",
      summary: "Fixture task for sustained stream responsiveness.",
      controls: {},
    },
    workflow: {
      steps: [
        { id: "requirements", status: "running" },
        { id: "architect", status: "pending" },
        { id: "build", status: "pending" },
      ],
    },
    requirements: [],
    interactions: [],
    goalWorkflows: [],
  }
}

function transcriptMessage(index: number) {
  const time = BASE_TIME + 100 + index * 10
  const sessionID = `ses_overlay_stream_history_${String(index).padStart(3, "0")}`
  const messageID = `msg_overlay_stream_history_${String(index).padStart(3, "0")}`
  const partID = `part_overlay_stream_history_${String(index).padStart(3, "0")}`
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      resolvedRole: "requirements",
      channel: "requirements",
      agent: "requirements",
      parentSessionID: ROOT_SESSION_ID,
      orderKey: testMessageOrderKey(messageID, time),
      time: { created: time, completed: time + 1 },
    },
    parts: [
      {
        id: partID,
        messageID,
        sessionID,
        orderKey: testPartOrderKey(partID, time + 1),
        type: "text",
        resolvedRole: "requirements",
        channel: "requirements",
        text: `Historical requirements message ${index}. ${"bounded content ".repeat(18)}`,
      },
    ],
  }
}

function activeMessage() {
  const time = BASE_TIME + 10_000
  return {
    info: {
      id: ACTIVE_MESSAGE_ID,
      sessionID: ACTIVE_SESSION_ID,
      role: "assistant",
      resolvedRole: "requirements",
      channel: "requirements",
      agent: "requirements",
      parentSessionID: ROOT_SESSION_ID,
      orderKey: testMessageOrderKey(ACTIVE_MESSAGE_ID, time),
      time: { created: time },
    },
    parts: [
      {
        id: ACTIVE_PART_ID,
        messageID: ACTIVE_MESSAGE_ID,
        sessionID: ACTIVE_SESSION_ID,
        orderKey: testPartOrderKey(ACTIVE_PART_ID, time + 1),
        type: "text",
        resolvedRole: "requirements",
        channel: "requirements",
        text: "stream start ",
      },
    ],
  }
}

function viewMessagesForTranscript(transcript: any[]) {
  return transcript.map((message) => ({
    messageID: message.info.id,
    sessionID: message.info.sessionID,
    stage: message.info.channel,
    parentSessionID: message.info.parentSessionID,
    time: message.info.time.created,
    orderKey: message.info.orderKey,
    placement: "top_level",
  }))
}

function viewSessionsForTranscript(transcript: any[]) {
  return transcript.map((message) => ({
    sessionID: message.info.sessionID,
    stage: message.info.channel,
    parentSessionID: message.info.parentSessionID,
    messageIDs: [message.info.id],
    lastDisplayMessageID: message.info.id,
    firstMessageTime: message.info.time.created,
    lastMessageTime: message.info.time.created,
    firstObservedAt: message.info.time.created,
    lastObservedAt: message.info.time.completed || message.info.time.created,
    status: message.info.time.completed ? "completed" : "running",
    placement: "top_level",
    orderKey: testSessionOrderKey(message.info.sessionID, message.info.time.created),
  }))
}

function conversationPayload(transcript: any[]) {
  const sessions = viewSessionsForTranscript(transcript)
  const messages = viewMessagesForTranscript(transcript)
  return {
    lastSequence: 10,
    messageWatermark: 10,
    board: board(),
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 10, latestSequence: 10, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
    view: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
    agentView: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }
}

function streamDelta(sequence: number) {
  const time = BASE_TIME + 20_000 + sequence
  return {
    type: "message.part.delta",
    taskID: TASK_ID,
    sequence,
    timestamp: time,
    emittedAt: time,
    orderKey: testEventOrderKey("message.part.delta", time, sequence),
    properties: {
      taskID: TASK_ID,
      sessionID: ACTIVE_SESSION_ID,
      messageID: ACTIVE_MESSAGE_ID,
      partID: ACTIVE_PART_ID,
      field: "text",
      delta: STREAM_CHUNK,
    },
  }
}

test(
  "overlay stays responsive while requirements stream updates conversation and workflow panel",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const transcript = [...Array.from({ length: HISTORY_MESSAGES }, (_, index) => transcriptMessage(index)), activeMessage()]
    const clients: SseClient[] = []
    const errors: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") return json({ version: "stream-jank-test" })
      if (path === "/mission" || path === "/session") return json([])
      if (path === "/global/projects/discover")
        return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
      if (path === "/project/current/worktrees") return json([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
      if (path === "/global/tasks") return json({ tasks: [{ task: task(), updated_at: BASE_TIME + 10_000 }] })
      if (path === "/path") return json({ directory: PROJECT_ROOT, exists: true, git: true })
      if (path === "/vcs") return json({ branch: "main", dirty: false, clean: true })
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config/prompt") return json([])
      if (path === "/config/prompt-profile")
        return json({ active: "general", project_active: "general", session_active: null, default: "general", targets: [], profiles: [] })
      if (path === "/config") return json({ model: "openai/gpt-5-mini", directory: PROJECT_ROOT })
      if (path === "/channel") return json([])
      if (path === "/executor") return json([])
      if (path === "/agent") return json([])
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return json([])
      if (path === "/skill/mounts")
        return json({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
      if (path === "/mcp") return json({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return json([])
      if (path === "/log") return json({})
      if (path === "/log/tail") return json({ path: "D:/overlay/logs/server.log", lines: [] })
      if (path === `/task/${TASK_ID}/board`) return json(board())
      if (path === `/task/${TASK_ID}/conversation`) return json(conversationPayload(transcript))
      if (path === `/task/${TASK_ID}/conversation/events`)
        return json({ events: [], eventReplay: { cursor: 10, latestSequence: 10, complete: true, limit: 500 } })
      if (path === `/task/${TASK_ID}/transcript`) return json(transcript)
      if (path === `/task/${TASK_ID}/trace`) return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace`, enabled: true })
      if (path === `/task/${TASK_ID}/browser-preview`)
        return json({ taskID: TASK_ID, kind: "missing", status: "missing", projectRoot: PROJECT_ROOT, viewports: [], diagnostics: [], candidates: [], source: "none" })
      if (path === `/task/${TASK_ID}/operator-model-context`) return json({ selected: null, candidates: [] })
      if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream(clients, path)
      return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const browserErrors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          return /^\/task\/[^/]+\/events(?:\?.*)?$/.test(failure.pathWithSearch) && failure.errorText === "net::ERR_ABORTED"
        },
      })
      page.on("pageerror", (error) => errors.push(`pageerror: ${(error as Error).message}`))
      page.on("console", (message) => {
        const item = message as { type?: () => string; text?: () => string }
        if (item.type?.() === "error") errors.push(`console: ${item.text?.() || ""}`)
      })
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((origin) => {
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/stream-jank")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/stream-jank")
        localStorage.setItem("oc_workspace_task", "tsk_overlay_stream_jank")
        localStorage.setItem("oc_theme", "light")
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#chatSection", { visible: true })
      await page.waitForFunction(
        () => document.body.textContent?.includes("Historical requirements message 119") === true,
        { timeout: 15_000 },
      )
      await page.waitForFunction(
        () => (window as any).cardTree?.order?.length >= 100,
        { timeout: 15_000 },
      )
      await waitForTaskEventStreamClient(clients)

      await page.evaluate(() => {
        const state = {
          ticks: 0,
          maxIntervalDriftMs: 0,
          longTasks: [] as number[],
          timer: 0,
          observer: undefined as PerformanceObserver | undefined,
        }
        let last = performance.now()
        state.timer = window.setInterval(() => {
          const now = performance.now()
          const drift = Math.max(0, now - last - 16)
          state.maxIntervalDriftMs = Math.max(state.maxIntervalDriftMs, drift)
          state.ticks += 1
          last = now
        }, 16)
        if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
          state.observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
          })
          state.observer.observe({ entryTypes: ["longtask"] })
        }
        ;(window as any).__overlayStreamJankProbe = state
      })

      for (let index = 0; index < STREAM_DELTAS; index += 1) {
        pushEvent(clients, streamDelta(11 + index))
        if (index % 10 === 0) await sleep(1)
      }

      await page.waitForFunction(
        (expected) => document.body.textContent?.includes("stream token stream token stream token") && ((window as any).cardTree?.visibleVersion ?? 0) >= expected,
        { timeout: 15_000 },
        2,
      )
      await sleep(600)

      const metrics = await page.evaluate(() => {
        const state = (window as any).__overlayStreamJankProbe
        window.clearInterval(state.timer)
        state.observer?.disconnect()
        const longTasks = Array.isArray(state.longTasks) ? state.longTasks : []
        return {
          maxIntervalDriftMs: state.maxIntervalDriftMs,
          longTaskCount: longTasks.length,
          maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
          mountedConversationCards: document.querySelectorAll(".conversation-virtual-item > [data-card-id]").length,
          workflowStreamMessages: document.querySelectorAll(".req-streaming-messages .msg-text").length,
          orderCount: (window as any).cardTree?.order?.length ?? 0,
          streamedTextLength:
            Object.values(((window as any).cardTree?.cards ?? {}) as Record<string, any>)
              .flatMap((card) => (Array.isArray(card?.parts) ? card.parts : []))
              .find((part) => part?.id === "part_overlay_stream_active")?.text?.length ?? 0,
        }
      })

      console.log(
        `[perf] stream-jank drift=${metrics.maxIntervalDriftMs.toFixed(1)}ms longTasks=${metrics.longTaskCount} ` +
          `maxLongTask=${metrics.maxLongTaskMs.toFixed(1)}ms mounted=${metrics.mountedConversationCards} ` +
          `workflowMessages=${metrics.workflowStreamMessages} order=${metrics.orderCount}`,
      )
      const screenshotPath = await savePageScreenshot(page)
      assert.ok(screenshotPath.endsWith("overlay-stream-jank-after-stream.png"))

      assert.equal(errors.length, 0, errors.join("\n"))
      browserErrors.assertNoUnexpectedErrors()
      assert.ok(metrics.streamedTextLength >= STREAM_CHUNK.length * STREAM_DELTAS)
      assert.ok(metrics.orderCount >= HISTORY_MESSAGES)
      assert.equal(metrics.workflowStreamMessages, 0)
      assert.ok(
        metrics.mountedConversationCards <= PERF_LIMITS.mountedConversationCards,
        `mountedConversationCards=${metrics.mountedConversationCards}`,
      )
      assert.ok(
        metrics.maxIntervalDriftMs <= PERF_LIMITS.maxIntervalDriftMs,
        `maxIntervalDriftMs=${metrics.maxIntervalDriftMs}`,
      )
      assert.ok(metrics.longTaskCount <= PERF_LIMITS.longTaskCount, `longTaskCount=${metrics.longTaskCount}`)
      assert.ok(metrics.maxLongTaskMs <= PERF_LIMITS.maxLongTaskMs, `maxLongTaskMs=${metrics.maxLongTaskMs}`)
    } finally {
      closeStreams(clients)
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 90_000 },
)
