import { expect, test } from "bun:test"

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

const src = new URL("../src/", import.meta.url)
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

async function browser() {
  const list = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay render behavior test")
}

function serve() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }))
    },
  })
}

test("overlay initializes cwd in a fresh temp directory when no custom cwd is saved", async () => {
  const exe = await browser()
  const seen: { path: string; directory: string | null }[] = []
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      if (!path.startsWith("/i18n/") && !path.endsWith(".svg") && !path.endsWith(".css") && !path.endsWith(".js") && !path.endsWith(".json") && path !== "/") {
        seen.push({
          path,
          directory: url.searchParams.get("directory"),
        })
      }
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/experimental/session") return send([])
      if (path === "/path") {
        const directory = url.searchParams.get("directory") || ""
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: directory,
          directory,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 })))
    },
  })
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value) => {
      const state = {
        settings: {
          serverUrl: value,
          autoServer: false,
        },
        temp: [] as string[],
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return state.settings
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_create_temp_dir") {
              const next = `D:/overlay/temp-auto-${state.temp.length + 1}`
              state.temp.push(next)
              return next
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
    await tab.waitForFunction(() => {
      try {
        const state = window.eval("state")
        return state.directory === "D:/overlay/temp-auto-1" && state.path?.directory === "D:/overlay/temp-auto-1"
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const test = (window as typeof window & { __overlayTest: { settings: Record<string, unknown> } }).__overlayTest
      return {
        directory: state.directory,
        directoryMode: state.directoryMode,
        savedDirectory: test.settings.directory,
        savedDirectoryMode: test.settings.directoryMode,
      }
    })

    expect(result.directory).toBe("D:/overlay/temp-auto-1")
    expect(result.directoryMode).toBe("temp")
    expect(result.savedDirectory).toBeUndefined()
    expect(result.savedDirectoryMode).toBe("temp")
    expect(seen.some((item) => item.path === "/tasks" && item.directory === "D:/overlay/temp-auto-1")).toBe(true)
    expect(seen.some((item) => item.path === "/path" && item.directory === "D:/overlay/temp-auto-1")).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("cwd uses state.directory as the only active source and keeps actions on the right", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderMeta") === "function"
          && typeof window.eval("activeDirectory") === "function"
          && typeof window.eval("clearProjectScopeData") === "function"
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderMeta = window.eval("renderMeta")
      const activeDirectory = window.eval("activeDirectory")
      const clearProjectScopeData = window.eval("clearProjectScopeData")

      state.directory = "D:/overlay/current"
      state.path = { directory: "D:/overlay/stale" }
      renderMeta()
      const filled = {
        active: activeDirectory(),
        lastChild: document.querySelector(".task-dir-shell")?.lastElementChild?.className || "",
      }

      state.directory = ""
      renderMeta()
      const empty = {
        active: activeDirectory(),
        lastChild: document.querySelector(".task-dir-shell")?.lastElementChild?.className || "",
      }

      state.memoryFiles = [{ id: "mem-1", title: "note", scope: "global", source: "test", timeUpdated: 1 }]
      state.memorySearchMode = true
      state.preferences = [{ id: "pref-1", key: "tone", value: "brief", scope: "cwd", source: "test" }]
      state.path = { directory: "D:/overlay/stale" }
      state.vcs = { branch: "main" }
      state.tasks = [{ task: { id: "task-1" } }]
      state.sessions = [{ id: "session-1" }]
      clearProjectScopeData()

      return {
        filled,
        empty,
        cleared: {
          path: state.path,
          vcs: state.vcs,
          tasks: state.tasks.length,
          sessions: state.sessions.length,
          memory: state.memoryFiles.length,
          search: state.memorySearchMode,
          preferences: state.preferences.length,
        },
      }
    })

    expect(result.filled.active).toBe("D:/overlay/current")
    expect(result.filled.lastChild).toContain("task-dir-actions")
    expect(result.empty.active).toBe("")
    expect(result.empty.lastChild).toContain("task-dir-actions")
    expect(result.cleared.path).toBeNull()
    expect(result.cleared.vcs).toBeNull()
    expect(result.cleared.tasks).toBe(0)
    expect(result.cleared.sessions).toBe(0)
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("planner turn refreshes when synthetic board content changes", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderSession") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const before = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.selectedTaskID = "task-1"
      state.chatSessionID = ""
      state.board = {
        task: {
          status: "running",
          request: "Review overlay render behavior.",
          time: { created: 1, updated: 5 },
        },
        spec: {
          content: "Spec before",
          time: { created: 2 },
        },
        plan: {
          version: 1,
          summary: "Plan before",
          time: { created: 3 },
          metadata: {},
        },
        lanes: [
          {
            id: "goals",
            cards: [
              {
                id: "goal-1",
                title: "Goal before",
                detail: "Keep synthetic turns current.",
                status: "pending",
                metadata: {},
              },
            ],
          },
        ],
        interactions: [],
        evaluation: {
          verdict: "pending",
          summary: "Evaluation before",
          time: { created: 4 },
          checks: [],
        },
      }
      state.session = [
        {
          parts: [{ type: "text", text: "Assistant note" }],
          info: { role: "assistant", time: { created: 6 } },
        },
      ]
      state._renderedGroupKey = ""
      renderSession()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(before).toContain("Plan before")

    const after = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.board = {
        ...state.board,
        plan: {
          ...state.board.plan,
          summary: "Plan after",
        },
      }
      renderSession()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(after).toContain("Plan after")
    expect(after).not.toContain("Plan before")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("live planner agent marks the plan section active", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderSession") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const phase = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.board = null
      state.session = [
        {
          info: {
            role: "assistant",
            agent: "planner",
            time: { created: 10 },
          },
          parts: [
            {
              type: "text",
              text: "Planning in progress",
            },
          ],
        },
      ]
      state._renderedGroupKey = ""
      renderSession()
      return document.querySelector("#planSection")?.dataset.phaseState || ""
    })

    expect(phase).toBe("active")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("session message deltas refresh the transcript live", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")
      const handleEventStreamEvent = window.eval("handleEventStreamEvent")

      state.board = null
      state.selectedTaskID = ""
      state.chatSessionID = "session-1"
      state.session = []
      state.sessionSource = "session"
      state._renderedGroupKey = ""
      renderSession()

      handleEventStreamEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: 10 },
          },
        },
      })
      handleEventStreamEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-1",
            sessionID: "session-1",
            messageID: "msg-1",
            type: "text",
            text: "Hel",
          },
        },
      })
      handleEventStreamEvent({
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "msg-1",
          partID: "part-1",
          field: "text",
          delta: "lo",
        },
      })

      await new Promise((resolve) => requestAnimationFrame(() => resolve()))

      return {
        body: document.querySelector('.turn[data-role="assistant"] .msg-body')?.textContent || "",
        count: document.querySelector("#chatCount")?.textContent || "",
      }
    })

    expect(result.body).toContain("Hello")
    expect(result.count).not.toBe("")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("first empty chat send opens the session-backed panel conversation", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderWorkspaceState") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderWorkspaceState = window.eval("renderWorkspaceState")
      const renderManagedSessionList = window.eval("renderManagedSessionList")
      const renderClear = window.eval("renderClear")
      const root = window as Window & { __overlayCalls?: string[] }
      const session = {
        id: "session-9",
        title: "Created session",
        directory: "",
        time: {
          created: 1,
          updated: 2,
        },
      }
      const calls = []
      const messages = []
      const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/panel/message/stream" && method === "POST") {
          return new Response("missing", { status: 404 })
        }
        if (url.pathname === "/panel/message" && method === "POST") {
          const body = JSON.parse(String(init.body || "{}"))
          const text = String(body.text || "")
          messages.splice(
            0,
            messages.length,
            {
              parts: [{ type: "text", text }],
              info: { id: "msg-user-1", role: "user", sessionID: "session-9", time: { created: 10 } },
            },
            {
              parts: [{ type: "text", text: `Handled: ${text}` }],
              info: { id: "msg-assistant-1", role: "assistant", sessionID: "session-9", time: { created: 11 } },
            },
          )
          return json({
            kind: "panel_response",
            session_id: "session-9",
            message: `Handled: ${text}`,
          })
        }
        if (url.pathname === "/session/session-9" && method === "GET") {
          return json(session)
        }
        if (url.pathname === "/session/session-9/message" && method === "GET") {
          return json(messages)
        }
        if (url.pathname === "/experimental/session" && method === "GET") {
          return json([session])
        }
        if (url.pathname === "/global/tasks" && method === "GET") {
          return json({ tasks: [] })
        }
        if (url.pathname === "/panel/knowledge/memory" && method === "GET") {
          return json([])
        }
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.globalView = false
      state.selectedTaskID = ""
      state.chatSessionID = ""
      state.managedSession = null
      state.sessions = []
      state.session = []
      state.sessionSource = ""
      renderWorkspaceState()
      renderManagedSessionList()
      renderClear()
    })

    await tab.click("#chatTextarea")
    await tab.type("#chatTextarea", "Start a new workspace chat")
    await tab.click("#chatSend")

    await tab.waitForFunction(() => {
      try {
        const state = window.eval("state")
        return (
          state.chatSessionID === "session-9" &&
          document.body.dataset.workspace === "session" &&
          (document.querySelector("#chatCount")?.textContent || "") !== ""
        )
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => ({
      calls: window.__overlayCalls || [],
      workspace: document.body.dataset.workspace || "",
      count: document.querySelector("#chatCount")?.textContent || "",
      assistant: document.querySelector('.turn[data-role="assistant"] .msg-body')?.textContent || "",
      sessions: [...document.querySelectorAll(".session-row-main[data-session-id]")].map((node) => node.getAttribute("data-session-id")),
    }))

    expect(result.workspace).toBe("session")
    expect(result.count).not.toBe("")
    expect(result.assistant).toContain("Handled: Start a new workspace chat")
    expect(result.calls).toContain("POST /panel/message/stream")
    expect(result.calls).toContain("POST /panel/message")
    expect(result.calls).toContain("GET /session/session-9")
    expect(result.calls).toContain("GET /session/session-9/message")
    expect(result.sessions).toContain("session-9")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("panel stream consumes the trailing done event without a final blank line", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderWorkspaceState") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderWorkspaceState = window.eval("renderWorkspaceState")
      const renderManagedSessionList = window.eval("renderManagedSessionList")
      const renderClear = window.eval("renderClear")
      const root = window as Window & { __overlayCalls?: string[] }
      const encoder = new TextEncoder()
      const calls = []

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/panel/message/stream" && method === "POST") {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool", tool: "panel" })}\n\n`))
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", result: { kind: "panel_response", message: "Done from tail flush." } })}`))
              controller.close()
            },
          })
          return new Response(stream, {
            status: 200,
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
            },
          })
        }

        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.globalView = false
      state.selectedTaskID = ""
      state.chatSessionID = ""
      state.managedSession = null
      state.sessions = []
      state.session = []
      state.sessionSource = ""
      renderWorkspaceState()
      renderManagedSessionList()
      renderClear()
    })

    await tab.click("#chatTextarea")
    await tab.type("#chatTextarea", "Stream parser regression")
    await tab.click("#chatSend")

    await tab.waitForFunction(() => {
      const text = document.querySelector('.turn[data-role="assistant"] .msg-body')?.textContent || ""
      return text.includes("Done from tail flush.")
    })

    const result = await tab.evaluate(() => ({
      assistant: document.querySelector('.turn[data-role="assistant"] .msg-body')?.textContent || "",
      calls: window.__overlayCalls || [],
    }))

    expect(result.assistant).toContain("Done from tail flush.")
    expect(result.calls).toContain("POST /panel/message/stream")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("executor width only remeasures on scale-driven renders", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function" && typeof window.eval("renderScale") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const counts = await tab.evaluate(() => {
      const renderExecutor = window.eval("renderExecutor")
      const renderScale = window.eval("renderScale")
      const buttons = [...document.querySelectorAll("[data-executor]")]
      let calls = 0
      const orig = buttons.map((button) => button.getBoundingClientRect.bind(button))

      buttons.forEach((button, index) => {
        button.getBoundingClientRect = () => {
          calls += 1
          return orig[index]()
        }
      })

      renderExecutor({ measure: true })
      const first = calls
      renderExecutor()
      const second = calls
      renderScale()
      return { first, second, third: calls }
    })

    expect(counts.first).toBeGreaterThan(0)
    expect(counts.second).toBe(counts.first)
    expect(counts.third).toBeGreaterThan(counts.second)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("external executors show manual install and auth tooltip when unavailable", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const titles = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderExecutor = window.eval("renderExecutor")

      state.locale = "en-US"
      state.executors = [
        { id: "codex", label: "Codex", detail: "Disconnected", selectable: false, discovered: false },
        { id: "claude-code", label: "Claude Code", detail: "Disconnected", selectable: false, discovered: false },
        { id: "opencode", label: "OpenCorvus", detail: "Bundled", selectable: true, discovered: true },
      ]

      renderExecutor({ measure: true })

      return {
        codex: document.querySelector('[data-executor="codex"]')?.getAttribute("title") || "",
        claude: document.querySelector('[data-executor="claude-code"]')?.getAttribute("title") || "",
        opencode: document.querySelector('[data-executor="opencode"]')?.getAttribute("title") || "",
      }
    })

    expect(titles.codex).toContain("Requires manual install and auth before use")
    expect(titles.claude).toContain("Requires manual install and auth before use")
    expect(titles.opencode).not.toContain("Requires manual install and auth before use")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("openai auth action opens a method picker instead of failing silently", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderProviderStatus") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderProviderStatus = window.eval("renderProviderStatus")

      state.locale = "en-US"
      state.providerCatalog = {
        all: [{ id: "openai", name: "OpenAI", env: [], models: { "gpt-4.1": {} } }],
        connected: [],
        default: { openai: "gpt-4.1" },
      }
      state.providerAuth = {
        openai: [
          { type: "oauth", label: "ChatGPT Pro/Plus (browser)" },
          { type: "oauth", label: "ChatGPT Pro/Plus (headless)" },
          { type: "api", label: "Manually enter API Key" },
        ],
      }
      document.querySelector("#llmProvider").innerHTML = `<option value="openai">OpenAI</option>`
      document.querySelector("#llmProvider").value = "openai"
      renderProviderStatus("openai", {})
    })

    await tab.waitForFunction(() => !document.querySelector("#btnLlmAuthAction")?.classList.contains("hidden"))
    await tab.evaluate(() => document.querySelector("#btnLlmAuthAction")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await tab.waitForFunction(() => (document.querySelector("#appDialog") instanceof HTMLDialogElement) && document.querySelector("#appDialog").open === true)

    const result = await tab.evaluate(() => ({
      title: document.querySelector("#appDialogTitle")?.textContent || "",
      selectLabel: document.querySelector("#appDialogSelectLabel")?.textContent || "",
      options: [...document.querySelectorAll("#appDialogSelect option")].map((item) => item.textContent || ""),
    }))

    expect(result.title).toContain("OpenAI")
    expect(result.selectLabel).not.toBe("")
    expect(result.options).toHaveLength(3)
    expect(result.options.some((item) => item.includes("Manually enter API Key"))).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace mode follows unified selection helpers", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("enterTaskWorkspace") === "function"
          && typeof window.eval("enterSessionWorkspace") === "function"
          && typeof window.eval("enterEmptyWorkspace") === "function"
          && typeof window.eval("renderWorkspaceState") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const modes = await tab.evaluate(() => {
      const state = window.eval("state")
      const enterTaskWorkspace = window.eval("enterTaskWorkspace")
      const enterSessionWorkspace = window.eval("enterSessionWorkspace")
      const enterEmptyWorkspace = window.eval("enterEmptyWorkspace")
      const renderWorkspaceState = window.eval("renderWorkspaceState")

      state.connected = true
      enterEmptyWorkspace()
      const empty = document.body.dataset.workspace || ""

      enterTaskWorkspace("task-1")
      const task = document.body.dataset.workspace || ""

      enterTaskWorkspace("task-1", {
        sessionID: "session-1",
        managedSession: { id: "session-1" },
      })
      const taskSession = document.body.dataset.workspace || ""

      enterSessionWorkspace("session-2", {
        managedSession: { id: "session-2" },
      })
      const session = document.body.dataset.workspace || ""

      state.connected = false
      renderWorkspaceState()
      const offline = document.body.dataset.workspace || ""

      return { empty, task, taskSession, session, offline }
    })

    expect(modes.empty).toBe("empty")
    expect(modes.task).toBe("task")
    expect(modes.taskSession).toBe("task-session")
    expect(modes.session).toBe("session")
    expect(modes.offline).toBe("offline")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace directory uses the visible control value as the single source of truth", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("activeDirectory") === "function"
          && typeof window.eval("restoreWorkspaceDirectory") === "function"
          && typeof window.eval("enterTaskWorkspace") === "function"
          && typeof window.eval("enterSessionWorkspace") === "function"
          && typeof window.eval("enterEmptyWorkspace") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

      const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const activeDirectory = window.eval("activeDirectory")
      const restoreWorkspaceDirectory = window.eval("restoreWorkspaceDirectory")
      const enterTaskWorkspace = window.eval("enterTaskWorkspace")
      const enterSessionWorkspace = window.eval("enterSessionWorkspace")
      const enterEmptyWorkspace = window.eval("enterEmptyWorkspace")

      state.directory = "D:/overlay/manual"
      restoreWorkspaceDirectory()
      const manual = activeDirectory()

      enterTaskWorkspace("task-1", { directory: "D:/overlay/task" })
      const task = {
        active: activeDirectory(),
        stored: state.directory,
      }

      enterSessionWorkspace("session-2", { directory: "D:/overlay/session" })
      const session = {
        active: activeDirectory(),
        stored: state.directory,
      }

      state.path = { directory: "D:/overlay/fallback" }
      enterEmptyWorkspace({ globalView: false })
      return {
        manual,
        task,
        session,
        restored: activeDirectory(),
        stored: state.directory,
      }
    })

    expect(result.manual).toBe("D:/overlay/manual")
    expect(result.task.active).toBe("D:/overlay/task")
    expect(result.task.stored).toBe("D:/overlay/task")
    expect(result.session.active).toBe("D:/overlay/session")
    expect(result.session.stored).toBe("D:/overlay/session")
    expect(result.restored).toBe("D:/overlay/session")
    expect(result.stored).toBe("D:/overlay/session")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("api requests always use the control directory instead of hidden path fallbacks", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("apiUrl") === "function"
          && typeof window.eval("setWorkspaceDirectory") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const apiUrl = window.eval("apiUrl")
      const setWorkspaceDirectory = window.eval("setWorkspaceDirectory")

      state.directory = "D:/overlay/control"
      state.path = { directory: "D:/overlay/hidden" }
      const before = apiUrl("path")

      setWorkspaceDirectory("D:/overlay/next", "task")
      const after = apiUrl("path")

      return {
        before,
        after,
        stored: state.directory,
      }
    })

    expect(result.before).toContain("directory=D%3A%2Foverlay%2Fcontrol")
    expect(result.before).not.toContain("hidden")
    expect(result.after).toContain("directory=D%3A%2Foverlay%2Fnext")
    expect(result.after).not.toContain("hidden")
    expect(result.stored).toBe("D:/overlay/next")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace bootstrap resolves the control directory before scoped loads run", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("ensureWorkspaceDirectory") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const ensureWorkspaceDirectory = window.eval("ensureWorkspaceDirectory")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []

      root.__overlayCalls = calls
      root.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        calls.push(url.pathname + (url.search ? url.search : ""))

        if (url.pathname === "/path") {
          return new Response(JSON.stringify({ directory: "D:/overlay/bootstrap", worktree: "", home: "", state: "", config: "" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname === "/vcs") {
          return new Response(JSON.stringify({ branch: "", clean: false, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }

      state.directory = ""
      state.path = null
      await ensureWorkspaceDirectory()

      return {
        directory: state.directory,
        calls,
      }
    })

    expect(result.directory).toBe("D:/overlay/bootstrap")
    expect(result.calls[0]).toBe("/path")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("pending interactions render through extracted helpers without blocking the workspace", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderInteractions") === "function"
          && typeof window.eval("dismissInteractionModal") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const view = await tab.evaluate(() => {
      const renderInteractions = window.eval("renderInteractions")
      const dismissInteractionModal = window.eval("dismissInteractionModal")

      renderInteractions([
        {
          id: "interaction-1",
          status: "pending",
          type: "permission",
          title: "Workspace access",
          body: "Need permission to proceed.",
        },
      ])

      const overlay = document.querySelector(".interaction-modal-overlay")
      const modal = document.querySelector(".interaction-modal")
      const modalId = document.getElementById("interaction-modal")?.getAttribute("data-interaction-id") || ""
      const inline = document.querySelectorAll("#goalsBody .interaction-alert").length
      const overlayPointer = overlay ? getComputedStyle(overlay).pointerEvents : ""
      const modalPointer = modal ? getComputedStyle(modal).pointerEvents : ""

      dismissInteractionModal()

      return {
        inline,
        modalId,
        overlayPointer,
        modalPointer,
        dismissed: !document.getElementById("interaction-modal"),
      }
    })

    expect(view.inline).toBe(1)
    expect(view.modalId).toBe("interaction-1")
    expect(view.overlayPointer).toBe("none")
    expect(view.modalPointer).toBe("auto")
    expect(view.dismissed).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })
