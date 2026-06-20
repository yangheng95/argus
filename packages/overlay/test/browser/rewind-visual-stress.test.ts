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
const CLICK_TRACE_PATH = resolve(SCREENSHOT_DIR, "click-trace.ndjson")
const WAIT_TRACE_PATH = resolve(SCREENSHOT_DIR, "wait-state.json")

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
    providerID?: string
    modelID?: string
    tokens?: { input: number; output: number; reasoning: number; total: number; cache: { read: number; write: number } }
    cost?: number
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
  providerID?: string
  modelID?: string
  tokens?: { input: number; output: number; reasoning: number; total: number; cache: { read: number; write: number } }
  cost?: number
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
      ...(input.providerID ? { providerID: input.providerID } : {}),
      ...(input.modelID ? { modelID: input.modelID } : {}),
      ...(input.tokens ? { tokens: input.tokens } : {}),
      ...(typeof input.cost === "number" ? { cost: input.cost } : {}),
    },
    parts: [{ id: `part_${input.id}`, messageID: input.id, sessionID: input.sessionID, type: "text", text: input.body }],
  }
}

function messageUpdatedEvent(item: FixtureMessage, sequence: number) {
  return {
    type: "message.updated",
    taskID: TASK_ID,
    sequence,
    emittedAt: item.info.time.created,
    properties: { taskID: TASK_ID, info: item.info },
  }
}

function partUpdatedEvent(item: FixtureMessage, sequence: number) {
  return {
    type: "message.part.updated",
    taskID: TASK_ID,
    sequence,
    emittedAt: item.info.time.created,
    properties: { taskID: TASK_ID, part: item.parts[0] },
  }
}

