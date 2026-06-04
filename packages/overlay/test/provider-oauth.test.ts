import { expect, test } from "bun:test"
import { launchBrowser, type OverlayPage } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"


await ensureOverlayDist()

async function clickVisible(tab: OverlayPage, selector: string) {
  await tab.waitForSelector(selector, { visible: true })
  await tab.click(selector)
}


test("selecting an oauth-capable provider starts oauth before provider test", async () => {
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
        id: "opencorvus",
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
  let callbackCalls = 0

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
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send(data.path)
      if (path === "/vcs") return send(data.vcs)
      if (path === "/provider") return send(data.provider)
      if (path === "/provider/auth") return send(data.providerAuth)
      if (path === "/agent") return send([])
      if (path === "/config/providers") {
        return send({
          providers: data.provider.all.map((item: any) => ({
            id: item.id,
            name: item.name || item.id,
            models: item.models || {},
          })),
          default: data.provider.default || {},
        })
      }
      if (path === "/config/prompt") return send([])
      if (path.startsWith("/provider/") && path.endsWith("/auth/prompts")) return send([])
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
        callbackCalls += 1
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

  const page = await launchBrowser()

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
                directory: "D:/overlay/workspace/app",
              }
            }
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_open_url") {
              if (args.url) state.open.push(String(args.url))
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
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, base)

    await tab.goto(`${base}/ui/index.html`, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online")

    await tab.click('[data-menu-trigger="provider"]')
    await tab.waitForSelector('[data-testid="titlebar-open-providers"]')
    await tab.click('[data-testid="titlebar-open-providers"]')
    await tab.waitForFunction(() => (document.querySelector("#configDialog") as HTMLDialogElement | null)?.open === true)

    await tab.waitForSelector('[data-testid="provider-auth-openai"]')
    await clickVisible(tab, '[data-testid="provider-auth-openai"]')
    await tab.waitForFunction(() => (document.querySelector("#appDialog") as HTMLDialogElement | null)?.open === true)
    await tab.click("#btnAppDialogOk")
    for (let i = 0; i < 50 && callbackCalls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(callbackCalls).toBe(1)
    expect(data.provider.connected).toContain("openai")

    const result = await tab.evaluate(() => {
      const state = (window as typeof window & { __overlayTest: { open: string[] } }).__overlayTest
      return {
        opened: [...state.open],
        connectedText: document.body.textContent || "",
      }
    })

    expect(result.opened).toContain("https://auth.example.com/openai")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })
