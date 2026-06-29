import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "task_notification_action"
const PROJECT_DIR = "D:/overlay/workspace/notify-action"

type SseClient = {
  path: string
  controller: ReadableStreamDefaultController<Uint8Array>
  closed: boolean
}

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

function sseChunk(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

function eventStream(clients: SseClient[], path: string) {
  const encoder = new TextEncoder()
  let client: SseClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { path, controller, closed: false }
      clients.push(client)
      controller.enqueue(encoder.encode(":\n\n"))
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

function pushTaskListEvent(clients: SseClient[], sequence: number) {
  const event = {
    type: "task.failed",
    taskID: TASK_ID,
    sequence,
    notify: { tier: 1, badge: true },
    summary: "Notification action fixture failure.",
    notificationDetails: "Notification action browser fixture diagnostic details.",
  }
  const chunk = sseChunk(event)
  for (const client of clients) {
    if (client.closed || client.path !== "/task/events") continue
    client.controller.enqueue(chunk)
  }
}

async function waitForTaskListStream(clients: SseClient[], diagnostics: () => unknown) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (clients.some((client) => !client.closed && client.path === "/task/events")) return
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 50))
  }
  assert.fail(
    `task list SSE stream did not connect: ${JSON.stringify({
      clients: clients.map((client) => client.path),
      diagnostics: diagnostics(),
    })}`,
  )
}

async function notificationStructure(page: any, root: string) {
  return page.$eval(root, (node: Element) => {
    const item = node as HTMLElement
    const open = item.querySelector<HTMLElement>('[data-ui="app-notification-open-task"]')
    const details = item.querySelector<HTMLElement>('[data-ui="app-notification-details-toggle"]')
    const copy = item.querySelector<HTMLElement>('[data-ui="app-notification-details-copy"]')
    const close = item.querySelector<HTMLElement>('[data-ui="app-notification-close"]')
    return {
      role: item.getAttribute("role"),
      live: item.getAttribute("aria-live"),
      tabIndex: item.getAttribute("tabindex"),
      clickable: item.getAttribute("data-clickable"),
      openTag: open?.tagName || "",
      detailsTag: details?.tagName || "",
      copyTag: copy?.tagName || "",
      closeTag: close?.tagName || "",
      detailsInsideOpen: !!open && !!details && open.contains(details),
      copyInsideOpen: !!open && !!copy && open.contains(copy),
      closeInsideOpen: !!open && !!close && open.contains(close),
    }
  })
}

