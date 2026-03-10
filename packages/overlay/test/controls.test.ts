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
  throw new Error("No local Edge/Chrome executable found for overlay control test")
}

test("overlay controls trigger without runtime failures", async () => {
  const exe = await browser()
  const now = Date.now()
  const task = {
    id: "task-1",
    status: "running",
    sessionID: "session-1",
    time: {
      created: now - 90_000,
      started: now - 80_000,
      updated: now - 1_000,
    },
    metadata: {
      checks: {
        ui_review: { target: "web", enabled: true },
        spec_check: { enabled: true },
      },
    },
  }
  const data = {
    config: {
      model: "openai/gpt-4o-mini",
      provider: {
        openai: {
          options: {
            apiKey: "sk-test-openai",
          },
        },
      },
      channel: {
        slack: {
          token: "xoxb-test",
          signing_secret: "secret-1",
          enabled: true,
        },
      },
      server: {
        publicUrl: "https://overlay.example.com",
      },
      mcp: {
        docs: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: true,
        },
      },
    },
    provider: {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-3-7-sonnet": {},
            "claude-3-5-haiku": {},
          },
          env: ["ANTHROPIC_API_KEY"],
        },
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-4.1": {},
            "gpt-4o-mini": {},
          },
          env: ["OPENAI_API_KEY"],
        },
      ],
      connected: ["openai"],
      default: {
        anthropic: "claude-3-7-sonnet",
        openai: "gpt-4o-mini",
      },
    },
    providerAuth: {
      anthropic: ["api_key"],
      openai: [],
    },
    channels: [
      {
        id: "slack",
        name: "Slack",
        summary: "Configured for alerts",
        status: "configured",
        fields: [
          { key: "token", label: "Bot Token", type: "secret", placeholder: "xoxb-..." },
          { key: "signing_secret", label: "Signing Secret", type: "secret", placeholder: "secret" },
          { key: "enabled", label: "Enabled", type: "boolean" },
        ],
      },
      {
        id: "discord",
        name: "Discord",
        summary: "Setup required",
        status: "missing",
        fields: [{ key: "token", label: "Bot Token", type: "secret", placeholder: "token" }],
      },
    ],
    executors: [
      { id: "codex", label: "Codex", detail: "Connected", version: "1.0.0", selectable: true, discovered: true },
      {
        id: "opencode",
        label: "OpenCorvus",
        detail: "Bundled",
        version: "0.0.1-alpha",
        selectable: true,
        discovered: true,
      },
      {
        id: "claude-code",
        label: "Claude Code",
        detail: "Connected",
        version: "1.0.0",
        selectable: true,
        discovered: true,
      },
    ],
    tasks: {
      tasks: [{ task, updated_at: now - 1_000 }],
    },
    board: {
      task,
      run: {
        executor: "opencode",
        phase: "execute",
      },
      overview: {
        headline: "### Overlay task headline",
        summary: "Overlay summary with **markdown**.",
        nextStep: {
          title: "Review UI controls",
          detail: "Validate that every visible control can still trigger.",
        },
        controls: {
          canRetry: true,
          canReplan: true,
          canCancel: true,
        },
      },
      plan: {
        version: 2,
        status: "ready",
        summary: "1. Validate title bar\n2. Validate dialogs\n3. Validate task controls",
        prompt: "Create a plan for overlay control validation.",
        metadata: {
          owner: "overlay-test",
        },
        time: {
          created: now - 70_000,
        },
      },
      spec: {
        content: "The overlay must keep all visible controls responsive.",
        time: {
          created: now - 75_000,
        },
      },
      lanes: [
        {
          id: "goals",
          cards: [
            {
              id: "goal-1",
              title: "Verify the overlay controls",
              detail: "Every control opens, closes, saves, or triggers as expected.",
              status: "pending",
              metadata: {
                origin: "test",
                priority: "high",
              },
            },
          ],
        },
      ],
      evaluation: {
        verdict: "pending",
        status: "running",
        summary: "Evaluation is still running.",
        time: {
          completed: now - 2_000,
        },
        checks: [
          {
            name: "ui_review",
            label: "UI Review",
            family: "review",
            status: "failed",
            evidence: "The current run is intentionally seeded with one failed review.",
          },
          {
            name: "spec_check",
            label: "Spec Check",
            family: "acceptance",
            status: "passed",
            evidence: "The seeded spec matches the overlay run.",
          },
        ],
      },
      delivery: {
        status: "candidate",
        summary: "Candidate delivery is ready for review.",
        result: {
          summary: "One file changed.",
          changedFiles: ["src/app.js"],
          diffs: [
            {
              file: "src/app.js",
              before: "const value = 1\n",
              after: "const value = 2\n",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        },
      },
      interactions: [
        {
          id: "interaction-1",
          type: "permission",
          status: "pending",
          title: "Approve tool usage",
          body: "Allow the overlay action to continue.",
        },
      ],
    },
    path: {
      directory: "D:/overlay/workspace/app",
    },
    vcs: {
      branch: "",
      clean: false,
      dirty: false,
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicts: 0,
      ahead: 0,
      behind: 0,
    },
    sessions: [
      {
        id: "session-1",
        title: "Task session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 500 },
      },
      {
        id: "session-2",
        title: "Review backlog",
        directory: "D:/overlay/review",
        time: { updated: now - 4_000 },
      },
    ],
    session: {
      "session-1": {
        id: "session-1",
        title: "Task session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 500 },
      },
      "session-2": {
        id: "session-2",
        title: "Review backlog",
        directory: "D:/overlay/review",
        time: { updated: now - 4_000 },
      },
    },
    timeline: {
      task: {
        "task-1": [
          {
            parts: [{ type: "text", text: "Please validate the overlay." }],
            info: { role: "user", time: { created: now - 20_000 } },
          },
          {
            parts: [{ type: "text", text: "I am validating the overlay controls now." }],
            info: { role: "assistant", time: { created: now - 19_000 } },
          },
        ],
      },
      session: {
        "session-1": [
          {
            parts: [{ type: "text", text: "Task session note" }],
            info: { role: "assistant", time: { created: now - 15_000 } },
          },
        ],
        "session-2": [
          {
            parts: [{ type: "text", text: "Independent session note" }],
            info: { role: "assistant", time: { created: now - 10_000 } },
          },
        ],
      },
    },
    diffs: {
      "session-1": [
        {
          file: "src/app.js",
          before: "const value = 1\n",
          after: "const value = 2\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
      "session-2": [
        {
          file: "notes.md",
          before: "",
          after: "# Review\n",
          additions: 1,
          deletions: 0,
          status: "added",
        },
      ],
    },
    skills: [
      {
        name: "alpha-skill",
        description: "Initial test skill",
        location: "D:/skills/alpha",
        builtin: false,
        source: "D:/skills/alpha",
        source_type: "config_path",
      },
    ],
    skillMarket: [
      {
        id: "market-install",
        name: "market-install",
        provider: "OpenAI",
        trust: "verified",
        install_kind: "url",
        source: "https://market.example.com/.well-known/skills/",
        recommended_policy: "ask",
        description: "Installable skill entry",
        notes: "Recommended",
        homepage: "https://market.example.com/install",
      },
      {
        id: "market-homepage",
        name: "market-homepage",
        provider: "OpenAI",
        trust: "community",
        install_kind: "manual",
        source: "",
        recommended_policy: "allow",
        description: "Homepage only entry",
        notes: "",
        homepage: "https://market.example.com/manual",
      },
    ],
    mcp: {
      docs: {
        status: "connected",
      },
    },
    memory: [
      {
        id: "mem-1",
        title: "Overlay note",
        scope: "global",
        source: "seed",
        score: 0.92,
        snippet: "Remember to validate every overlay button.",
        timeUpdated: now - 2_500,
      },
    ],
    memoryDetail: {
      "mem-1": {
        file: {
          id: "mem-1",
          title: "Overlay note",
          scope: "global",
          source: "seed",
          timeCreated: now - 5_000,
          timeUpdated: now - 2_500,
        },
        content: "Remember to validate every overlay button and dialog.",
      },
    },
    preference: [
      {
        id: "pref-1",
        key: "tone",
        value: "concise",
        scope: "global",
        source: "seed",
      },
    ],
    logs: [
      "INFO  2026-03-10T10:00:00 +1ms service=server overlay ready",
      "WARN  2026-03-10T10:00:01 +2ms service=server seeded warning",
    ],
    counters: {
      restart: 0,
      nextSession: 3,
      nextGoal: 2,
      nextPreference: 2,
      taskMessage: 0,
    },
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
  const append = async (body: Record<string, unknown>) => {
    const ts = Date.now()
    const msg = String(body.text || "").trim()
    const taskID = body.taskID ? String(body.taskID) : body.sessionID === "session-1" ? "task-1" : ""
    const sessionID = body.sessionID ? String(body.sessionID) : taskID === "task-1" ? "session-1" : ""
    const user = {
      parts: [{ type: "text", text: msg }],
      info: { role: "user", time: { created: ts } },
    }
    const assistant = {
      parts: [{ type: "text", text: `Handled: ${msg}` }],
      info: { role: "assistant", time: { created: ts + 1 } },
    }
    if (taskID) {
      data.timeline.task[taskID] = [...(data.timeline.task[taskID] || []), user, assistant]
      data.counters.taskMessage += 1
    }
    if (sessionID) {
      data.timeline.session[sessionID] = [...(data.timeline.session[sessionID] || []), user, assistant]
    }
    if (msg.startsWith("/goal ")) {
      const detail = msg.includes("\nCriteria:") ? msg.split("\nCriteria:")[1]?.trim() || "" : ""
      data.board.lanes[0].cards.push({
        id: `goal-${data.counters.nextGoal++}`,
        title: msg.replace(/^\/goal\s+/, "").split("\nCriteria:")[0].trim(),
        detail,
        status: "pending",
        metadata: { origin: "panel", priority: "medium" },
      })
    }
    if (msg.startsWith("Update goal ")) {
      const meta = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {}
      const id = String(meta.goalID || "")
      const card = data.board.lanes[0].cards.find((item) => item.id === id)
      if (card) {
        card.title = String(meta.description || card.title)
        card.detail = String(meta.criteria || card.detail || "")
      }
    }
    if (msg.startsWith("Delete goal ")) {
      const id = msg.replace("Delete goal ", "").replace(/\.$/, "").trim()
      data.board.lanes[0].cards = data.board.lanes[0].cards.filter((item) => item.id !== id)
    }
    return {
      ok: true,
      task_id: taskID || "task-1",
      message: "done",
    }
  }
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") {
        return new Response(null, { status: 204 })
      }
      if (path === "/ui" || path === "/ui/") {
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      }
      if (path.startsWith("/ui/")) {
        const name = decodeURIComponent(path.slice(4)) || "index.html"
        if (name.includes("..")) return text("forbidden", { status: 403 })
        const file = Bun.file(new URL(name, src))
        if (!(await file.exists())) return text("not found", { status: 404 })
        const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
        return new Response(file, {
          headers: { "content-type": type },
        })
      }
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send(data.tasks)
      if (path === "/executor") return send(data.executors)
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path.startsWith("/provider/") && path.endsWith("/test")) {
        return send({ ok: true, message: "Provider connected" })
      }
      if (path === "/config" && req.method === "GET") return send(data.config)
      if (path === "/config" && req.method === "PATCH") {
        data.config = await req.json()
        return send(data.config)
      }
      if (path === "/channel") return send(data.channels)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/skill/directories") return send(["D:/skills"])
      if (path === "/skill/market") return send(data.skillMarket)
      if (path === "/skill/install") {
        const body = await req.json()
        const value = String(body.value || body.source || "installed-skill")
        const name = value.split("/").filter(Boolean).at(-1) || "installed-skill"
        data.skills.push({
          name,
          description: `Installed from ${body.kind}`,
          location: value,
          builtin: false,
          source: value,
          source_type:
            body.kind === "git" ? "managed_git" : body.kind === "url" ? "config_url" : "config_path",
        })
        return send({ ok: true })
      }
      if (path === "/skill/remove") {
        const body = await req.json()
        const source = String(body.source || "")
        data.skills = data.skills.filter((item) => item.source !== source)
        return send({ ok: true })
      }
      if (path === "/mcp" && req.method === "GET") return send(data.mcp)
      if (path === "/mcp" && req.method === "POST") {
        const body = await req.json()
        data.mcp[String(body.name)] = { status: "connected" }
        return send({ ok: true })
      }
      if (path.startsWith("/mcp/") && path.endsWith("/disconnect")) {
        const name = decodeURIComponent(path.slice(5, -11))
        delete data.mcp[name]
        return send({ ok: true })
      }
      if (path.startsWith("/mcp/") && path.endsWith("/auth")) return send({ ok: true })
      if (path === "/session" && req.method === "GET") return send(data.sessions)
      if (path === "/session" && req.method === "POST") {
        const id = `session-${data.counters.nextSession++}`
        const item = {
          id,
          title: `Created ${id}`,
          directory: "D:/overlay/new-session",
          time: { updated: Date.now() },
        }
        data.sessions = [item, ...data.sessions]
        data.session[id] = item
        data.timeline.session[id] = []
        data.diffs[id] = []
        return send(item)
      }
      if (path.startsWith("/session/") && path.endsWith("/message")) {
        const id = decodeURIComponent(path.slice(9, -8))
        return send(data.timeline.session[id] || [])
      }
      if (path.startsWith("/session/") && path.endsWith("/diff")) {
        const id = decodeURIComponent(path.slice(9, -5))
        return send(data.diffs[id] || [])
      }
      if (path.startsWith("/session/") && req.method === "GET") {
        const id = decodeURIComponent(path.slice(9))
        return send(data.session[id] || null)
      }
      if (path.startsWith("/session/") && req.method === "DELETE") {
        const id = decodeURIComponent(path.slice(9))
        data.sessions = data.sessions.filter((item) => item.id !== id)
        delete data.session[id]
        delete data.timeline.session[id]
        delete data.diffs[id]
        return send({ ok: true })
      }
      if (path === "/control/timeline") {
        const taskID = url.searchParams.get("taskID")
        const sessionID = url.searchParams.get("sessionID")
        if (taskID) return send(data.timeline.task[taskID] || [])
        if (sessionID) return send(data.timeline.session[sessionID] || [])
        return send([])
      }
      if (path === "/panel/message") {
        return send(await append(await req.json()))
      }
      if (path === "/panel/message/stream") {
        const body = await append(await req.json())
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(`data: ${JSON.stringify({ type: "done", result: body })}\n\n`)
            controller.close()
          },
        })
        return new Response(stream, {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        })
      }
      if (path === "/project/current/init-git") {
        data.vcs = {
          branch: "dev",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        }
        return send({ created: true })
      }
      if (path === "/path/open") return send({ opened: true })
      if (path === "/restart") {
        data.counters.restart += 1
        return send({ ok: true })
      }
      if (path === "/task/task-1/board") {
        return send(data.board, {
          headers: { etag: `"board-${data.board.task.time.updated}"` },
        })
      }
      if (path === "/task/task-1/events") {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(`data: ${JSON.stringify({ type: "noop" })}\n\n`)
            controller.close()
          },
          cancel() {},
        })
        return new Response(stream, {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        })
      }
      if (path === "/task/task-1/checks" && req.method === "PATCH") {
        const body = await req.json()
        data.board.task.metadata.checks = body.checks
        return send({ ok: true })
      }
      if (path.startsWith("/interaction/") && path.endsWith("/reply")) {
        const id = decodeURIComponent(path.slice(13, -6))
        const item = data.board.interactions.find((entry) => entry.id === id)
        if (item) item.status = "resolved"
        return send({ ok: true })
      }
      if (path.startsWith("/interaction/") && path.endsWith("/reject")) {
        const id = decodeURIComponent(path.slice(13, -7))
        const item = data.board.interactions.find((entry) => entry.id === id)
        if (item) item.status = "rejected"
        return send({ ok: true })
      }
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/memory/search") {
        const body = await req.json()
        const q = String(body.query || "").toLowerCase()
        return send(data.memory.filter((item) => item.title.toLowerCase().includes(q) || item.snippet.toLowerCase().includes(q)))
      }
      if (path.startsWith("/panel/knowledge/memory/") && req.method === "GET") {
        const id = decodeURIComponent(path.slice(24))
        return send(data.memoryDetail[id])
      }
      if (path.startsWith("/panel/knowledge/memory/") && req.method === "DELETE") {
        const id = decodeURIComponent(path.slice(24))
        data.memory = data.memory.filter((item) => item.id !== id)
        delete data.memoryDetail[id]
        return send({ ok: true })
      }
      if (path === "/panel/knowledge/preference" && req.method === "GET") return send(data.preference)
      if (path === "/panel/knowledge/preference" && req.method === "POST") {
        const body = await req.json()
        const item = {
          id: `pref-${data.counters.nextPreference++}`,
          key: String(body.key || ""),
          value: String(body.value || ""),
          scope: "global",
          source: "manual",
        }
        data.preference = [item, ...data.preference]
        return send(item)
      }
      if (path.startsWith("/panel/knowledge/preference/") && req.method === "PATCH") {
        const id = decodeURIComponent(path.slice(28))
        const body = await req.json()
        data.preference = data.preference.map((item) =>
          item.id === id ? { ...item, key: String(body.key || item.key), value: String(body.value || item.value) } : item,
        )
        return send({ ok: true })
      }
      if (path.startsWith("/panel/knowledge/preference/") && req.method === "DELETE") {
        const id = decodeURIComponent(path.slice(28))
        data.preference = data.preference.filter((item) => item.id !== id)
        return send({ ok: true })
      }
      if (path === "/log" && req.method === "POST") {
        const body = await req.json()
        data.logs.push(`${String(body.level || "info").toUpperCase()}  ${new Date().toISOString()} +0ms service=${body.service} ${body.message}`)
        return send({ ok: true })
      }
      if (path === "/log/tail") return send({ lines: data.logs })
      return text(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })
  const seen: string[] = []
  const errors: string[] = []
  const app = `http://127.0.0.1:${server.port}`
  const client = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const page = await client.newPage()
  await page.setViewport({ width: 1600, height: 1200 })
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.url()}`)
  })
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
  })
  await page.evaluateOnNewDocument(() => {
    const state = {
      close: 0,
      drag: 0,
      minimize: 0,
      open: [] as string[],
      copy: [] as string[],
      created: [] as string[],
      picked: ["D:/overlay/picked", "D:/overlay/picked"] as string[],
      alwaysOnTop: false,
      settings: {},
    }
    Object.defineProperty(window, "__overlayTest", {
      configurable: true,
      value: state,
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          state.copy.push(String(value))
        },
      },
    })
    window.open = (value: string | URL | undefined | null) => {
      if (value) state.open.push(String(value))
      return null
    }
    window.__TAURI__ = {
      core: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "overlay_settings_load") return state.settings
          if (command === "overlay_settings_save") {
            state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
            return true
          }
          if (command === "overlay_pick_dir") return state.picked.shift() || "D:/overlay/picked"
          if (command === "overlay_create_dir") {
            if (args.path) state.created.push(String(args.path))
            return true
          }
          if (command === "overlay_open_path") {
            if (args.path) state.open.push(String(args.path))
            return true
          }
          return null
        },
      },
      window: {
        getCurrentWindow() {
          return {
            close: async () => {
              state.close += 1
            },
            startDragging: async () => {
              state.drag += 1
            },
            minimize: async () => {
              state.minimize += 1
            },
            setAlwaysOnTop: async (value: boolean) => {
              state.alwaysOnTop = !!value
            },
            isAlwaysOnTop: async () => state.alwaysOnTop,
          }
        },
      },
    }
  })
  try {
    const tap = async (selector: string) => {
      await page.waitForSelector(selector)
      await page.evaluate((value) => {
        const node = document.querySelector(value)
        if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${value}`)
        node.click()
      }, selector)
    }
    const open = async (trigger: string, dialog: string) => {
      seen.push(trigger)
      await tap(trigger)
      await page.waitForFunction((id) => (document.querySelector(id) as HTMLDialogElement | null)?.open === true, {}, dialog)
    }
    const close = async (trigger: string, dialog: string) => {
      seen.push(trigger)
      await tap(trigger)
      await page.waitForFunction((id) => (document.querySelector(id) as HTMLDialogElement | null)?.open !== true, {}, dialog)
    }
    const confirm = async (value?: string) => {
      if (value !== undefined) {
        await page.waitForSelector("#appDialogInput")
        await page.click("#appDialogInput", { clickCount: 3 })
        await page.type("#appDialogInput", value)
      }
      seen.push("#btnAppDialogOk")
      await tap("#btnAppDialogOk")
      await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open !== true)
    }
    const waitIdle = () => new Promise((resolve) => setTimeout(resolve, 250))

    await page.goto(`${app}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
    await page.waitForSelector('[data-task-action="retry"]')
    await page.waitForSelector(".change-row")
    await page.waitForSelector(".session-row-main[data-session-id='session-1']")
    await page.waitForSelector("#interaction-modal")

    await page.click("body")
    const scale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim())
    await page.keyboard.down("Control")
    await page.keyboard.press("Equal")
    await page.keyboard.up("Control")
    await page.waitForFunction(
      (value) => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim() !== value,
      {},
      scale,
    )
    await page.waitForFunction(() => (window as typeof window & { __overlayTest: { settings: { zoom?: number } } }).__overlayTest.settings.zoom === 1.1)
    await page.keyboard.down("Control")
    await page.keyboard.press("Minus")
    await page.keyboard.up("Control")
    await page.waitForFunction(
      (value) => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim() === value,
      {},
      scale,
    )
    await page.waitForFunction(() => (window as typeof window & { __overlayTest: { settings: { zoom?: number } } }).__overlayTest.settings.zoom === 1)

    seen.push("#interaction-modal [data-action='once']")
    await tap("#interaction-modal [data-action='once']")
    await page.waitForFunction(() => !document.querySelector("#interaction-modal"))
    await page.hover(".brand-guide")
    await page.waitForFunction(() => {
      const node = document.querySelector(".brand-guide-card")
      if (!(node instanceof HTMLElement)) return false
      const style = getComputedStyle(node)
      return style.opacity === "1" && style.visibility === "visible"
    })
    expect(await page.$eval(".brand-guide-card", (node) => node.querySelectorAll(".brand-guide-step").length)).toBe(4)

    const theme = await page.$eval("body", (node) => node.dataset.theme)
    seen.push("#btnTheme")
    await tap("#btnTheme")
    await page.waitForFunction((value) => document.body.dataset.theme !== value, {}, theme)

    const lang = await page.$eval("html", (node) => node.lang)
    seen.push("#btnLocale")
    await tap("#btnLocale")
    await page.waitForFunction((value) => document.documentElement.lang !== value, {}, lang)

    const pin = await page.$eval("#btnPin", (node) => node.dataset.pinned)
    seen.push("#btnPin")
    await tap("#btnPin")
    await page.waitForFunction((value) => document.querySelector("#btnPin")?.dataset.pinned !== value, {}, pin)

    seen.push("#btnMinimize")
    await tap("#btnMinimize")
    seen.push("#btnClose")
    await tap("#btnClose")
    await page.waitForFunction(() => ((window as typeof window & { __overlayTest: { drag: number } }).__overlayTest.drag || 0) === 0)
    await page.$eval("#titlebar", (node) => {
      node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }))
    })
    await page.waitForFunction(() => ((window as typeof window & { __overlayTest: { drag: number } }).__overlayTest.drag || 0) === 1)

    for (const item of ["#specSection", "#planSection", "#goalsSection", "#criteriaSection", "#changesSection", "#overviewSection", "#llmSection"]) {
      seen.push(`${item} > summary`)
      await tap(`${item} > summary`)
      await page.waitForFunction((id) => (document.querySelector(id) as HTMLDetailsElement | null)?.open === true, {}, item)
    }

    for (const item of ["codex", "claude-code", "opencode"]) {
      seen.push(`[data-executor='${item}']`)
      await tap(`[data-executor='${item}']`)
      await page.waitForFunction(
        (id) => document.querySelector(`[data-executor="${id}"]`)?.dataset.active === "true",
        {},
        item,
      )
    }

    seen.push("#taskGit")
    await tap("#taskGit")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()
    await page.waitForFunction(() => document.querySelector("#taskGit")?.dataset.actionable === "false")

    seen.push(".task-dir-node[data-current='true']")
    await tap(".task-dir-node[data-current='true']")
    await waitIdle()

    seen.push("[data-path-set]")
    await tap("[data-path-set]")
    await page.waitForFunction(() => document.querySelector("#taskDir")?.getAttribute("title") !== "D:/overlay/workspace/app")
    seen.push("[data-path-action='reset']")
    await tap("[data-path-action='reset']")
    await page.waitForFunction(() => document.querySelector("#taskDir")?.getAttribute("title") === "D:/overlay/workspace/app")

    seen.push("[data-path-action='browse']")
    await tap("[data-path-action='browse']")
    await page.waitForFunction(() => document.querySelector("#taskDir")?.getAttribute("title") === "D:/overlay/picked")

    seen.push("[data-path-action='create']")
    await tap("[data-path-action='create']")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm("child")
    await page.waitForFunction(() => document.querySelector("#taskDir")?.getAttribute("title") === "D:/overlay/picked/child")

    seen.push("[data-path-action='reset']")
    await tap("[data-path-action='reset']")
    await page.waitForFunction(() => document.querySelector("#taskDir")?.getAttribute("title") === "D:/overlay/workspace/app")
    await page.waitForSelector('[data-task-action="retry"]')

    for (const item of ["retry", "replan", "cancel"]) {
      seen.push(`[data-task-action='${item}']`)
      await tap(`[data-task-action='${item}']`)
      await waitIdle()
    }

    for (const item of [
      "#specBody .plan-summary",
      "#planBody .plan-summary",
      "#goalsBody .goal-content",
      "#criteriaBody .criteria-group-title",
      "#changesBody .changes-summary",
      "#overviewBody .plan-summary",
    ]) {
      seen.push(item)
      await tap(item)
      await page.waitForFunction(() => (document.querySelector("#sectionDialog") as HTMLDialogElement | null)?.open === true)
      await close("#btnCloseSectionDialog", "#sectionDialog")
    }

    seen.push(".change-row")
    await tap(".change-row")
    await page.waitForFunction(() => (document.querySelector("#diffDialog") as HTMLDialogElement | null)?.open === true)
    await close("#btnCloseDiff", "#diffDialog")

    seen.push('input[data-check="ui_review"]')
    await tap('input[data-check="ui_review"]')
    await waitIdle()

    seen.push("#goalsBody [data-goal-action='create']")
    await tap("#goalsBody [data-goal-action='create']")
    await page.waitForFunction(() => (document.querySelector("#goalDialog") as HTMLDialogElement | null)?.open === true)
    await page.type("#goalDescription", "Created goal from UI")
    await page.type("#goalCriteria", "Trigger goal save")
    seen.push("#goalDialog [type='submit']")
    await tap("#goalDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#goalDialog") as HTMLDialogElement | null)?.open !== true)

    seen.push("#goalsBody [data-goal-action='edit']")
    await tap("#goalsBody [data-goal-action='edit']")
    await page.waitForFunction(() => (document.querySelector("#goalDialog") as HTMLDialogElement | null)?.open === true)
    await close("#btnCancelGoal", "#goalDialog")

    seen.push("#goalsBody [data-goal-action='delete']")
    await tap("#goalsBody [data-goal-action='delete']")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    const count = await page.$eval("#chatCount", (node) => node.textContent || "")
    await page.click("#chatTextarea")
    await page.type("#chatTextarea", "Run overlay chat send")
    seen.push("#chatSend")
    await tap("#chatSend")
    await page.waitForFunction((value) => (document.querySelector("#chatCount")?.textContent || "") !== value, {}, count)

    await open("#btnSettings", "#settingsDialog")
    await close("#btnCancelSettings", "#settingsDialog")
    await open("#btnSettings", "#settingsDialog")
    seen.push("#settingsDialog [type='submit']")
    await tap("#settingsDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#settingsDialog") as HTMLDialogElement | null)?.open !== true)
    await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")

    seen.push("#btnChatCopyAll")
    await tap("#btnChatCopyAll")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    await open("#btnLog", "#logDialog")
    seen.push("#btnLogRefresh")
    await tap("#btnLogRefresh")
    seen.push("#btnLogCopy")
    await tap("#btnLogCopy")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()
    seen.push("#btnLogClear")
    await tap("#btnLogClear")
    await close("#btnCloseLog", "#logDialog")

    seen.push("[data-open-channels='true']")
    await tap("[data-open-channels='true']")
    await page.waitForFunction(() => (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open === true)
    await close("#btnCloseConfigDialog", "#configDialog")

    await open("#btnConfigToggle", "#configDialog")
    for (const item of ["#channelSection", "#extensionsSection", "#memorySection", "#preferenceSection", "#skillSubsection", "#mcpSubsection"]) {
      if (await page.$(item)) {
        const open = await page.$eval(item, (node) => (node as HTMLDetailsElement).open)
        if (!open) {
          seen.push(`${item} > summary`)
          await tap(`${item} > summary`)
          await page.waitForFunction((id) => (document.querySelector(id) as HTMLDetailsElement | null)?.open === true, {}, item)
        }
      }
    }

    seen.push("#btnLlmApiKeyToggle")
    await tap("#btnLlmApiKeyToggle")
    await page.waitForFunction(() => (document.querySelector("#llmApiKey") as HTMLInputElement | null)?.type === "text")
    seen.push("#btnLlmApiKeyCopy")
    await tap("#btnLlmApiKeyCopy")
    await page.waitForFunction(() => document.querySelector("#llmNotice")?.getAttribute("data-open") === "true")
    await page.select("#llmProvider", "anthropic")
    await waitIdle()
    await page.waitForFunction(() => (document.querySelector("#llmProvider") as HTMLSelectElement | null)?.value === "anthropic")
    await page.select("#llmModel", "claude-3-5-haiku")
    await waitIdle()

    seen.push("#btnSaveChannelPublicUrl")
    await tap("#btnSaveChannelPublicUrl")
    await waitIdle()

    seen.push("#channelList [data-channel-docs]")
    await tap("#channelList [data-channel-docs]")
    await waitIdle()

    seen.push("#channelList [data-channel-edit]")
    await tap("#channelList [data-channel-edit]")
    await page.waitForFunction(() => (document.querySelector("#channelDialog") as HTMLDialogElement | null)?.open === true)
    seen.push("#channelDialog [data-channel-docs]")
    await tap("#channelDialog [data-channel-docs]")
    await waitIdle()
    await page.type('#channelDialog input[name="channel_slack_token"]', "-updated")
    seen.push("#channelDialog [type='submit']")
    await tap("#channelDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#channelDialog") as HTMLDialogElement | null)?.open !== true)

    seen.push("#btnOpenSkillRoot")
    await tap("#btnOpenSkillRoot")
    await waitIdle()
    seen.push("[data-skill-open]")
    await tap("[data-skill-open]")
    await waitIdle()
    seen.push("[data-skill-remove]")
    await tap("[data-skill-remove]")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    await open("#btnSkillMarket", "#skillMarketDialog")
    seen.push("#skillMarketList [data-market-homepage]")
    await tap("#skillMarketList [data-market-homepage]")
    await waitIdle()
    await close("#btnCloseSkillMarket", "#skillMarketDialog")
    await open("#btnSkillMarket", "#skillMarketDialog")
    seen.push("#skillMarketList [data-market-install]")
    await tap("#skillMarketList [data-market-install]")
    await page.waitForFunction(() => (document.querySelector("#skillMarketDialog") as HTMLDialogElement | null)?.open !== true)

    await open("#btnAddSkill", "#skillDialog")
    await close("#btnCancelSkill", "#skillDialog")
    await open("#btnAddSkill", "#skillDialog")
    await page.select("#skillType", "path")
    await page.type("#skillValue", "D:/skills/beta")
    seen.push("#skillDialog [type='submit']")
    await tap("#skillDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#skillDialog") as HTMLDialogElement | null)?.open !== true)

    seen.push("#btnReloadSkills")
    await tap("#btnReloadSkills")
    await waitIdle()
    seen.push("#btnDeleteAllSkills")
    await tap("#btnDeleteAllSkills")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    seen.push("#btnDeleteAllMcp")
    await tap("#btnDeleteAllMcp")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    await open("#btnAddMcp", "#mcpDialog")
    await page.select("#mcpType", "local")
    await waitIdle()
    await close("#btnCancelMcp", "#mcpDialog")
    await open("#btnAddMcp", "#mcpDialog")
    await page.type("#mcpName", "search")
    await page.type("#mcpUrl", "https://search.example.com/mcp")
    seen.push("#mcpDialog [type='submit']")
    await tap("#mcpDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#mcpDialog") as HTMLDialogElement | null)?.open !== true)

    await page.click("#memorySearch")
    await page.type("#memorySearch", "overlay")
    seen.push("#btnMemorySearch")
    await tap("#btnMemorySearch")
    await waitIdle()
    seen.push("#btnMemoryRefresh")
    await tap("#btnMemoryRefresh")
    await page.waitForSelector(".knowledge-item[data-id='mem-1']")
    seen.push(".knowledge-item[data-id='mem-1']")
    await tap(".knowledge-item[data-id='mem-1']")
    await page.waitForFunction(() => (document.querySelector("#memoryDialog") as HTMLDialogElement | null)?.open === true)
    await close("#btnCloseMemory", "#memoryDialog")
    seen.push(".knowledge-item[data-id='mem-1']")
    await tap(".knowledge-item[data-id='mem-1']")
    await page.waitForFunction(() => (document.querySelector("#memoryDialog") as HTMLDialogElement | null)?.open === true)
    seen.push("#btnDeleteMemory")
    await tap("#btnDeleteMemory")
    await page.waitForFunction(() => (document.querySelector("#memoryDialog") as HTMLDialogElement | null)?.open !== true)

    seen.push("#btnPreferenceRefresh")
    await tap("#btnPreferenceRefresh")
    await waitIdle()
    await open("#btnPreferenceAdd", "#prefEditDialog")
    await close("#btnCancelPrefEdit", "#prefEditDialog")
    await open("#btnPreferenceAdd", "#prefEditDialog")
    await page.type("#prefEditKey", "layout")
    await page.type("#prefEditValue", "dense")
    seen.push("#prefEditDialog [type='submit']")
    await tap("#prefEditDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#prefEditDialog") as HTMLDialogElement | null)?.open !== true)
    seen.push(".pref-item[data-pref-id='pref-1']")
    await tap(".pref-item[data-pref-id='pref-1']")
    await page.waitForFunction(() => (document.querySelector("#prefEditDialog") as HTMLDialogElement | null)?.open === true)
    await page.click("#prefEditValue", { clickCount: 3 })
    await page.type("#prefEditValue", "brief")
    seen.push("#prefEditDialog [type='submit']")
    await tap("#prefEditDialog [type='submit']")
    await page.waitForFunction(() => (document.querySelector("#prefEditDialog") as HTMLDialogElement | null)?.open !== true)
    seen.push("[data-pref-action='delete']")
    await tap("[data-pref-action='delete']")
    await waitIdle()

    await close("#btnCloseConfigDialog", "#configDialog")

    seen.push("#btnRefreshSessions")
    await tap("#btnRefreshSessions")
    await waitIdle()
    seen.push("#btnCreateSession")
    await tap("#btnCreateSession")
    await page.waitForSelector(".session-row-main[data-session-id='session-3']")
    seen.push(".session-row-main[data-session-id='session-1']")
    await tap(".session-row-main[data-session-id='session-1']")
    await page.waitForSelector('[data-task-action="retry"]')
    seen.push(".session-row-delete[data-session-delete='session-3']")
    await tap(".session-row-delete[data-session-delete='session-3']")
    await page.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await confirm()

    seen.push("#connBadge")
    await page.click("#connBadge", { clickCount: 2 })
    await waitIdle()

    const stub = await page.evaluate(() => (window as typeof window & { __overlayTest: Record<string, unknown> }).__overlayTest)
    expect(seen.length).toBeGreaterThan(50)
    expect(data.counters.restart).toBe(1)
    expect(data.counters.taskMessage).toBeGreaterThan(3)
    expect((stub.open as string[]).length).toBeGreaterThan(3)
    expect((stub.copy as string[]).length).toBeGreaterThan(2)
    expect((stub.created as string[])).toContain("D:/overlay/picked/child")
    expect(stub.drag).toBe(1)
    expect(stub.minimize).toBe(1)
    expect(stub.close).toBe(1)
    expect(errors).toEqual([])
  } finally {
    await page.close().catch(() => undefined)
    await client.close().catch(() => undefined)
    server.stop(true)
  }
})
