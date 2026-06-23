import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
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

const emptySkillMountMatrix = {
  scope: "project",
  skills: [],
  agents: [],
  matrix: [],
  project_mounts: {},
  unmounted_count: 0,
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch
  const base =
    target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key]
    } else {
      base[key] = mergePatch(base[key], value)
    }
  }
  return base
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const root = fileURLToPath(new URL("../../../../.scratch/", import.meta.url))
  const target = `${root}${filename}`
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const image = await element.screenshot({})
  await writeFile(target, image)
  return target
}

test("compact MCP panel surfaces delete-all failure without removing config", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requests: Array<{ method: string; path: string }> = []
  let config: Record<string, unknown> = {
    model: "opencorvus/gpt-5-nano",
    mcp: {
      browser: { type: "remote", url: "https://mcp.example.com/browser" },
      filesystem: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "D:/repo"] },
      auth: { type: "remote", url: "https://mcp.example.com/auth" },
    },
  }
  const mcp = {
    browser: { status: "connected" },
    filesystem: { status: "disconnected" },
    auth: { status: "needs_auth" },
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requests.push({ method: req.method, path })

    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse

    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
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
    if (path === "/config/prompt-profile") {
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    }
    if (path === "/config" && req.method === "GET") return send(config)
    if (path === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>
      config = mergePatch(config, body.kind === "json" ? body.value : body) as Record<string, unknown>
      return send(config)
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
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts") return send(emptySkillMountMatrix)
    if (path === "/skill/directories") {
      return send({
        global_config: "D:/overlay/global/.opencorvus",
        managed_skills: "D:/overlay/global/.opencorvus/skills-market",
        remote_cache: "D:/overlay/global/.opencorvus/skill-cache",
      })
    }
    if (path === "/mcp" && req.method === "GET") return send(mcp)
    if (path.startsWith("/mcp/") && path.endsWith("/disconnect")) return send({ ok: true })
    if (path.startsWith("/mcp/") && path.endsWith("/auth") && req.method === "DELETE") {
      return send({ error: "mcp auth removal unavailable" }, { status: 503 })
    }
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument((serverUrl) => {
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      ;(window as any).__openedPaths = []
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
      ;(window as any).__TAURI__ = {
        core: {
          invoke: async (command: string, args?: Record<string, unknown>) => {
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                theme: "light",
                directory: "D:/overlay/workspace/app",
                workspaceDirectory: "D:/overlay/workspace/app",
              }
            }
            if (command === "overlay_settings_save") return true
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
            if (command === "overlay_open_path") {
              ;(window as any).__openedPaths.push(args?.path)
              return true
            }
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
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
    await page.waitForSelector("#leftPanelSkills[data-active='true']")
    const openSkillDirButton =
      '#leftPanelSkills[data-active="true"] [data-ui="tool-panel-action"][aria-label="Open Dir"]'
    await page.waitForSelector(openSkillDirButton, { visible: true })
    await page.click(openSkillDirButton)
    await page.waitForFunction(() => (window as any).__openedPaths?.length === 1)
    assert.deepEqual(await page.evaluate(() => (window as any).__openedPaths), [
      "D:/overlay/global/.opencorvus/skills-market",
    ])

    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]')
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]')
    await page.waitForSelector("#leftPanelMcp[data-active='true'] #mcpList")
    await page.waitForFunction(() => document.querySelector("#leftPanelMcp")?.textContent?.includes("browser"))
    const statusScreenshot = await saveElementScreenshot(page, "#leftPanelMcp", "skill-mcp-status-pills.png")
    const statusRows = await page.$$eval("#leftPanelMcp .extension-settings-row", (rows: HTMLElement[]) =>
      rows.map((row) => {
        const title = row.querySelector(".s-row-title") as HTMLElement | null
        const desc = row.querySelector(".s-row-desc") as HTMLElement | null
        const pill = row.querySelector(".s-pill") as HTMLElement | null
        const pillRect = pill?.getBoundingClientRect()
        const pillStyle = pill ? getComputedStyle(pill) : null
        return {
          title: title?.textContent?.trim() ?? "",
          desc: desc?.textContent?.trim() ?? "",
          pill: pill?.textContent?.trim() ?? "",
          tone: pill?.getAttribute("data-tone") ?? "",
          width: pillRect?.width ?? 0,
          height: pillRect?.height ?? 0,
          background: pillStyle?.backgroundColor ?? "",
          color: pillStyle?.color ?? "",
          border: pillStyle?.borderTopWidth ?? "",
        }
      }),
    )
    assert.deepEqual(
      statusRows.map((row) => ({ title: row.title, desc: row.desc, pill: row.pill, tone: row.tone })),
      [
        { title: "browser", desc: "Connected", pill: "Connected", tone: "ok" },
        { title: "filesystem", desc: "Disconnected", pill: "Disconnected", tone: "neutral" },
        { title: "auth", desc: "Needs auth", pill: "Needs auth", tone: "warn" },
      ],
    )
    for (const row of statusRows) {
      assert.ok(row.width > 24 && row.height > 12, `${row.title} status pill should be visible`)
      assert.match(row.color, /^rgb/)
      if (row.tone === "ok" || row.tone === "warn") {
        assert.notEqual(row.background, "rgba(0, 0, 0, 0)")
      }
      assert.equal(row.border, "1px")
    }
    requests.length = 0

    const deleteAllButton = '#leftPanelMcp[data-active="true"] [data-ui="tool-panel-action"][aria-label="Delete All"]'
    await page.waitForSelector(deleteAllButton, { visible: true })
    await page.click(deleteAllButton)
    await page.waitForFunction(() =>
      document.querySelector("#appDialogBody")?.textContent?.includes("Delete all 3 MCP"),
    )
    const confirmScreenshot = await saveElementScreenshot(page, "#appDialog", "skill-mcp-delete-confirm.png")

    await page.click("#btnAppDialogOk")
    await page.waitForFunction(() =>
      document.querySelector("#leftPanelMcp")?.textContent?.includes("mcp auth removal unavailable"),
    )
    const failureScreenshot = await saveElementScreenshot(page, "#leftPanelMcp", "skill-mcp-delete-failure.png")
    const failureNotice = await page.$eval("#leftPanelMcp .config-status-box", (node: HTMLElement) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const buttonRect = node.querySelector("button")?.getBoundingClientRect()
      return {
        text: node.textContent || "",
        width: rect.width,
        height: rect.height,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        buttonInside:
          !!buttonRect &&
          buttonRect.left >= rect.left &&
          buttonRect.right <= rect.right &&
          buttonRect.top >= rect.top &&
          buttonRect.bottom <= rect.bottom,
      }
    })

    assert.deepEqual(
      requests.filter((item) => item.path === "/config" && item.method === "PATCH"),
      [],
      "MCP config must not be patched after delete-all auth removal fails",
    )
    assert.ok(config.mcp, "MCP config should remain after failed delete-all")
    assert.match(failureNotice.text, /mcp auth removal unavailable/)
    assert.ok(
      failureNotice.width > 180 && failureNotice.height > 40,
      "failure notice should have visible box dimensions",
    )
    assert.notEqual(failureNotice.background, "rgba(0, 0, 0, 0)")
    assert.equal(failureNotice.border, "1px")
    assert.equal(failureNotice.buttonInside, true)
    assert.ok(statusScreenshot.endsWith("skill-mcp-status-pills.png"))
    assert.ok(confirmScreenshot.endsWith("skill-mcp-delete-confirm.png"))
    assert.ok(failureScreenshot.endsWith("skill-mcp-delete-failure.png"))
  } finally {
    await browser.close()
    await server.close()
  }
})