async function notificationReadability(page: any, root: string) {
  return page.$eval(root, (node: Element) => {
    type Rgba = { r: number; g: number; b: number; a: number }
    const item = node as HTMLElement

    function parseNumber(value: string, scale: number): number {
      const trimmed = value.trim()
      if (trimmed.endsWith("%")) return (Number.parseFloat(trimmed) / 100) * scale
      return Number.parseFloat(trimmed)
    }

    function parseAlpha(value: string | undefined): number {
      if (!value) return 1
      const trimmed = value.trim()
      if (trimmed.endsWith("%")) return Number.parseFloat(trimmed) / 100
      const parsed = Number.parseFloat(trimmed)
      return Number.isFinite(parsed) ? parsed : 1
    }

    function parseColor(value: string): Rgba {
      const rgb = value.match(/^rgba?\((.*)\)$/)
      if (rgb) {
        const body = rgb[1]!.trim()
        const parts = body.includes(",")
          ? body.split(",").map((part) => part.trim())
          : body.split(/\s+\/\s+|\s+/).map((part) => part.trim())
        return {
          r: parseNumber(parts[0] || "0", 255),
          g: parseNumber(parts[1] || "0", 255),
          b: parseNumber(parts[2] || "0", 255),
          a: parseAlpha(parts[3]),
        }
      }
      const srgb = value.match(/^color\(srgb\s+([^\)]+)\)$/)
      if (srgb) {
        const parts = srgb[1]!.split(/\s+\/\s+|\s+/).filter(Boolean)
        return {
          r: parseNumber(parts[0] || "0", 1) * 255,
          g: parseNumber(parts[1] || "0", 1) * 255,
          b: parseNumber(parts[2] || "0", 1) * 255,
          a: parseAlpha(parts[3]),
        }
      }
      throw new Error(`unsupported computed color: ${value}`)
    }

    function blend(top: Rgba, bottom: Rgba): Rgba {
      const alpha = top.a + bottom.a * (1 - top.a)
      if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      }
    }

    function luminance(color: Rgba): number {
      const channel = (value: number) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }

    function contrast(foreground: Rgba, background: Rgba): number {
      const light = Math.max(luminance(foreground), luminance(background))
      const dark = Math.min(luminance(foreground), luminance(background))
      return (light + 0.05) / (dark + 0.05)
    }

    function effectiveOpacity(element: HTMLElement): number {
      let opacity = 1
      let current: HTMLElement | null = element
      while (current) {
        const value = Number.parseFloat(getComputedStyle(current).opacity)
        if (Number.isFinite(value)) opacity *= value
        if (current === item) break
        current = current.parentElement
      }
      return opacity
    }

    const cardStyle = getComputedStyle(item)
    const bodyStyle = getComputedStyle(document.body)
    const fallbackBackground = parseColor(bodyStyle.backgroundColor)
    const cardBackground = blend(parseColor(cardStyle.backgroundColor), fallbackBackground)
    const samples = [
      { id: "title", node: item.querySelector<HTMLElement>(".app-notification__title") },
      { id: "message", node: item.querySelector<HTMLElement>(".app-notification__message") },
      { id: "open-task", node: item.querySelector<HTMLElement>('[data-ui="app-notification-open-task"]') },
      { id: "details-toggle", node: item.querySelector<HTMLElement>('[data-ui="app-notification-details-toggle"]') },
      { id: "details-copy", node: item.querySelector<HTMLElement>('[data-ui="app-notification-details-copy"]') },
    ].flatMap((sample) => (sample.node ? [sample as { id: string; node: HTMLElement }] : []))

    return {
      dismissed: item.getAttribute("data-dismissed"),
      cardOpacity: cardStyle.opacity,
      samples: samples.map((sample) => {
        const style = getComputedStyle(sample.node)
        const opacity = effectiveOpacity(sample.node)
        const foreground = blend({ ...parseColor(style.color), a: parseColor(style.color).a * opacity }, cardBackground)
        return {
          id: sample.id,
          opacity,
          color: style.color,
          backgroundColor: cardStyle.backgroundColor,
          contrast: contrast(foreground, cardBackground),
        }
      }),
    }
  })
}

async function notificationPanelWidthState(page: any, root: string) {
  return page.$eval(
    "#rightPanelNotifications",
    (node: Element, rootSelector: string) => {
      const panel = node as HTMLElement
      const mount = document.querySelector<HTMLElement>("#solidNotificationCenterMount")
      const list = document.querySelector<HTMLElement>('.app-notifications[data-surface="panel"]')
      const group = document.querySelector<HTMLElement>(".app-notification-group")
      const groupItems = document.querySelector<HTMLElement>(".app-notification-group__items")
      const card = document.querySelector<HTMLElement>(rootSelector)
      if (!mount || !list || !group || !groupItems || !card) throw new Error("notification panel DOM is incomplete")
      const portalHost = list.parentElement as HTMLElement | null

      function width(element: HTMLElement): number {
        return Math.round(element.getBoundingClientRect().width)
      }

      function styleState(element: HTMLElement) {
        const style = getComputedStyle(element)
        return {
          display: style.display,
          flex: style.flex,
          flexBasis: style.flexBasis,
          flexGrow: style.flexGrow,
          flexShrink: style.flexShrink,
          width: style.width,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          alignSelf: style.alignSelf,
        }
      }

      return {
        widths: {
          panel: width(panel),
          mount: width(mount),
          portalHost: portalHost ? width(portalHost) : 0,
          list: width(list),
          group: width(group),
          groupItems: width(groupItems),
          card: width(card),
        },
        listParentID: list.parentElement?.id || "",
        listParentClass: list.parentElement?.className || "",
        listMatchesPanelSelector: list.matches('.app-notifications[data-surface="panel"]'),
        mountStyle: styleState(mount),
        portalHostStyle: portalHost ? styleState(portalHost) : null,
        listStyle: styleState(list),
      }
    },
    root,
  )
}

