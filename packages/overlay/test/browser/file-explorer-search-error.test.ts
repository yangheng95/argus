import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIRECTORY = "D:/overlay/workspace/app"
const NEXT_PROJECT_DIRECTORY = "D:/overlay/workspace/next-app"

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

function matchesFixtureQuery(
  response: { status: number; url: string; path: string },
  expectedPath: string,
  expectedQuery: Record<string, string>,
  expectedStatus: number,
): boolean {
  return response.status === expectedStatus && matchesFixtureUrl(response, expectedPath, expectedQuery)
}

function matchesFixtureUrl(
  input: { url: string; path: string },
  expectedPath: string,
  expectedQuery: Record<string, string>,
): boolean {
  if (input.path !== expectedPath) return false
  const actual = [...new URL(input.url).searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
  const expected = Object.entries(expectedQuery).sort(([left], [right]) => left.localeCompare(right))
  return (
    actual.length === expected.length &&
    actual.every(([key, value], index) => {
      const [expectedKey, expectedValue] = expected[index]
      return key === expectedKey && value === expectedValue
    })
  )
}

async function waitForCondition(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

async function openExplorerRootContextMenu(page: any): Promise<void> {
  const point = await page.$eval(".file-explorer-list", (node: Element) => {
    const rect = (node as HTMLElement).getBoundingClientRect()
    return { x: rect.left + Math.min(80, rect.width / 2), y: rect.bottom - 24 }
  })
  await page.mouse.click(point.x, point.y, { button: "right" })
}

async function openExplorerRowContextMenu(page: any, selector: string): Promise<void> {
  const point = await page.$eval(selector, (node: Element) => {
    const rect = (node as HTMLElement).getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(point.x, point.y, { button: "right" })
}

async function clickExplorerContextMenuItem(page: any, dataUi: string): Promise<void> {
  const selector = `.file-explorer-context-menu [data-ui="${dataUi}"]:not([disabled]):not([data-disabled])`
  await page.waitForSelector(selector, { visible: true })
  await page.click(selector)
}

async function triggerExplorerRefresh(page: any): Promise<void> {
  await openExplorerRootContextMenu(page)
  await clickExplorerContextMenuItem(page, "file-explorer-context-refresh")
}

async function uploadFixtureThroughExplorerContext(
  page: any,
  input: { rowSelector?: string; name: string; content: string },
): Promise<void> {
  if (input.rowSelector) await openExplorerRowContextMenu(page, input.rowSelector)
  else await openExplorerRootContextMenu(page)
  await clickExplorerContextMenuItem(page, "file-explorer-context-upload")
  await page.evaluate((fileInput: { name: string; content: string }) => {
    const uploadInput = document.querySelector<HTMLInputElement>('[data-ui="file-explorer-upload-input"]')
    if (!uploadInput) throw new Error("upload input missing")
    const transfer = new DataTransfer()
    transfer.items.add(new File([fileInput.content], fileInput.name, { type: "text/plain" }))
    Object.defineProperty(uploadInput, "files", { value: transfer.files, configurable: true })
    uploadInput.dispatchEvent(new Event("change", { bubbles: true }))
  }, input)
}

test(
  "file explorer search failures render an error instead of no matches",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        return send([
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/find/file") return send({ error: "ripgrep unavailable" }, { status: 500 })
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(
            response,
            "/find/file",
            { directory: PROJECT_DIRECTORY, query: "broken", type: "file", limit: "80" },
            500,
          )
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await page.$eval(".file-explorer-search-input", (node) => {
        const input = node as HTMLInputElement
        input.value = "broken"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "broken" }))
      })
      await page.waitForSelector('[data-ui="file-explorer-search-retry"]', { visible: true })

      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
        retryVisible: !!node.querySelector('[data-ui="file-explorer-search-retry"]'),
      }))
      assert.match(state.text, /File search failed/)
      assert.equal(state.retryVisible, true)
      assert.doesNotMatch(state.text, /No matching files/)

      const screenshotPath = resolve(".scratch/file-explorer-search-error-visible.png")
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

test(
  "file explorer refresh failures do not report success",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let fileListCalls = 0
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        fileListCalls += 1
        if (fileListCalls > 1) return send({ error: "directory reload unavailable" }, { status: 500 })
        return send([
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(response, "/file", { directory: PROJECT_DIRECTORY, path: "" }, 500)
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await triggerExplorerRefresh(page)
      await page.waitForSelector('[data-ui="file-explorer-command-message"][data-status="error"]', { visible: true })

      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
        commandMessage: node.querySelector('[data-ui="file-explorer-command-message"]')?.textContent ?? "",
        retryVisible: !!node.querySelector('[data-ui="file-explorer-retry"]'),
      }))
      assert.match(state.commandMessage, /directory reload unavailable|API 500/)
      assert.match(state.text, /Unable to load files/)
      assert.equal(state.retryVisible, true)
      assert.doesNotMatch(state.text, /Explorer refreshed/)

      const screenshotPath = resolve(".scratch/file-explorer-refresh-error-visible.png")
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

test(
  "file explorer retry forces a cached directory reload after refresh failure",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let fileListCalls = 0
    let failRootReload = false
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        fileListCalls += 1
        if (failRootReload) return send({ error: "root retry should recover" }, { status: 500 })
        return send([
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(response, "/file", { directory: PROJECT_DIRECTORY, path: "" }, 500)
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      failRootReload = true
      await triggerExplorerRefresh(page)
      await page.waitForSelector('[data-ui="file-explorer-retry"]', { visible: true })
      failRootReload = false
      await page.click('[data-ui="file-explorer-retry"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })

      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
      }))
      assert.equal(fileListCalls, 3)
      assert.doesNotMatch(state.text, /Unable to load files/)
      assert.doesNotMatch(state.text, /root retry should recover/)

      const screenshotPath = resolve(".scratch/file-explorer-retry-recovered-visible.png")
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

test(
  "file editor content load failures render a load error instead of the non-editable state",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        return send([
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/file/content") return send({ error: "content read unavailable" }, { status: 500 })
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(
            response,
            "/file/content",
            { directory: PROJECT_DIRECTORY, path: "README.md" },
            500,
          )
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await page.click('.file-explorer-row[title="README.md"]')
      await page.waitForSelector('[data-ui="file-editor-load-error"]', { visible: true })

      const state = await page.$eval(".file-editor-pane", (node) => ({
        text: node.textContent ?? "",
      }))
      assert.match(state.text, /Failed to load file/)
      assert.match(state.text, /content read unavailable|API 500/)
      assert.doesNotMatch(state.text, /This file is not editable in the overlay/)

      const screenshotPath = resolve(".scratch/file-editor-content-load-error-visible.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      const editor = await page.$(".file-editor-pane")
      assert.ok(editor)
      writeFileSync(screenshotPath, await editor.screenshot({}))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "file explorer create dialog does not mutate the new active directory after a project switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const createRequests: Array<{ directory: string; body: unknown }> = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      const directory = url.searchParams.get("directory") || PROJECT_DIRECTORY
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file" && req.method === "GET") {
        const name = directory === NEXT_PROJECT_DIRECTORY ? "NEXT.md" : "README.md"
        return send([
          {
            name,
            path: name,
            absolute: `${directory}/${name}`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/file/item" && req.method === "POST") {
        createRequests.push({ directory, body: await req.json().catch(() => ({})) })
        return send({
          name: "new-owned.md",
          path: "new-owned.md",
          absolute: `${directory}/new-owned.md`,
          type: "file",
          ignored: false,
        })
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          return failure.path === "/task/events" && failure.errorText === "net::ERR_ABORTED"
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await openExplorerRootContextMenu(page)
      await clickExplorerContextMenuItem(page, "file-explorer-context-new-file")
      await page.waitForSelector("#appDialog[data-dialog-epoch]", { visible: true })
      await page.$eval("#appDialogInput", (node) => {
        const input = node as HTMLInputElement
        input.value = "new-owned.md"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "new-owned.md" }))
      })

      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false, save: false, restoreWorkspace: false })
      }, NEXT_PROJECT_DIRECTORY)
      await page.waitForSelector('.file-explorer-row[title="NEXT.md"]', { visible: true })
      await page.click("#btnAppDialogOk")
      await new Promise((resolve) => setTimeout(resolve, 300))

      assert.deepEqual(createRequests, [])
      const screenshotPath = resolve(".scratch/file-explorer-dialog-directory-switch-no-cross-project-create.png")
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

test(
  "file explorer stale refresh completion does not own next project controls",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let projectFileCalls = 0
    let releaseProjectRefresh: (response: Response) => void = () => {
      throw new Error("project refresh was not started")
    }
    const projectRefresh = new Promise<Response>((resolve) => {
      releaseProjectRefresh = resolve
    })
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      const directory = url.searchParams.get("directory") || PROJECT_DIRECTORY
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file" && req.method === "GET") {
        if (directory === PROJECT_DIRECTORY) {
          projectFileCalls += 1
          if (projectFileCalls > 1) return projectRefresh
          return send([
            {
              name: "README.md",
              path: "README.md",
              absolute: `${directory}/README.md`,
              type: "file",
              ignored: false,
            },
          ])
        }
        return send([
          {
            name: "NEXT.md",
            path: "NEXT.md",
            absolute: `${directory}/NEXT.md`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(response, "/file", { directory: PROJECT_DIRECTORY, path: "" }, 500)
        },
        allowRequestFailure(failure) {
          return failure.path === "/task/events" && failure.errorText === "net::ERR_ABORTED"
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await triggerExplorerRefresh(page)
      await waitForCondition(() => projectFileCalls === 2, "project refresh did not start")

      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false, save: false, restoreWorkspace: false })
      }, NEXT_PROJECT_DIRECTORY)
      await page.waitForSelector('.file-explorer-row[title="NEXT.md"]', { visible: true })
      await openExplorerRootContextMenu(page)
      await page.waitForSelector('.file-explorer-context-menu [data-ui="file-explorer-context-refresh"]', {
        visible: true,
      })
      const nextProjectBusyState = await page.evaluate(() => {
        const refresh = document.querySelector<HTMLButtonElement>(
          '.file-explorer-context-menu [data-ui="file-explorer-context-refresh"]',
        )
        return {
          refreshDisabled: refresh?.disabled ?? true,
          commandMessage:
            document.querySelector("#centerWorkbenchExplorer [data-ui='file-explorer-command-message']")?.textContent ??
            "",
        }
      })
      assert.equal(nextProjectBusyState.refreshDisabled, false)
      assert.equal(nextProjectBusyState.commandMessage, "")
      await page.mouse.click(4, 4)

      releaseProjectRefresh(send({ error: "stale project reload failed" }, { status: 500 }))
      await new Promise((resolve) => setTimeout(resolve, 300))
      const finalState = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
        commandMessage: node.querySelector('[data-ui="file-explorer-command-message"]')?.textContent ?? "",
      }))
      assert.equal(finalState.commandMessage, "")
      assert.doesNotMatch(finalState.text, /Explorer refreshed|stale project reload failed|API 500/)

      const screenshotPath = resolve(".scratch/file-explorer-stale-refresh-next-project-clean.png")
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

