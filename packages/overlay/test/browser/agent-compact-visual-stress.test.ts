import assert from "node:assert/strict"
import test from "node:test"
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

const PORT = 7378
const TASK_ID = "tsk_agent_compact_visual_stress"
const PROJECT_ROOT = "D:/overlay/workspace/compact-stress"
const SCREENSHOT_DIR = fileURLToPath(new URL("../../.scratch/agent-compact-visual-stress/", import.meta.url))

await ensureOverlayDist()

type FixtureMessage = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    resolvedRole: string
    channel: string
    agent: string
    parentSessionID?: string
    goalID?: string
    time: { created: number; completed?: number }
    tokens?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
    cost?: { total?: number }
    providerID?: string
    modelID?: string
    summary?: boolean
  }
  parts: Array<{ id: string; messageID: string; sessionID: string; type: "text"; text: string }>
}

type SseClient = {
  path: string
  controller: ReadableStreamDefaultController<Uint8Array>
  closed: boolean
}

type VisualSnapshot = Awaited<ReturnType<typeof visualSnapshot>>

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
  parentSessionID?: string
  goalID?: string
  tokens?: FixtureMessage["info"]["tokens"]
  cost?: FixtureMessage["info"]["cost"]
  summary?: boolean
}): FixtureMessage {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      role: input.role ?? "assistant",
      resolvedRole: input.resolvedRole,
      channel: input.channel,
      agent: input.agent,
      ...(input.parentSessionID ? { parentSessionID: input.parentSessionID } : {}),
      ...(input.goalID ? { goalID: input.goalID } : {}),
      time: { created: input.created },
      ...(input.tokens ? { tokens: input.tokens } : {}),
      ...(input.cost ? { cost: input.cost } : {}),
      providerID: "openai",
      modelID: "openai/gpt-5-mini",
      ...(input.summary ? { summary: true } : {}),
    },
    parts: [
      { id: `part_${input.id}`, messageID: input.id, sessionID: input.sessionID, type: "text", text: input.body },
    ],
  }
}

function messageUpdatedEvent(item: FixtureMessage, sequence: number) {
  return {
    type: "message.updated",
    taskID: TASK_ID,
    sequence,
    emittedAt: item.info.time.created,
    properties: { info: item.info },
  }
}

function partUpdatedEvent(item: FixtureMessage, sequence: number) {
  return {
    type: "message.part.updated",
    taskID: TASK_ID,
    sequence,
    emittedAt: item.info.time.created,
    properties: { part: item.parts[0] },
  }
}

function sessionStatusEvent(input: {
  sessionID: string
  sequence: number
  reason: "completed" | "error" | "aborted"
  message?: string
  emittedAt: number
  channel?: string
}) {
  return {
    type: "session.status",
    taskID: TASK_ID,
    sequence: input.sequence,
    emittedAt: input.emittedAt,
    properties: {
      sessionID: input.sessionID,
      channel: input.channel ?? "build",
      status: {
        type: "terminal",
        reason: input.reason,
        ...(input.message ? { message: input.message } : {}),
      },
    },
  }
}