async function selectedTaskID(page: any) {
  return page.evaluate(() => {
    const source = (window as any).boardStore?.selectedSource
    return source?.kind === "task" ? String(source.id || "") : ""
  })
}

test("notification task action is an explicit button on toast and panel surfaces", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const errors: string[] = []
  const requestLog: Array<{ method: string; path: string }> = []
  const clients: SseClient[] = []
  const task = {
    id: TASK_ID,
    title: "Notification action task",
    directory: PROJECT_DIR,
    status: "failed",
    sessionID: "session-notify-action",
    time: { created: now - 10_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "notification-action-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "failed" },
    overview: { headline: "Notification action task", summary: "Task failed for notification action.", controls: {} },
    plan: null,
    spec: null,
    evaluation: null,
    acceptance: null,
    interactions: [],
  }
  const promptProfileCatalog = {
    active: "default",
    project_active: "default",
    session_active: null,
    default: "default",
    targets: [],
    profiles: [],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push({ method: req.method, path })
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover") {
      return send({ root: "D:/overlay", defaultDirectory: PROJECT_DIR, projects: [] })
    }
    if (path === "/project/current/worktrees") return send([])
    if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream(clients, path)
    if (path === `/task/${TASK_ID}/operator-model-context`) return send({ selected: null, candidates: [] })
    if (path === `/task/${TASK_ID}/browser-preview`) return send({ status: "missing", diagnostics: [] })
    if (path === `/task/${TASK_ID}/conversation`) {
      return send({
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        agentView: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        history: { cursor: 0, complete: true, hasMore: false, limit: 100 },
        messageWatermark: 0,
        lastSequence: 0,
      })
    }
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: PROJECT_DIR })
    if (path === "/vcs") {
      return send({
        branch: "notify-action",
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
    if (path === "/config") return send({})
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/executor") return send([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/skill/mounts") {
      return send({
        scope: "project",
        skills: [],
        agents: [],
        matrix: [],
        project_mounts: { agents: {} },
        unmounted_count: 0,
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 960, height: 720 })
    page.on("pageerror", (error) => errors.push(`pageerror: ${(error as Error).message}`))
    page.on("requestfailed", (request) => {
      if (/\/task\/(?:events|[^/]+\/events)(?:\?.*)?$/.test(request.url())) return
      errors.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() === 404) errors.push(`response404: ${response.url()}`)
    })
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
    })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      ;(window as any).__notificationActionClipboardWrites = []
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            ;(window as any).__notificationActionClipboardWrites.push(text)
          },
        },
      })
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/notify-action")
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => (window as any).__overlayInitSettled === true)
    await waitForTaskListStream(clients, () => ({
      errors,
      requests: requestLog.slice(-40),
    }))

    pushTaskListEvent(clients, 1)
    await page.waitForSelector('.app-notifications[data-surface="toast"] .app-notification')
    await page.waitForSelector('.app-notifications[data-surface="toast"] [data-ui="app-notification-open-task"]')

    const toastRoot = '.app-notifications[data-surface="toast"] .app-notification'
    assert.deepEqual(await notificationStructure(page, toastRoot), {
      role: "alert",
      live: "assertive",
      tabIndex: null,
      clickable: null,
      openTag: "BUTTON",
      detailsTag: "BUTTON",
      copyTag: "BUTTON",
      closeTag: "BUTTON",
      detailsInsideOpen: false,
      copyInsideOpen: false,
      closeInsideOpen: false,
    })

    await page.focus(`${toastRoot} [data-ui="app-notification-open-task"]`)
    await page.keyboard.press("Tab")
    assert.equal(
      await page.evaluate(() => document.activeElement?.matches('[data-ui="app-notification-details-toggle"]')),
      true,
    )
    await page.keyboard.press("Tab")
    assert.equal(
      await page.evaluate(() => document.activeElement?.matches('[data-ui="app-notification-details-copy"]')),
      true,
    )
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-ui="app-notification-close"]')), true)

    await page.focus(`${toastRoot} [data-ui="app-notification-details-toggle"]`)
    await page.keyboard.press("Enter")
    await page.waitForSelector(`${toastRoot} .app-notification__details-body`)
    assert.equal(await selectedTaskID(page), "")

    await page.focus(`${toastRoot} [data-ui="app-notification-details-copy"]`)
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => (window as any).__notificationActionClipboardWrites.length === 1)
    assert.equal(await selectedTaskID(page), "")

    const toastScreenshotPath = resolve(".scratch", "notification-task-action-toast.png")
    mkdirSync(resolve(".scratch"), { recursive: true })
    writeFileSync(toastScreenshotPath, await (await page.$(toastRoot))!.screenshot({}))

    await page.focus(`${toastRoot} [data-ui="app-notification-close"]`)
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => !document.querySelector('.app-notifications[data-surface="toast"] .app-notification'),
    )
    assert.equal(await selectedTaskID(page), "")

    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="notifications"]')
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>("#rightPanelNotifications")?.dataset.active === "true",
    )
    const panelRoot = '#solidNotificationCenterMount .app-notification[data-task-id="task_notification_action"]'
    await page.waitForSelector(`${panelRoot} [data-ui="app-notification-open-task"]`)
    await page.waitForFunction(
      (selector) => document.querySelector<HTMLElement>(selector)?.getAttribute("data-dismissed") === "true",
      {},
      panelRoot,
    )
    const panel = await notificationStructure(page, panelRoot)
    assert.equal(panel.role, "alert")
    assert.equal(panel.tabIndex, null)
    assert.equal(panel.clickable, null)
    assert.equal(panel.openTag, "BUTTON")
    assert.equal(panel.detailsInsideOpen, false)
    assert.equal(panel.copyInsideOpen, false)

    const readability = await notificationReadability(page, panelRoot)
    assert.equal(readability.dismissed, "true")
    assert.equal(readability.cardOpacity, "1")
    for (const sample of readability.samples) {
      assert.ok(sample.opacity >= 0.99, `${sample.id} effective opacity ${sample.opacity}`)
      assert.ok(sample.contrast >= 4.5, `${sample.id} contrast ${sample.contrast}`)
    }

    const widthState = await notificationPanelWidthState(page, panelRoot)
    assert.ok(widthState.widths.panel > 0, JSON.stringify(widthState))
    for (const [key, width] of Object.entries(widthState.widths)) {
      assert.ok(
        Math.abs(width - widthState.widths.panel) <= 2,
        `${key} width did not fill panel: ${JSON.stringify(widthState)}`,
      )
    }

    const panelScreenshotPath = resolve(".scratch", "notification-dismissed-panel-readable.png")
    writeFileSync(panelScreenshotPath, await (await page.$("#rightPanelNotifications"))!.screenshot({}))
    const panelWidthScreenshotPath = resolve(".scratch", "notification-panel-width-fill.png")
    writeFileSync(panelWidthScreenshotPath, await (await page.$("#rightPanelNotifications"))!.screenshot({}))

    await page.focus(`${panelRoot} [data-ui="app-notification-open-task"]`)
    await page.keyboard.press("Enter")
    await page.waitForFunction((taskID) => (window as any).boardStore?.selectedSource?.id === taskID, {}, TASK_ID)
    assert.equal(await selectedTaskID(page), TASK_ID)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