test(
  "file editor save remains scoped to the original project after a directory switch",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const patchRequests: Array<{ directory: string; body: unknown }> = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      const directory = url.searchParams.get("directory") || PROJECT_DIRECTORY
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file" && req.method === "GET") {
        const name = directory === NEXT_PROJECT_DIRECTORY ? "NEXT.md" : "README.md"
        return send([
          {
            name,
            path: name,
            absolute: `${directory}/${name}`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/file/content" && req.method === "GET") {
        return send({
          type: "text",
          content: directory === NEXT_PROJECT_DIRECTORY ? "next project\n" : "alpha project\n",
        })
      }
      if (path === "/file/content" && req.method === "PATCH") {
        patchRequests.push({ directory, body: await req.json().catch(() => ({})) })
        return send({ type: "text", content: "edited alpha project\n" })
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          return failure.path === "/task/events" && failure.errorText === "net::ERR_ABORTED"
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await page.click('.file-explorer-row[title="README.md"]')
      await page.waitForFunction(() =>
        document.querySelector<HTMLElement>(".file-editor-pane .cm-content")?.textContent?.includes("alpha project"),
      )
      await page.click(".file-editor-pane .cm-content")
      await page.keyboard.down("Control")
      await page.keyboard.press("A")
      await page.keyboard.up("Control")
      await page.keyboard.type("edited alpha project\n")
      await page.waitForSelector('.file-editor-pane [data-ui="file-editor-save"][data-dirty="true"]')

      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false, save: false, restoreWorkspace: false })
      }, NEXT_PROJECT_DIRECTORY)
      await page.waitForSelector('.file-explorer-row[title="NEXT.md"]', { visible: true })
      await page.click('.file-editor-pane [data-ui="file-editor-save"]')
      await waitForCondition(() => patchRequests.length === 1, "file editor save request did not complete")

      assert.deepEqual(patchRequests, [
        {
          directory: PROJECT_DIRECTORY,
          body: { path: "README.md", content: "edited alpha project\n" },
        },
      ])

      const screenshotPath = resolve(".scratch/file-editor-directory-scoped-save-after-switch.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      const editor = await page.$(".file-editor-pane")
      assert.ok(editor)
      writeFileSync(screenshotPath, await editor.screenshot({}))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "file explorer refreshes active search results after deleting a search row",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let deleted = false
    let searchCalls = 0
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        const requestedPath = url.searchParams.get("path") ?? ""
        if (requestedPath === "src") return send([])
        return send([
          {
            name: "src",
            path: "src",
            absolute: `${PROJECT_DIRECTORY}/src`,
            type: "directory",
            ignored: false,
          },
        ])
      }
      if (path === "/find/file") {
        searchCalls += 1
        return send(deleted ? [] : ["src/a.ts"])
      }
      if (path === "/file/content") return send({ type: "text", content: "export const a = 1;\n" })
      if (path === "/file/item" && req.method === "DELETE") {
        const target = url.searchParams.get("path") ?? ""
        assert.equal(target, "src/a.ts")
        deleted = true
        return send({ path: "src/a.ts" })
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector(".file-explorer-search-input", { visible: true })
      await page.type(".file-explorer-search-input", "a")
      await page.waitForSelector('.file-explorer-row[title="src/a.ts"]', { visible: true })
      await openExplorerRowContextMenu(page, '.file-explorer-row[title="src/a.ts"]')
      await clickExplorerContextMenuItem(page, "file-explorer-context-delete")
      await page.waitForSelector("#appDialog", { visible: true })
      await page.click("#btnAppDialogOk")
      await page.waitForFunction(() => !document.querySelector('.file-explorer-row[title="src/a.ts"]'))

      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
      }))
      assert.equal(deleted, true)
      assert.equal(searchCalls, 2)
      assert.match(state.text, /No matching files/)

      const screenshotPath = resolve(".scratch/file-explorer-search-delete-refetch-visible.png")
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

