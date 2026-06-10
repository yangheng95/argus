import assert from "node:assert/strict"
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
      if (path === "/project/current/worktrees") return send([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === `/task/${taskID}/operator-model-context`) return send({ selected: null, candidates: [] })
      if (path === `/task/${taskID}/browser-preview`) return send({ status: "missing", diagnostics: [] })
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path === "/task/events" || path === `/task/${taskID}/events` || path === `/task/${taskID}/conversation/events`) {
        return eventStream()
      }
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/session") return send([])
      if (path === "/config/prompt") return send([])
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
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        const state = { writes: [] as string[][] }
        Object.defineProperty(window, "__imageCopyTest", {
          configurable: true,
          value: state,
        })
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            write: async (items: ClipboardItem[]) => {
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
                  locale: "en-US",
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
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
      await page.waitForSelector(`.task-row-main[data-task-id='${taskID}']`)
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
      await page.click('.card[data-kind="tool"] > .card__head')
      await page.waitForSelector(".msg-browser-evidence__trigger")
      await page.click(".msg-browser-evidence__trigger")
      await page.waitForSelector("#imagePreviewDialog")
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>(".image-preview-dialog__image")
        return Boolean(image?.complete && image.naturalWidth > 0)
      })
      await page.click('button[aria-label="Copy image"]')
      await page.waitForFunction(() => {
        const state = (window as typeof window & { __imageCopyTest?: { writes: string[][] } }).__imageCopyTest
        return (state?.writes.length ?? 0) > 0
      })

      const writes = await page.evaluate(() => {
        const state = (window as typeof window & { __imageCopyTest: { writes: string[][] } }).__imageCopyTest
        return state.writes
      })
      assert.deepEqual(writes, [["image/png"]])
      assert.deepEqual(errors, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
