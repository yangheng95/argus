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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

test("closed titlebar menus do not block task-scope panel interactions", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") {
      return Response.redirect(`${url.origin}/ui/index.html`, 302)
    }
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
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
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [] })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile")
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    if (path === "/config") return send({ model: "" })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
    if (path === "/skill/directories")
      return send({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/task/events") return eventStream()
    if (path === "/control/timeline") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return send({})
  })

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
    }, server.port)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]')
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]')
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-ui="side-activity-button"][data-side="right"][data-activity="requirements"]')
          ?.getAttribute("data-active") === "true",
    )

    assert.equal(await page.$("[data-testid^='titlebar-menu-']"), null)
    await page.click('[data-menu-trigger="help"]')
    await page.waitForSelector('[data-testid="titlebar-menu-help"]')
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector('[data-testid^="titlebar-menu-"]'))

    const hitTarget = await page.evaluate(() => {
      const header = Array.from(document.querySelectorAll<HTMLElement>(".task-scope-panel__header")).find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      if (!header) throw new Error("Missing visible task-scope header")
      const rect = header.getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      if (!(target instanceof Element)) return ""
      const insideHeader = !!target.closest(".task-scope-panel__header")
      return insideHeader ? "task-scope-panel__header-descendant" : `${target.tagName}.${target.className}`
    })
    assert.match(hitTarget, /task-scope-panel__header/)
  } finally {
    await browser.close()
    await server.close()
  }
})
