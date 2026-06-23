import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
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

const PROMPT_PROFILE_CATALOG = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

async function leftPaneState(page: OverlayPage) {
  return await page.$eval("#leftPaneResizer", (node) => {
    const separator = node as HTMLElement
    const sidebar = document.querySelector<HTMLElement>("#sidebar")!
    const chat = document.querySelector<HTMLElement>("#chatSection")!
    const style = getComputedStyle(separator)
    const min = separator.getAttribute("aria-valuemin")
    const max = separator.getAttribute("aria-valuemax")
    const now = separator.getAttribute("aria-valuenow")
    return {
      hidden: separator.hidden,
      display: style.display,
      disabled: separator.dataset.disabled ?? "",
      role: separator.getAttribute("role"),
      orientation: separator.getAttribute("aria-orientation"),
      controls: separator.getAttribute("aria-controls"),
      tabIndex: separator.tabIndex,
      min,
      max,
      now,
      minValue: min === null ? null : Number(min),
      maxValue: max === null ? null : Number(max),
      nowValue: now === null ? null : Number(now),
      focused: document.activeElement === separator,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      chatWidth: Math.round(chat.getBoundingClientRect().width),
    }
  })
}

type LeftPaneState = Awaited<ReturnType<typeof leftPaneState>>

async function leftPaneMaxContract(page: OverlayPage) {
  return await page.$eval("#leftPaneResizer", (node) => {
    const separator = node as HTMLElement
    const panelBody = document.querySelector<HTMLElement>("#panelBody")!
    const tokenPx = (name: string) => {
      const probe = document.createElement("div")
      probe.style.position = "absolute"
      probe.style.visibility = "hidden"
      probe.style.pointerEvents = "none"
      probe.style.width = `var(${name})`
      document.body.appendChild(probe)
      const width = probe.getBoundingClientRect().width
      probe.remove()
      return width
    }
    const max = separator.getAttribute("aria-valuemax")
    const separatorWidth = separator.getBoundingClientRect().width
    const panelWidth = panelBody.getBoundingClientRect().width
    const chatMin = tokenPx("--ui-chat-min-width")
    const railMin = tokenPx("--ui-rail-min-width")
    return {
      maxValue: max === null ? null : Number(max),
      expectedMaxWithoutRetiredRightPane: Math.round(Math.max(railMin, panelWidth - separatorWidth - chatMin)),
    }
  })
}

type PaneDragProbeEventType = "pane-geometry-read" | "pane-style-write" | "pane-aria-write"

interface PaneDragProbeEvent {
  type: PaneDragProbeEventType
  frame: number
  sequence: number
  id?: string
  name?: string
}

interface PaneDragProbeSummary {
  frame: number
  rafCallbacks: number
  events: PaneDragProbeEvent[]
  rectReadsTotal: number
  rectReadsBeforeFrame: number
  styleWritesTotal: number
  styleWritesBeforeFrame: number
  styleWriteFrames: number
  ariaWritesTotal: number
  ariaWritesBeforeFrame: number
  ariaWriteFrames: number
  geometryReadsAfterStyleWritesTotal: number
  geometryReadFramesAfterStyleWrites: number
  geometryReadsInUiScaleWriteFrames: number
}

