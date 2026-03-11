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
  throw new Error("No local Edge/Chrome executable found for overlay provider oauth test")
}

test("selecting an oauth-capable provider starts oauth before provider test", async () => {
  const exe = await browser()
  const data = {
    config: {
      model: "anthropic/claude-3-7-sonnet",
    },
    provider: {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-3-7-sonnet": {},
          },
          env: ["ANTHROPIC_API_KEY"],
        },
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-4o-mini": {},
          },
          env: ["OPENAI_API_KEY"],
        },
      ],
      connected: [] as string[],
      default: {
        anthropic: "claude-3-7-sonnet",
        openai: "gpt-4o-mini",
      },
    },
    providerAuth: {
      openai: [
        {
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        },
      ],
    },
    channels: [],
    skills: [],
    mcp: {},
    memory: [],
    preference: [],
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

  const server = Bun.serve({
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
        if (name.includes("..")) return new Response("forbidden", { status: 403 })
        const file = Bun.file(new URL(name, src))
        if (!(await file.exists())) return new Response("not found", { status: 404 })
        const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
        return new Response(file, {
          headers: { "content-type": type },
        })
      }
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/experimental/session") return send([])
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/config" && req.method === "GET") return send(data.config)
      if (path === "/config" && req.method === "PATCH") {
        data.config = await req.json()
        return send(data.config)
      }
      if (path === "/channel") return send(data.channels)
      if (path === "/skill/installed" || path === "/skill") return send(data.skills)
      if (path === "/mcp") return send(data.mcp)
      if (path === "/executor") return send(data.executors)
      if (path === "/panel/knowledge/memory") return send(data.memory)
      if (path === "/panel/knowledge/preference") return send(data.preference)
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path.startsWith("/provider/") && path.endsWith("/oauth/authorize")) {
        return send({
          url: "https://auth.example.com/openai",
          method: "auto",
          instructions: "Complete authorization in your browser.",
        })
      }
      if (path.startsWith("/provider/") && path.endsWith("/oauth/callback")) {
        if (!data.provider.connected.includes("openai")) data.provider.connected.push("openai")
        return send(true)
      }
      if (path.startsWith("/provider/") && path.endsWith("/test")) {
        const providerID = decodeURIComponent(path.slice(10, -5))
        if (providerID === "openai" && !data.provider.connected.includes("openai")) {
          return send(
            {
              ok: false,
              message: "OAuth missing",
            },
            { status: 400 },
          )
        }
        return send({
          ok: true,
          message: "Provider connected",
        })
      }
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
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
      const state = {
        open: [] as string[],
        settings: {},
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
              }
            }
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_open_path") {
              if (args.path) state.open.push(String(args.path))
              return true
            }
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
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, base)

    await tab.goto(`${base}/ui/index.html`, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")

    await tab.click("#btnConfigToggle")
    await tab.waitForFunction(() => (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open === true)
    await tab.$eval("#llmAdvanced", (node) => {
      ;(node as HTMLDetailsElement).open = true
    })
    await tab.waitForFunction(() => (document.querySelector("#llmAdvanced") as HTMLDetailsElement | null)?.open === true)

    await tab.select("#llmProvider", "openai")
    await tab.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await tab.click("#btnAppDialogOk")

    await tab.waitForFunction(() => {
      const status = document.querySelector("#llmStatus")
      return status?.getAttribute("data-status") === "active" && status?.getAttribute("title") === "Provider connected"
    })

    const result = await tab.evaluate(() => {
      const state = (window as typeof window & { __overlayTest: { open: string[] } }).__overlayTest
      return {
        opened: [...state.open],
        provider: (document.querySelector("#llmProvider") as HTMLSelectElement | null)?.value,
        model: (document.querySelector("#llmModel") as HTMLSelectElement | null)?.value,
        status: document.querySelector("#llmStatus")?.getAttribute("data-status"),
        title: document.querySelector("#llmStatus")?.getAttribute("title"),
      }
    })

    expect(result.provider).toBe("openai")
    expect(result.model).toBe("gpt-4o-mini")
    expect(result.status).toBe("active")
    expect(result.title).toBe("Provider connected")
    expect(result.opened).toContain("https://auth.example.com/openai")
  } finally {
    await page.close()
    server.stop(true)
  }
})
