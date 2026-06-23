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

function colorAlpha(value: string): number {
  const slashAlpha = value.match(/\/\s*([0-9.]+)/)
  if (slashAlpha) return Number(slashAlpha[1])
  const commaAlpha = value.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/)
  if (commaAlpha) return Number(commaAlpha[1])
  if (value === "transparent" || value === "rgba(0, 0, 0, 0)") return 0
  return 1
}

async function separatorState(page: OverlayPage) {
  return await page.$eval("#centerWorkbenchSeparatorWorkflow", (node) => {
    const separator = node as HTMLElement
    const workflow = document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!
    const inspector = document.querySelector<HTMLElement>("#centerWorkbenchInspector")!
    const min = separator.getAttribute("aria-valuemin")
    const max = separator.getAttribute("aria-valuemax")
    const now = separator.getAttribute("aria-valuenow")
    const style = getComputedStyle(separator)
    const accentProbe = document.createElement("span")
    accentProbe.style.color = "var(--accent)"
    document.body.appendChild(accentProbe)
    const accentColor = getComputedStyle(accentProbe).color
    accentProbe.remove()
    return {
      hidden: separator.hidden,
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
      focusVisible: separator.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      backgroundColor: style.backgroundColor,
      accentColor,
      workflowWidth: Math.round(workflow.getBoundingClientRect().width),
      inspectorWidth: Math.round(inspector.getBoundingClientRect().width),
    }
  })
}

type CenterWorkbenchResizeEvent = {
  type: "resize-style-write" | "center-workbench-rect-read"
  frameID: number
  inRaf: boolean
  name?: string
  id?: string
}

function assertCenterWorkbenchResizeReadsAreDeferred(events: CenterWorkbenchResizeEvent[], label: string) {
  const writeFrameIDs = new Set(
    events.filter((event) => event.type === "resize-style-write").map((event) => event.frameID),
  )
  const rectReads = events.filter((event) => event.type === "center-workbench-rect-read")
  const conflictingReads = events.filter(
    (event) => event.type === "center-workbench-rect-read" && writeFrameIDs.has(event.frameID),
  )
  assert.ok(writeFrameIDs.size > 0, `${label}: expected resize style writes, got ${JSON.stringify(events)}`)
  assert.deepEqual(
    rectReads.filter((event) => !event.inRaf),
    [],
    `${label}: center workbench geometry reads must stay in RAF when they happen: ${JSON.stringify(events)}`,
  )
  assert.deepEqual(
    conflictingReads,
    [],
    `${label}: center workbench rect reads shared the resize style-write RAF callback: ${JSON.stringify(events)}`,
  )
}

async function installCenterWorkbenchResizeInstrumentation(page: OverlayPage) {
  await page.evaluate(() => {
    const win = window as any
    win.__centerWorkbenchResizeRestoreInstrumentation?.()
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty
    let activeFrameID = 0
    let frameDepth = 0
    let nextFrameID = 1
    const resizeStyleNames = new Set(["--ui-scale", "--ui-sidebar-width", "--center-workbench-panel-grow"])
    win.__centerWorkbenchResizeEvents = []
    win.__centerWorkbenchResizePhase = "idle"
    window.requestAnimationFrame = function requestAnimationFrameWithCenterWorkbenchProbe(callback) {
      return originalRequestAnimationFrame.call(window, (time) => {
        const previousFrameID = activeFrameID
        const previousFrameDepth = frameDepth
        activeFrameID = nextFrameID++
        frameDepth = previousFrameDepth + 1
        try {
          callback(time)
        } finally {
          activeFrameID = previousFrameID
          frameDepth = previousFrameDepth
        }
      })
    }
    Element.prototype.getBoundingClientRect = function getBoundingClientRectWithCenterWorkbenchProbe() {
      const rect = originalGetBoundingClientRect.call(this)
      if (
        win.__centerWorkbenchResizePhase === "resize" &&
        this instanceof HTMLElement &&
        (this.id.startsWith("centerWorkbench") ||
          this.dataset.centerWorkbenchView !== undefined ||
          this.dataset.centerWorkbenchSeparator !== undefined)
      ) {
        win.__centerWorkbenchResizeEvents.push({
          type: "center-workbench-rect-read",
          frameID: activeFrameID,
          inRaf: frameDepth > 0,
          id: this.id,
        })
      }
      return rect
    }
    CSSStyleDeclaration.prototype.setProperty = function setPropertyWithCenterWorkbenchProbe(name, value, priority) {
      if (win.__centerWorkbenchResizePhase === "resize" && resizeStyleNames.has(name)) {
        win.__centerWorkbenchResizeEvents.push({
          type: "resize-style-write",
          frameID: activeFrameID,
          inRaf: frameDepth > 0,
          name,
        })
      }
      return originalSetProperty.call(this, name, value, priority)
    }
    win.__centerWorkbenchResizeRestoreInstrumentation = () => {
      window.requestAnimationFrame = originalRequestAnimationFrame
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
      CSSStyleDeclaration.prototype.setProperty = originalSetProperty
      win.__centerWorkbenchResizePhase = "idle"
    }
  })
}

