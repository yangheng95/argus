import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

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

await ensureOverlayDist()

const TASK_ID = "tsk_overlay_long_markdown"
const ROOT_SESSION_ID = "ses_overlay_long_markdown_root"
const PROJECT_ROOT = "D:/overlay/workspace/long-markdown"
const BASE_TIME = 1_776_200_000_000
const TRANSCRIPT_MESSAGES = 240
const PERF_LIMITS = {
  scrollMaxRafGapMs: 120,
  scrollLongTaskCount: 8,
  scrollMaxLongTaskMs: 160,
  mountedConversationCards: 90,
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

function closeStreams(clients: SseClient[]): void {
  for (const client of clients) {
    if (client.closed) continue
    client.closed = true
    try {
      client.controller.close()
    } catch {}
  }
}

function task() {
  return {
    id: TASK_ID,
    orderKey: testTaskOrderKey(TASK_ID, BASE_TIME),
    title: "Overlay long markdown transcript benchmark",
    request: "Measure real overlay scrolling through completed markdown transcript messages.",
    directory: PROJECT_ROOT,
    status: "completed",
    sessionID: ROOT_SESSION_ID,
    attachments: [],
    time: { created: BASE_TIME, updated: BASE_TIME + 30_000, completed: BASE_TIME + 30_000 },
  }
}

function board() {
  return {
    snapshotVersion: "overlay-long-markdown-board",
    lastSequence: 20,
    task: task(),
    overview: {
      headline: "Overlay long markdown transcript benchmark",
      summary: "Fixture task for completed markdown transcript responsiveness.",
      controls: {},
    },
    workflow: {
      steps: [
        { id: "requirements", status: "completed" },
        { id: "architect", status: "completed" },
        { id: "build", status: "completed" },
      ],
    },
    requirements: [],
    interactions: [],
    goalWorkflows: [],
  }
}

function markdownBody(index: number): string {
  const rows = Array.from({ length: 4 }, (_, row) => `| ${index}-${row} | ${"cell detail ".repeat(6)} |`)
  return [
    `### Markdown transcript message ${index}`,
    "",
    `Completed assistant output with **bold text**, a [docs link](https://example.com/docs/${index}), and repeated detail.`,
    "",
    "- Result item alpha with enough copy to exercise wrapping and layout.",
    "- Result item beta with `inline code` and more descriptive text.",
    "- Result item gamma that keeps the message height realistic.",
    "",
    "| Key | Value |",
    "| --- | --- |",
    ...rows,
    "",
    "```ts",
    `export const transcriptMessage${index} = ${index}`,
    `console.log("markdown transcript ${index}")`,
    "```",
    "",
    `Final paragraph ${index}. ${"completed markdown content ".repeat(18)}`,
  ].join("\n")
}

function transcriptMessage(index: number) {
  const time = BASE_TIME + 100 + index * 50
  const sessionID = `ses_overlay_long_markdown_${String(index).padStart(3, "0")}`
  const messageID = `msg_overlay_long_markdown_${String(index).padStart(3, "0")}`
  const partID = `part_overlay_long_markdown_${String(index).padStart(3, "0")}`
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      resolvedRole: index % 3 === 0 ? "requirements" : index % 3 === 1 ? "architect" : "build",
      channel: index % 3 === 0 ? "requirements" : index % 3 === 1 ? "architect" : "build",
      agent: index % 3 === 0 ? "requirements" : index % 3 === 1 ? "architect" : "build",
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
        resolvedRole: index % 3 === 0 ? "requirements" : index % 3 === 1 ? "architect" : "build",
        channel: index % 3 === 0 ? "requirements" : index % 3 === 1 ? "architect" : "build",
        text: markdownBody(index),
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
    status: "completed",
    placement: "top_level",
    orderKey: testSessionOrderKey(message.info.sessionID, message.info.time.created),
  }))
}

function conversationPayload(transcript: any[]) {
  const sessions = viewSessionsForTranscript(transcript)
  const messages = viewMessagesForTranscript(transcript)
  return {
    lastSequence: 20,
    messageWatermark: 20,
    board: board(),
    transcript,
    timeline: [],
    events: [],
    eventReplay: { cursor: 20, latestSequence: 20, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 260 },
    view: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
    agentView: { sessions, messages, topLevelSessionIDs: sessions.map((item) => item.sessionID) },
  }
}

async function savePageScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }): Promise<string> {
  const screenshotPath = resolve(".scratch", "overlay-long-markdown-transcript-scroll.png")
  mkdirSync(dirname(screenshotPath), { recursive: true })
  writeFileSync(screenshotPath, await page.screenshot({ fullPage: false }))
  return screenshotPath
}

