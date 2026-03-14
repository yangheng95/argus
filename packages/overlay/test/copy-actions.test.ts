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
  throw new Error("No local Edge/Chrome executable found for overlay copy action test")
}

test("copying chat and logs does not open the dialog", async () => {
  const exe = await browser()
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
      task,
      run: {
        executor: "opencode",
        phase: "complete",
      },
      overview: {
        headline: "Overlay copy task",
        summary: "Used to verify copy actions stay silent.",
        controls: {},
      },
      plan: null,
      spec: null,
      lanes: [],
      evaluation: null,
      delivery: null,
      interactions: [],
    },
    timeline: {
      task: {
        "task-1": [
          {
            parts: [{ type: "text", text: "Please copy this transcript." }],
            info: { role: "user", time: { created: now - 8_000 } },
          },
          {
            parts: [{ type: "text", text: "Transcript ready." }],
            info: { role: "assistant", time: { created: now - 7_000 } },
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
      if (path === "/tasks") return send(data.tasks)
      if (path.startsWith("/task/") && path.endsWith("/board")) return send(data.board)
      if (path === "/task/task-1/transcript") return send(data.timeline.task["task-1"] || [])
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/config") return send(data.config)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/channel") return send(data.channels)
      if (path === "/executor") return send(data.executors)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/mcp") return send(data.mcp)
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/preference") return send(data.preferences)
      if (path === "/log/tail") return send({ path: "D:/overlay/logs/server.log", lines: data.logs })
      if (path === "/log" && req.method === "POST") return send(true)
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
    const base = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((serverUrl) => {
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
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
    }, base)
    await tab.goto(`${base}/ui/index.html`, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")
    await tab.waitForFunction(() => (document.querySelector("#chatCount")?.textContent || "").trim().length > 0)

    await tab.click("#btnChatCopyAll")
    await new Promise((resolve) => setTimeout(resolve, 200))

    const afterChat = await tab.evaluate(() => {
      const state = (window as typeof window & { __copyTest: { writes: string[] } }).__copyTest
      return {
        writes: [...state.writes],
        dialogOpen: (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true,
      }
    })

    expect(afterChat.dialogOpen).toBe(false)
    expect(afterChat.writes.length).toBe(1)
    expect(afterChat.writes[0]).toContain("Transcript ready.")

    await tab.click("#btnTitlebarMenu")
    await tab.waitForFunction(() => (document.querySelector("#titlebarMenu") as HTMLElement | null)?.hidden === false)
    await tab.click("#btnLog")
    await tab.waitForFunction(() => (document.querySelector("#logDialog") as HTMLDialogElement | null)?.open === true)
    await tab.click("#btnLogCopy")
    await new Promise((resolve) => setTimeout(resolve, 200))

    const afterLog = await tab.evaluate(() => {
      const state = (window as typeof window & { __copyTest: { writes: string[] } }).__copyTest
      return {
        writes: [...state.writes],
        dialogOpen: (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true,
      }
    })

    expect(afterLog.dialogOpen).toBe(false)
    expect(afterLog.writes.length).toBe(2)
    expect(afterLog.writes[1]).toContain("overlay ready")
  } finally {
    await page.close().catch(() => undefined)
    server.stop(true)
  }
})