test(
  "file explorer required refresh is not superseded by background refresh",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let fileListCalls = 0
    let releaseManualRefresh!: (response: Response) => void
    const manualRefresh = new Promise<Response>((resolve) => {
      releaseManualRefresh = resolve
    })
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        fileListCalls += 1
        if (fileListCalls === 1) {
          return send([
            {
              name: "README.md",
              path: "README.md",
              absolute: `${PROJECT_DIRECTORY}/README.md`,
              type: "file",
              ignored: false,
            },
          ])
        }
        if (fileListCalls === 2) return manualRefresh
        return send({ error: "background refresh should not supersede required reload" }, { status: 500 })
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(response, "/file", { directory: PROJECT_DIRECTORY, path: "" }, 500)
        },
        allowRequestFailure(failure) {
          return (
            failure.errorText === "net::ERR_ABORTED" &&
            matchesFixtureUrl(failure, "/file", { directory: PROJECT_DIRECTORY, path: "" })
          )
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await triggerExplorerRefresh(page)
      await waitForCondition(() => fileListCalls === 2, "manual refresh did not start")
      await new Promise((resolve) => setTimeout(resolve, 16_000))
      assert.equal(fileListCalls, 2, "background refresh must not issue a competing /file request")

      releaseManualRefresh(send({ error: "manual refresh failed after pending reload" }, { status: 500 }))
      await page.waitForSelector('[data-ui="file-explorer-command-message"][data-status="error"]', { visible: true })
      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
        commandMessage: node.querySelector('[data-ui="file-explorer-command-message"]')?.textContent ?? "",
      }))
      assert.match(state.commandMessage, /manual refresh failed after pending reload|API 500|signal timed out/)
      assert.doesNotMatch(state.text, /Explorer refreshed/)
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)