async function installPaneDragProbe(page: OverlayPage) {
  await page.evaluate(() => {
    const w = window as any
    if (w.__paneDragProbeInstalled) return
    w.__paneDragProbeInstalled = true
    const probe = {
      frame: 0,
      rafCallbacks: 0,
      rectReadsByFrame: {} as Record<string, number>,
      styleWritesByFrame: {} as Record<string, number>,
      ariaWritesByFrame: {} as Record<string, number>,
      events: [] as PaneDragProbeEvent[],
      sequence: 0,
      reset() {
        this.frame = 0
        this.rafCallbacks = 0
        this.rectReadsByFrame = {}
        this.styleWritesByFrame = {}
        this.ariaWritesByFrame = {}
        this.events = []
        this.sequence = 0
      },
      record(type: PaneDragProbeEventType, bucket: Record<string, number>, detail: { id?: string; name?: string }) {
        const key = String(this.frame)
        bucket[key] = (bucket[key] ?? 0) + 1
        this.sequence += 1
        this.events.push({
          type,
          frame: this.frame,
          sequence: this.sequence,
          ...detail,
        })
      },
      summary(): PaneDragProbeSummary {
        const total = (bucket: Record<string, number>) => Object.values(bucket).reduce((sum, value) => sum + value, 0)
        const frames = (bucket: Record<string, number>) => Object.keys(bucket).filter((key) => (bucket[key] ?? 0) > 0).length
        const styleWriteFrames = new Set<number>()
        const uiScaleWriteFrames = new Set<number>()
        const styleSeenByFrame = new Set<number>()
        const geometryReadFramesAfterStyleWrites = new Set<number>()
        let geometryReadsAfterStyleWritesTotal = 0
        for (const event of this.events) {
          if (event.type === "pane-style-write") {
            styleWriteFrames.add(event.frame)
            styleSeenByFrame.add(event.frame)
            if (event.name === "--ui-scale") uiScaleWriteFrames.add(event.frame)
          } else if (event.type === "pane-geometry-read" && styleSeenByFrame.has(event.frame)) {
            geometryReadsAfterStyleWritesTotal += 1
            geometryReadFramesAfterStyleWrites.add(event.frame)
          }
        }
        const geometryReadsInUiScaleWriteFrames = this.events.filter(
          (event) => event.type === "pane-geometry-read" && uiScaleWriteFrames.has(event.frame),
        ).length
        return {
          frame: this.frame,
          rafCallbacks: this.rafCallbacks,
          events: this.events.slice(),
          rectReadsTotal: total(this.rectReadsByFrame),
          rectReadsBeforeFrame: this.rectReadsByFrame["0"] ?? 0,
          styleWritesTotal: total(this.styleWritesByFrame),
          styleWritesBeforeFrame: this.styleWritesByFrame["0"] ?? 0,
          styleWriteFrames: styleWriteFrames.size || frames(this.styleWritesByFrame),
          ariaWritesTotal: total(this.ariaWritesByFrame),
          ariaWritesBeforeFrame: this.ariaWritesByFrame["0"] ?? 0,
          ariaWriteFrames: frames(this.ariaWritesByFrame),
          geometryReadsAfterStyleWritesTotal,
          geometryReadFramesAfterStyleWrites: geometryReadFramesAfterStyleWrites.size,
          geometryReadsInUiScaleWriteFrames,
        }
      },
    }
    w.__paneDragProbe = probe

    const requestAnimationFrameOriginal = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback: FrameRequestCallback) =>
      requestAnimationFrameOriginal((time) => {
        probe.frame += 1
        probe.rafCallbacks += 1
        callback(time)
      })

    const rectOriginal = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && (this.id === "panelBody" || this.id === "leftPaneResizer")) {
        probe.record("pane-geometry-read", probe.rectReadsByFrame, { id: this.id })
      }
      return rectOriginal.call(this)
    }

    const setPropertyOriginal = CSSStyleDeclaration.prototype.setProperty
    CSSStyleDeclaration.prototype.setProperty = function (propertyName: string, value?: string | null, priority?: string) {
      if (propertyName === "--ui-scale" || propertyName === "--ui-sidebar-width") {
        probe.record("pane-style-write", probe.styleWritesByFrame, { name: propertyName })
      }
      return setPropertyOriginal.call(this, propertyName, value, priority)
    }

    const setAttributeOriginal = Element.prototype.setAttribute
    Element.prototype.setAttribute = function (name: string, value: string) {
      if (this instanceof HTMLElement && this.id === "leftPaneResizer" && name.startsWith("aria-value")) {
        probe.record("pane-aria-write", probe.ariaWritesByFrame, { id: this.id, name })
      }
      return setAttributeOriginal.call(this, name, value)
    }
  })
}

async function paneDragProbeSummary(page: OverlayPage): Promise<PaneDragProbeSummary> {
  return await page.evaluate(() => (window as any).__paneDragProbe.summary())
}

async function resetPaneDragProbe(page: OverlayPage): Promise<void> {
  await page.evaluate(() => (window as any).__paneDragProbe.reset())
}

async function waitForAnimationFrames(page: OverlayPage, count: number): Promise<void> {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolveFrame) => {
        let remaining = frameCount
        const next = () => {
          remaining -= 1
          if (remaining <= 0) {
            resolveFrame()
            return
          }
          requestAnimationFrame(next)
        }
        requestAnimationFrame(next)
      }),
    count,
  )
}

function assertNoPaneGeometryReadsAfterStyleWrites(summary: PaneDragProbeSummary, label: string): void {
  assert.equal(
    summary.geometryReadsAfterStyleWritesTotal,
    0,
    `${label}: pane geometry read after style write in the same RAF callback: ${JSON.stringify(summary.events)}`,
  )
}

function assertPaneViewportResizeGeometryIsDeferred(summary: PaneDragProbeSummary, label: string): void {
  assert.ok(summary.styleWritesTotal > 0, `${label}: expected resize style writes, got ${JSON.stringify(summary)}`)
  assert.equal(
    summary.geometryReadsInUiScaleWriteFrames,
    0,
    `${label}: pane geometry read shared the --ui-scale resize write frame: ${JSON.stringify(summary.events)}`,
  )
  assertNoPaneGeometryReadsAfterStyleWrites(summary, label)
}

