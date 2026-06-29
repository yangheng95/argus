import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIRECTORY = "D:/overlay/workspace/loading-status"

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function eventStream(): Response {
  return new Response(":\n\n", {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function saveScreenshot(
  element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> },
  name: string,
) {
  const target = resolve(".scratch", name)
  mkdirSync(dirname(target), { recursive: true })
  const bytes = await element.screenshot({})
  assert.ok(bytes.length > 0, `${name} screenshot should not be empty`)
  writeFileSync(target, bytes)
  return target
}

async function assertLedgerLoading(page: any, containerSelector: string, name: string) {
  await page.waitForSelector(`${containerSelector} [role="status"][aria-live="polite"][aria-busy="true"]`, {
    visible: true,
    timeout: 15_000,
  })
  const state = await page.$eval(containerSelector, (container: HTMLElement) => {
    const statuses = Array.from(
      container.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"][aria-busy="true"]'),
    )
    const status = statuses[0]
    const rows = status ? Array.from(status.querySelectorAll<HTMLElement>(".ledger-skeleton-row")) : []
    return {
      statusCount: statuses.length,
      statusText: status?.textContent?.trim().replace(/\s+/g, " ") ?? "",
      statusHidden: status?.getAttribute("aria-hidden") ?? "",
      rowsHidden: status?.querySelector<HTMLElement>(".ledger-skeleton-rows")?.getAttribute("aria-hidden") ?? "",
      rowCount: rows.length,
      rowRects: rows.map((row) => {
        const rect = row.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
      skeletonRowText: rows.map((row) => row.textContent?.trim() ?? ""),
    }
  })
  assert.equal(state.statusCount, 1, `${name} should expose one loading status`)
  assert.equal(state.statusText, "Loading…", `${name} status text`)
  assert.equal(state.statusHidden, "", `${name} status itself must remain exposed`)
  assert.equal(state.rowsHidden, "true", `${name} skeleton rows should be decorative`)
  assert.equal(state.rowCount, 3, `${name} skeleton rows`)
  assert.deepEqual(state.skeletonRowText, ["", "", ""], `${name} skeleton rows should not add readable text`)
  assert.equal(
    state.rowRects.every((rect) => rect.width > 0 && rect.height > 0),
    true,
    JSON.stringify(state),
  )
  const element = await page.$(containerSelector)
  assert.ok(element)
  return saveScreenshot(element, `${name}.png`)
}

test("left ledger loading skeletons expose live status text without visual regression", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const tasks = deferredResponse()
  const missions = deferredResponse()
  const codingSessions = deferredResponse()
  const badResponses: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "ledger-loading-status-test" })
    if (path === "/global/tasks") return tasks.promise
    if (path === "/mission") return missions.promise
    if (path === "/coding/sessions") return codingSessions.promise
    if (path === "/global/projects/discover") {
      return send({
        root: "D:/overlay/workspace",
        defaultDirectory: PROJECT_DIRECTORY,
        projects: [{ directory: PROJECT_DIRECTORY, name: "loading-status", marker: "package.json" }],
      })
    }
    if (path === "/path") return send({ directory: PROJECT_DIRECTORY, exists: true, git: true })
    if (path === "/vcs") return send({ branch: "loading", clean: true, dirty: false })
    if (path === "/session") return send([])
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") return send({ server: {}, provider: {}, channel: {}, mcp: {}, model: "" })
    if (path === "/config/prompt" || path === "/config/prompt-profile") {
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
    }
    if (path === "/channel" || path === "/executor" || path === "/agent") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles")
      return send({ defaultProfileID: "", profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/directories") {
      return send({
        global_config: "D:/overlay/config",
        managed_skills: "D:/overlay/config/skills-market",
        remote_cache: "D:/overlay/cache",
      })
    }
    if (path === "/mcp") return send({})
    if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (path === "/task/events") return eventStream()
    return send({ error: `unhandled ${req.method} ${path}` }, 404)
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument(
      (input: { directory: string; serverUrl: string }) => {
        localStorage.setItem("oc_directory", input.directory)
        localStorage.setItem("oc_saved_directory", input.directory)
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", input.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      },
      { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]', {
      visible: true,
    })

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
    const missionScreenshot = await assertLedgerLoading(page, ".mission-ledger-list", "mission-ledger-loading-status")
    assert.ok(missionScreenshot.endsWith("mission-ledger-loading-status.png"))

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
    const assistantScreenshot = await assertLedgerLoading(
      page,
      ".coding-assistant-ledger-list",
      "coding-assistant-ledger-loading-status",
    )
    assert.ok(assistantScreenshot.endsWith("coding-assistant-ledger-loading-status.png"))

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    const taskScreenshot = await assertLedgerLoading(page, "#taskListPanel", "task-ledger-loading-status")
    assert.ok(taskScreenshot.endsWith("task-ledger-loading-status.png"))

    assert.deepEqual(badResponses, [])
  } finally {
    tasks.resolve(send({ tasks: [] }))
    missions.resolve(send([]))
    codingSessions.resolve(send({ sessions: [] }))
    await browser.close().catch(() => undefined)
    await server.close()
  }
})

test("Mission ledger shows offline connection boundary without requesting missions", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  let missionRequests = 0
  const badResponses: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ error: "offline for mission boundary test" }, 503)
    if (path === "/mission") {
      missionRequests += 1
      return send({ error: "mission should not load while offline" }, 500)
    }
    if (path === "/global/projects/discover") {
      return send({
        root: "D:/overlay/workspace",
        defaultDirectory: PROJECT_DIRECTORY,
        projects: [{ directory: PROJECT_DIRECTORY, name: "loading-status", marker: "package.json" }],
      })
    }
    if (path === "/project/current/worktrees") return send([])
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    return send({ error: `unhandled ${req.method} ${path}` }, 404)
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    page.on("response", (response: any) => {
      if (response.status() >= 400 && !response.url().endsWith("/global/health")) {
        badResponses.push(`${response.status()} ${response.url()}`)
      }
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument(
      (input: { directory: string; serverUrl: string }) => {
        localStorage.setItem("oc_directory", input.directory)
        localStorage.setItem("oc_saved_directory", input.directory)
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", input.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      },
      { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]', {
      visible: true,
    })
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
    await page.waitForSelector(".mission-ledger-list [role='alert']", { visible: true, timeout: 15_000 })

    const state = await page.$eval(".mission-ledger-list", (container: HTMLElement) => {
      const alert = container.querySelector<HTMLElement>("[role='alert']")
      const loading = container.querySelector<HTMLElement>("[role='status'][aria-busy='true']")
      return {
        alertText: alert?.textContent?.trim().replace(/\s+/g, " ") ?? "",
        loadingVisible: !!loading,
        rowCount: container.querySelectorAll('[data-ui="mission-row"]').length,
      }
    })
    assert.match(state.alertText, /OpenCorvus is not connected yet/)
    assert.equal(state.loadingVisible, false)
    assert.equal(state.rowCount, 0)
    assert.equal(missionRequests, 0)
    assert.deepEqual(badResponses, [])

    const element = await page.$(".mission-ledger-list")
    assert.ok(element)
    const screenshotPath = await saveScreenshot(element, "mission-ledger-offline-boundary.png")
    assert.ok(screenshotPath.endsWith("mission-ledger-offline-boundary.png"))
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