test(
  "file explorer upload reports reload failure after a successful upload",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    let uploadCompleted = false
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        const requestedPath = url.searchParams.get("path") ?? ""
        if (requestedPath === "src" && uploadCompleted) {
          return send({ error: "post-upload reload unavailable" }, { status: 500 })
        }
        return send([
          {
            name: "src",
            path: "src",
            absolute: `${PROJECT_DIRECTORY}/src`,
            type: "directory",
            ignored: false,
          },
        ])
      }
      if (path === "/file/upload" && req.method === "POST") {
        uploadCompleted = true
        return send([{ name: "uploaded.txt", path: "src/uploaded.txt", bytes: 13 }])
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return matchesFixtureQuery(response, "/file", { directory: PROJECT_DIRECTORY, path: "src" }, 500)
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="src"]', { visible: true })
      await uploadFixtureThroughExplorerContext(page, {
        rowSelector: '.file-explorer-row[title="src"]',
        name: "uploaded.txt",
        content: "from browser",
      })
      await page.waitForSelector('.file-explorer-upload-message[data-status="error"]', { visible: true })

      const state = await page.$eval("#centerWorkbenchExplorer", (node) => ({
        text: node.textContent ?? "",
        uploadMessage: node.querySelector(".file-explorer-upload-message")?.textContent ?? "",
      }))
      assert.match(state.uploadMessage, /Uploaded, but failed to reload files/)
      assert.match(state.uploadMessage, /post-upload reload unavailable|API 500/)
      assert.doesNotMatch(state.uploadMessage, /Upload failed/)
      assert.doesNotMatch(state.text, /Uploaded 1 file/)

      const screenshotPath = resolve(".scratch/file-explorer-upload-reload-error-visible.png")
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

