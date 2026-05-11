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

test("executor selector separates long plan and edit models", async () => {
  const planModel = "alibaba/alibaba-coding-plan-ultra-long-routing-profile"
  const editModel = "openai/gpt-5.5-pro-priority-editing-profile"

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") {
        return send({
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.5-pro-priority-editing-profile": { id: "gpt-5.5-pro-priority-editing-profile" },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-5.5-pro-priority-editing-profile" },
        })
      }
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") {
        return send({
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.5-pro-priority-editing-profile": { id: "gpt-5.5-pro-priority-editing-profile" },
              },
            },
          ],
          default: { openai: "gpt-5.5-pro-priority-editing-profile" },
        })
      }
      if (path === "/config" && req.method === "GET") {
        return send({
          model: planModel,
          agent: {
            build: { model: "openai/gpt-5.5-pro-priority-editing-profile" },
          },
        })
      }
      if (path === "/config/prompt") return send([])
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") {
        return send([
          { id: "mirrorcode", label: "MirrorCode", selectable: true, discovered: true },
          { id: "codex", label: "Codex", selectable: true, discovered: true, model: editModel },
        ])
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path.startsWith("/executor/") && path.endsWith("/model")) return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 760, height: 720 })
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
                executor: "codex",
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

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="executor-chip"]')
    await page.waitForFunction(() =>
      (document.querySelector('[data-ui="executor-chip"]') as HTMLElement | null)?.innerText.includes("alibaba"),
    )
    const chip = await page.$eval('[data-ui="executor-chip"]', (node) => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      const action = el.querySelector<HTMLElement>(".executor-chip-action")
      const model = el.querySelector<HTMLElement>(".executor-chip-model")
      const modelStyle = model ? getComputedStyle(model) : null
      return {
        text: el.innerText,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        height: el.getBoundingClientRect().height,
        borderTopWidth: style.borderTopWidth,
        actionDisplay: action ? getComputedStyle(action).display : "",
        modelBorderTopWidth: modelStyle?.borderTopWidth ?? "",
        slotCount: el.querySelectorAll(".executor-chip-model").length,
      }
    })
    expect(chip.text).toContain("OpenCorvus")
    expect(chip.text).toContain("Codex")
    expect(chip.text).toContain("Custom")
    expect(chip.text).toContain("alibaba")
    expect(chip.text).toContain("gpt-5.5-pro-priority-editing-profile")
    expect(chip.slotCount).toBe(2)
    expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1)
    expect(chip.height).toBeLessThanOrEqual(34)
    expect(chip.borderTopWidth).toBe("0px")
    expect(chip.actionDisplay).toBe("none")
    expect(chip.modelBorderTopWidth).toBe("0px")

    await page.click('[data-ui="executor-chip"]')
    await page.waitForSelector(".executor-menu-summary")
    const menuText = await page.$eval(".executor-menu", (node) => (node as HTMLElement).innerText)
    expect(menuText).toContain(planModel)
    expect(menuText).toContain("Custom")
    expect(menuText).toContain(editModel)
    expect(menuText).toContain("openai")
    expect(menuText).toContain("gpt-5.5-pro-priority-editing-profile")

    // OpenCorvus model picker is always visible inside the open menu.
    const projectSection = await page.$('[data-section="opencorvus"]')
    expect(projectSection).not.toBeNull()
    const projectButtons = await page.$$eval(
      '[data-section="opencorvus"] .executor-menu-model',
      (nodes) => nodes.length,
    )
    expect(projectButtons).toBeGreaterThan(0)

    // External executor section starts collapsed — body not present until
    // the user clicks the toggle.
    const externalCollapsed = await page.$('[data-section="external"][data-open="false"]')
    expect(externalCollapsed).not.toBeNull()
    const bodyBefore = await page.$('[data-section="external"] .executor-menu-section-body')
    expect(bodyBefore).toBeNull()

    await page.click('[data-section="external"] .executor-menu-section-toggle')
    await page.waitForSelector('[data-section="external"][data-open="true"]')
    const bodyAfter = await page.$('[data-section="external"] .executor-menu-section-body')
    expect(bodyAfter).not.toBeNull()
    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
    server.stop(true)
  }
}, { timeout: 60_000 })
