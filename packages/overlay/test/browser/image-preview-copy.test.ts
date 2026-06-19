import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
)

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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

const promptProfileCatalog = {
  active: "default",
  project_active: "default",
  session_active: null,
  default: "default",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  profiles: [
    {
      id: "default",
      label: "Default",
      description: "Default implementation profile.",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

test(
  "tool output image preview copies image bytes to the clipboard",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const taskID = "task-image-preview-copy"
    const task = {
      id: taskID,
      title: "Image preview copy",
      directory: "D:/overlay/workspace/app",
      status: "completed",
      sessionID: "session-1",
      time: { created: now - 20_000, updated: now - 1_000 },
    }
    const board = {
      snapshotVersion: "image-preview-copy-board",
      lastSequence: 0,
      task,
      run: { executor: "opencorvus", phase: "complete" },
      overview: { headline: "Image preview copy", summary: "Tool screenshot is ready.", controls: {} },
      plan: null,
      spec: null,
      evaluation: null,
      acceptance: null,
      interactions: [],
    }
    const transcript = [
      {
        parts: [{ type: "text", text: "Capture the preview." }],
        info: {
          id: "msg-user",
          sessionID: "session-user",
          role: "user",
          resolvedRole: "user",
          agent: "user",
          channel: "user",
          time: { created: now - 8_000 },
        },
      },
      {
        parts: [
          {
            id: "tool-browser-evidence",
            type: "tool",
            tool: "browser",
            state: {
              status: "completed",
              input: { url: "https://example.test" },
              output: "Browser observation captured.",
              metadata: {
                browser: {
                  url: "https://example.test",
                  title: "Example",
                  viewport: { width: 320, height: 240 },
                  screenshot: { attachmentUrl: "/attachment/project/tiny.png" },
                  diagnostics: {},
                },
              },
              time: { start: now - 7_000, end: now - 6_000 },
            },
          },
        ],
        info: {
          id: "msg-assistant",
          sessionID: "session-1",
          role: "assistant",
          resolvedRole: "assistant",
          agent: "assistant",
          channel: "assistant",
          time: { created: now - 7_000 },
        },
      },
    ]
    const errors: string[] = []
    const requests: string[] = []

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requests.push(`${req.method} ${url.pathname}${url.search}`)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/attachment/project/tiny.png") {
        return new Response(tinyPng, { headers: { "content-type": "image/png" } })
      }
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") {
        return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
      }
      if (path === "/project/current/worktrees") return send([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === `/task/${taskID}/operator-model-context`) return send({ selected: null, candidates: [] })
      if (path === `/task/${taskID}/browser-preview`) return send({ status: "missing", diagnostics: [] })
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (
        path === "/task/events" ||
        path === `/task/${taskID}/events` ||
        path === `/task/${taskID}/conversation/events`
      ) {
        return eventStream()
      }
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/mission") return send([])
      if (path === "/session") return send([])
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === `/task/${taskID}/board`) return send(board)
      if (path === `/task/${taskID}/conversation`) {
        return send({
          board,
          transcript,
          timeline: transcript,
          events: [],
          view: {
            sessions: [
              {
                sessionID: "session-1",
                stage: "assistant",
                messageIDs: ["msg-assistant"],
                firstMessageTime: now - 7_000,
                placement: "top_level",
              },
            ],
          },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          lastSequence: 0,
        })
      }
      if (path === `/task/${taskID}/transcript`) return send(transcript)
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") {
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
      }
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/agent") return send([])
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/channel") return send([])
      if (path === "/executor") {
        return send([
          {
            id: "opencorvus",
            label: "OpenCorvus",
            detail: "Bundled",
            version: "0.0.1-alpha",
            selectable: true,
            discovered: true,
          },
        ])
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
    })
    const browser = await launchBrowser(["--disable-dev-shm-usage"])

    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1280, height: 800 })
      page.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`)
      })
      page.on("requestfailed", (request) => {
        if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
        errors.push(`requestfailed: ${request.url()}`)
      })
      page.on("response", (response) => {
        if (response.status() === 404) errors.push(`response404: ${response.url()}`)
      })
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
      })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "zh-CN"
        const state = {
          writes: [] as string[][],
          fetches: [] as string[],
          copyFetches: [] as string[],
          writeAttempts: 0,
          fetchMode: "ok" as "ok" | "fail" | "non-png",
          fetchTarget: "" as string,
          writeMode: "ok" as "ok" | "reject",
        }
        Object.defineProperty(window, "__imageCopyTest", {
          configurable: true,
          value: state,
        })
        const realFetch = window.fetch.bind(window)
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: async (input: RequestInfo | URL, init?: RequestInit) => {
            const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            state.fetches.push(value)
            if (state.fetchTarget && value === state.fetchTarget) {
              state.copyFetches.push(value)
              if (state.fetchMode === "fail") return new Response("missing", { status: 404 })
              if (state.fetchMode === "non-png") {
                return new Response("plain image payload", {
                  headers: { "content-type": "text/plain; charset=utf-8" },
                })
              }
            }
            return realFetch(input, init)
          },
        })
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: async (items: ClipboardItem[]) => {
              state.writeAttempts += 1
              if (state.writeMode === "reject") throw new DOMException("blocked", "NotAllowedError")
              state.writes.push(items.flatMap((item) => item.types))
            },
          },
        })
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  directory: "D:/overlay/workspace/app",
                  locale: "zh-CN",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_open_url" || command === "overlay_open_path") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                minimize: async () => undefined,
                startDragging: async () => undefined,
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
        localStorage.setItem("oc_locale", "zh-CN")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
      await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true")
      await page.waitForSelector(`.task-row-main[data-task-id='${taskID}']`, { visible: true })
      await page.click(`.task-row-main[data-task-id='${taskID}']`)
      try {
        await page.waitForSelector('.card[data-kind="tool"] > .card__head')
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          cards: Array.from(document.querySelectorAll<HTMLElement>(".card, .chat-bubble-row")).map((node) => ({
            kind: node.dataset.kind || "",
            role: node.dataset.role || "",
            stage: node.dataset.stage || "",
            status: node.dataset.status || "",
            text: node.textContent?.slice(0, 240) || "",
          })),
          body: document.body.textContent?.slice(0, 1400) || "",
        }))
        assert.fail(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
            { errors, requests, snapshot },
            null,
            2,
          )}`,
        )
      }
      const toolHeaderSemantics = await page.$eval('.card[data-kind="tool"] > .card__head', (head) => {
        const header = head as HTMLElement
        const main = header.querySelector<HTMLElement>(".card__head-main")
        const actions = header.querySelector<HTMLElement>(".card__actions")
        const actionButton = actions?.querySelector("button") ?? null
        return {
          headerRole: header.getAttribute("role"),
          headerTabIndex: header.getAttribute("tabindex"),
          mainTag: main?.tagName || "",
          mainExpanded: main?.getAttribute("aria-expanded") || "",
          actionsInsideMain: !!main && !!actions && main.contains(actions),
          actionButtonInsideMain: !!main && !!actionButton && main.contains(actionButton),
        }
      })
      assert.deepEqual(toolHeaderSemantics, {
        headerRole: null,
        headerTabIndex: null,
        mainTag: "BUTTON",
        mainExpanded: "false",
        actionsInsideMain: false,
        actionButtonInsideMain: false,
      })
      await page.focus('.card[data-kind="tool"] > .card__head .card__head-main')
      await page.keyboard.press("Enter")
      await page.waitForSelector(".msg-browser-evidence__trigger")
      const expandedToolHeader = await page.$eval('.card[data-kind="tool"] > .card__head .card__head-main', (main) =>
        main.getAttribute("aria-expanded"),
      )
      assert.equal(expandedToolHeader, "true")
      const toolCard = await page.$('.card[data-kind="tool"]')
      assert.ok(toolCard)
      const toolHeaderScreenshotPath = resolve(".scratch", "card-header-sibling-controls.png")
      mkdirSync(resolve(".scratch"), { recursive: true })
      writeFileSync(toolHeaderScreenshotPath, await toolCard.screenshot({}))
      await page.click(".msg-browser-evidence__trigger")
      await page.waitForSelector("#imagePreviewDialog")
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>(".image-preview-dialog__image")
        return Boolean(image?.complete && image.naturalWidth > 0)
      })
      const localizedToolbar = await page.evaluate(() => {
        const toolbar = document.querySelector<HTMLElement>(".image-preview-dialog__toolbar")
        if (!toolbar) throw new Error("image preview toolbar missing")
        const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")).map((button) => ({
          label: button.getAttribute("aria-label") || "",
          title: button.getAttribute("title") || "",
          text: button.textContent?.trim() || "",
        }))
        const scale = toolbar.querySelector<HTMLElement>(".image-preview-dialog__scale")
        return {
          toolbarLabel: toolbar.getAttribute("aria-label") || "",
          scaleLabel: scale?.getAttribute("aria-label") || "",
          buttons,
        }
      })
      assert.deepEqual(localizedToolbar, {
        toolbarLabel: "图片预览控制",
        scaleLabel: "当前缩放",
        buttons: [
          { label: "缩小", title: "缩小", text: "" },
          { label: "放大", title: "放大", text: "" },
          { label: "适应宽度", title: "适应宽度", text: "宽度" },
          { label: "适应图片", title: "适应整张图片", text: "适应" },
          { label: "原始尺寸", title: "原始尺寸", text: "1:1" },
          { label: "复制图片", title: "复制图片", text: "" },
          { label: "关闭", title: "关闭", text: "" },
        ],
      })
      const dialogMetrics = await page.evaluate(() => {
        const form = document.querySelector<HTMLElement>(".image-preview-dialog__form")
        if (!form) throw new Error("image preview dialog form missing")
        const rect = form.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }
      })
      assert.ok(
        dialogMetrics.viewportWidth - dialogMetrics.width >= 72,
        `expected horizontal backdrop close area, got ${JSON.stringify(dialogMetrics)}`,
      )
      assert.ok(
        dialogMetrics.viewportHeight - dialogMetrics.height >= 72,
        `expected vertical backdrop close area, got ${JSON.stringify(dialogMetrics)}`,
      )

      const previewSrc = await page.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>(".image-preview-dialog__image")
        return image?.src || ""
      })
      assert.ok(previewSrc, "expected image preview src")
      assert.ok(previewSrc.startsWith("blob:"), `expected protected screenshot to render from object URL, got ${previewSrc}`)
      const initialFetches = await page.evaluate(() => {
        const state = (
          window as typeof window & {
            __imageCopyTest: {
              fetches: string[]
            }
          }
        ).__imageCopyTest
        return state.fetches
      })
      assert.ok(
        initialFetches.some((value) => value.includes("/attachment/project/tiny.png")),
        `expected fixture to load protected screenshot bytes, got ${JSON.stringify(initialFetches)}`,
      )

      async function configureCopy(
        fetchMode: "ok" | "fail" | "non-png",
        writeMode: "ok" | "reject" = "ok",
        clipboardAvailable = true,
      ): Promise<void> {
        await page.evaluate(
          ({ clipboardAvailable, fetchMode, previewSrc, writeMode }) => {
            const state = (
              window as typeof window & {
                __imageCopyTest: {
                  writes: string[][]
                  copyFetches: string[]
                  writeAttempts: number
                  fetchMode: "ok" | "fail" | "non-png"
                  fetchTarget: string
                  writeMode: "ok" | "reject"
                }
              }
            ).__imageCopyTest
            state.writes = []
            state.copyFetches = []
            state.writeAttempts = 0
            state.fetchMode = fetchMode
            state.fetchTarget = previewSrc
            state.writeMode = writeMode
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: clipboardAvailable
                ? {
                    write: async (items: ClipboardItem[]) => {
                      const current = (
                        window as typeof window & {
                          __imageCopyTest: {
                            writes: string[][]
                            writeAttempts: number
                            writeMode: "ok" | "reject"
                          }
                        }
                      ).__imageCopyTest
                      current.writeAttempts += 1
                      if (current.writeMode === "reject") throw new DOMException("blocked", "NotAllowedError")
                      current.writes.push(items.flatMap((item) => item.types))
                    },
                  }
                : undefined,
            })
          },
          { clipboardAvailable, fetchMode, previewSrc, writeMode },
        )
      }

      async function waitForCopyStatus(message: string, status: "success" | "error") {
        await page.waitForFunction(
          ({ message, status }) => {
            const element = document.querySelector<HTMLElement>(".image-preview-dialog__copy-status")
            return element?.textContent?.trim() === message && element.dataset.status === status
          },
          {},
          { message, status },
        )
        return await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(".image-preview-dialog__copy-status")
          if (!element) throw new Error("copy status missing")
          return {
            text: element.textContent?.trim() || "",
            status: element.dataset.status || "",
            role: element.getAttribute("role") || "",
            live: element.getAttribute("aria-live") || "",
          }
        })
      }

      async function readCopyState() {
        return await page.evaluate(() => {
          const state = (
            window as typeof window & {
              __imageCopyTest: {
                writes: string[][]
                copyFetches: string[]
                writeAttempts: number
              }
            }
          ).__imageCopyTest
          return {
            writes: state.writes,
            copyFetches: state.copyFetches,
            writeAttempts: state.writeAttempts,
          }
        })
      }

      await configureCopy("ok")
      await page.click('button[aria-label="复制图片"]')
      assert.deepEqual(await waitForCopyStatus("已复制", "success"), {
        text: "已复制",
        status: "success",
        role: "status",
        live: "polite",
      })
      assert.deepEqual(await readCopyState(), {
        writes: [["image/png"]],
        copyFetches: [previewSrc],
        writeAttempts: 1,
      })

      await configureCopy("fail")
      await page.click('button[aria-label="复制图片"]')
      assert.deepEqual(await waitForCopyStatus("复制失败：源图片字节不可用", "error"), {
        text: "复制失败：源图片字节不可用",
        status: "error",
        role: "alert",
        live: "assertive",
      })
      assert.deepEqual(await readCopyState(), {
        writes: [],
        copyFetches: [previewSrc],
        writeAttempts: 0,
      })

      await configureCopy("non-png")
      await page.click('button[aria-label="复制图片"]')
      assert.deepEqual(await waitForCopyStatus("复制失败：需要 PNG 源图片", "error"), {
        text: "复制失败：需要 PNG 源图片",
        status: "error",
        role: "alert",
        live: "assertive",
      })
      assert.deepEqual(await readCopyState(), {
        writes: [],
        copyFetches: [previewSrc],
        writeAttempts: 0,
      })

      await configureCopy("ok", "reject")
      await page.click('button[aria-label="复制图片"]')
      assert.deepEqual(await waitForCopyStatus("复制失败：剪贴板被阻止", "error"), {
        text: "复制失败：剪贴板被阻止",
        status: "error",
        role: "alert",
        live: "assertive",
      })
      assert.deepEqual(await readCopyState(), {
        writes: [],
        copyFetches: [previewSrc],
        writeAttempts: 1,
      })

      await configureCopy("ok", "ok", false)
      await page.click('button[aria-label="复制图片"]')
      assert.deepEqual(await waitForCopyStatus("复制失败：剪贴板不可用", "error"), {
        text: "复制失败：剪贴板不可用",
        status: "error",
        role: "alert",
        live: "assertive",
      })
      const localizedStatusMetrics = await page.evaluate(() => {
        const form = document.querySelector<HTMLElement>(".image-preview-dialog__form")
        const toolbar = document.querySelector<HTMLElement>(".image-preview-dialog__toolbar")
        const status = document.querySelector<HTMLElement>(".image-preview-dialog__copy-status")
        if (!form || !toolbar || !status) throw new Error("localized image preview status missing")
        return {
          toolbarOverflowX: toolbar.scrollWidth - toolbar.clientWidth,
          statusOverflowX: status.scrollWidth - status.clientWidth,
          formOverflowX: form.scrollWidth - form.clientWidth,
        }
      })
      assert.ok(
        localizedStatusMetrics.toolbarOverflowX <= 1,
        `expected localized toolbar not to overflow horizontally, got ${JSON.stringify(localizedStatusMetrics)}`,
      )
      assert.ok(
        localizedStatusMetrics.statusOverflowX <= 1,
        `expected localized copy status not to overflow horizontally, got ${JSON.stringify(localizedStatusMetrics)}`,
      )
      assert.ok(
        localizedStatusMetrics.formOverflowX <= 1,
        `expected localized dialog not to overflow horizontally, got ${JSON.stringify(localizedStatusMetrics)}`,
      )
      const screenshotPath = resolve(".scratch/image-preview-copy-status-zh-cn.png")
      mkdirSync(resolve(".scratch"), { recursive: true })
      const screenshot = await page.screenshot({ fullPage: false })
      assert.ok(screenshot.length > 0)
      writeFileSync(screenshotPath, screenshot)
      assert.deepEqual(await readCopyState(), {
        writes: [],
        copyFetches: [],
        writeAttempts: 0,
      })
      assert.deepEqual(errors, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
