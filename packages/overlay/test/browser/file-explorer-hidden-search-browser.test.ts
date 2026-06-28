import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIRECTORY = "D:/overlay/workspace/app"

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function json(value: unknown, init?: ResponseInit) {
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

test(
  "file explorer does not search from a hidden center workbench panel",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const searchRequests: Array<{ query: string; directory: string }> = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return json({ version: "1.2.3" })
      if (path === "/global/projects/discover") return json([])
      if (path === "/global/tasks") return json({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return json([])
      if (path === "/path") return json({ directory: PROJECT_DIRECTORY })
      if (path === "/vcs")
        return json({
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
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config") return json({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return json([])
      if (path === "/config/prompt-profile") return json({ active: "general", targets: [], profiles: [] })
      if (path === "/terminal/profiles") return json({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return json({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return json([])
      if (path === "/skill/installed" || path === "/skill") return json([])
      if (path === "/skill/mounts")
        return json({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return json({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return json([])
      if (path === "/file") {
        return json([
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/find/file") {
        const query = url.searchParams.get("query") ?? ""
        const directory = url.searchParams.get("directory") ?? ""
        searchRequests.push({ query, directory })
        return json([`src/${query}.ts`])
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return json({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page)
      await page.setViewport({ width: 1280, height: 760 })
      await page.evaluateOnNewDocument(
        (input: { directory: string; serverUrl: string }) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_directory", input.directory)
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      const explorerButton = '[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]'
      await page.waitForSelector(explorerButton)
      await page.click(explorerButton)
      await page.waitForSelector(".file-explorer-search-input", { visible: true })
      await page.type(".file-explorer-search-input", "visible")
      await page.waitForSelector('.file-explorer-row[title="src/visible.ts"]', { visible: true })
      assert.deepEqual(searchRequests.at(-1), { query: "visible", directory: PROJECT_DIRECTORY })
      const visibleSearchRequestCount = searchRequests.length

      await page.click(explorerButton)
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#centerWorkbenchExplorer")?.dataset.open === "false",
      )
      await page.$eval(".file-explorer-search-input", (node) => {
        const input = node as HTMLInputElement
        input.value = "hidden"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "hidden" }))
      })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      assert.equal(searchRequests.length, visibleSearchRequestCount)

      await page.click(explorerButton)
      await page.waitForSelector('.file-explorer-row[title="src/hidden.ts"]', { visible: true })
      assert.deepEqual(searchRequests.at(-1), { query: "hidden", directory: PROJECT_DIRECTORY })

      const screenshotPath = resolve(".scratch/file-explorer-hidden-search-active-gate.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      const explorer = await page.$("#centerWorkbenchExplorer")
      assert.ok(explorer)
      writeFileSync(screenshotPath, await explorer.screenshot({}))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
