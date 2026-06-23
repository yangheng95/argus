import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

test(
  "copying logs does not open the dialog",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const task = {
      id: "task-1",
      title: "Overlay copy task",
      directory: "D:/overlay/workspace/app",
      status: "completed",
      sessionID: "session-1",
      time: {
        created: now - 20_000,
        updated: now - 1_000,
      },
    }
    const data = {
      tasks: {
        tasks: [{ task, updated_at: now - 1_000 }],
      },
      board: {
        snapshotVersion: "copy-actions-log-viewer",
        task,
        run: {
          executor: "opencorvus",
          phase: "complete",
        },
        overview: {
          headline: "Overlay copy task",
          summary: "Used to verify copy actions stay silent.",
          controls: {},
        },
        plan: null,
        spec: null,
        evaluation: null,
        acceptance: null,
        interactions: [],
      },
      timeline: {
        task: {
          "task-1": [
            {
              parts: [{ type: "text", text: "Please copy this transcript." }],
              info: {
                id: "msg-user",
                sessionID: "session-user",
                role: "user",
                channel: "main",
                time: { created: now - 8_000 },
              },
            },
            {
              parts: [{ type: "text", text: "Transcript ready." }],
              info: {
                id: "msg-assistant",
                sessionID: "session-1",
                role: "assistant",
                resolvedRole: "assistant",
                channel: "assistant",
                time: { created: now - 7_000 },
              },
            },
          ],
        },
      },
      logs: [
        "INFO  2026-03-10T10:00:00 +1ms service=server overlay ready",
        "WARN  2026-03-10T10:00:01 +2ms service=server seeded warning",
      ],
      path: {
        directory: "D:/overlay/workspace/app",
      },
      vcs: {
        branch: "dev",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      },
      config: {},
      provider: { all: [], connected: [], default: {} },
      providerAuth: {},
      channels: [],
      skills: [],
      mcp: {},
      executors: [
        {
          id: "opencorvus",
          label: "OpenCorvus",
          detail: "Bundled",
          version: "0.0.1-alpha",
          selectable: true,
          discovered: true,
        },
      ],
      memory: [],
      preferences: [],
    }
    const route = (url: URL) => url.pathname.replace(/\/+$/, "") || "/"
    const send = (value: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(value), {
        ...init,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(init?.headers || {}),
        },
      })
    const text = (value: string, init?: ResponseInit) =>
      new Response(value, {
        ...init,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...(init?.headers || {}),
        },
      })
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") {
        return new Response(null, { status: 204 })
      }
      if (path === "/ui" || path === "/ui/") {
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      }
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/task/events" || path === "/task/task-1/events") {
        return new Response(":\n\n", {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }
      if (path === "/tasks") return send(data.tasks)
      if (path === "/global/tasks") return send(data.tasks)
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
      if (path === "/session") return send([])
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") {
        return send({
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
        })
      }
      if (path.startsWith("/task/") && path.endsWith("/board")) return send(data.board)
      if (path === "/task/task-1/conversation") {
        return send({
          board: data.board,
          transcript: data.timeline.task["task-1"] || [],
          timeline: data.timeline.task["task-1"] || [],
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
      if (path.startsWith("/task/task-1/conversation/events")) {
        return send({
          events: [],
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        })
      }
      if (path === "/task/task-1/transcript") return send(data.timeline.task["task-1"] || [])
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/config") return send(data.config)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/agent") return send([])
      if (path === "/config/providers") {
        return send({ providers: [], default: data.provider.default || {} })
      }
      if (path === "/channel") return send(data.channels)
      if (path === "/executor") return send(data.executors)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/mcp") return send(data.mcp)
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/preference") return send(data.preferences)
      if (path === "/log/tail") return send({ path: "D:/overlay/logs/server.log", lines: data.logs })
      if (path === "/log" && req.method === "POST") return send(true)
      return text("not found", { status: 404 })
    })
    const browser = await launchBrowser()

    try {
      const tab = await browser.newPage()
      const base = server.origin
      const errors: string[] = []
      tab.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`)
      })
      tab.on("requestfailed", (request) => {
        errors.push(`requestfailed: ${request.url()}`)
      })
      tab.on("response", (response) => {
        if (response.status() === 404) errors.push(`response404: ${response.url()}`)
      })
      tab.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
      })
      await tab.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        if (document.documentElement) document.documentElement.lang = "en-US"
        const state = { writes: [] as string[] }
        Object.defineProperty(window, "__copyTest", {
          configurable: true,
          value: state,
        })
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              state.writes.push(String(value))
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
      }, base)
      await tab.goto(`${base}/ui/index.html`, { waitUntil: "load" })
      try {
        await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
      } catch (error) {
        const snapshot = await tab.evaluate(() => ({
          badge: document.querySelector("#connBadge")?.textContent || "",
          badgeStatus: document.querySelector<HTMLElement>("#connBadge")?.dataset.status || "",
          body: document.body.textContent?.slice(0, 500) || "",
          serverUrl: localStorage.getItem("oc_server_url"),
        }))
        assert.fail(
          `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ errors, snapshot })}`,
        )
      }
      await tab.waitForSelector('[data-ui="side-activity-button"][data-activity="tasks"]')
      await tab.click('[data-ui="side-activity-button"][data-activity="tasks"]')
      await tab.waitForSelector(".task-row-main[data-task-id='task-1']", { visible: true })
      await tab.click(".task-row-main[data-task-id='task-1']")

      await tab.evaluate(() => window.dispatchEvent(new CustomEvent("oc:open-logs")))
      await tab.waitForFunction(() => document.querySelector("#logDialog") !== null)
      await tab.waitForSelector(".log-line")
      const logLayout = await tab.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>("#logDialog")
        const viewer = document.querySelector<HTMLElement>(".log-viewer")
        const dialogBox = dialog?.getBoundingClientRect()
        const viewerBox = viewer?.getBoundingClientRect()
        const headerActions = Array.from(
          document.querySelectorAll<HTMLButtonElement>("#logDialog .dialog-header-actions button"),
        ).map((button) => ({
          id: button.id,
          text: button.textContent?.trim() || "",
          disabled: button.disabled,
        }))
        return {
          logPathResidueCount: document.querySelectorAll(".log-path").length,
          serverLogsButtonCount: document.querySelectorAll("#btnLogServerLogs").length,
          refreshButtonCount: document.querySelectorAll("#btnLogRefresh").length,
          refreshActionLabels: headerActions
            .filter((button) => button.id === "btnLogRefresh")
            .map((button) => button.text),
          commandActionIds: headerActions.filter((button) => button.id.startsWith("btn")).map((button) => button.id),
          lineCount: document.querySelectorAll(".log-line").length,
          dialogWidth: Math.round(dialogBox?.width ?? 0),
          dialogHeight: Math.round(dialogBox?.height ?? 0),
          viewerHeight: Math.round(viewerBox?.height ?? 0),
        }
      })
      assert.equal(logLayout.logPathResidueCount, 0)
      assert.equal(logLayout.serverLogsButtonCount, 0)
      assert.equal(logLayout.refreshButtonCount, 1)
      assert.deepEqual(logLayout.refreshActionLabels, ["Refresh"])
      assert.deepEqual(logLayout.commandActionIds, ["btnLogRefresh", "btnLogCopy", "btnLogClear", "btnCloseLog"])
      assert.ok(logLayout.lineCount > 0)
      assert.ok(logLayout.dialogWidth > 320)
      assert.ok(logLayout.dialogHeight > 240)
      assert.ok(logLayout.viewerHeight > 180)
      const logDialog = await tab.$("#logDialog")
      assert.ok(logDialog)
      const screenshotPath = resolve(".scratch/log-viewer-single-refresh-entry.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await logDialog.screenshot({}))

      await tab.waitForFunction(() => {
        const button = document.querySelector("#btnLogCopy")
        return button instanceof HTMLButtonElement && !button.disabled
      })
      await tab.click("#btnLogCopy")
      await new Promise((resolve) => setTimeout(resolve, 200))

      const afterLog = await tab.evaluate(() => {
        const state = (window as typeof window & { __copyTest: { writes: string[] } }).__copyTest
        return {
          writes: [...state.writes],
          dialogOpen: document.querySelector("#appDialog") !== null,
        }
      })

      assert.equal(afterLog.dialogOpen, false)
      assert.equal(afterLog.writes.length, 1)
      assert.match(afterLog.writes[0], /overlay ready/)
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
