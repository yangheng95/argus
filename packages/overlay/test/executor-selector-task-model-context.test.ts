import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

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

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch
  const base =
    target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key]
    else base[key] = mergePatch(base[key], value)
  }
  return base
}

test(
  "OpenCorvus composer chip follows per-task agent model context",
  async () => {
    const now = Date.now()
    const taskA = {
      id: "task_a",
      directory: "D:/overlay/workspace/app",
      status: "active",
      sessionID: "session_a",
      time: { created: now - 2_000, started: now - 1_900, updated: now - 1_000 },
    }
    const taskB = {
      id: "task_b",
      directory: "D:/overlay/workspace/app",
      status: "active",
      sessionID: "session_b",
      time: { created: now - 1_000, started: now - 900, updated: now - 500 },
    }
    const overlays: Record<string, Record<string, unknown>> = {
      session_a: { agent: { orchestrator: { model: "openai/task-a-model" } } },
      session_b: { agent: { orchestrator: { model: "openai/task-b-model" } } },
    }
    const patches: Array<{ sessionID: string; body: Record<string, unknown> }> = []
    const taskListEntry = (task: typeof taskA) => ({
      ...task,
      sessionID: undefined,
    })
    let releaseTaskAContext: () => void = () => undefined
    const taskAContextDelay = new Promise<void>((resolve) => {
      releaseTaskAContext = resolve
    })

    function effectiveConfig(sessionID: string) {
      return mergePatch(
        {
          model: "openai/project-model",
          agent: {
            orchestrator: { model: "openai/project-orchestrator" },
          },
        },
        overlays[sessionID] ?? {},
      ) as Record<string, unknown>
    }

    function context(taskID: string) {
      const sessionID = taskID === taskA.id ? taskA.sessionID : taskB.sessionID
      const cfg = effectiveConfig(sessionID) as { agent?: Record<string, { model?: string }>; model?: string }
      const model = cfg.agent?.orchestrator?.model ?? cfg.model ?? ""
      const slash = model.indexOf("/")
      return {
        taskID,
        sessionID,
        agent: "orchestrator",
        model: {
          providerID: model.slice(0, slash),
          modelID: model.slice(slash + 1),
        },
      }
    }

    function board(task: typeof taskA) {
      return {
        snapshotVersion: `${task.id}:1`,
        lastSequence: 0,
        task,
        overview: {
          headline: task.id,
          summary: "",
          nextStep: { title: "", detail: "" },
          controls: { canRetry: true, canReplan: true, canCancel: true },
        },
        plan: undefined,
        spec: undefined,
        requirements: [],
        interactions: [],
      }
    }

    function conversation(task: typeof taskA) {
      const emptyView = { topLevelSessionIDs: [], sessions: [] }
      return {
        lastSequence: 0,
        messageWatermark: 0,
        board: board(task),
        transcript: [],
        timeline: [],
        events: [],
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 500, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
        view: emptyView,
        agentView: emptyView,
      }
    }

    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        const path = route(url)
        if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
        if (path === "/" || path === "/ui" || path === "/ui/")
          return Response.redirect(`${url.origin}/ui/index.html`, 302)
        const staticResponse = await overlayStaticResponse(path)
        if (staticResponse) return staticResponse
        if (path === "/global/health") return send({ version: "1.2.3" })
        if (path === "/tasks" || path === "/global/tasks") {
          return send({ tasks: [{ task: taskListEntry(taskB) }, { task: taskListEntry(taskA) }] })
        }
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
        if (path === "/provider") {
          return send({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  "project-model": { id: "project-model" },
                  "project-orchestrator": { id: "project-orchestrator" },
                  "task-a-model": { id: "task-a-model" },
                  "task-b-model": { id: "task-b-model" },
                  "task-b-new": { id: "task-b-new" },
                },
              },
            ],
            connected: ["openai"],
            default: { openai: "project-model" },
          })
        }
        if (path === "/provider/auth") return send({})
        if (path === "/config/providers") return send({ providers: [], default: {} })
        if (path === "/config" && req.method === "GET") return send(effectiveConfig(""))
        if (path === "/config" && req.method === "PATCH") return send(await req.json())
        if (path === "/config/prompt") return send([])
        if (path === "/agent") return send([])
        if (path === "/channel") return send([])
        if (path === "/executor")
          return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
        if (path === "/skill/installed" || path === "/skill") return send([])
        if (path === "/mcp") return send({})
        if (path === "/panel/knowledge/memory") return send([])
        if (path === "/panel/knowledge/preference") return send([])
        if (path.startsWith("/task/") && path.endsWith("/conversation")) {
          const taskID = decodeURIComponent(path.slice("/task/".length, -"/conversation".length))
          return send(conversation(taskID === taskA.id ? taskA : taskB))
        }
        if (path.startsWith("/task/") && path.endsWith("/operator-model-context")) {
          const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
          if (taskID === taskA.id) await taskAContextDelay
          return send(context(taskID))
        }
        if (path.startsWith("/task/") && path.endsWith("/browser-preview")) {
          const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
          return send({
            taskID,
            kind: "missing",
            status: "missing",
            projectRoot: "D:/overlay/workspace/app",
            viewports: [],
            diagnostics: [],
            candidates: [],
            source: "none",
          })
        }
        if (path.startsWith("/session/") && path.endsWith("/config") && req.method === "PATCH") {
          const sessionID = decodeURIComponent(path.slice("/session/".length, -"/config".length))
          const body = (await req.json()) as Record<string, unknown>
          patches.push({ sessionID, body })
          overlays[sessionID] = mergePatch(overlays[sessionID] ?? {}, body) as Record<string, unknown>
          return send({ config: effectiveConfig(sessionID), origin: {} })
        }
        if (path.startsWith("/session/") && path.endsWith("/config") && req.method === "GET") {
          const sessionID = decodeURIComponent(path.slice("/session/".length, -"/config".length))
          return send({ config: effectiveConfig(sessionID), origin: {} })
        }
        if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
          return new Response(`data: ${JSON.stringify({ type: "task.connected", properties: {} })}\n\n`, {
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          })
        }
        if (path === "/log" && req.method === "POST") return send({ ok: true })
        return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
      },
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument((serverUrl) => {
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
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
      }, `http://127.0.0.1:${server.port}`)

      await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector('[data-ui="executor-chip-mirror"]')
      await page.waitForFunction(() => (window as any).__overlayInitSettled === true)

      await page.evaluate(() => {
        void (window as any).selectTask("task_a")
      })
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "Loading",
        ),
      )
      const loadingChipText = await page.$eval(
        '[data-ui="executor-chip-mirror"]',
        (element) => (element as HTMLElement).innerText,
      )
      expect(loadingChipText).not.toContain("project-model")
      expect(loadingChipText).not.toContain("not set")

      releaseTaskAContext()
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "task-a-model",
        ),
      )

      await page.evaluate(() => {
        void (window as any).selectTask("task_b")
      })
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "task-b-model",
        ),
      )

      await page.click('[data-ui="executor-chip-mirror"]')
      await page.waitForSelector('[data-section="mirror"]')
      await page.click('[data-section="mirror"] .executor-popover-model[title="openai/task-b-new"]')
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "task-b-new",
        ),
      )

      expect(patches).toEqual([
        {
          sessionID: "session_b",
          body: {
            agent: {
              orchestrator: {
                model: "openai/task-b-new",
              },
            },
          },
        },
      ])
      expect(effectiveConfig("session_a")).toMatchObject({
        agent: { orchestrator: { model: "openai/task-a-model" } },
      })
      expect(effectiveConfig("session_b")).toMatchObject({
        agent: { orchestrator: { model: "openai/task-b-new" } },
      })

      await page.close()
    } finally {
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  { timeout: 60_000 },
)
