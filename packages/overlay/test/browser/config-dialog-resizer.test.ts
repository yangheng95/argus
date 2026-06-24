import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
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

function promptProfileCatalog() {
  return {
    active: "frontend-replica",
    project_active: "frontend-replica",
    session_active: null,
    default: "frontend-replica",
    targets: [],
    profiles: [
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Frontend Replica profile.",
        built_in: true,
        editable: false,
        agents: {},
      },
    ],
  }
}

test(
  "config dialog resizer exposes separator semantics and keyboard resizing",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [] })
      if (path === "/mission") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs")
        return send({
          branch: "preview-e2e",
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
      if (path === "/config" && req.method === "PATCH") return send({ model: "" })
      if (path === "/config") return send({ model: "", version: "1.2.3" })
      if (path === "/config/prompt-profile") return send(promptProfileCatalog())
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/agent") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      return send({})
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
        }
        window.__TAURI__ = {
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
              }
            },
          },
        }
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-menu-trigger="settings"]')
      await page.click('[data-menu-trigger="settings"]')
      await page.waitForSelector('[data-testid="titlebar-settings-general"]', { visible: true })
      await page.click('[data-testid="titlebar-settings-general"]')
      await page.waitForSelector("#configResizer")
      const semantics = await page.evaluate(() => {
        const resizer = document.querySelector<HTMLElement>("#configResizer")
        return {
          role: resizer?.getAttribute("role"),
          orientation: resizer?.getAttribute("aria-orientation"),
          controls: resizer?.getAttribute("aria-controls"),
          tabIndex: resizer?.tabIndex,
          min: Number(resizer?.getAttribute("aria-valuemin")),
          max: Number(resizer?.getAttribute("aria-valuemax")),
          now: Number(resizer?.getAttribute("aria-valuenow")),
        }
      })
      assert.equal(semantics.role, "separator")
      assert.equal(semantics.orientation, "vertical")
      assert.equal(semantics.controls, "configSidebar")
      assert.equal(semantics.tabIndex, 0)
      assert.ok(semantics.min < semantics.max)
      assert.ok(semantics.now >= semantics.min)
      assert.ok(semantics.now <= semantics.max)

      await page.focus("#configResizer")
      await page.keyboard.press("Home")
      await page.waitForFunction(() => {
        const resizer = document.querySelector<HTMLElement>("#configResizer")
        const sidebar = document.querySelector<HTMLElement>("#configSidebar")
        const min = Number(resizer?.getAttribute("aria-valuemin"))
        return !!sidebar && Math.abs(sidebar.getBoundingClientRect().width - min) <= 1
      })
      const before = await page.evaluate(
        () => document.querySelector<HTMLElement>("#configSidebar")!.getBoundingClientRect().width,
      )
      await page.keyboard.press("ArrowRight")
      await page.waitForFunction(
        (previous) => document.querySelector<HTMLElement>("#configSidebar")!.getBoundingClientRect().width > previous,
        before,
      )
      const dragBurst = await page.evaluate(async () => {
        const resizer = document.querySelector<HTMLElement>("#configResizer")
        const sidebar = document.querySelector<HTMLElement>("#configSidebar")
        if (!resizer || !sidebar) throw new Error("Config dialog resize fixture is missing")
        type StyleSet = { frameDepth: number; inputDepth: number; property: string; value: string }
        const record = {
          frameDepth: 0,
          inputDepth: 0,
          sets: [] as StyleSet[],
        }
        const originalRaf = window.requestAnimationFrame.bind(window)
        const originalSetProperty = CSSStyleDeclaration.prototype.setProperty
        const originalSetAttribute = Element.prototype.setAttribute
        const captureSet = (property: string, value: unknown) => {
          record.sets.push({
            frameDepth: record.frameDepth,
            inputDepth: record.inputDepth,
            property,
            value: String(value),
          })
        }
        const observer = new MutationObserver(() => {
          captureSet("style", sidebar.getAttribute("style") || "")
        })
        try {
          CSSStyleDeclaration.prototype.setProperty = function (
            property: string,
            value: string | null,
            priority?: string,
          ) {
            if (this === sidebar.style && (property === "width" || property === "min-width")) {
              captureSet(property, value)
            }
            return originalSetProperty.call(this, property, value, priority)
          }
          Element.prototype.setAttribute = function (name: string, value: string) {
            if (this === sidebar && name === "style") captureSet("style", value)
            return originalSetAttribute.call(this, name, value)
          }
          observer.observe(sidebar, { attributes: true, attributeFilter: ["style"] })
          window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
            originalRaf((time) => {
              record.frameDepth += 1
              try {
                callback(time)
              } finally {
                record.frameDepth -= 1
              }
            })) as typeof window.requestAnimationFrame
          const pointer = resizer.getBoundingClientRect()
          const startX = pointer.left + pointer.width / 2
          const startY = pointer.top + pointer.height / 2
          resizer.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              cancelable: true,
              clientX: startX,
              clientY: startY,
              pointerId: 11,
              pointerType: "mouse",
            }),
          )
          record.sets = []
          record.inputDepth += 1
          try {
            for (let index = 0; index < 30; index += 1) {
              window.dispatchEvent(
                new PointerEvent("pointermove", {
                  bubbles: true,
                  clientX: startX + 80 + index,
                  clientY: startY,
                  pointerId: 11,
                  pointerType: "mouse",
                }),
              )
            }
            await Promise.resolve()
          } finally {
            await Promise.resolve()
            record.inputDepth -= 1
          }
          const afterMoves = record.sets.slice()
          await new Promise<void>((resolve) => originalRaf(() => originalRaf(() => resolve())))
          await Promise.resolve()
          const afterFrame = record.sets.slice()
          record.sets = []
          record.inputDepth += 1
          try {
            window.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                clientX: startX + 130,
                clientY: startY,
                pointerId: 11,
                pointerType: "mouse",
              }),
            )
            window.dispatchEvent(
              new PointerEvent("pointerup", {
                bubbles: true,
                clientX: startX + 130,
                clientY: startY,
                pointerId: 11,
                pointerType: "mouse",
              }),
            )
          } finally {
            await Promise.resolve()
            record.inputDepth -= 1
          }
          const afterPointerUpFlush = record.sets.slice()
          return {
            afterFrame,
            afterMoves,
            afterPointerUpFlush,
            finalWidth: sidebar.getBoundingClientRect().width,
            handleActive: resizer.dataset.active || "",
          }
        } finally {
          observer.disconnect()
          window.requestAnimationFrame = originalRaf
          CSSStyleDeclaration.prototype.setProperty = originalSetProperty
          Element.prototype.setAttribute = originalSetAttribute
        }
      })
      assert.deepEqual(
        dragBurst.afterMoves,
        [],
        `pointermove burst should not write width synchronously: ${JSON.stringify(dragBurst)}`,
      )
      const frameWidthSets = dragBurst.afterFrame.filter((entry) => entry.property === "width")
      const frameMinWidthSets = dragBurst.afterFrame.filter((entry) => entry.property === "min-width")
      const frameStyleSets = dragBurst.afterFrame.filter((entry) => entry.property === "style")
      assert.equal(
        frameWidthSets.length,
        1,
        `pointermove burst should write one width in RAF: ${JSON.stringify(dragBurst)}`,
      )
      assert.equal(
        frameMinWidthSets.length,
        1,
        `pointermove burst should write one min-width in RAF: ${JSON.stringify(dragBurst)}`,
      )
      assert.equal(
        frameStyleSets.length,
        1,
        `pointermove burst should produce one sidebar style mutation: ${JSON.stringify(dragBurst)}`,
      )
      assert.ok(
        dragBurst.afterFrame.every((entry) => entry.inputDepth === 0),
        `pointermove burst writes must run outside the input event: ${JSON.stringify(dragBurst)}`,
      )
      assert.ok(
        dragBurst.afterPointerUpFlush.some((entry) => entry.inputDepth > 0),
        `pointerup should flush the final pending width before cleanup: ${JSON.stringify(dragBurst)}`,
      )
      assert.equal(dragBurst.handleActive, "")
      const dialogDrag = await page.evaluate(async () => {
        const header = document.querySelector<HTMLElement>("#configDialog .dialog-header")
        const form = document.querySelector<HTMLElement>("#configDialog .dialog-form")
        if (!header || !form) throw new Error("Config dialog drag fixture is missing")
        type RectRead = { frameDepth: number; inputDepth: number; target: string }
        const record = {
          frameDepth: 0,
          inputDepth: 0,
          reads: [] as RectRead[],
        }
        const originalRect = Element.prototype.getBoundingClientRect
        const originalRaf = window.requestAnimationFrame.bind(window)
        const captureRead = (target: Element) => {
          if (target !== form && target !== document.body) return
          record.reads.push({
            frameDepth: record.frameDepth,
            inputDepth: record.inputDepth,
            target: target === form ? "form" : "body",
          })
        }
        try {
          Element.prototype.getBoundingClientRect = function () {
            captureRead(this)
            return originalRect.call(this)
          }
          window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
            originalRaf((time) => {
              record.frameDepth += 1
              try {
                callback(time)
              } finally {
                record.frameDepth -= 1
              }
            })) as typeof window.requestAnimationFrame
          const pointer = originalRect.call(header)
          const startX = pointer.left + pointer.width / 2
          const startY = pointer.top + pointer.height / 2
          header.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              cancelable: true,
              clientX: startX,
              clientY: startY,
              isPrimary: true,
              pointerId: 17,
              pointerType: "mouse",
            }),
          )
          record.reads = []
          record.inputDepth += 1
          try {
            for (let index = 0; index < 30; index += 1) {
              window.dispatchEvent(
                new PointerEvent("pointermove", {
                  bubbles: true,
                  cancelable: true,
                  clientX: startX + 90 + index,
                  clientY: startY + 24,
                  pointerId: 17,
                  pointerType: "mouse",
                }),
              )
            }
            await Promise.resolve()
          } finally {
            await Promise.resolve()
            record.inputDepth -= 1
          }
          const afterMoves = record.reads.slice()
          await new Promise<void>((resolve) => originalRaf(() => originalRaf(() => resolve())))
          await Promise.resolve()
          const afterFrame = record.reads.slice()
          record.reads = []
          record.inputDepth += 1
          try {
            window.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                cancelable: true,
                clientX: startX + 140,
                clientY: startY + 48,
                pointerId: 17,
                pointerType: "mouse",
              }),
            )
            window.dispatchEvent(
              new PointerEvent("pointerup", {
                bubbles: true,
                cancelable: true,
                clientX: startX + 140,
                clientY: startY + 48,
                pointerId: 17,
                pointerType: "mouse",
              }),
            )
            await Promise.resolve()
          } finally {
            await Promise.resolve()
            record.inputDepth -= 1
          }
          const afterPointerUpFlush = record.reads.slice()
          return {
            afterFrame,
            afterMoves,
            afterPointerUpFlush,
            dragging: form.dataset.dialogDragging || "",
            x: form.style.getPropertyValue("--dialog-drag-x"),
            y: form.style.getPropertyValue("--dialog-drag-y"),
          }
        } finally {
          Element.prototype.getBoundingClientRect = originalRect
          window.requestAnimationFrame = originalRaf
        }
      })
      assert.deepEqual(
        dialogDrag.afterMoves,
        [],
        `dialog pointermove burst should not read layout synchronously: ${JSON.stringify(dialogDrag)}`,
      )
      const frameFormReads = dialogDrag.afterFrame.filter((entry) => entry.target === "form")
      const frameBodyReads = dialogDrag.afterFrame.filter((entry) => entry.target === "body")
      assert.equal(
        frameFormReads.length,
        1,
        `dialog drag should read form rect once in RAF: ${JSON.stringify(dialogDrag)}`,
      )
      assert.equal(
        frameBodyReads.length,
        1,
        `dialog drag should read body rect once in RAF: ${JSON.stringify(dialogDrag)}`,
      )
      assert.ok(
        dialogDrag.afterFrame.every((entry) => entry.frameDepth > 0 && entry.inputDepth === 0),
        `dialog drag layout reads must run inside RAF outside pointermove: ${JSON.stringify(dialogDrag)}`,
      )
      assert.ok(
        dialogDrag.afterPointerUpFlush.some((entry) => entry.inputDepth > 0),
        `dialog pointerup should flush the final pending clamp: ${JSON.stringify(dialogDrag)}`,
      )
      assert.equal(dialogDrag.dragging, "")
      assert.ok(
        dialogDrag.x !== "0px" || dialogDrag.y !== "0px",
        `dialog drag should apply a visible offset: ${JSON.stringify(dialogDrag)}`,
      )
      const notifications = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.app-notification[role="alert"]')).map((node) =>
          node.textContent?.replace(/\s+/g, " ").trim(),
        ),
      )
      assert.deepEqual(notifications, [])
      await page.setViewport({ width: 1120, height: 720 })
      await page.waitForFunction(() => document.body.getBoundingClientRect().width >= 1120)
      mkdirSync(resolve(".scratch"), { recursive: true })
      writeFileSync(resolve(".scratch/config-dialog-resizer.png"), await page.screenshot({ fullPage: false }))
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