function eventStream(clients: SseClient[], path: string, replayEvents: unknown[] = []) {
  const encoder = new TextEncoder()
  let client: SseClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { path, controller, closed: false }
      clients.push(client)
      controller.enqueue(encoder.encode(":\n\n"))
      for (const event of replayEvents) controller.enqueue(sseChunk(event))
    },
    cancel() {
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

function sseChunk(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

function eventSequence(event: unknown): number {
  if (!event || typeof event !== "object") return 0
  const sequence = Number((event as { sequence?: unknown }).sequence)
  return Number.isFinite(sequence) ? sequence : 0
}

function pushEvent(clients: SseClient[], event: unknown) {
  const chunk = sseChunk(event)
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
    const headerControls = Array.from(document.querySelectorAll<HTMLElement>('[data-ui="card-rewind"]')).map((element) => {
      const parent = element.closest<HTMLElement>("[data-card-id]")
      const rect = element.getBoundingClientRect()
      return {
        cardID: parent?.dataset.cardId || "",
        className: element.className,
        dataUi: element.dataset.ui || "",
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    })
    const box = (element: HTMLElement | null) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => {
      if (!a || !b) return false
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    }
    const headerActionGroups = Array.from(
      document.querySelectorAll<HTMLElement>(".card__actions, .chat-bubble__actions"),
    ).map((element) => {
      const parent = element.closest<HTMLElement>("[data-card-id]")
      const meta = element.querySelector<HTMLElement>(":scope > .card__meta-actions")
      const controls = element.querySelector<HTMLElement>(":scope > .card__control-actions")
      const metaBox = box(meta)
      const controlBox = box(controls)
      return {
        cardID: parent?.dataset.cardId || "",
        hasMeta: !!meta,
        hasControls: !!controls,
        rail: box(element),
        meta: metaBox,
        controls: controlBox,
        overlap: overlaps(metaBox, controlBox),
      }
    })
    const headerSemantics = Array.from(
      document.querySelectorAll<HTMLElement>(".card__head, .chat-bubble__head"),
    ).map((element) => {
      const isBubble = element.classList.contains("chat-bubble__head")
      const parent = element.closest<HTMLElement>("[data-card-id]")
      const main = element.querySelector<HTMLButtonElement>(
        isBubble ? ":scope .chat-bubble__head-main" : ":scope .card__head-main",
      )
      const actions = element.querySelector<HTMLElement>(
        isBubble ? ":scope .chat-bubble__actions" : ":scope .card__actions",
      )
      const actionButton = actions?.querySelector<HTMLButtonElement>("button") ?? null
      return {
        cardID: parent?.dataset.cardId || "",
        kind: isBubble ? "bubble" : "card",
        role: element.getAttribute("role"),
        tabIndex: element.getAttribute("tabindex"),
        mainTag: main?.tagName || "",
        mainExpanded: main?.getAttribute("aria-expanded") || "",
        actionsInsideMain: !!main && !!actions && main.contains(actions),
        actionButtonInsideMain: !!main && !!actionButton && main.contains(actionButton),
        main: box(main),
        actions: box(actions),
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
      headerActionGroups,
      headerSemantics,
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
    headerActionGroups: Array<{
      cardID: string
      hasMeta: boolean
      hasControls: boolean
      rail: Record<string, number> | null
      meta: Record<string, number> | null
      controls: Record<string, number> | null
      overlap: boolean
    }>
    headerSemantics: Array<{
      cardID: string
      kind: string
      role: string | null
      tabIndex: string | null
      mainTag: string
      mainExpanded: string
      actionsInsideMain: boolean
      actionButtonInsideMain: boolean
      main: Record<string, number> | null
      actions: Record<string, number> | null
    }>
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
  let lastActivityReason = "initial"
  for (;;) {
    const snapshot = await visualSnapshot(page)
    if (predicate(snapshot)) return snapshot
    const signature = JSON.stringify({
      order: snapshot.order,
      cursor: snapshot.rewindCursor,
      diagnostics: diagnostics(),
      cards: snapshot.visibleCards.map((item) => ({
        id: item.id,
        kind: item.kind,
        stage: item.stage,
        text: item.text,
      })),
      notifications: snapshot.notifications,
      renderErrors: snapshot.renderErrors,
    })
    writeFileSync(
      WAIT_TRACE_PATH,
      JSON.stringify(
        {
          label,
          time: Date.now(),
          cursor: snapshot.rewindCursor,
          idleMs: Date.now() - lastActivity,
          lastActivityReason,
          diagnostics: diagnostics(),
          cards: snapshot.visibleCards.map((item) => ({
            id: item.id,
            kind: item.kind,
            stage: item.stage,
            text: item.text,
          })),
          notifications: snapshot.notifications,
          renderErrors: snapshot.renderErrors,
        },
        null,
        2,
      ),
    )
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
      lastActivityReason = "visual/request/event signature changed"
    }
    if (Date.now() - lastActivity > idleTimeoutMs) {
      assert.fail(
        `No page activity while waiting for ${label}\n${JSON.stringify(
          { snapshot, diagnostics: diagnostics(), idleMs: Date.now() - lastActivity, lastActivityReason },
          null,
          2,
        )}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function assertVisible(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  for (const marker of markers) {
    assert.ok(
      snapshot.text.includes(marker),
      `expected marker visible: ${marker}\n${JSON.stringify(snapshot, null, 2)}`,
    )
  }
}

function assertHidden(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  for (const marker of markers) {
    assert.equal(
      snapshot.text.includes(marker),
      false,
      `expected marker hidden: ${marker}\n${JSON.stringify(snapshot, null, 2)}`,
    )
  }
}

function snapshotCardText(snapshot: Pick<Awaited<ReturnType<typeof visualSnapshot>>, "cards">): string {
  return Object.values(snapshot.cards)
    .map((card) => card.partText)
    .join("\n")
}

function assertCardsContain(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  const text = snapshotCardText(snapshot)
  for (const marker of markers) {
    assert.ok(text.includes(marker), `expected marker in card store: ${marker}\n${JSON.stringify(snapshot, null, 2)}`)
  }
}

function assertCardsDoNotContain(snapshot: Awaited<ReturnType<typeof visualSnapshot>>, markers: string[]) {
  const text = snapshotCardText(snapshot)
  for (const marker of markers) {
    assert.equal(
      text.includes(marker),
      false,
      `expected marker absent from card store: ${marker}\n${JSON.stringify(snapshot, null, 2)}`,
    )
  }
}

function assertNoLayoutBreakage(snapshot: Awaited<ReturnType<typeof visualSnapshot>>) {
  assert.equal(
    snapshot.renderErrors.length,
    0,
    `render errors present\n${JSON.stringify(snapshot.renderErrors, null, 2)}`,
  )
  assert.ok(snapshot.bodyOverflowX <= 1, `body horizontal overflow\n${JSON.stringify(snapshot, null, 2)}`)
  assert.ok(
    snapshot.headerControls.length >= 1,
    `rewind controls missing\n${JSON.stringify(snapshot.headerControls, null, 2)}`,
  )
  assert.ok(
    snapshot.headerActionGroups.some((item) => item.hasMeta && item.hasControls),
    `header action meta/control grouping missing\n${JSON.stringify(snapshot.headerActionGroups, null, 2)}`,
  )
  assert.ok(
    snapshot.headerSemantics.length >= 1,
    `header semantics missing\n${JSON.stringify(snapshot.headerSemantics, null, 2)}`,
  )
  for (const item of snapshot.headerSemantics) {
    assert.equal(item.role, null, `header container still has role\n${JSON.stringify(item, null, 2)}`)
    assert.equal(item.tabIndex, null, `header container still has tabindex\n${JSON.stringify(item, null, 2)}`)
    assert.equal(item.mainTag, "BUTTON", `header disclosure is not a native button\n${JSON.stringify(item, null, 2)}`)
    assert.match(item.mainExpanded, /^(true|false)$/, `header disclosure lacks aria-expanded\n${JSON.stringify(item)}`)
    assert.equal(item.actionsInsideMain, false, `header actions nested in disclosure\n${JSON.stringify(item, null, 2)}`)
    assert.equal(
      item.actionButtonInsideMain,
      false,
      `header action button nested in disclosure\n${JSON.stringify(item, null, 2)}`,
    )
  }
  for (const item of snapshot.headerControls) {
    assert.equal(item.dataUi, "card-rewind", `rewind control missing data-ui ${JSON.stringify(item)}`)
    assert.match(String(item.className), /\boc-button\b/, `rewind control bypassed Button ${JSON.stringify(item)}`)
    assert.ok(Number(item.width) >= 12 && Number(item.height) >= 12, `bad rewind control box ${JSON.stringify(item)}`)
    assert.ok(
      Number(item.left) >= -1 && Number(item.right) <= snapshot.viewportWidth + 1,
      `rewind control escaped viewport ${JSON.stringify({ item, viewportWidth: snapshot.viewportWidth })}`,
    )
  }
  for (const item of snapshot.headerActionGroups) {
    if (!item.rail) continue
    assert.ok(
      item.rail.right <= snapshot.viewportWidth + 1,
      `header action rail escaped viewport ${JSON.stringify(item)}`,
    )
    if (!item.hasMeta || !item.hasControls) continue
    assert.equal(item.overlap, false, `header meta and controls overlap\n${JSON.stringify(item, null, 2)}`)
  }
}

function isExpectedFailedRewindConsole(text: string): boolean {
  return text === "Failed to load resource: the server responded with a status of 503 ()"
}

async function sendButtonState(page: OverlayPage) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("#chatSend")
    const composer = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
    return {
      buttonFound: !!button,
      buttonDisabled: button?.disabled ?? null,
      composerFound: !!composer,
      composerDisabled: composer?.disabled ?? null,
      composerValue: composer?.value ?? "",
      appConnected: (window as any).appStore?.connected ?? null,
      selectedSource: (window as any).boardStore?.selectedSource ?? null,
      directory: (window as any).settingsStore?.directory ?? null,
    }
  })
}

function stepTimeout<T>(label: string, action: () => Promise<T>, diagnostics: () => unknown, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out while ${label}\n${JSON.stringify(diagnostics(), null, 2)}`))
    }, timeoutMs)
  })
  return Promise.race([action(), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function recordClickTrace(cardID: string, step: string, details: unknown = {}) {
  appendFileSync(CLICK_TRACE_PATH, `${JSON.stringify({ time: Date.now(), cardID, step, details })}\n`)
}

type RewindButtonState = {
  cardID: string
  selector: string
  viewport: { width: number; height: number }
  cardFound: boolean
  cardRect: { left: number; top: number; width: number; height: number } | null
  buttons: Array<{
    index: number
    visible: boolean
    left: number
    top: number
    width: number
    height: number
    centerX: number
    centerY: number
    title: string
    ariaLabel: string
    disabled: boolean
  }>
  dialogOpen: boolean
  dialogText: string
  rewindCursor: number | null
  order: string[]
}

async function rewindButtonTarget(page: OverlayPage, cardID: string, selector: string) {
  const state = await page.evaluate<RewindButtonState>(
    (input) => {
      const { cardID, selector } = input as { cardID: string; selector: string }
      const store = (window as any).cardTreeStore
      const rawOrder = Array.isArray(store?.order) ? store.order : []
      const buttons = Array.from(document.querySelectorAll<HTMLElement>(selector)).map((button, index) => {
        const rect = button.getBoundingClientRect()
        const style = window.getComputedStyle(button)
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(rect.width) > 0 &&
          Number(rect.height) > 0
        return {
          index,
          visible,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          title: button.getAttribute("title") || "",
          ariaLabel: button.getAttribute("aria-label") || "",
          disabled: button.hasAttribute("disabled"),
        }
      })
      const card = document.querySelector<HTMLElement>(`[data-card-id="${cardID}"]`)
      const cardRect = card?.getBoundingClientRect()
      return {
        cardID,
        selector,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        cardFound: !!card,
        cardRect: cardRect
          ? { left: cardRect.left, top: cardRect.top, width: cardRect.width, height: cardRect.height }
          : null,
        buttons,
        dialogOpen: !!document.querySelector("#appDialogBody"),
        dialogText: document.querySelector("#appDialogBody")?.textContent?.trim() || "",
        rewindCursor: typeof store?.rewindCursor === "number" ? store.rewindCursor : null,
        order: rawOrder.map((id) => String(id)),
      }
    },
    { cardID, selector },
  )
  const visibleButtons = state.buttons.filter((button) => button.visible)
  assert.equal(
    visibleButtons.length,
    1,
    `expected exactly one visible rewind button for ${cardID}\n${JSON.stringify(state, null, 2)}`,
  )
  const button = visibleButtons[0]!
  assert.ok(
    button.centerX >= 0 &&
      button.centerX <= state.viewport.width &&
      button.centerY >= 0 &&
      button.centerY <= state.viewport.height,
    `rewind button center is outside viewport for ${cardID}\n${JSON.stringify(state, null, 2)}`,
  )
  return { state, button }
}

async function clickRewind(page: OverlayPage, cardID: string) {
  const selector = `[data-card-id="${cardID}"] [data-ui="card-rewind"]`
  let lastState: unknown = { cardID, selector }
  recordClickTrace(cardID, "wait-button:start", { selector })
  await stepTimeout(
    `${cardID} waiting for rewind button`,
    () => page.waitForSelector(selector, { visible: true, timeout: 5_000 }),
    () => lastState,
  )
  recordClickTrace(cardID, "wait-button:done")
  recordClickTrace(cardID, "scroll:start")
  await stepTimeout(
    `${cardID} scrolling rewind button into view`,
    () =>
      page.evaluate((targetSelector) => {
        const element = document.querySelector<HTMLElement>(String(targetSelector))
        if (!element) throw new Error(`rewind button missing: ${targetSelector}`)
        element.scrollIntoView({ block: "center", inline: "nearest" })
      }, selector),
    () => lastState,
  )
  recordClickTrace(cardID, "scroll:done")
  recordClickTrace(cardID, "resolve-target:start")
  const target = await stepTimeout(
    `${cardID} resolving visible rewind button`,
    () => rewindButtonTarget(page, cardID, selector),
    () => lastState,
  )
  lastState = target.state
  recordClickTrace(cardID, "resolve-target:done", target.state)
  assert.equal(
    target.state.buttons.length,
    1,
    `rewind selector is ambiguous for ${cardID}\n${JSON.stringify(target.state, null, 2)}`,
  )
  recordClickTrace(cardID, "hover:start")
  await stepTimeout(`${cardID} hovering rewind button`, () => page.hover(selector, { timeout: 5_000 }), () => lastState)
  recordClickTrace(cardID, "hover:done")
  recordClickTrace(cardID, "click:start")
  await stepTimeout(
    `${cardID} clicking rewind button`,
    () => page.click(selector, { timeout: 5_000 }),
    () => lastState,
  )
  recordClickTrace(cardID, "click:done")
  await stepTimeout(
    `${cardID} waiting for rewind dialog`,
    () => page.waitForSelector("#appDialogBody", { visible: true, timeout: 5_000 }),
    () => lastState,
  )
  recordClickTrace(cardID, "dialog:visible")
  await stepTimeout(`${cardID} opening rewind mode menu`, () => page.click("#appDialogSelect", { timeout: 5_000 }), () => lastState)
  recordClickTrace(cardID, "dialog-select:opened")
  await stepTimeout(
    `${cardID} waiting for view-only option`,
    () => page.waitForSelector(".app-dialog-select-option[data-value='view']", { visible: true, timeout: 5_000 }),
    () => lastState,
  )
  recordClickTrace(cardID, "dialog-option:visible")
  await stepTimeout(
    `${cardID} selecting view-only rewind mode`,
    () => page.click(".app-dialog-select-option[data-value='view']", { timeout: 5_000 }),
    () => lastState,
  )
  recordClickTrace(cardID, "dialog-option:selected")
  const selected = await page.$eval("#appDialogSelect", (element) => element.textContent?.trim() || "")
  assert.match(selected, /view/i, `rewind dialog did not select view-only mode: ${selected}`)
  await stepTimeout(`${cardID} confirming rewind dialog`, () => page.click("#btnAppDialogOk", { timeout: 5_000 }), () => lastState)
  recordClickTrace(cardID, "dialog-confirmed")
}

test(
  `rewind visual stress exercises rewind, clear, failed rewind, reload, resume, and rapid operations on port ${PORT}`,
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const screenshots: Array<{ name: string } & Awaited<ReturnType<typeof screenshotPanel>>> = []
    const stages: Array<{
      stage: string
      time: number
      requests: number
      events: number
      streams: number
      rewinds: number
    }> = []
    const markStage = (stage: string) => {
      stages.push({
        stage,
        time: Date.now(),
        requests: requestLog.length,
        events: emittedEvents.length,
        streams: sseClients.length,
        rewinds: rewindResponses.length,
      })
      writeFileSync(resolve(SCREENSHOT_DIR, "stage-log.json"), JSON.stringify(stages, null, 2))
    }

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
    const headerActionFixture = {
      providerID: "hexin",
      modelID: "gpt-5.5",
      tokens: { input: 47_000, output: 275_000, reasoning: 0, total: 322_000, cache: { read: 0, write: 0 } },
      cost: 0.42,
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
        ...headerActionFixture,
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
        ...headerActionFixture,
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
        ...headerActionFixture,
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
      status: "active",
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
        {
          id: "requirements",
          label: "Requirements",
          description: "Requirements agent prompt.",
          editable: true,
          built_in_only: false,
        },
        {
          id: "architect",
          label: "Architect",
          description: "Architect agent prompt.",
          editable: true,
          built_in_only: false,
        },
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
    const rewindResponses: Array<{ status: number; cursorTime: number | null; resetWorktree?: boolean }> = []
    const messageRequests: unknown[] = []
    const emittedEvents: Array<{ type: string; sequence: number; cursorTime?: number; messageID?: string }> = []
    const protocolEvents: unknown[] = []

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
      const event = {
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
      }
      emittedEvents.push({ type: "task.rewound", sequence, cursorTime })
      protocolEvents.push(event)
      pushEvent(sseClients, event)
    }
    const emitMessage = (item: FixtureMessage) => {
      sequence += 1
      const updated = messageUpdatedEvent(item, sequence)
      emittedEvents.push({ type: "message.updated", sequence, messageID: item.info.id })
      protocolEvents.push(updated)
      pushEvent(sseClients, updated)
      sequence += 1
      const part = partUpdatedEvent(item, sequence)
      emittedEvents.push({ type: "message.part.updated", sequence, messageID: item.info.id })
      protocolEvents.push(part)
      pushEvent(sseClients, part)
    }
    const emitSequenceGap = () => {
      sequence += 1
      const replayOnlyEvent = {
        type: "goal.progress",
        taskID: TASK_ID,
        sequence,
        properties: { taskID: TASK_ID, summary: "replay-only rewind stress sequence gap filler" },
      }
      protocolEvents.push(replayOnlyEvent)
      emittedEvents.push({ type: "goal.progress", sequence })
      sequence += 1
      const liveEvent = {
        type: "goal.progress",
        taskID: TASK_ID,
        sequence,
        properties: { taskID: TASK_ID, summary: "intentional rewind stress sequence gap" },
      }
      emittedEvents.push({ type: "goal.progress", sequence })
      protocolEvents.push(liveEvent)
      pushEvent(sseClients, liveEvent)
    }
    const sawRewindEvent = (cursorTime: number) =>
      emittedEvents.some((event) => event.type === "task.rewound" && event.cursorTime === cursorTime)
    const sawMessageEvent = (messageID: string) =>
      emittedEvents.some((event) => event.type === "message.updated" && event.messageID === messageID)

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
        if (path === "/global/health") return json({ version: "1.2.3" })
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
        if (path === "/provider") return json({ all: [], connected: [], default: {} })
        if (path === "/provider/auth") return json({})
        if (path === "/provider/hexin/budget") return json({ ok: true })
        if (path === "/config/providers") return json({ providers: [], default: {} })
        if (path === "/config/prompt-profile") return json(promptProfileCatalog)
        if (path === "/config" && req.method === "PATCH") return json(await req.json())
        if (path === "/config") return json({ model: "", prompt_profile: { active: "front" } })
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
          const after = Number(url.searchParams.get("after") || 0)
          const until = Number(url.searchParams.get("until") || sequence)
          const events = protocolEvents.filter((event) => {
            const eventSeq = eventSequence(event)
            return eventSeq > after && eventSeq <= until
          })
          const cursor = events.length > 0 ? eventSequence(events.at(-1)) : after
          return json({
            events,
            eventReplay: {
              cursor,
              latestSequence: sequence,
              complete: true,
              limit: 100,
              sinceTimestamp: null,
            },
          })
        }
        if (path === `/task/${TASK_ID}/transcript`) return json(visibleMessages())
        if (path === `/task/${TASK_ID}/trace`)
          return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace`, enabled: true })
        if (path.startsWith("/session/") && path.endsWith("/trace")) {
          const sessionID = decodeURIComponent(path.slice("/session/".length, -"/trace".length))
          return json({
            events: [
              {
                ts: times.t8,
                kind: "session_open",
                sessionID,
                taskID: TASK_ID,
                agentName: "orchestrator",
                payload: { firstEvent: "session_open" },
              },
            ],
            traceDir: `${PROJECT_ROOT}/.opencorvus/trace`,
            enabled: true,
          })
        }
        if (path === `/task/${TASK_ID}/browser-preview`) return json(browserPreviewTarget)
        if (path === "/control/timeline") return json([])
        if (path === "/task/events") return eventStream(sseClients, path)
        if (path === `/task/${TASK_ID}/events`) {
          const after = Number(url.searchParams.get("after") || 0)
          return eventStream(
            sseClients,
            path,
            protocolEvents.filter((event) => eventSequence(event) > after),
          )
        }
        if (path === `/task/${TASK_ID}/rewind` && req.method === "POST") {
          const body = await req.json()
          rewindRequests.push(body)
          if (failNextRewind) {
            failNextRewind = false
            rewindResponses.push({ status: 503, cursorTime: null })
            return text("rewind failed by visual stress fixture", { status: 503 })
          }
          const cursorTime = Number((body as any)?.anchor?.cursorTime)
          assert.ok(Number.isFinite(cursorTime) && cursorTime > 0, `invalid rewind cursor ${JSON.stringify(body)}`)
          rewindCursor = cursorTime
          rewindCount += 1
          rewindResponses.push({
            status: 200,
            cursorTime,
            resetWorktree: (body as any)?.resetWorktree === true,
          })
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
          rewindCursor = null
          branchMode = false
          setTimeout(() => emitTaskRewound(0, false), 0)
          return json(true)
        }
        if (path === `/task/${TASK_ID}/message` && req.method === "POST") {
          const body = await req.json()
          messageRequests.push(body)
          rewindCursor = null
          branchMode = true
          setTimeout(() => {
            emitTaskRewound(0, false)
            emitMessage(branchUser)
            emitMessage(branchAssistant)
          }, 0)
          return json({ user_message: branchUser, assistant_message: branchAssistant })
        }
        if (path === `/task/${TASK_ID}/followup` && req.method === "POST") return json({ suggestion: "" })
        return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
      },
      { port: PORT },
    )
    assert.equal(server.port, PORT)

    const browser = await launchBrowser(["--disable-dev-shm-usage"], { headless: false })
    try {
      const page = await browser.newPage()
      const captureScreenshot = async (name: string) => {
        screenshots.push({ name, ...(await screenshotPanel(page, name)) })
      }
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
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
      }, server.origin)
      page.on("pageerror", (error) => errors.push(`pageerror: ${(error as Error).message}`))
      page.on("requestfailed", (request) => {
        const item = request as { url?: () => string; method?: () => string; failure?: () => { errorText?: string } | null }
        const method = item.method?.() || ""
        const url = item.url?.() || ""
        const errorText = item.failure?.()?.errorText || ""
        let path = ""
        try {
          path = new URL(url).pathname
        } catch {
          path = ""
        }
        const closedReplacedSse =
          method === "GET" &&
          errorText === "net::ERR_ABORTED" &&
          (path === "/task/events" || path === `/task/${TASK_ID}/events`)
        if (closedReplacedSse) return
        errors.push(`requestfailed: ${method} ${url} ${errorText}`)
      })
      page.on("console", (message) => {
        const item = message as { type?: () => string; text?: () => string }
        if (item.type?.() !== "error") return
        const text = item.text?.() || ""
        if (isExpectedFailedRewindConsole(text)) return
        errors.push(`console: ${text}`)
      })
      page.on("response", (response) => {
        const item = response as { status?: () => number; url?: () => string }
        const status = item.status?.() ?? 0
        if (status < 400) return
        const url = item.url?.() || ""
        const expectedFailedRewind =
          status === 503 && url.includes(`/task/${TASK_ID}/rewind`) && !url.includes("/rewind/clear")
        if (expectedFailedRewind) return
        errors.push(`response${status}: ${url}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "baseline full rewind fixture",
        (snapshot) => baselineMessages.every((item) => snapshotCardText(snapshot).includes(item.parts[0]!.text)),
        () => ({ requestLog, errors }),
      )
      let snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertCardsContain(snapshot, ["RW-T1 user request", "RW-T4 plan anchor", "RW-T8 final orchestration tail"])
      assertVisible(snapshot, ["RW-T8 final orchestration tail"])
      await captureScreenshot("01-baseline")
      markStage("01-baseline")

      await page.click('[data-card-id="orchestrator:session:ses_orch:message:msg_orch_1"] [data-ui="card-trace"]')
      await page.waitForSelector(".trace-panel-body", { visible: true, timeout: 5_000 })
      const traceActionState = await page.$$eval(".trace-panel-actions button", (buttons) =>
        buttons.map((button) => ({
          dataUi: button.dataset.ui || "",
          className: String(button.className || ""),
          disabled: button.disabled,
          ariaLabel: button.getAttribute("aria-label") || "",
        })),
      )
      assert.deepEqual(
        traceActionState.map((item) => item.dataUi),
        ["trace-copy", "trace-refresh", "trace-close"],
      )
      for (const item of traceActionState) {
        assert.match(item.className, /\boc-button\b/, `${item.dataUi} did not use Button primitive chrome`)
        assert.ok(item.ariaLabel, `${item.dataUi} missing accessible label`)
      }
      assert.deepEqual(
        traceActionState.map((item) => item.disabled),
        [false, false, false],
      )
      await captureScreenshot("01-trace-panel-actions")
      await page.click('.trace-panel-actions [data-ui="trace-close"]')
      await page.waitForFunction(() => !document.querySelector(".trace-panel"))
      markStage("01-trace-panel-actions")

      await waitForVisualState(
        page,
        "task stream open",
        () => sseClients.some((client) => client.path === `/task/${TASK_ID}/events` && !client.closed),
        () => ({ requestLog, streamCount: sseClients.length }),
      )

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "view-only rewind pruned tail",
        (item) =>
          sawRewindEvent(times.t4) &&
          item.rewindCursor === times.t4 &&
          snapshotCardText(item).includes("RW-T4 plan anchor") &&
          !snapshotCardText(item).includes("RW-T5 build output"),
        () => ({ requestLog, rewindRequests, rewindResponses, emittedEvents, errors }),
      )
      assert.equal((rewindRequests.at(-1) as any)?.resetWorktree, false)
      assert.equal((rewindRequests.at(-1) as any)?.anchor?.cursorTime, times.t4)
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertCardsContain(snapshot, ["RW-T1 user request", "RW-T4 plan anchor"])
      assertCardsDoNotContain(snapshot, ["RW-T5 build output", "RW-T8 final orchestration tail"])
      await captureScreenshot("02-view-rewind")
      markStage("02-view-rewind")

      await page.evaluate(
        async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status,
        TASK_ID,
      )
      await waitForVisualState(
        page,
        "clear rewind restores visible tail",
        (item) => sawRewindEvent(0) && item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindRequests, rewindResponses, emittedEvents, errors, streamCount: sseClients.length }),
      )
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assertCardsContain(snapshot, ["RW-T1 user request", "RW-T5 build output", "RW-T8 final orchestration tail"])
      assertVisible(snapshot, ["RW-T8 final orchestration tail"])
      await captureScreenshot("03-clear-restored")
      markStage("03-clear-restored")

      failNextRewind = true
      const failedRewindResponseStart = rewindResponses.length
      const failedRewindRequestStart = rewindRequests.length
      await clickRewind(page, "integrity:session:ses_integrity")
      await waitForVisualState(
        page,
        "failed rewind leaves authoritative tail visible",
        (item) =>
          rewindRequests.length === failedRewindRequestStart + 1 &&
          rewindResponses.length === failedRewindResponseStart + 1 &&
          rewindResponses.at(-1)?.status === 503 &&
          item.rewindCursor === null &&
          item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindRequests, rewindResponses, errors }),
      )
      assert.equal(rewindResponses.at(-1)?.status, 503)
      snapshot = await visualSnapshot(page)
      assertCardsContain(snapshot, ["RW-T7 integrity review", "RW-T8 final orchestration tail"])
      assertVisible(snapshot, ["RW-T8 final orchestration tail"])
      await captureScreenshot("04-failed-rewind")
      markStage("04-failed-rewind")

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "rewind before reload",
        (item) =>
          sawRewindEvent(times.t4) &&
          item.rewindCursor === times.t4 &&
          !snapshotCardText(item).includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindResponses, emittedEvents, errors }),
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "reload filtered rewind",
        (item) =>
          snapshotCardText(item).includes("RW-T4 plan anchor") &&
          !snapshotCardText(item).includes("RW-T5 build output"),
        () => ({ requestLog, errors }),
      )
      await captureScreenshot("05-reload-filtered")
      markStage("05-reload-filtered")

      await page.evaluate(
        async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status,
        TASK_ID,
      )
      await waitForVisualState(
        page,
        "clear after reload restores full tail",
        (item) => sawRewindEvent(0) && item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, emittedEvents, errors }),
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      await waitForVisualState(
        page,
        "reload cleared full timeline",
        (item) => item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, errors }),
      )
      await captureScreenshot("06-reload-cleared")
      markStage("06-reload-cleared")

      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "rewind before resume branch",
        (item) =>
          sawRewindEvent(times.t4) && item.rewindCursor === times.t4 && !item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, rewindResponses, emittedEvents, errors }),
      )
      await page.click('nav[data-side="left"] [data-activity="tasks"]')
      await page
        .waitForFunction(() => {
          const composer = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
          return !!composer && !composer.disabled
        })
        .catch(async (error) => {
          throw new Error(
            `chat composer stayed disabled before resume branch: ${JSON.stringify(await sendButtonState(page))}\n${(error as Error).message}`,
          )
        })
      await page.click("#solidChatComposer textarea")
      await page.keyboard.type("Continue from the rewound point with a new branch")
      await page
        .waitForFunction(() => {
          const composer = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
          return composer?.value === "Continue from the rewound point with a new branch"
        })
        .catch(async (error) => {
          throw new Error(
            `chat composer did not accept typed resume text: ${JSON.stringify(await sendButtonState(page))}\n${(error as Error).message}`,
          )
        })
      await page
        .waitForFunction(() => {
          const button = document.querySelector<HTMLButtonElement>("#chatSend")
          return !!button && !button.disabled
        })
        .catch(async (error) => {
          throw new Error(
            `chat send stayed disabled before resume branch: ${JSON.stringify(await sendButtonState(page))}\n${(error as Error).message}`,
          )
        })
      await page.click("#chatSend")
      await waitForVisualState(
        page,
        "resume branch visible after rewind",
        (item) =>
          sawRewindEvent(0) &&
          sawMessageEvent("msg_branch_user") &&
          sawMessageEvent("msg_branch_assistant") &&
          item.rewindCursor === null &&
          item.text.includes("RW-RESUME-NEW user branch") &&
          item.text.includes("RW-RESUME-NEW orchestrator continued") &&
          item.text.includes("RW-T4 plan anchor") &&
          !item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, messageRequests, emittedEvents, errors }),
      )
      assert.equal((messageRequests.at(-1) as any)?.text, "Continue from the rewound point with a new branch")
      await captureScreenshot("07-resume-branch")
      markStage("07-resume-branch")

      branchMode = false
      rewindCursor = null
      markStage("before-rapid-clear")
      await page.evaluate(
        async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status,
        TASK_ID,
      )
      markStage("after-rapid-clear-request")
      await waitForVisualState(
        page,
        "baseline restored before rapid stress",
        (item) => sawRewindEvent(0) && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, emittedEvents, errors }),
      )
      markStage("baseline-before-rapid")
      markStage("before-rapid-T6-click")
      await clickRewind(page, "acceptance:session:ses_accept:message:msg_accept_1")
      await waitForVisualState(
        page,
        "rapid rewind T6",
        (item) => sawRewindEvent(times.t6) && item.rewindCursor === times.t6,
        () => ({ requestLog, emittedEvents, errors }),
      )
      markStage("rapid-T6")
      const streamCountBeforeGap = sseClients.length
      emitSequenceGap()
      await waitForVisualState(
        page,
        "rapid stress sequence gap recovered",
        (item) =>
          emittedEvents.some((event) => event.type === "goal.progress") &&
          sseClients.length > streamCountBeforeGap &&
          item.rewindCursor === times.t6,
        () => ({ requestLog, emittedEvents, streamCount: sseClients.length, errors }),
      )
      markStage("rapid-gap-recovered")
      markStage("before-rapid-T4-click")
      await clickRewind(page, "planner:session:ses_plan:message:msg_plan_1")
      await waitForVisualState(
        page,
        "rapid rewind T4",
        (item) => sawRewindEvent(times.t4) && item.rewindCursor === times.t4,
        () => ({ requestLog, emittedEvents, errors }),
      )
      markStage("rapid-T4")
      markStage("before-rapid-T2-click")
      await clickRewind(page, "requirements:session:ses_req:message:msg_req_1")
      await waitForVisualState(
        page,
        "rapid rewind T2",
        (item) => sawRewindEvent(times.t2) && item.rewindCursor === times.t2,
        () => ({ requestLog, emittedEvents, errors }),
      )
      markStage("rapid-T2")
      await page.evaluate(
        async (taskID) => (await fetch(`/task/${taskID}/rewind/clear`, { method: "POST" })).status,
        TASK_ID,
      )
      await waitForVisualState(
        page,
        "rapid clear returns baseline",
        (item) => sawRewindEvent(0) && item.rewindCursor === null && item.text.includes("RW-T8 final orchestration tail"),
        () => ({ requestLog, emittedEvents, errors }),
      )
      markStage("rapid-clear")
      snapshot = await visualSnapshot(page)
      assertNoLayoutBreakage(snapshot)
      assert.equal(
        new Set(snapshot.order).size,
        snapshot.order.length,
        `duplicate top-level cards ${snapshot.order.join(",")}`,
      )
      for (const [id, card] of Object.entries(snapshot.cards)) {
        for (const childID of card.childIDs) {
          assert.ok(snapshot.cards[childID], `card ${id} references missing child ${childID}`)
        }
      }
      const taskStreamCount = sseClients.filter((item) => item.path.startsWith(`/task/${TASK_ID}/events`)).length
      assert.ok(taskStreamCount <= 12, `selected task stream storm: ${taskStreamCount}`)
      await captureScreenshot("08-rapid-clear")

      writeFileSync(
        resolve(SCREENSHOT_DIR, "report.json"),
        JSON.stringify(
          {
            requestLog,
            rewindRequests,
            rewindResponses,
            messageRequests,
            emittedEvents,
            stages,
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