async function beginCenterWorkbenchResizeInstrumentation(page: OverlayPage) {
  await page.evaluate(() => {
    const win = window as any
    win.__centerWorkbenchResizeEvents = []
    win.__centerWorkbenchResizePhase = "resize"
  })
}

async function collectCenterWorkbenchResizeEvents(page: OverlayPage) {
  return await page.evaluate<CenterWorkbenchResizeEvent[]>(async () => {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => resolveFrame())
      })
    }
    const win = window as any
    win.__centerWorkbenchResizePhase = "idle"
    return Array.from(win.__centerWorkbenchResizeEvents ?? [])
  })
}

async function threeCenterWorkbenchPanelLayout(page: OverlayPage) {
  return await page.evaluate(async () => {
    await new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
    })
    const tokenProbe = document.createElement("div")
    tokenProbe.style.position = "fixed"
    tokenProbe.style.visibility = "hidden"
    tokenProbe.style.width = "var(--ui-workbench-panel-min-width)"
    document.body.appendChild(tokenProbe)
    const minWidth = tokenProbe.getBoundingClientRect().width
    tokenProbe.remove()

    const body = document.querySelector<HTMLElement>(".center-workbench-body")!
    const panels = [
      document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!,
      document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")!,
      document.querySelector<HTMLElement>("#centerWorkbenchInspector")!,
    ].map((panel) => {
      const rect = panel.getBoundingClientRect()
      return {
        id: panel.id,
        open: panel.dataset.open,
        width: rect.width,
        left: rect.left,
        right: rect.right,
      }
    })
    const widthProbe = document.createElement("div")
    widthProbe.style.position = "fixed"
    widthProbe.style.visibility = "hidden"
    widthProbe.style.width = "var(--ui-overlay-min-width)"
    const heightProbe = document.createElement("div")
    heightProbe.style.position = "fixed"
    heightProbe.style.visibility = "hidden"
    heightProbe.style.height = "var(--ui-overlay-min-height)"
    document.body.append(widthProbe, heightProbe)
    const minimumWidth = widthProbe.getBoundingClientRect().width
    const minimumHeight = heightProbe.getBoundingClientRect().height
    widthProbe.remove()
    heightProbe.remove()
    const shell = document.body.getBoundingClientRect()
    const aspectRatio = minimumWidth / minimumHeight
    return {
      minWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      shellWidth: shell.width,
      shellHeight: shell.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      aspectRatio,
      panels,
    }
  })
}

function assertThreeCenterWorkbenchPanelMinWidths(
  layout: Awaited<ReturnType<typeof threeCenterWorkbenchPanelLayout>>,
  label: string,
) {
  assert.deepEqual(
    layout.panels.map((panel) => [panel.id, panel.open]),
    [
      ["centerWorkbenchWorkflow", "true"],
      ["centerWorkbenchScreenshots", "true"],
      ["centerWorkbenchInspector", "true"],
    ],
    `${label}: expected workflow, screenshots, and inspector to be open`,
  )
  for (const panel of layout.panels) {
    assert.ok(
      panel.width >= layout.minWidth - 1,
      `${label}: expected ${panel.id} width ${panel.width} to stay above ${layout.minWidth}`,
    )
  }
  for (let index = 1; index < layout.panels.length; index += 1) {
    assert.ok(
      layout.panels[index - 1].right <= layout.panels[index].left + 2,
      `${label}: expected open panels not to overlap: ${JSON.stringify(layout.panels)}`,
    )
  }
  assert.ok(layout.bodyScrollWidth >= layout.bodyClientWidth, `${label}: workbench body should scroll, not compress`)
}

