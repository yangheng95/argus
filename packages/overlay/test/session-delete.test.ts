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
  throw new Error("No local Edge/Chrome executable found for overlay session delete test")
}

test("deleting an inactive session in the current directory updates locally without refetching session sources", async () => {
  const exe = await browser()
  const now = Date.now()
  const task1 = {
    id: "task-1",
    title: "Active task",
    directory: "D:/overlay/workspace/app",
    status: "completed",
    sessionID: "session-1",
    time: {
      created: now - 20_000,
      updated: now - 2_000,
    },
  }
  const task2 = {
    id: "task-2",
    title: "Inactive task",
    directory: "D:/overlay/workspace/app",
    status: "completed",
    sessionID: "session-2",
    time: {
      created: now - 30_000,
      updated: now - 4_000,
    },
  }
  const data = {
    tasks: {
      tasks: [
        { task: task1, updated_at: now - 2_000 },
        { task: task2, updated_at: now - 4_000 },
      ],
    },
    boards: {
      "task-1": {
        task: task1,
        run: {
          executor: "opencode",
          phase: "complete",
        },
        overview: {
          headline: "Active task",
          summary: "Keep the current session stable.",
          controls: {},
        },
        plan: null,
        spec: null,
        lanes: [],
        evaluation: null,
        delivery: null,
        interactions: [],
      },
      "task-2": {
        task: task2,
        run: {
          executor: "opencode",
          phase: "complete",
        },
        overview: {
          headline: "Inactive task",
          summary: "This task should disappear with its session.",
          controls: {},
        },
        plan: null,
        spec: null,
        lanes: [],
        evaluation: null,
        delivery: null,
        interactions: [],
      },
    },
    sessions: [
      {
        id: "session-1",
        title: "Active session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 2_000 },
      },
      {
        id: "session-2",
        title: "Inactive session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 4_000 },
      },
    ],
    session: {
      "session-1": {
        id: "session-1",
        title: "Active session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 2_000 },
      },
      "session-2": {
        id: "session-2",
        title: "Inactive session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 4_000 },
      },
    },
    timeline: {
      task: {
        "task-1": [
          {
            parts: [{ type: "text", text: "Current task timeline" }],
            info: { role: "assistant", time: { created: now - 10_000 } },
          },
        ],
        "task-2": [
          {
            parts: [{ type: "text", text: "Inactive task timeline" }],
            info: { role: "assistant", time: { created: now - 9_000 } },
          },
        ],
      },
      session: {
        "session-1": [
          {
            parts: [{ type: "text", text: "Current session note" }],
            info: { role: "assistant", time: { created: now - 8_000 } },
          },
        ],
        "session-2": [
          {
            parts: [{ type: "text", text: "Inactive session note" }],
            info: { role: "assistant", time: { created: now - 7_000 } },
          },
        ],
      },
    },
    diffs: {
      "session-1": [],
      "session-2": [],
    },
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
    config: {
      model: "openai/gpt-4o-mini",
      provider: {
        openai: {
          options: {
            apiKey: "sk-test-openai",
          },
        },
      },
      channel: {},
      server: {
        publicUrl: "https://overlay.example.com",
      },
    },
    provider: {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-4o-mini": {},
          },
          env: ["OPENAI_API_KEY"],
        },
      ],
      connected: ["openai"],
      default: {
        openai: "gpt-4o-mini",
      },
    },
    providerAuth: {
      openai: [],
    },
    channels: [],
    skills: [],
    mcp: {},
    executors: [
      {
        id: "opencode",
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
  const hits = {
    tasks: 0,
    sessions: 0,
    deletes: 0,
  }
  let releaseDelete = () => {}
  const deleteReady = new Promise<void>((resolve) => {
    releaseDelete = resolve
  })
  let markDelete = () => {}
  const deleteSeen = new Promise<void>((resolve) => {
    markDelete = resolve
  })
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
      if (path === "/tasks") {
        hits.tasks += 1
        return send(data.tasks)
      }
      if (path === "/executor") return send(data.executors)
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/config" && req.method === "GET") return send(data.config)
      if (path === "/channel") return send(data.channels)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/mcp") return send(data.mcp)
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/preference") return send(data.preferences)
      if (path === "/session" && req.method === "GET") {
        hits.sessions += 1
        return send(data.sessions)
      }
      if (path.startsWith("/task/") && path.endsWith("/board")) {
        const taskID = decodeURIComponent(path.slice(6, -6))
        return send(data.boards[taskID] || null)
      }
      if (path === "/control/timeline") {
        const taskID = url.searchParams.get("taskID")
        const sessionID = url.searchParams.get("sessionID")
        if (taskID) return send(data.timeline.task[taskID] || [])
        if (sessionID) return send(data.timeline.session[sessionID] || [])
        return send([])
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
        hits.deletes += 1
        markDelete()
        await deleteReady
        data.sessions = data.sessions.filter((item) => item.id !== id)
        data.tasks.tasks = data.tasks.tasks.filter((item) => item.task.sessionID !== id)
        delete data.session[id]
        delete data.timeline.session[id]
        delete data.timeline.task[`task-${id.split("-").at(-1)}`]
        delete data.diffs[id]
        return send(true)
      }
      return text("not found", { status: 404 })
    },
  })
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
    await tab.waitForSelector(".session-row-main[data-session-id='session-1']")
    await tab.waitForSelector(".session-row-main[data-session-id='session-2']")

    const base = { ...hits }

    await tab.locator(".session-row-delete[data-session-delete='session-2']").click()
    await tab.waitForSelector(".session-row-delete[data-session-delete='session-2'][data-confirm='true']")
    const confirm = await tab.evaluate(() => {
      const button = document.querySelector(".session-row-delete[data-session-delete='session-2'][data-confirm='true']")
      const trash = button?.querySelector(".session-row-delete-icon[data-icon='delete']")
      const check = button?.querySelector(".session-row-delete-icon[data-icon='confirm']")
      return {
        trashDisplay: trash ? getComputedStyle(trash).display : "",
        checkDisplay: check ? getComputedStyle(check).display : "",
      }
    })
    expect(confirm.trashDisplay).toBe("none")
    expect(confirm.checkDisplay).not.toBe("none")
    await tab.locator(".session-row-delete[data-session-delete='session-2'][data-confirm='true']").click()
    await deleteSeen
    await tab.waitForFunction(() => !document.querySelector(".session-row-main[data-session-id='session-2']"))
    expect(hits.deletes).toBe(1)
    expect(data.sessions.some((item) => item.id === "session-2")).toBe(true)
    releaseDelete()
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(hits.tasks - base.tasks).toBe(0)
    expect(hits.sessions - base.sessions).toBe(0)
    expect(await tab.$(".session-row-main[data-session-id='session-1']")).toBeTruthy()
  } finally {
    await page.close().catch(() => undefined)
    server.stop(true)
  }
})