function compactedEvent(sequence: number, sessionID: string, emittedAt: number) {
  return {
    type: "session.compacted",
    taskID: TASK_ID,
    sequence,
    emittedAt,
    properties: {
      sessionID,
      source: "automatic",
      tail_start_id: "msg_user_tail_anchor",
      anchor_id: "msg_user_compact_anchor",
    },
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

function pushEvent(clients: SseClient[], streamLog: unknown[], event: unknown) {
  streamLog.push(event)
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

async function screenshotAgentRail(page: OverlayPage, name: string) {
  await page.waitForSelector(".conversation-agent-rail", { visible: true })
  const element = await page.$(".conversation-agent-rail")
  assert.ok(element, `${name}: agent rail missing`)
  const screenshot = await element.screenshot({})
  const file = resolve(SCREENSHOT_DIR, `${name}.png`)
  writeFileSync(file, screenshot)
  const stats = await analyzePng(screenshot)
  assert.ok(stats.width >= 90 && stats.height >= 32, `${name}: invalid screenshot size ${JSON.stringify(stats)}`)
  assert.ok(stats.nonWhiteDensity > 0.03, `${name}: screenshot lacks UI pixels ${JSON.stringify(stats)}`)
  assert.ok(stats.uniqueColorBuckets > 12, `${name}: screenshot is visually too sparse ${JSON.stringify(stats)}`)
  return { file, stats }
}

async function focusAgentRailLocateButton(page: OverlayPage) {
  const selector = '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]'
  await page.waitForSelector(selector, { visible: true })
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  for (let index = 0; index < 80; index += 1) {
    const state = await page.evaluate((targetSelector) => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !active.matches(targetSelector)) return null
      const rect = active.getBoundingClientRect()
      const style = getComputedStyle(active)
      return {
        tagName: active.tagName,
        className: active.className,
        ariaLabel: active.getAttribute("aria-label") || "",
        title: active.getAttribute("title") || "",
        focusVisible: active.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }, selector)
    if (state) return state
    await page.keyboard.press("Tab")
  }
  assert.fail("Unable to reach ConversationAgentRail locate button through keyboard Tab navigation")
}

async function settleFrame(page: OverlayPage) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function scrollMarkerIntoView(page: OverlayPage, marker: string) {
  await page.evaluate((text) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]"))
    const target = cards.find((element) => (element.textContent || "").includes(String(text)))
    target?.scrollIntoView({ block: "center", inline: "nearest" })
  }, marker)
  await settleFrame(page)
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
        role: element.dataset.role || "",
        stage: element.dataset.stage || "",
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 320) || "",
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
    const compactTexts = visibleCards
      .filter((item) => /compact|Compaction|StructuredOutputPayloadError|ContextOverflowError|resume/i.test(item.text))
      .map((item) => ({ id: item.id, text: item.text, rect: item.rect }))
    const notifications = Array.from(document.querySelectorAll<HTMLElement>(".app-notification")).map(
      (element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) || "",
    )
    const cardsByID = Object.fromEntries(
      Object.entries(cards).map(([id, card]: [string, any]) => [
        id,
        {
          kind: card?.kind || "",
          stage: card?.stage || "",
          status: card?.status || "",
          terminalReason: card?.terminalReason || "",
          errorReason: card?.errorReason || "",
          time: Number(card?.time || 0),
          childIDs: Array.isArray(card?.childIDs) ? [...card.childIDs] : [],
          partText: Array.isArray(card?.parts)
            ? card.parts
                .map((part: any) => String(part?.text || part?.state?.output || part?.state?.raw || ""))
                .join("\n")
            : "",
        },
      ]),
    )
    return {
      order,
      cards: cardsByID,
      text: document.body.textContent?.replace(/\s+/g, " ").slice(0, 9000) || "",
      visibleCards,
      compactTexts,
      notifications,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
      renderErrors: visibleCards.filter((item) => item.kind === "render-error").map((item) => item.text),
    }
  }) as Promise<{
    order: string[]
    cards: Record<
      string,
      {
        kind: string
        stage: string
        status: string
        terminalReason: string
        errorReason: string
        time: number
        childIDs: string[]
        partText: string
      }
    >
    text: string
    visibleCards: Array<{
      id: string
      kind: string
      role: string
      stage: string
      text: string
      rect: Record<string, number>
    }>
    compactTexts: Array<{ id: string; text: string; rect: Record<string, number> }>
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
  predicate: (snapshot: VisualSnapshot) => boolean,
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
      cards: Object.entries(snapshot.cards).map(([id, card]) => ({
        id,
        kind: card.kind,
        stage: card.stage,
        status: card.status,
        terminalReason: card.terminalReason,
        errorReason: card.errorReason,
        time: card.time,
        childIDs: card.childIDs,
        partText: card.partText.slice(0, 1200),
      })),
      notifications: snapshot.notifications,
      renderErrors: snapshot.renderErrors,
      visible: snapshot.visibleCards.map((item) => `${item.id}:${item.text.slice(0, 100)}`),
    })
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > idleTimeoutMs) {
      assert.fail(
        `No page activity while waiting for ${label}\n${JSON.stringify({ snapshot, diagnostics: diagnostics() }, null, 2)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function assertVisible(snapshot: VisualSnapshot, markers: string[]) {
  for (const marker of markers) {
    assert.ok(
      snapshot.text.includes(marker),
      `expected marker visible: ${marker}\n${JSON.stringify(snapshot, null, 2)}`,
    )
  }
}

function assertNoLayoutBreakage(snapshot: VisualSnapshot) {
  assert.equal(
    snapshot.renderErrors.length,
    0,
    `render errors present\n${JSON.stringify(snapshot.renderErrors, null, 2)}`,
  )
  assert.ok(snapshot.bodyOverflowX <= 1, `body horizontal overflow\n${JSON.stringify(snapshot, null, 2)}`)
  const ids = snapshot.order.filter(Boolean)
  assert.equal(
    new Set(ids).size,
    ids.length,
    `duplicate top-level card IDs\n${JSON.stringify(snapshot.order, null, 2)}`,
  )
  const known = new Set(Object.keys(snapshot.cards))
  for (const [id, card] of Object.entries(snapshot.cards)) {
    for (const childID of card.childIDs) {
      assert.ok(known.has(childID), `orphan childID ${childID} under ${id}\n${JSON.stringify(snapshot, null, 2)}`)
      assert.notEqual(childID, id, `self childID ${childID}\n${JSON.stringify(snapshot, null, 2)}`)
    }
  }
}

function assertChronology(snapshot: VisualSnapshot, markers: string[]) {
  let cursor = -1
  for (const marker of markers) {
    const next = snapshot.text.indexOf(marker)
    assert.ok(
      next > cursor,
      `marker order failed for ${marker}\n${JSON.stringify({ cursor, next, text: snapshot.text }, null, 2)}`,
    )
    cursor = next
  }
}

test(
  `agent compact visual stress covers hydrate, live timing, failures, reload, resume, and narrow layout on port ${PORT}`,
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const progressFile = resolve(SCREENSHOT_DIR, "progress.log")
    const reportFile = resolve(SCREENSHOT_DIR, "report.json")
    const screenshots: Array<{ name: string; file: string; stats: Awaited<ReturnType<typeof analyzePng>> }> = []
    const snapshots: Record<string, VisualSnapshot> = {}
    const mark = (stage: string, extra: Record<string, unknown> = {}) => {
      appendFileSync(progressFile, `${new Date().toISOString()} ${stage} ${JSON.stringify(extra)}\n`)
    }

    const base = Date.now() - 120_000
    const times = {
      user: base + 1_000,
      preCompact: base + 2_000,
      compactSummary: base + 3_000,
      resumed: base + 4_000,
      unsupported: base + 5_000,
      liveSummary: base + 20_000,
      liveResume: base + 21_000,
      validation: base + 22_000,
    }
    const buildSessionID = "ses_build_compact_primary"
    const liveSessionID = "ses_build_compact_live"
    const validationSessionID = "ses_build_compact_validation"
    const unsupportedSessionID = "ses_architect_compact_disabled"
    const sessions = [
      { sessionID: "ses_root", parentSessionID: "", goalID: "" },
      { sessionID: buildSessionID, parentSessionID: "ses_root", goalID: "" },
      { sessionID: liveSessionID, parentSessionID: "ses_root", goalID: "" },
      { sessionID: validationSessionID, parentSessionID: "ses_root", goalID: "" },
      { sessionID: unsupportedSessionID, parentSessionID: "ses_root", goalID: "" },
    ]

    const largeHandoff = [
      "AGC-COMPACT-CHECKPOINT Compaction checkpoint for goal overlay compact stress.",
      "",
      "Objective: preserve the exact acceptance criteria, active build contracts, durable instruction sources, and next actions after compaction.",
      "",
      "Acceptance criteria:",
      "- AGC-CRITERIA-01 automatic compaction must happen only when live runtime continuation is available.",
      "- AGC-CRITERIA-02 compact summary must retain task requirements after context pressure.",
      "- AGC-CRITERIA-03 resumed build output must appear after compact summary.",
      "- AGC-CRITERIA-04 reload must hydrate compact and resumed messages without duplicates.",
      "",
      "Durable instruction sources:",
      "- AGENTS.md",
      "- specs/new-arch/2026-06-04-workflow-auto-compaction-live-continuation.md",
      "- specs/new-arch/2026-06-03-compaction-dispatch-anchor-bounded-reference.md",
      "- specs/new-arch/2026-06-06-compaction-instruction-path-match.md",
      "",
      "Working context:",
      "The compact input crossed 154000 context tokens. The tail start is msg_user_tail_anchor. The dispatch anchor keeps full text by anchor_id, while the compact prompt carries only a bounded reference.",
      "",
      `Evidence: ${"visual compact evidence row ".repeat(30)}`,
      `Files: ${"packages/opencorvus/src/session/compaction.ts packages/overlay/src/services/tree-writer.ts ".repeat(12)}`,
      `Commands: ${"node test/browser-runner.mjs test/browser/agent-compact-visual-stress.test.ts ".repeat(8)}`,
      "",
      "Next actions:",
      "- AGC-NEXT-01 continue the build session from the resumed prompt.",
      "- AGC-NEXT-02 keep validation failure visible if structured handoff parsing fails.",
      "- AGC-NEXT-03 inspect screenshots after benchmark pass.",
    ].join("\n")

    const baselineMessages: FixtureMessage[] = [
      message({
        id: "msg_user_compact_anchor",
        sessionID: "ses_root",
        role: "user",
        channel: "main",
        resolvedRole: "user",
        agent: "user",
        created: times.user,
        body: "AGC-USER-ANCHOR user asks the goal overlay to survive compaction under long-running agent pressure.",
      }),
      message({
        id: "msg_precompact_pressure",
        sessionID: buildSessionID,
        channel: "build",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: "ses_root",
        created: times.preCompact,
        tokens: { input: 151_200, output: 3_400, cache_read: 8_000, cache_write: 1_200 },
        cost: { total: 1.23 },
        body: "AGC-PRECOMPACT high context build output before automatic compaction. The agent is still running with visible usage pressure.",
      }),
      message({
        id: "msg_compact_summary_hydrated",
        sessionID: buildSessionID,
        channel: "build",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: "ses_root",
        created: times.compactSummary,
        summary: true,
        tokens: { input: 154_900, output: 1_900, cache_read: 12_000 },
        cost: { total: 0.42 },
        body: largeHandoff,
      }),
      message({
        id: "msg_resumed_after_compact",
        sessionID: buildSessionID,
        channel: "build",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: "ses_root",
        created: times.resumed,
        tokens: { input: 26_000, output: 1_100, cache_read: 2_100 },
        cost: { total: 0.18 },
        body: "AGC-RESUME-AFTER-COMPACT resumed build output uses the compact handoff and continues without losing acceptance criteria.",
      }),
      message({
        id: "msg_unsupported_auto_compact",
        sessionID: unsupportedSessionID,
        channel: "architect",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: "ses_root",
        created: times.unsupported,
        body: "AGC-UNSUPPORTED-AUTO-COMPACT Automatic compaction disabled for architect without live runtime continuation. ContextOverflowError remains visible instead of a hidden compact success.",
      }),
    ]

    const liveSummary = message({
      id: "msg_live_compact_summary",
      sessionID: liveSessionID,
      channel: "build",
      resolvedRole: "build",
      agent: "build",
      parentSessionID: "ses_root",
      created: times.liveSummary,
      summary: true,
      body: "AGC-LIVE-COMPACT-SUMMARY live compact summary arrived after session.compacted. It is the first visible evidence for the compact event.",
    })
    const liveResume = message({
      id: "msg_live_resume_after_compact",
      sessionID: liveSessionID,
      channel: "build",
      resolvedRole: "build",
      agent: "build",
      parentSessionID: "ses_root",
      created: times.liveResume,
      body: "AGC-LIVE-RESUME-AFTER-COMPACT resume after live compact remains visible after the compact summary.",
    })
    const validationFailure = message({
      id: "msg_compact_validation_failure",
      sessionID: validationSessionID,
      channel: "build",
      resolvedRole: "build",
      agent: "build",
      parentSessionID: "ses_root",
      created: times.validation,
      body: "AGC-VALIDATION-FAILURE StructuredOutputPayloadError: required field acceptanceCriteria missing from CompactionHandoff. Resume must not be shown as success for this failed compact.",
    })

    let sequence = 20
    let streamed = false
    const transcriptMessages = () =>
      streamed ? [...baselineMessages, liveSummary, liveResume, validationFailure] : baselineMessages
    const task = {
      id: TASK_ID,
      directory: PROJECT_ROOT,
      status: "running",
      sessionID: "ses_root",
      request: "AGC-USER-ANCHOR user asks the goal overlay to survive compaction under long-running agent pressure.",
      title: "Agent compact visual stress",
      attachments: [],
      time: { created: times.user, updated: Date.now() },
    }
    const board = () => ({
      snapshotVersion: `agent-compact-visual-stress-${sequence}-${streamed ? "streamed" : "baseline"}`,
      lastSequence: sequence,
      task: { ...task, time: { ...task.time, updated: Date.now() } },
      overview: {
        headline: "Agent compact visual stress",
        summary: "Fixture board for compaction preview validation.",
        controls: {},
      },
      lanes: [],
      interactions: [],
      goalWorkflows: [],
    })
    const conversation = () => ({
      lastSequence: sequence,
      messageWatermark: sequence,
      board: board(),
      transcript: transcriptMessages(),
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
    const promptProfileCatalog = {
      active: "compact",
      project_active: "compact",
      session_active: null,
      default: "compact",
      targets: [
        { id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false },
        {
          id: "architect",
          label: "Architect",
          description: "Architect agent prompt.",
          editable: true,
          built_in_only: false,
        },
      ],
      profiles: [
        {
          id: "compact",
          label: "Compact Stress",
          description: "Agent compact visual benchmark profile.",
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
        { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
      ],
      diagnostics: ["No backend preview target is attached to the compact stress fixture."],
      candidates: [],
      source: "none",
    }
    const requestLog: string[] = []
    const streamLog: unknown[] = []
    const errors: string[] = []
    const sseClients: SseClient[] = []

    const server = await startBrowserFixture(
      async (req) => {
        const url = new URL(req.url)
        const path = route(url)
        requestLog.push(`${req.method} ${url.pathname}${url.search}`)
        if (path === "/" || path === "/ui" || path === "/ui/")
          return Response.redirect(`${url.origin}/ui/index.html`, 302)
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
            branch: "agent-compact-visual-stress",
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
        if (path === "/config") return json({ model: "openai/gpt-5-mini", prompt_profile: { active: "compact" } })
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
            eventReplay: {
              cursor: sequence,
              latestSequence: sequence,
              complete: true,
              limit: 100,
              sinceTimestamp: null,
            },
          })
        }
        if (path === `/task/${TASK_ID}/transcript`) return json(transcriptMessages())
        if (path === `/task/${TASK_ID}/trace`)
          return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace`, enabled: true })
        if (path === `/task/${TASK_ID}/browser-preview`) return json(browserPreviewTarget)
        if (path === "/control/timeline") return json([])
        if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream(sseClients, path)
        if (path === `/task/${TASK_ID}/followup` && req.method === "POST") return json({ suggestion: "" })
        return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
      },
      { port: PORT },
    )
    assert.equal(server.port, PORT)

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_right_panel_collapsed", "true")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/compact-stress")
        localStorage.setItem("oc_directory_mode", "custom")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/compact-stress")
        localStorage.setItem("oc_workspace_task", "tsk_agent_compact_visual_stress")
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/compact-stress",
          directoryMode: "custom",
          workspaceDirectory: "D:/overlay/workspace/compact-stress",
          workspaceTaskID: "tsk_agent_compact_visual_stress",
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
      }, server.origin)
      page.on("pageerror", (error) => errors.push(`pageerror: ${(error as Error).stack || (error as Error).message}`))
      page.on("requestfailed", (request) => {
        const item = request as {
          url?: () => string
          method?: () => string
          failure?: () => { errorText?: string } | null
        }
        const url = item.url?.() || ""
        const errorText = item.failure?.()?.errorText || ""
        if (url.includes("/events") && errorText.includes("net::ERR_ABORTED")) {
          mark("expected-sse-abort", { method: item.method?.() || "", url, errorText })
          return
        }
        errors.push(`requestfailed: ${item.method?.() || ""} ${url} ${errorText}`)
      })
      page.on("console", (message) => {
        const item = message as { type?: () => string; text?: () => string }
        if (item.type?.() === "error") errors.push(`console: ${item.text?.() || ""}`)
      })
      page.on("response", (response) => {
        const item = response as { status?: () => number; url?: () => string }
        const status = item.status?.() ?? 0
        if (status >= 400) errors.push(`response${status}: ${item.url?.() || ""}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      mark("goto-complete")
      let snapshot = await waitForVisualState(
        page,
        "hydrated compact baseline",
        (item) =>
          item.text.includes("AGC-PRECOMPACT") &&
          item.text.includes("AGC-COMPACT-CHECKPOINT") &&
          item.text.includes("AGC-RESUME-AFTER-COMPACT") &&
          item.text.includes("AGC-UNSUPPORTED-AUTO-COMPACT"),
        () => ({ requestLog, streamLog, errors }),
      )
      assertNoLayoutBreakage(snapshot)
      assertVisible(snapshot, [
        "AGC-USER-ANCHOR",
        "AGC-PRECOMPACT",
        "AGC-COMPACT-CHECKPOINT",
        "AGC-RESUME-AFTER-COMPACT",
        "AGC-UNSUPPORTED-AUTO-COMPACT",
        "ContextOverflowError",
      ])
      assertChronology(snapshot, ["AGC-PRECOMPACT", "AGC-COMPACT-CHECKPOINT", "AGC-RESUME-AFTER-COMPACT"])
      snapshots["01-hydrated-compact"] = snapshot
      const railFocus = await focusAgentRailLocateButton(page)
      assert.equal(railFocus.tagName, "BUTTON")
      assert.match(railFocus.className, /\boc-button\b/)
      assert.equal(railFocus.ariaLabel.length > 0, true)
      assert.equal(railFocus.ariaLabel, railFocus.title)
      assert.equal(railFocus.focusVisible, true)
      assert.notEqual(railFocus.outlineStyle, "none")
      assert.notEqual(railFocus.outlineWidth, "0px")
      assert.ok(railFocus.width >= 30)
      assert.ok(railFocus.height >= 30)
      screenshots.push({ name: "00-agent-rail-focus", ...(await screenshotAgentRail(page, "00-agent-rail-focus")) })
      await scrollMarkerIntoView(page, "AGC-COMPACT-CHECKPOINT")
      screenshots.push({ name: "01-hydrated-compact", ...(await screenshotPanel(page, "01-hydrated-compact")) })
      mark("hydrated-complete")

      await waitForVisualState(
        page,
        "task stream open",
        () => sseClients.some((client) => client.path === `/task/${TASK_ID}/events` && !client.closed),
        () => ({ requestLog, streamCount: sseClients.length, errors }),
      )

      sequence += 1
      pushEvent(sseClients, streamLog, compactedEvent(sequence, liveSessionID, times.liveSummary - 250))
      sequence += 1
      pushEvent(sseClients, streamLog, messageUpdatedEvent(liveSummary, sequence))
      sequence += 1
      pushEvent(sseClients, streamLog, partUpdatedEvent(liveSummary, sequence))
      sequence += 1
      pushEvent(
        sseClients,
        streamLog,
        sessionStatusEvent({
          sessionID: liveSessionID,
          sequence,
          reason: "completed",
          emittedAt: times.liveSummary + 250,
        }),
      )
      sequence += 1
      pushEvent(sseClients, streamLog, messageUpdatedEvent(liveResume, sequence))
      sequence += 1
      pushEvent(sseClients, streamLog, partUpdatedEvent(liveResume, sequence))
      streamed = true
      snapshot = await waitForVisualState(
        page,
        "live compact timing and resume",
        (item) => item.text.includes("AGC-LIVE-COMPACT-SUMMARY") && item.text.includes("AGC-LIVE-RESUME-AFTER-COMPACT"),
        () => ({ requestLog, streamLog, errors }),
      )
      assertNoLayoutBreakage(snapshot)
      assertChronology(snapshot, ["AGC-LIVE-COMPACT-SUMMARY", "AGC-LIVE-RESUME-AFTER-COMPACT"])
      snapshots["02-live-timing"] = snapshot
      await scrollMarkerIntoView(page, "AGC-LIVE-COMPACT-SUMMARY")
      screenshots.push({ name: "02-live-timing", ...(await screenshotPanel(page, "02-live-timing")) })
      mark("live-timing-complete")

      sequence += 1
      pushEvent(sseClients, streamLog, messageUpdatedEvent(validationFailure, sequence))
      sequence += 1
      pushEvent(sseClients, streamLog, partUpdatedEvent(validationFailure, sequence))
      sequence += 1
      pushEvent(
        sseClients,
        streamLog,
        sessionStatusEvent({
          sessionID: validationSessionID,
          sequence,
          reason: "error",
          message: "StructuredOutputPayloadError: required field acceptanceCriteria missing",
          emittedAt: times.validation + 250,
        }),
      )
      snapshot = await waitForVisualState(
        page,
        "validation failure visible",
        (item) => item.text.includes("AGC-VALIDATION-FAILURE") && item.text.includes("StructuredOutputPayloadError"),
        () => ({ requestLog, streamLog, errors }),
      )
      assertNoLayoutBreakage(snapshot)
      assertVisible(snapshot, [
        "AGC-VALIDATION-FAILURE",
        "StructuredOutputPayloadError",
        "required field acceptanceCriteria",
      ])
      snapshots["03-validation-failure"] = snapshot
      await scrollMarkerIntoView(page, "AGC-VALIDATION-FAILURE")
      screenshots.push({ name: "03-validation-failure", ...(await screenshotPanel(page, "03-validation-failure")) })
      mark("validation-failure-complete")

      await scrollMarkerIntoView(page, "AGC-UNSUPPORTED-AUTO-COMPACT")
      screenshots.push({
        name: "04-unsupported-auto-compact",
        ...(await screenshotPanel(page, "04-unsupported-auto-compact")),
      })

      await page.reload({ waitUntil: "domcontentloaded" })
      snapshot = await waitForVisualState(
        page,
        "reload compact resume hydrate",
        (item) =>
          item.text.includes("AGC-COMPACT-CHECKPOINT") &&
          item.text.includes("AGC-LIVE-COMPACT-SUMMARY") &&
          item.text.includes("AGC-LIVE-RESUME-AFTER-COMPACT") &&
          item.text.includes("AGC-VALIDATION-FAILURE"),
        () => ({ requestLog, streamLog, errors }),
      )
      assertNoLayoutBreakage(snapshot)
      assertChronology(snapshot, [
        "AGC-LIVE-COMPACT-SUMMARY",
        "AGC-LIVE-RESUME-AFTER-COMPACT",
        "AGC-VALIDATION-FAILURE",
      ])
      snapshots["05-reload-resume"] = snapshot
      await scrollMarkerIntoView(page, "AGC-LIVE-COMPACT-SUMMARY")
      screenshots.push({ name: "05-reload-resume", ...(await screenshotPanel(page, "05-reload-resume")) })
      mark("reload-complete")

      snapshots["06-large-handoff"] = snapshot
      await scrollMarkerIntoView(page, "AGC-COMPACT-CHECKPOINT")
      screenshots.push({ name: "06-large-handoff", ...(await screenshotPanel(page, "06-large-handoff")) })

      await page.setViewport({ width: 390, height: 844 })
      snapshot = await waitForVisualState(
        page,
        "narrow compact layout",
        (item) => item.text.includes("AGC-COMPACT-CHECKPOINT") && item.viewportWidth === 390,
        () => ({ requestLog, streamLog, errors }),
      )
      assertNoLayoutBreakage(snapshot)
      assertVisible(snapshot, ["AGC-COMPACT-CHECKPOINT", "AGC-RESUME-AFTER-COMPACT", "AGC-VALIDATION-FAILURE"])
      snapshots["07-narrow-layout"] = snapshot
      await scrollMarkerIntoView(page, "AGC-VALIDATION-FAILURE")
      screenshots.push({ name: "07-narrow-layout", ...(await screenshotPanel(page, "07-narrow-layout")) })
      mark("narrow-complete")

      assert.deepEqual(errors, [], `browser errors\n${JSON.stringify({ errors, requestLog, streamLog }, null, 2)}`)
    } finally {
      closeStreams(sseClients)
      await browser.close()
      await server.close()
      writeFileSync(
        reportFile,
        JSON.stringify(
          {
            port: PORT,
            requestLog,
            streamLog,
            screenshots,
            snapshots: Object.fromEntries(
              Object.entries(snapshots).map(([name, snapshot]) => [
                name,
                {
                  order: snapshot.order,
                  compactTexts: snapshot.compactTexts,
                  bodyOverflowX: snapshot.bodyOverflowX,
                  renderErrors: snapshot.renderErrors,
                },
              ]),
            ),
            errors,
          },
          null,
          2,
        ),
      )
    }
  },
  { timeout: 180_000 },
)