test(
  "center workbench panel separator owns pointer and keyboard resizing",
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
      if (path === "/mission") return send([])
      if (path === "/session") return send([])
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
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl: location.origin,
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
      })
      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]', {
        visible: true,
      })
      await installCenterWorkbenchResizeInstrumentation(page)
      await beginCenterWorkbenchResizeInstrumentation(page)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      const inspectorOpenEvents = await collectCenterWorkbenchResizeEvents(page)
      assertCenterWorkbenchResizeReadsAreDeferred(inspectorOpenEvents, "inspector toolbar open")

      const initial = await separatorState(page)
      assert.equal(initial.hidden, false)
      assert.equal(initial.disabled, "false")
      assert.equal(initial.role, "separator")
      assert.equal(initial.orientation, "vertical")
      assert.equal(initial.controls, "centerWorkbenchWorkflow centerWorkbenchInspector")
      assert.equal(initial.tabIndex, 0)
      assert.ok(initial.minValue! < initial.maxValue!)
      assert.ok(initial.nowValue! >= initial.minValue!)
      assert.ok(initial.nowValue! <= initial.maxValue!)
      assert.ok(Math.abs(initial.workflowWidth - initial.inspectorWidth) <= 2)

      await beginCenterWorkbenchResizeInstrumentation(page)
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']", { visible: true })
      const screenshotsOpenEvents = await collectCenterWorkbenchResizeEvents(page)
      assertCenterWorkbenchResizeReadsAreDeferred(screenshotsOpenEvents, "screenshots toolbar open")
      const threePanelLayout = await threeCenterWorkbenchPanelLayout(page)
      assertThreeCenterWorkbenchPanelMinWidths(threePanelLayout, "1280x760 three-panel layout")
      await mkdir(resolve(".scratch"), { recursive: true })
      await writeFile(
        resolve(".scratch", "center-workbench-three-panel-min-width.png"),
        await page.screenshot({ fullPage: true }),
      )
      await page.setViewport({ width: 1120, height: 720 })
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']", { visible: true })
      const minimumThreePanelLayout = await threeCenterWorkbenchPanelLayout(page)
      assertThreeCenterWorkbenchPanelMinWidths(minimumThreePanelLayout, "1120x720 three-panel layout")
      await writeFile(
        resolve(".scratch", "center-workbench-three-panel-min-width-1120.png"),
        await page.screenshot({ fullPage: true }),
      )
      await page.setViewport({ width: 1120, height: 1000 })
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']", { visible: true })
      const illegalTallLayout = await threeCenterWorkbenchPanelLayout(page)
      assertThreeCenterWorkbenchPanelMinWidths(illegalTallLayout, "1120x1000 illegal-tall three-panel layout")
      assert.equal(illegalTallLayout.viewportHeight, 1000)
      assert.ok(illegalTallLayout.aspectRatio > 1.5)
      assert.ok(
        Math.abs(illegalTallLayout.shellHeight - illegalTallLayout.shellWidth / illegalTallLayout.aspectRatio) <= 1,
        `expected illegal tall shell height to be aspect-clamped: ${JSON.stringify(illegalTallLayout)}`,
      )
      await writeFile(
        resolve(".scratch", "center-workbench-illegal-tall-aspect-frame.png"),
        await page.screenshot({ fullPage: true }),
      )
      await page.setViewport({ width: 1280, height: 760 })
      await page.waitForSelector("#centerWorkbenchScreenshots[data-open='true']", { visible: true })
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="screenshots"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#centerWorkbenchScreenshots")?.dataset.open === "false",
      )
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })

      const separatorPoint = await page.$eval("#centerWorkbenchSeparatorWorkflow", (node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(separatorPoint.x, separatorPoint.y)
      await page.mouse.down()
      await page.mouse.move(separatorPoint.x + 120, separatorPoint.y, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(
        (previous) =>
          document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!.getBoundingClientRect().width >
          previous + 70,
        {},
        initial.workflowWidth,
      )
      const pointerResized = await separatorState(page)
      assert.ok(pointerResized.workflowWidth - pointerResized.inspectorWidth > 80)

      await page.mouse.move(20, 20)
      await page.focus("#centerWorkbenchSeparatorWorkflow")
      await page.keyboard.press("ArrowLeft")
      await page.waitForFunction(
        (previous) =>
          document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!.getBoundingClientRect().width <
          previous - 10,
        {},
        pointerResized.workflowWidth,
      )
      const keyboardResized = await separatorState(page)
      assert.equal(keyboardResized.focused, true)
      assert.equal(keyboardResized.focusVisible, true)
      assert.equal(keyboardResized.outlineStyle, "solid")
      assert.equal(keyboardResized.outlineWidth, "1px")
      assert.equal(keyboardResized.outlineColor, keyboardResized.accentColor)
      assert.ok(Number.parseFloat(keyboardResized.outlineOffset) > 0)
      assert.ok(colorAlpha(keyboardResized.backgroundColor) > 0.18)
      assert.ok(colorAlpha(keyboardResized.backgroundColor) < 0.26)
      assert.ok(keyboardResized.workflowWidth < pointerResized.workflowWidth)

      await mkdir(resolve(".scratch"), { recursive: true })
      await writeFile(
        resolve(".scratch", "center-workbench-separator-focus.png"),
        await page.screenshot({ fullPage: true }),
      )

      await page.keyboard.press("Home")
      await page.waitForFunction(() => {
        const separator = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")!
        return Number(separator.getAttribute("aria-valuenow")) === Number(separator.getAttribute("aria-valuemin"))
      })
      await page.keyboard.press("End")
      await page.waitForFunction(() => {
        const separator = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")!
        return Number(separator.getAttribute("aria-valuenow")) === Number(separator.getAttribute("aria-valuemax"))
      })

      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")?.hidden)
      const hidden = await separatorState(page)
      assert.equal(hidden.hidden, true)
      assert.equal(hidden.disabled, "true")
      assert.equal(hidden.tabIndex, -1)
      assert.equal(hidden.min, null)
      assert.equal(hidden.max, null)
      assert.equal(hidden.now, null)

      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      await beginCenterWorkbenchResizeInstrumentation(page)
      await page.setViewport({ width: 1180, height: 720 })
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      const desktopResizeEvents = await collectCenterWorkbenchResizeEvents(page)
      assertCenterWorkbenchResizeReadsAreDeferred(desktopResizeEvents, "desktop viewport resize")
      await writeFile(
        resolve(".scratch", "center-workbench-separator-desktop-resize.png"),
        await page.screenshot({ fullPage: true }),
      )
      await beginCenterWorkbenchResizeInstrumentation(page)
      await page.setViewport({ width: 500, height: 720 })
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      const illegalNarrowResizeEvents = await collectCenterWorkbenchResizeEvents(page)
      assertCenterWorkbenchResizeReadsAreDeferred(illegalNarrowResizeEvents, "illegal narrow viewport resize")
      await writeFile(
        resolve(".scratch", "center-workbench-separator-illegal-narrow-legal-frame.png"),
        await page.screenshot({ fullPage: true }),
      )
      const illegalNarrow = await separatorState(page)
      assert.equal(illegalNarrow.hidden, false)
      assert.equal(illegalNarrow.disabled, "false")
      assert.equal(illegalNarrow.tabIndex, 0)
      assert.ok(illegalNarrow.minValue! < illegalNarrow.maxValue!)
      assert.ok(illegalNarrow.nowValue! >= illegalNarrow.minValue!)
      assert.ok(illegalNarrow.nowValue! <= illegalNarrow.maxValue!)

      await beginCenterWorkbenchResizeInstrumentation(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.waitForSelector("#centerWorkbenchSeparatorWorkflow:not([hidden])", { visible: true })
      const restoredResizeEvents = await collectCenterWorkbenchResizeEvents(page)
      assertCenterWorkbenchResizeReadsAreDeferred(restoredResizeEvents, "restored desktop viewport resize")
      const restored = await separatorState(page)
      assert.equal(restored.hidden, false)
      assert.equal(restored.disabled, "false")
      assert.equal(restored.tabIndex, 0)
      await writeFile(
        resolve(".scratch", "center-workbench-separator-restored-desktop-resize.png"),
        await page.screenshot({ fullPage: true }),
      )

      await page.evaluate(() => (window as any).__centerWorkbenchResizeRestoreInstrumentation?.())
      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
