import assert from "node:assert/strict"
import test from "node:test"
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

const PORT = 7478
const TASK_ID = "tsk_rewind_visual_stress"
const PROJECT_ROOT = "D:/overlay/workspace/rewind-stress"
const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/rewind-visual-stress/", import.meta.url))

await ensureOverlayDist()

type FixtureMessage = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    resolvedRole: string
    channel: string
    agent: string
    time: { created: number }
  }
  parts: Array<{ id: string; messageID: string; sessionID: string; type: "text"; text: string }>
}

type SseClient = {
  path: string
  controller: ReadableStreamDefaultController<Uint8Array>
  closed: boolean
}

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

function message(input: {
  id: string
  sessionID: string
  role?: "user" | "assistant"
  channel: string
  resolvedRole: string
  agent: string
  created: number
  body: string
}): FixtureMessage {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      role: input.role ?? "assistant",
      resolvedRole: input.resolvedRole,
      channel: input.channel,
      agent: input.agent,
      time: { created: input.created },
    },
    parts: [{ id: `part_${input.id}`, messageID: input.id, sessionID: input.sessionID, type: "text", text: input.body }],
  }
}

function eventStream(clients: SseClient[], path: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client: SseClient = { path, controller, closed: false }
      clients.push(client)
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

function pushEvent(clients: SseClient[], event: unknown) {
  const encoder = new TextEncoder()
  const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  for (const client of clients) {
    if (client.closed) continue
    if (!client.path.startsWith(`/task/${TASK_ID}/events`)) continue
    try {
      client.controller.enqueue(chunk)
    } catch {
      client.closed = true
    }
  }
}

function closeStreams(clients: SseClient[]) {
  for (const client of clients) {
    if (client.closed) continue
    client.closed = true
    try {
      client.controller.close()
    } catch {}
  }
}

async function analyzePng(buffer: Buffer) {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const raw = await image.ensureAlpha().raw().toBuffer()
  const buckets = new Set<number>()
  let nonWhite = 0
  let total = 0
  for (let index = 0; index < raw.length; index += 4) {
    const red = raw[index]
    const green = raw[index + 1]
    const blue = raw[index + 2]
    const alpha = raw[index + 3]
    if (alpha >= 16) {
      buckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4))
      if (Math.max(red, green, blue) < 250) nonWhite += 1
    }
    total += 1
  }
  return {
    width,
    height,
    nonWhiteDensity: total === 0 ? 0 : nonWhite / total,
    uniqueColorBuckets: buckets.size,
  }
}

async function screenshotPanel(page: OverlayPage, name: string) {
  await page.waitForSelector("#chatSection", { visible: true })
  const element = await page.$("#chatSection")
  assert.ok(element, `${name}: chat section missing`)
  const screenshot = await element.screenshot({})
  const file = resolve(SCREENSHOT_DIR, `${name}.png`)
  writeFileSync(file, screenshot)
  const stats = await analyzePng(screenshot)
  assert.ok(stats.width >= 320 && stats.height >= 360, `${name}: invalid screenshot size ${JSON.stringify(stats)}`)
  assert.ok(stats.nonWhiteDensity > 0.03, `${name}: screenshot lacks UI pixels ${JSON.stringify(stats)}`)
  assert.ok(stats.uniqueColorBuckets > 24, `${name}: screenshot is visually too sparse ${JSON.stringify(stats)}`)
  return { file, stats }
}