test(
  "real overlay scrolls a long completed markdown transcript without main-thread stalls",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const transcript = Array.from({ length: TRANSCRIPT_MESSAGES }, (_, index) => transcriptMessage(index))
    const clients: SseClient[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") return json({ version: "long-markdown-test" })
      if (path === "/mission" || path === "/session") return json([])
      if (path === "/global/projects/discover")
        return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
      if (path === "/project/current/worktrees") return json([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
      if (path === "/global/tasks") return json({ tasks: [{ task: task(), updated_at: BASE_TIME + 30_000 }] })
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
        return json({ events: [], eventReplay: { cursor: 20, latestSequence: 20, complete: true, limit: 500 } })
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
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((origin) => {
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/long-markdown")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/long-markdown")
        localStorage.setItem("oc_workspace_task", "tsk_overlay_long_markdown")
        localStorage.setItem("oc_theme", "light")
      }, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#chatSection", { visible: true })
      await page.waitForFunction(
        (expected) => ((window as any).cardTree?.order?.length ?? 0) >= expected,
        { timeout: 20_000 },
        TRANSCRIPT_MESSAGES,
      )
      await page.waitForSelector(".conversation-virtual-item > [data-card-id]", { visible: true })
      await page.waitForFunction(
        () => (window as any).__ocMarkdownRenderPrewarmPending === 0,
        { timeout: 20_000 },
      )

      const metrics = await page.evaluate(async () => {
        const scroll = document.querySelector<HTMLElement>(".chat-scroll")
        if (!scroll) throw new Error("missing chat scroll container")
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const state = {
          maxRafGapMs: 0,
          samples: 0,
          longTasks: [] as number[],
          observer: undefined as PerformanceObserver | undefined,
          rafID: 0,
        }
        let last = performance.now()
        const tick = (now: number) => {
          state.maxRafGapMs = Math.max(state.maxRafGapMs, now - last)
          state.samples += 1
          last = now
          state.rafID = requestAnimationFrame(tick)
        }
        state.rafID = requestAnimationFrame(tick)
        if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
          state.observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
          })
          state.observer.observe({ entryTypes: ["longtask"] })
        }

        const ratios = [0, 0.18, 0.36, 0.54, 0.72, 0.9, 1, 0.66, 0.33, 0]
        for (const ratio of ratios) {
          scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * ratio
          scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
          await frame()
          await frame()
        }
        await frame()
        cancelAnimationFrame(state.rafID)
        state.observer?.disconnect()
        const longTasks = state.longTasks
        const visibleText = document.querySelector<HTMLElement>(".chat-scroll")?.textContent || ""
        return {
          scrollMaxRafGapMs: state.maxRafGapMs,
          scrollRafSamples: state.samples,
          scrollLongTaskCount: longTasks.length,
          scrollMaxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
          mountedConversationCards: document.querySelectorAll(".conversation-virtual-item > [data-card-id]").length,
          mountedMarkdownBlocks: document.querySelectorAll(".msg-text :is(p, pre, table, ul, ol, h1, h2, h3)").length,
          orderCount: (window as any).cardTree?.order?.length ?? 0,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          visibleHasMarkdownMessage: visibleText.includes("Markdown transcript message"),
        }
      })
      console.log(
        `[perf] long-markdown scrollRafGap=${metrics.scrollMaxRafGapMs.toFixed(1)}ms ` +
          `longTasks=${metrics.scrollLongTaskCount} maxLongTask=${metrics.scrollMaxLongTaskMs.toFixed(1)}ms ` +
          `mounted=${metrics.mountedConversationCards} markdownBlocks=${metrics.mountedMarkdownBlocks} ` +
          `order=${metrics.orderCount}`,
      )
      const screenshotPath = await savePageScreenshot(page)
      assert.ok(screenshotPath.endsWith("overlay-long-markdown-transcript-scroll.png"))

      browserErrors.assertNoUnexpectedErrors()
      assert.ok(metrics.orderCount >= TRANSCRIPT_MESSAGES, `orderCount=${metrics.orderCount}`)
      assert.equal(metrics.visibleHasMarkdownMessage, true)
      assert.ok(metrics.scrollRafSamples >= 10, `scrollRafSamples=${metrics.scrollRafSamples}`)
      assert.ok(metrics.scrollHeight > metrics.clientHeight, `scrollHeight=${metrics.scrollHeight}; clientHeight=${metrics.clientHeight}`)
      assert.ok(metrics.mountedMarkdownBlocks > 0, `mountedMarkdownBlocks=${metrics.mountedMarkdownBlocks}`)
      assert.ok(
        metrics.mountedConversationCards <= PERF_LIMITS.mountedConversationCards,
        `mountedConversationCards=${metrics.mountedConversationCards}`,
      )
      assert.ok(metrics.scrollMaxRafGapMs <= PERF_LIMITS.scrollMaxRafGapMs, `scrollMaxRafGapMs=${metrics.scrollMaxRafGapMs}`)
      assert.ok(metrics.scrollLongTaskCount <= PERF_LIMITS.scrollLongTaskCount, `scrollLongTaskCount=${metrics.scrollLongTaskCount}`)
      assert.ok(metrics.scrollMaxLongTaskMs <= PERF_LIMITS.scrollMaxLongTaskMs, `scrollMaxLongTaskMs=${metrics.scrollMaxLongTaskMs}`)
    } finally {
      closeStreams(clients)
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