test(
  "stale upload completion does not clear a newer project upload state",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const uploadRequests: string[] = []
    let releaseProjectUpload!: (response: Response) => void
    let releaseNextUpload!: (response: Response) => void
    const projectUpload = new Promise<Response>((resolve) => {
      releaseProjectUpload = resolve
    })
    const nextUpload = new Promise<Response>((resolve) => {
      releaseNextUpload = resolve
    })

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      const directory = url.searchParams.get("directory") || PROJECT_DIRECTORY
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/mission" || path === "/session" || path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory })
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
      if (path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
      if (path === "/file") {
        const name = directory === NEXT_PROJECT_DIRECTORY ? "NEXT.md" : "README.md"
        return send([
          {
            name,
            path: name,
            absolute: `${directory}/${name}`,
            type: "file",
            ignored: false,
          },
        ])
      }
      if (path === "/file/upload" && req.method === "POST") {
        uploadRequests.push(directory)
        return directory === NEXT_PROJECT_DIRECTORY ? nextUpload : projectUpload
      }
      if (path === "/task/events") return eventStream()
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowRequestFailure(failure) {
          return failure.path === "/task/events" && failure.errorText === "net::ERR_ABORTED"
        },
      })
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
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      await page.waitForSelector('.file-explorer-row[title="README.md"]', { visible: true })
      await uploadFixtureThroughExplorerContext(page, {
        name: "project-upload.txt",
        content: "from project",
      })
      await waitForCondition(() => uploadRequests.includes(PROJECT_DIRECTORY), "project upload did not start")

      await page.evaluate(async (directory) => {
        await (window as any).applyDirectory(directory, { persist: false, save: false, restoreWorkspace: false })
      }, NEXT_PROJECT_DIRECTORY)
      await page.waitForSelector('.file-explorer-row[title="NEXT.md"]', { visible: true })
      await uploadFixtureThroughExplorerContext(page, {
        name: "next-upload.txt",
        content: "from next",
      })
      await waitForCondition(() => uploadRequests.includes(NEXT_PROJECT_DIRECTORY), "next upload did not start")

      releaseProjectUpload(send([{ name: "project-upload.txt", path: "project-upload.txt", bytes: 12 }]))
      await new Promise((resolve) => setTimeout(resolve, 300))
      const activeUploadState = await page.$eval(".file-explorer-panel", (node) => ({
        uploading: (node as HTMLElement).dataset.uploading ?? "",
        text: node.textContent ?? "",
      }))
      assert.equal(activeUploadState.uploading, "true")
      assert.match(activeUploadState.text, /Uploading/)
      assert.doesNotMatch(activeUploadState.text, /Uploaded 1 file/)

      const screenshotPath = resolve(".scratch/file-explorer-upload-stale-completion-keeps-next-upload.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      const explorer = await page.$("#centerWorkbenchExplorer")
      assert.ok(explorer)
      writeFileSync(screenshotPath, await explorer.screenshot({}))

      releaseNextUpload(send([{ name: "next-upload.txt", path: "next-upload.txt", bytes: 9 }]))
      await page.waitForSelector('.file-explorer-panel[data-uploading="false"]', { visible: true })
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