async function visualSnapshot(page: OverlayPage) {
  return page.evaluate(() => {
    const cardTree = (window as any).cardTree
    const cards = cardTree?.cards && typeof cardTree.cards === "object" ? cardTree.cards : {}
    const order = Array.isArray(cardTree?.order) ? cardTree.order : []
    const visibleCards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]")).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.dataset.cardId || "",
        kind: element.dataset.kind || "",
        stage: element.dataset.stage || "",
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) || "",
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }
    })
      const headerControls = Array.from(document.querySelectorAll<HTMLElement>(".card__rewind")).map((element) => {
        const parent = element.closest<HTMLElement>("[data-card-id]")
        const rect = element.getBoundingClientRect()
        return {
        cardID: parent?.dataset.cardId || "",
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      })
      const notifications = Array.from(document.querySelectorAll<HTMLElement>(".app-notification")).map(
        (element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) || "",
      )
      return {
        order,
      cards: Object.fromEntries(
        Object.entries(cards).map(([id, card]: [string, any]) => [
          id,
          {
            kind: card?.kind || "",
            stage: card?.stage || "",
            time: Number(card?.time || 0),
            childIDs: Array.isArray(card?.childIDs) ? [...card.childIDs] : [],
            partText: Array.isArray(card?.parts)
              ? card.parts.map((part: any) => String(part?.text || part?.state?.output || "")).join("\n")
              : "",
          },
        ]),
      ),
      rewindCursor: cardTree?.rewindCursor ?? null,
      text: document.body.textContent?.replace(/\s+/g, " ").slice(0, 5000) || "",
        visibleCards,
        headerControls,
        notifications,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
        renderErrors: visibleCards.filter((item) => item.kind === "render-error").map((item) => item.text),
      }
  }) as Promise<{
    order: string[]
    cards: Record<string, { kind: string; stage: string; time: number; childIDs: string[]; partText: string }>
    rewindCursor: number | null
    text: string
    visibleCards: Array<{ id: string; kind: string; stage: string; text: string; rect: Record<string, number> }>
    headerControls: Array<Record<string, number | string>>
    notifications: string[]
    viewportWidth: number
    viewportHeight: number
    bodyOverflowX: number
    renderErrors: string[]
  }>
}