test("creating a session in the current directory updates locally without refetching session sources", async () => {
  const exe = await browser()
  const now = Date.now()
  const data = {
    tasks: {
      tasks: [],
    },
    boards: {},
    sessions: [
      {
        id: "session-1",
        title: "Existing session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 2_000 },
      },
    ],
    session: {
      "session-1": {
        id: "session-1",
        title: "Existing session",
        directory: "D:/overlay/workspace/app",
        time: { updated: now - 2_000 },
      },
    },
    timeline: {
      task: {},
      session: {
        "session-1": [
          {
            parts: [{ type: "text", text: "Existing session note" }],
            info: { role: "assistant", time: { created: now - 8_000 } },
          },
        ],
      },
    },
    diffs: {
      "session-1": [],
    },
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
    config: {
      model: "openai/gpt-4o-mini",
      provider: {
        openai: {
          options: {
            apiKey: "sk-test-openai",
          },
        },
      },
      channel: {},
      server: {
        publicUrl: "https://overlay.example.com",
      },
    },
    provider: {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-4o-mini": {},
          },
          env: ["OPENAI_API_KEY"],
        },
      ],
      connected: ["openai"],
      default: {
        openai: "gpt-4o-mini",
      },
    },
    providerAuth: {
      openai: [],
    },
    channels: [],
    skills: [],
    mcp: {},
    executors: [
      {
        id: "opencode",
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
  const hits = {
    tasks: 0,
    sessions: 0,
    creates: 0,
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
      if (path === "/tasks") {
        hits.tasks += 1
        return send(data.tasks)
      }
      if (path === "/executor") return send(data.executors)
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/config" && req.method === "GET") return send(data.config)
      if (path === "/channel") return send(data.channels)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/mcp") return send(data.mcp)
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/preference") return send(data.preferences)
      if (path === "/session" && req.method === "GET") {
        hits.sessions += 1
        return send(data.sessions)
      }
      if (path === "/session" && req.method === "POST") {
        hits.creates += 1
        const session = {
          id: "session-2",
          title: "Created session",
          directory: "D:/overlay/workspace/app",
          time: { updated: Date.now() },
        }
        data.sessions = [session, ...data.sessions]
        data.session[session.id] = session
        data.timeline.session[session.id] = []
        data.diffs[session.id] = []
        return send(session)
      }
      if (path === "/control/timeline") {
        const taskID = url.searchParams.get("taskID")
        const sessionID = url.searchParams.get("sessionID")
        if (taskID) return send(data.timeline.task[taskID] || [])
        if (sessionID) return send(data.timeline.session[sessionID] || [])
        return send([])
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
      return text("not found", { status: 404 })
    },
  })
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
    await tab.waitForSelector(".session-row-main[data-session-id='session-1']")

    const base = { ...hits }

    await tab.click("#btnCreateSession")
    await tab.waitForSelector(".session-row-main[data-session-id='session-2']")
    await tab.waitForFunction(() => document.querySelector(".session-row-mini[data-active='true'] .session-row-main")?.getAttribute("data-session-id") === "session-2")

    expect(hits.creates - base.creates).toBe(1)
    expect(hits.tasks - base.tasks).toBe(0)
    expect(hits.sessions - base.sessions).toBe(0)
    expect(data.sessions[0]?.id).toBe("session-2")
  } finally {
    await page.close().catch(() => undefined)
    server.stop(true)
  }
})
