import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

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

function taskListPayload() {
  return { tasks: [] }
}

async function waitForAssistantButton(
  page: any,
  diagnostics: { badResponses: string[]; consoleMessages: string[]; pageErrors: string[] },
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const exists = await page.evaluate(
      () => !!document.querySelector('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]'),
    )
    if (exists) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const state = await page.evaluate(() => ({
    readyState: document.readyState,
    bodyLength: document.body?.textContent?.length ?? 0,
    bodySample: document.body?.textContent?.slice(0, 300) ?? "",
    hasComposerMount: !!document.querySelector("#solidChatComposer"),
    scripts: Array.from(document.scripts).map((script) => script.src || script.textContent?.slice(0, 80) || ""),
  }))
  throw new Error(`Assistant activity button did not mount: ${JSON.stringify({ ...diagnostics, state }, null, 2)}`)
}

test("prompt profile selector options remain readable on the light popup surface", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const promptProfileCatalog = {
    active: "frontend",
    project_active: "frontend",
    session_active: null,
    default: "general",
    targets: [],
    profiles: [
      {
        id: "general",
        label: "General",
        description: "Baseline prompt set.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "frontend",
        label: "Frontend",
        description: "Visual UI verification squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "backend",
        label: "Backend",
        description: "Contract and data integrity squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "algorithm",
        label: "Algorithm",
        description: "Correctness and benchmark squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
    ],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send(taskListPayload())
    if (path === "/global/projects/discover") return send([])
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) {
      return send({
        model: "opencorvus/gpt-5-nano",
        prompt_profile: { active: "frontend" },
      })
    }
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task/events") {
      return new Response(":\n\n", {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
    }
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") {
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const badResponses: string[] = []
    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    page.on("console", (message: any) => {
      consoleMessages.push(`${message.type}: ${message.text}`)
    })
    page.on("pageerror", (error: any) => {
      pageErrors.push(error.message || String(error))
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                theme: "light",
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
    }, server.origin)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await waitForAssistantButton(page, { badResponses, consoleMessages, pageErrors })
    const assistantVisible = await page.$eval(
      '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
      (node: HTMLElement) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      },
    )
    assert.equal(assistantVisible, true)
    await page.$eval('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]', (node: HTMLElement) =>
      node.click(),
    )
    await page.waitForSelector('[data-ui="prompt-profile-selector"]')
    await page.waitForFunction(() => {
      const trigger = document.querySelector<HTMLButtonElement>('[data-ui="prompt-profile-selector"]')
      return !!trigger && !trigger.disabled
    })
    await page.click('[data-ui="prompt-profile-selector"]')
    await page.waitForSelector(".prompt-profile-select-content")
    await page.waitForSelector(".prompt-profile-select-option")

    const result = await page.evaluate(() => {
      function parseRgb(value: string): [number, number, number] {
        const match = value.match(/rgba?\(([^)]+)\)/)
        if (!match) throw new Error(`Unsupported color: ${value}`)
        const [r, g, b] = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
        if (![r, g, b].every(Number.isFinite)) throw new Error(`Invalid color: ${value}`)
        return [r, g, b]
      }
      function channel(value: number): number {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
      }
      function luminance([r, g, b]: [number, number, number]): number {
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      }
      function contrastRatio(foreground: string, background: string): number {
        const lighter = Math.max(luminance(parseRgb(foreground)), luminance(parseRgb(background)))
        const darker = Math.min(luminance(parseRgb(foreground)), luminance(parseRgb(background)))
        return (lighter + 0.05) / (darker + 0.05)
      }

      const rootTheme = document.documentElement.dataset.theme
      const bodyTheme = document.body.dataset.theme
      const content = document.querySelector(".prompt-profile-select-content") as HTMLElement | null
      if (!content) throw new Error("Missing prompt profile select content")
      const contentBackground = getComputedStyle(content).backgroundColor
      const options = Array.from(document.querySelectorAll(".prompt-profile-select-option")).map((node) => {
        const option = node as HTMLElement
        const style = getComputedStyle(option)
        const copy = option.querySelector(".prompt-profile-select-option-copy") as HTMLElement | null
        const textParts = Array.from(copy?.children ?? [])
          .map((child) => {
            const element = child as HTMLElement
            const color = getComputedStyle(element).color
            return {
              tag: element.tagName.toLowerCase(),
              text: element.textContent?.trim() ?? "",
              color,
              contrast: contrastRatio(color, contentBackground),
            }
          })
          .filter((part) => part.text)
        const label = textParts
          .map((part) => part.text)
          .filter(Boolean)
          .join(" ")
        return {
          label,
          selected: option.hasAttribute("data-selected") || option.getAttribute("aria-selected") === "true",
          color: style.color,
          background: contentBackground,
          contrast: contrastRatio(style.color, contentBackground),
          textParts,
        }
      })
      return { rootTheme, bodyTheme, options }
    })

    assert.equal(result.rootTheme, "light")
    assert.equal(result.bodyTheme, "light")
    assert.deepEqual(
      result.options.map((option) => option.label),
      [
        "General Baseline prompt set.",
        "Frontend Visual UI verification squad.",
        "Backend Contract and data integrity squad.",
        "Algorithm Correctness and benchmark squad.",
      ],
    )
    assert.equal(result.options.filter((option) => !option.selected).length >= 3, true)
    assert.equal(result.options.every((option) => option.color !== "rgba(0, 0, 0, 0)"), true)
    assert.equal(result.options.every((option) => option.contrast >= 4.5), true)
    assert.equal(result.options.every((option) => option.textParts.length >= 2), true)
    assert.equal(
      result.options.every((option) =>
        option.textParts.every((part) => part.color !== "rgba(0, 0, 0, 0)" && part.contrast >= 4.5),
      ),
      true,
    )
    assert.deepEqual(badResponses, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