async function waitForLeftPaneState(
  page: OverlayPage,
  label: string,
  predicate: (state: LeftPaneState) => boolean,
): Promise<LeftPaneState> {
  let previousSignature = ""
  let lastActivity = Date.now()
  for (;;) {
    const state = await leftPaneState(page)
    if (predicate(state)) return state
    const signature = JSON.stringify(state)
    if (signature !== previousSignature) {
      previousSignature = signature
      lastActivity = Date.now()
    }
    if (Date.now() - lastActivity > 6_000) {
      assert.fail(`No left pane state activity while waiting for ${label}: ${signature}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test(
  "left pane separator exposes keyboard resizing and live ARIA values",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/global/projects/discover") return send([])
      if (path === "/mission") return send([])
      if (path === "/session") return send([])
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs")
        return send({
          branch: "dev",
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
      if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
      if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/task/events") {
        return new Response(":\n\n", {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_right_panel_collapsed", "true")
        localStorage.setItem("oc_sections_width", "9999")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  theme: "light",
                  directory: "D:/overlay/workspace/app",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
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
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector("#leftPaneResizer", { visible: true })
      const initialMaxContract = await leftPaneMaxContract(page)
      await installPaneDragProbe(page)

      const initial = await leftPaneState(page)
      assert.equal(initial.hidden, false)
      assert.equal(initial.display, "block")
      assert.equal(initial.disabled, "false")
      assert.equal(initial.role, "separator")
      assert.equal(initial.orientation, "vertical")
      assert.equal(initial.controls, "sidebar workspaceMain")
      assert.equal(initial.tabIndex, 0)
      assert.ok(initial.minValue! < initial.maxValue!)
      assert.ok(
        Math.abs(initial.maxValue! - initialMaxContract.expectedMaxWithoutRetiredRightPane) <= 2,
        `left pane max should not reserve retired right pane width: ${JSON.stringify({
          initial,
          initialMaxContract,
        })}`,
      )
      assert.ok(initial.nowValue! >= initial.minValue!)
      assert.ok(initial.nowValue! <= initial.maxValue!)

      await page.focus("#leftPaneResizer")
      await page.keyboard.press("ArrowRight")
      const expanded = await waitForLeftPaneState(
        page,
        "ArrowRight to increase sidebar width",
        (state) => state.sidebarWidth > initial.sidebarWidth + 10 && state.nowValue! > initial.nowValue!,
      )
      assert.equal(expanded.focused, true)
      assert.ok(expanded.sidebarWidth > initial.sidebarWidth)
      assert.ok(expanded.nowValue! > initial.nowValue!)

      await page.keyboard.press("ArrowLeft")
      await waitForLeftPaneState(
        page,
        "ArrowLeft to decrease sidebar width",
        (state) => state.sidebarWidth < expanded.sidebarWidth - 10 && state.nowValue! < expanded.nowValue! - 10,
      )

      await page.keyboard.press("Home")
      const atMin = await waitForLeftPaneState(
        page,
        "Home to move sidebar width to minimum",
        (state) => state.nowValue === state.minValue,
      )
      assert.equal(atMin.sidebarWidth, atMin.minValue)

      await page.keyboard.press("End")
      const atMax = await waitForLeftPaneState(
        page,
        "End to move sidebar width to maximum",
        (state) => state.nowValue !== null && state.maxValue !== null && state.nowValue >= state.maxValue - 2,
      )
      assert.ok(atMax.sidebarWidth >= atMax.maxValue! - 2)

      const afterMoveBurst = await page.$eval("#leftPaneResizer", (node) => {
        const probe = (window as any).__paneDragProbe
        const separator = node as HTMLElement
        const rect = separator.getBoundingClientRect()
        const startX = rect.left + rect.width / 2
        const clientY = rect.top + rect.height / 2
        separator.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: startX,
            clientY,
            pointerId: 5,
            pointerType: "mouse",
          }),
        )
        probe.reset()
        for (let index = 0; index < 30; index += 1) {
          window.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              clientX: startX - 160 - index,
              clientY,
              pointerId: 5,
              pointerType: "mouse",
            }),
          )
        }
        return probe.summary() as PaneDragProbeSummary
      })
      assert.equal(afterMoveBurst.rectReadsBeforeFrame, 0)
      assert.equal(afterMoveBurst.styleWritesBeforeFrame, 0)
      assert.equal(afterMoveBurst.ariaWritesBeforeFrame, 0)

      await waitForAnimationFrames(page, 2)
      const afterDragFrame = await paneDragProbeSummary(page)
      assert.ok(afterDragFrame.rectReadsTotal > 0)
      assert.ok(afterDragFrame.styleWritesTotal > 0)
      assert.ok(afterDragFrame.ariaWritesTotal > 0)
      assert.equal(afterDragFrame.styleWriteFrames, 1)
      assert.ok(afterDragFrame.ariaWriteFrames >= 1)
      assertNoPaneGeometryReadsAfterStyleWrites(afterDragFrame, "left pane pointermove")

      const afterPointerUp = await page.$eval("#leftPaneResizer", (node) => {
        const probe = (window as any).__paneDragProbe
        const separator = node as HTMLElement
        const rect = separator.getBoundingClientRect()
        const clientY = rect.top + rect.height / 2
        probe.reset()
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: rect.left + rect.width / 2 - 220,
            clientY,
            pointerId: 5,
            pointerType: "mouse",
          }),
        )
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            clientX: rect.left + rect.width / 2 - 220,
            clientY,
            pointerId: 5,
            pointerType: "mouse",
          }),
        )
        return probe.summary() as PaneDragProbeSummary
      })
      assert.ok(afterPointerUp.styleWritesBeforeFrame > 0)
      assert.equal(afterPointerUp.ariaWritesBeforeFrame, 0)
      assertNoPaneGeometryReadsAfterStyleWrites(afterPointerUp, "left pane pointerup flush")
      await waitForAnimationFrames(page, 2)
      const afterPointerUpFrames = await paneDragProbeSummary(page)
      assert.ok(afterPointerUpFrames.ariaWritesTotal > 0)
      assertNoPaneGeometryReadsAfterStyleWrites(afterPointerUpFrames, "left pane pointerup scheduled semantics")
      const afterDrag = await waitForLeftPaneState(
        page,
        "pointerup flush to persist final sidebar width",
        (state) => state.sidebarWidth < atMax.sidebarWidth - 100,
      )
      assert.ok(afterDrag.nowValue! < atMax.nowValue!)

      await mkdir(resolve(".scratch"), { recursive: true })
      await writeFile(
        resolve(".scratch", "left-pane-resizer-accessibility.png"),
        await page.screenshot({ fullPage: true }),
      )

      await resetPaneDragProbe(page)
      await page.setViewport({ width: 1180, height: 720 })
      await waitForLeftPaneState(
        page,
        "desktop viewport resize keeps the left pane separator visible",
        (state) => state.display === "block" && state.tabIndex === 0 && state.now !== null,
      )
      await waitForAnimationFrames(page, 3)
      const desktopResize = await paneDragProbeSummary(page)
      assertPaneViewportResizeGeometryIsDeferred(desktopResize, "desktop viewport resize")
      await writeFile(
        resolve(".scratch", "left-pane-resizer-desktop-resize.png"),
        await page.screenshot({ fullPage: true }),
      )

      await resetPaneDragProbe(page)
      await page.setViewport({ width: 900, height: 760 })
      const illegalNarrow = await waitForLeftPaneState(
        page,
        "illegal narrow viewport keeps the legal desktop left pane separator",
        (state) => state.display === "block" && state.disabled === "false" && state.tabIndex === 0 && state.now !== null,
      )
      await waitForAnimationFrames(page, 3)
      const illegalNarrowResize = await paneDragProbeSummary(page)
      assertPaneViewportResizeGeometryIsDeferred(illegalNarrowResize, "illegal narrow viewport resize")
      assert.equal(illegalNarrow.display, "block")
      assert.equal(illegalNarrow.disabled, "false")
      assert.equal(illegalNarrow.tabIndex, 0)
      assert.ok(illegalNarrow.minValue! < illegalNarrow.maxValue!)
      assert.ok(illegalNarrow.nowValue! >= illegalNarrow.minValue!)
      assert.ok(illegalNarrow.nowValue! <= illegalNarrow.maxValue!)
      await writeFile(
        resolve(".scratch", "left-pane-resizer-illegal-narrow-legal-frame.png"),
        await page.screenshot({ fullPage: true }),
      )

      await resetPaneDragProbe(page)
      await page.setViewport({ width: 1280, height: 760 })
      const restored = await waitForLeftPaneState(
        page,
        "restored desktop viewport resize returns the left pane separator",
        (state) => state.display === "block" && state.tabIndex === 0 && state.now !== null,
      )
      await waitForAnimationFrames(page, 3)
      const restoredResize = await paneDragProbeSummary(page)
      assertPaneViewportResizeGeometryIsDeferred(restoredResize, "restored desktop viewport resize")
      assert.equal(restored.display, "block")
      assert.equal(restored.disabled, "false")
      assert.equal(restored.tabIndex, 0)
      await writeFile(
        resolve(".scratch", "left-pane-resizer-restored-desktop-resize.png"),
        await page.screenshot({ fullPage: true }),
      )

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