async function waitForVisualState(
  page: OverlayPage,
  label: string,
  predicate: (snapshot: Awaited<ReturnType<typeof visualSnapshot>>) => boolean,
  diagnostics: () => unknown,
  idleTimeoutMs = 6_000,
) {
  let lastActivity = Date.now()
  let previousSignature = ""
  for (;;) {
    const snapshot = await visualSnapshot(page)
    if (predicate(snapshot)) return snapshot
    const signature = JSON.stringify({
      order: snapshot.order,
      cursor: snapshot.rewindCursor,
      cards: Object.entries(snapshot.cards).map(([id, card]) => ({
        id,
        kind: card.kind,
        stage: card.stage,
        time: card.time,
        childIDs: card.childIDs,
        partText: card.partText,
      })),
      notifications: snapshot.notifications,
      renderErrors: snapshot.renderErrors,
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > idleTimeoutMs) {
      assert.fail(`No page activity while waiting for ${label}\n${JSON.stringify({ snapshot, diagnostics: diagnostics() }, null, 2)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function assertVisible(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  for (const marker of markers) {
    assert.ok(snapshot.text.includes(marker), `expected marker visible: ${marker}\n${JSON.stringify(snapshot, null, 2)}`)
  }
}

function assertHidden(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  for (const marker of markers) {
    assert.equal(snapshot.text.includes(marker), false, `expected marker hidden: ${marker}\n${JSON.stringify(snapshot, null, 2)}`)
  }
}

function assertCardsContain(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  const text = Object.values(snapshot.cards)
    .map((card) => card.partText)
    .join("\n")
  for (const marker of markers) {
    assert.ok(text.includes(marker), `expected marker in card store: ${marker}\n${JSON.stringify(snapshot, null, 2)}`)
  }
}

function assertCardsDoNotContain(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  const text = Object.values(snapshot.cards)
    .map((card) => card.partText)
    .join("\n")
  for (const marker of markers) {
    assert.equal(text.includes(marker), false, `expected marker absent from card store: ${marker}\n${JSON.stringify(snapshot, null, 2)}`)
  }
}

function assertNoLayoutBreakage(snapshot: Awaited<ReturnType<typeof visualSnapshot>>) {
  assert.equal(snapshot.renderErrors.length, 0, `render errors present\n${JSON.stringify(snapshot.renderErrors, null, 2)}`)
  assert.ok(snapshot.bodyOverflowX <= 1, `body horizontal overflow\n${JSON.stringify(snapshot, null, 2)}`)
  assert.ok(snapshot.headerControls.length >= 1, `rewind controls missing\n${JSON.stringify(snapshot.headerControls, null, 2)}`)
  for (const item of snapshot.headerControls) {
    assert.ok(Number(item.width) >= 12 && Number(item.height) >= 12, `bad rewind control box ${JSON.stringify(item)}`)
    assert.ok(
      Number(item.left) >= -1 && Number(item.right) <= snapshot.viewportWidth + 1,
      `rewind control escaped viewport ${JSON.stringify({ item, viewportWidth: snapshot.viewportWidth })}`,
    )
  }
}

function isExpectedFailedRewindConsole(text: string): boolean {
  return (
    text === "Failed to load resource: the server responded with a status of 503 ()" ||
    text === "rewind request failed 503 rewind failed by visual stress fixture"
  )
}

async function sendButtonState(page: OverlayPage) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("#chatSend")
    const textarea = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
    const appStore = (window as any).appStore
    const boardStore = (window as any).boardStore
    const settingsStore = (window as any).settingsStore
    return {
      disabled: button?.disabled ?? null,
      title: button?.getAttribute("title") ?? "",
      ariaLabel: button?.getAttribute("aria-label") ?? "",
      textareaDisabled: textarea?.disabled ?? null,
      textLength: textarea?.value?.length ?? 0,
      connected: appStore?.connected ?? null,
      directory: settingsStore?.directory ?? null,
      selectedSource: boardStore?.selectedSource ?? null,
      boardTaskID: boardStore?.board?.task?.id ?? null,
      activeModel: appStore?.config?.model ?? null,
    }
  }) as Promise<Record<string, unknown>>
}

async function clickRewind(page: OverlayPage, cardID: string) {
  await page.hover(`[data-card-id="${cardID}"]`)
  await page.click(`[data-card-id="${cardID}"] .card__rewind`)
  await page.waitForSelector("#appDialogBody", { visible: true })
  await page.click("#btnAppDialogOk")
}

test(
  `rewind visual stress exercises rewind, clear, failed rewind, reload, resume, and rapid operations on port ${PORT}`,
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const progressFile = resolve(SCREENSHOT_DIR, "progress.log")
    const screenshots: Array<{ name: string; file: string; stats: Awaited<ReturnType<typeof analyzePng>> }> = []
    const mark = (stage: string, extra: Record<string, unknown> = {}) => {
      appendFileSync(progressFile, `${new Date().toISOString()} ${stage} ${JSON.stringify(extra)}\n`)
    }
    mark("start")

    const base = Date.now() - 60_000
    const times = {
      t1: base + 1_000,
      t2: base + 2_000,
      t3: base + 3_000,
      t4: base + 4_000,
      t5: base + 5_000,
      t6: base + 6_000,
      t7: base + 7_000,
      t8: base + 8_000,
      branch: base + 20_000,
    }
    const sessions = [
      { sessionID: "ses_root", parentSessionID: "", goalID: "" },
      { sessionID: "ses_req", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_arch", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_plan", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_build", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_accept", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_integrity", parentSessionID: "ses_root", goalID: "" },
      { sessionID: "ses_orch", parentSessionID: "ses_root", goalID: "" },
    ]
    const baselineMessages: FixtureMessage[] = [
      message({
        id: "msg_user_1",
        sessionID: "ses_root",
        role: "user",
        channel: "main",
        resolvedRole: "user",
        agent: "user",
        created: times.t1,
        body: "RW-T1 user request",
      }),
      message({
        id: "msg_req_1",
        sessionID: "ses_req",
        channel: "requirements",
        resolvedRole: "requirements",
        agent: "requirements",
        created: times.t2,
        body: "RW-T2 requirements captured",
      }),
      message({
        id: "msg_arch_1",
        sessionID: "ses_arch",
        channel: "architect",
        resolvedRole: "architect",
        agent: "architect",
        created: times.t3,
        body: "RW-T3 architecture ready",
      }),
      message({
        id: "msg_plan_1",
        sessionID: "ses_plan",
        channel: "planner",
        resolvedRole: "planner",
        agent: "planner",
        created: times.t4,
        body: "RW-T4 plan anchor",
      }),
      message({
        id: "msg_build_1",
        sessionID: "ses_build",
        channel: "build",
        resolvedRole: "build",
        agent: "build",
        created: times.t5,
        body: "RW-T5 build output",
      }),
      message({
        id: "msg_accept_1",
        sessionID: "ses_accept",
        channel: "acceptance",
        resolvedRole: "acceptance",
        agent: "acceptance",
        created: times.t6,
        body: "RW-T6 acceptance result",
      }),
      message({
        id: "msg_integrity_1",
        sessionID: "ses_integrity",
        channel: "integrity",
        resolvedRole: "integrity",
        agent: "integrity",
        created: times.t7,
        body: "RW-T7 integrity review",
      }),
      message({
        id: "msg_orch_1",
        sessionID: "ses_orch",
        channel: "orchestrator",
        resolvedRole: "orchestrator",
        agent: "orchestrator",
        created: times.t8,
        body: "RW-T8 final orchestration tail",
      }),
    ]
    const branchUser = message({
      id: "msg_branch_user",
      sessionID: "ses_root",
      role: "user",
      channel: "main",
      resolvedRole: "user",
      agent: "user",
      created: times.branch,
      body: "RW-RESUME-NEW user branch",
    })
    const branchAssistant = message({
      id: "msg_branch_assistant",
      sessionID: "ses_orch",
      channel: "orchestrator",
      resolvedRole: "orchestrator",
      agent: "orchestrator",
      created: times.branch + 500,
      body: "RW-RESUME-NEW orchestrator continued",
    })

    const task = {
      id: TASK_ID,
      directory: PROJECT_ROOT,
      status: "running",
      sessionID: "ses_root",
      request: "RW-T1 user request",
      title: "Rewind visual stress",
      attachments: [],
      time: { created: times.t1, updated: times.t8 },
    }
    const promptProfileCatalog = {
      active: "front",
      project_active: "front",
      session_active: null,
      default: "front",
      targets: [
        { id: "requirements", label: "Requirements", description: "Requirements agent prompt.", editable: true, built_in_only: false },
        { id: "architect", label: "Architect", description: "Architect agent prompt.", editable: true, built_in_only: false },
        { id: "planner", label: "Planner", description: "Planner agent prompt.", editable: true, built_in_only: false },
        { id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false },
      ],
      profiles: [
        {
          id: "front",
          label: "Frontend",
          description: "Frontend rewind stress benchmark profile.",
          built_in: true,
          editable: false,
          agents: {},
        },
      ],
    }
    const browserPreviewTarget = {
      kind: "missing",
      status: "missing",
      projectRoot: PROJECT_ROOT,
      viewports: [
        { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
        { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
        { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
      ],
      diagnostics: ["No backend preview target is attached to the rewind stress fixture."],
      candidates: [],
      source: "none",
    }
    let sequence = 10
    let rewindCursor: number | null = null
    let rewindCount = 0
    let branchMode = false
    let failNextRewind = false
    const requestLog: string[] = []
    const errors: string[] = []
    const sseClients: SseClient[] = []
    const rewindRequests: unknown[] = []
    const messageRequests: unknown[] = []

    const visibleMessages = () => {
      const source = branchMode
        ? [...baselineMessages.filter((item) => item.info.time.created <= times.t4), branchUser, branchAssistant]
        : baselineMessages
      return rewindCursor == null ? source : source.filter((item) => item.info.time.created <= rewindCursor!)
    }
    const board = () => ({
      snapshotVersion: `rewind-visual-stress-${sequence}-${rewindCursor ?? "none"}-${branchMode ? "branch" : "main"}`,
      lastSequence: sequence,
      task: { ...task, time: { ...task.time, updated: Date.now() } },
      overview: {
        headline: "Rewind visual stress",
        summary: "Fixture board for visual rewind validation.",
        controls: {},
      },
      lanes: [],
      interactions: [],
      goalWorkflows: [],
      rewindCursor,
    })
    const conversation = () => ({
      lastSequence: sequence,
      messageWatermark: sequence,
      board: board(),
      transcript: visibleMessages(),
      timeline: [],
      events: [],
      eventReplay: {
        cursor: sequence,
        latestSequence: sequence,
        complete: true,
        limit: 100,
        sinceTimestamp: null,
      },
      history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
      view: { rootID: "root", sessions, cards: {}, order: [] },
      agentView: { rootID: "root", sessions, cards: {}, order: [] },
    })
    const emitTaskRewound = (cursorTime: number, resetWorktree = false) => {
      sequence += 1
      pushEvent(sseClients, {
        type: "task.rewound",
        taskID: TASK_ID,
        sequence,
        properties: {
          taskID: TASK_ID,
          cursorTime,
          rewindCount,
          resetWorktree,
          anchorKind: "cursorTime",
        },
      })
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${url.pathname}${url.search}`)
      if (path.includes("rewind") || path.includes("conversation") || path.endsWith("/events")) {
        mark("request", { method: req.method, path: `${url.pathname}${url.search}` })
      }
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") {
        return json({
          version: "1.2.3",
          paths: {
            database: `${PROJECT_ROOT}/.opencorvus/opencorvus.db`,
            data: `${PROJECT_ROOT}/.opencorvus/data`,
            home: `${PROJECT_ROOT}/.opencorvus`,
          },
        })
      }
      if (path === "/mission") return json([])
      if (path === "/global/projects/discover") return json([])
      if (path === "/project/current/worktrees") return json([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
      if (path === "/global/tasks" || path === "/tasks") return json({ tasks: [{ task, updated_at: Date.now() }] })
      if (path === "/path") return json({ directory: PROJECT_ROOT })
      if (path === "/vcs") {
        return json({
          branch: "rewind-visual-stress",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/provider") {
        return json({
          all: [{ id: "openai", name: "OpenAI", models: ["openai/gpt-5-mini"] }],
          connected: ["openai"],
          default: { provider: "openai", model: "openai/gpt-5-mini" },
        })
      }
      if (path === "/provider/auth") return json({ openai: { ok: true, authenticated: true } })
      if (path === "/provider/hexin/budget") return json({ ok: true })
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config/prompt-profile") return json(promptProfileCatalog)
      if (path === "/config" && req.method === "PATCH") return json(await req.json())
      if (path === "/config") return json({ model: "openai/gpt-5-mini", prompt_profile: { active: "front" } })
      if (path === "/config/prompt") return json([])
      if (path === "/channel") return json([])
      if (path === "/executor") return json([])
      if (path === "/agent") return json([])
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return json([])
      if (path === "/mcp") return json({})
      if (path === "/panel/knowledge/memory") return json([])
      if (path === "/panel/knowledge/preference") return json([])
      if (path === "/log" && req.method === "POST") return json({ ok: true })
      if (path === `/task/${TASK_ID}/operator-model-context`) return json({ selected: null, candidates: [] })
      if (path === `/task/${TASK_ID}/board`) return json(board(), { headers: { etag: `"board-${sequence}"` } })
      if (path === `/task/${TASK_ID}/conversation`) return json(conversation())
      if (path === `/task/${TASK_ID}/conversation/events`) {
        return json({
          events: [],
          eventReplay: { cursor: sequence, latestSequence: sequence, complete: true, limit: 100, sinceTimestamp: null },
        })
      }
      if (path === `/task/${TASK_ID}/transcript`) return json(visibleMessages())
      if (path === `/task/${TASK_ID}/trace`) return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace`, enabled: true })
      if (path === `/task/${TASK_ID}/browser-preview`) return json(browserPreviewTarget)
      if (path === "/control/timeline") return json([])
      if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream(sseClients, path)
      if (path === `/task/${TASK_ID}/rewind` && req.method === "POST") {
        const body = await req.json()
        rewindRequests.push(body)
        if (failNextRewind) {
          failNextRewind = false
          return text("rewind failed by visual stress fixture", { status: 503 })
        }
        const cursorTime = Number((body as any)?.anchor?.cursorTime)
        assert.ok(Number.isFinite(cursorTime) && cursorTime > 0, `invalid rewind cursor ${JSON.stringify(body)}`)
        rewindCursor = cursorTime
        rewindCount += 1
        setTimeout(() => emitTaskRewound(cursorTime, (body as any)?.resetWorktree === true), 0)
        return json({
          taskID: TASK_ID,
          cursorTime,
          rewindCount,
          resetWorktree: (body as any)?.resetWorktree === true,
          anchorKind: "cursorTime",
        })
      }
      if (path === `/task/${TASK_ID}/rewind/clear` && req.method === "POST") {
        mark("fixture-clear-start")
        rewindCursor = null
        branchMode = false
        setTimeout(() => emitTaskRewound(0, false), 0)
        mark("fixture-clear-return")
        return json(true)
      }
      if (path === `/task/${TASK_ID}/message` && req.method === "POST") {
        const body = await req.json()
        messageRequests.push(body)
        rewindCursor = null
        branchMode = true
        setTimeout(() => emitTaskRewound(0, false), 0)
        return json({ user_message: branchUser })
      }
      if (path === `/task/${TASK_ID}/followup` && req.method === "POST") return json({ suggestion: "" })
      return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
    }, { port: PORT })
    assert.equal(server.port, PORT)

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument(
        (serverUrl) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_server_url", serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_directory", "D:/overlay/workspace/rewind-stress")
          localStorage.setItem("oc_directory_mode", "custom")
          localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/rewind-stress")
          localStorage.setItem("oc_workspace_task", "tsk_rewind_visual_stress")
          const settings = {
            serverUrl,
            autoServer: false,
            locale: "en-US",
            directory: "D:/overlay/workspace/rewind-stress",
            directoryMode: "custom",
            workspaceDirectory: "D:/overlay/workspace/rewind-stress",
            workspaceTaskID: "tsk_rewind_visual_stress",
          }
          ;(window as any).__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") return settings
                if (command === "overlay_settings_save") {
                  Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                  return true
                }
                if (command === "overlay_open_path") return true
                if (command === "overlay_open_url") return true
                return null
              },
            },
            window: {
              getCurrentWindow() {
                return {
                  close: async () => true,
                  hide: async () => true,
                  startDragging: async () => true,
                  minimize: async () => true,
                  isMaximized: async () => false,
                  onResized: async () => ({ unlisten: async () => undefined }),
                }
              },
            },
          }
        },
        server.origin,
      )
      page.on("pageerror", (error) => errors.push(`pageerror: ${(error as Error).message}`))
      page.on("close", () => mark("page-close"))
      page.on("requestfailed", (request) => {
        const item = request as { url?: () => string; method?: () => string; failure?: () => { errorText?: string } | null }
        mark("request-failed", {
          method: item.method?.() || "",
          url: item.url?.() || "",
          error: item.failure?.()?.errorText || "",
        })
      })
      page.on("console", (message) => {
        const item = message as { type?: () => string; text?: () => string }
        if (item.type?.() === "error") {
          const text = item.text?.() || ""
          if (isExpectedFailedRewindConsole(text)) {
            mark("expected-console-error", { text })
            return
          }
          errors.push(`console: ${text}`)
          mark("console-error", { text })
        }
      })
      page.on("response", (response) => {
        const item = response as { status?: () => number; url?: () => string }
        const status = item.status?.() ?? 0
        if (status >= 400 && !item.url?.().includes("/rewind")) {
          const url = item.url?.() || ""
          errors.push(`response${status}: ${url}`)
          mark("response-error", { status, url })
        }
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      mark("goto-complete")
      await waitForVisualState(
        page,
        "baseline full rewind fixture",
        (snapshot) => baselineMessages.every((item) => snapshot.text.includes(item.parts[0]!.text)),
        () => ({ requestLog, errors }),
      )
      let snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertVisible(snapshot, ["RW-T1 user request", "RW-T4 plan anchor", "RW-T8 final orchestration tail"])
      screenshots.push({ name: "01-baseline", ...(await screenshotPanel(page, "01-baseline")) })
      mark("baseline-complete", { requestCount: requestLog.length })

      await waitForVisualState(
        page,
        "task stream open",
        () => sseClients.some((client) => client.path === `/task/${TASK_ID}/events` && !client.closed),
        () => ({ requestLog, streamCount: sseClients.length }),
      )

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      mark("clicked-plan-rewind")
      await waitForVisualState(
        page,
        "view-only rewind pruned tail",
        (item) => item.rewindCursor === times.t4 && item.text.includes("RW-T4 plan anchor") && !item.text.includes("RW-T5 build output"),
        () => ({ requestLog, rewindRequests, errors }),
      )
      assert.equal((rewindRequests.at(-1) as any)?.resetWorktree, false)
      assert.equal((rewindRequests.at(-1) as any)?.anchor?.cursorTime, times.t4)
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertVisible(snapshot, ["RW-T1 user request", "RW-T4 plan anchor"])
      assertHidden(snapshot, ["RW-T5 build output", "RW-T8 final orchestration tail"])
      screenshots.push({ name: "02-view-rewind", ...(await screenshotPanel(page, "02-view-rewind")) })
      mark("view-rewind-complete", { requestCount: requestLog.length, rewindRequests: rewindRequests.length })

      mark("clear-fetch-before")
      const clearStatus = await page.evaluate(
        async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status,
        TASK_ID,
      )
      mark("clear-fetch-after", { clearStatus })
      mark("clear-wait-before")
      await waitForVisualState(
        page,
        "clear rewind restores visible tail",
        (item) => item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindRequests, errors, streamCount: sseClients.length }),
      )
      mark("clear-wait-after")
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertCardsContain(snapshot, ["RW-T1 user request", "RW-T5 build output", "RW-T8 final orchestration tail"])
      assertVisible(snapshot, ["RW-T8 final orchestration tail"])
      screenshots.push({ name: "03-clear-restored", ...(await screenshotPanel(page, "03-clear-restored")) })

      failNextRewind = true
      await clickRewind(page, "architect:session:ses_arch:message:msg_arch_1")
      await waitForVisualState(
        page,
        "failed rewind leaves authoritative tail visible",
        (item) => item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindRequests, errors }),
      )
      snapshot = await visualSnapshot(page)
      assertCardsContain(snapshot, ["RW-T3 architecture ready", "RW-T8 final orchestration tail"])
      screenshots.push({ name: "04-failed-rewind", ...(await screenshotPanel(page, "04-failed-rewind")) })

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "rewind before reload",
        (item) => item.rewindCursor === times.t4 && !item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "reload filtered rewind",
        (item) => item.text.includes("RW-T4 plan anchor") && !item.text.includes("RW-T5 build output"),
        () => ({ requestLog, errors }),
      )
      screenshots.push({ name: "05-reload-filtered", ...(await screenshotPanel(page, "05-reload-filtered")) })

      await page.evaluate(async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status, TASK_ID)
      await waitForVisualState(
        page,
        "clear after reload restores full tail",
        (item) => item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "reload cleared full timeline",
        (item) => item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      screenshots.push({ name: "06-reload-cleared", ...(await screenshotPanel(page, "06-reload-cleared")) })

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "rewind before resume branch",
        (item) => item.rewindCursor === times.t4 && !item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      await page.type("#solidChatComposer textarea", "Continue from the rewound point with a new branch")
      await page.waitForFunction(
        () => {
          const button = document.querySelector<HTMLButtonElement>("#chatSend")
          return !!button && !button.disabled
        },
        { timeout: 5_000 },
      ).catch(async (error) => {
        const state = await sendButtonState(page)
        mark("send-disabled", state)
        throw new Error(`chat send stayed disabled before resume branch: ${JSON.stringify(state)}\n${(error as Error).message}`)
      })
      await page.click("#chatSend")
      await waitForVisualState(
        page,
        "resume branch visible after rewind",
        (item) =>
          item.rewindCursor === null &&
          item.text.includes("RW-RESUME-NEW user branch") &&
          item.text.includes("RW-T4 plan anchor") &&
          !item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, messageRequests, errors }),
      )
      assert.equal((messageRequests.at(-1) as any)?.text, "Continue from the rewound point with a new branch")
      screenshots.push({ name: "07-resume-branch", ...(await screenshotPanel(page, "07-resume-branch")) })

      branchMode = false
      rewindCursor = null
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "baseline restored before rapid stress",
        (item) => item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      await clickRewind(page, "acceptance:session:ses_accept:message:msg_accept_1")
      await waitForVisualState(page, "rapid rewind T6", (item) => item.rewindCursor === times.t6, () => ({ requestLog, errors }))
      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(page, "rapid rewind T4", (item) => item.rewindCursor === times.t4, () => ({ requestLog, errors }))
      await clickRewind(page, "requirements:session:ses_req:message:msg_req_1")
      await waitForVisualState(page, "rapid rewind T2", (item) => item.rewindCursor === times.t2, () => ({ requestLog, errors }))
      await page.evaluate(async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status, TASK_ID)
      await waitForVisualState(
        page,
        "rapid clear returns baseline",
        (item) => item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assert.equal(new Set(snapshot.order).size, snapshot.order.length, `duplicate top-level cards ${snapshot.order.join(",")}`)
      for (const [id, card] of Object.entries(snapshot.cards)) {
        for (const childID of card.childIDs) {
          assert.ok(snapshot.cards[childID], `card ${id} references missing child ${childID}`)
        }
      }
      screenshots.push({ name: "08-rapid-clear", ...(await screenshotPanel(page, "08-rapid-clear")) })

      writeFileSync(
        resolve(SCREENSHOT_DIR, "report.json"),
        JSON.stringify(
          {
            requestLog,
            rewindRequests,
            messageRequests,
            screenshots,
            streamPaths: sseClients.map((item) => item.path),
            finalSnapshot: snapshot,
          },
          null,
          2,
        ),
      )
      assert.equal(errors.length, 0, errors.join("\n"))
    } finally {
      closeStreams(sseClients)
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
