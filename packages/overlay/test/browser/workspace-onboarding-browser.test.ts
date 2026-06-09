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

test("browser overlay opens a project by submitting an explicit server path", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestedDirectories: string[] = []
  const projectPath = "D:/browser-overlay/project"
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    const directory = url.searchParams.get("directory")
    if (directory) requestedDirectories.push(directory)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: directory ?? projectPath })
    if (path === "/vcs")
      return send({
        branch: "main",
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
    if (path === "/config/prompt") return send([])
    if (path === "/config") return send({})
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
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
    await page.setViewport({ width: 900, height: 720 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.removeItem("oc_directory")
    }, server.port)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-testid="workspace-onboarding-browser-path-form"]', { visible: true })
    await page.type('[data-testid="workspace-onboarding-browser-path-input"]', projectPath)
    await page.click('[data-testid="workspace-onboarding-browser-path-submit"]')
    await page.waitForFunction((expected) => (window as any).settingsStore.directory === expected, {}, projectPath)

    const state = await page.evaluate(() => ({
      hostIsBrowser: !("__TAURI__" in window),
      directory: (window as any).settingsStore.directory,
      savedDirectory: (window as any).settingsStore.savedDirectory,
      persistedDirectory: localStorage.getItem("oc_directory"),
      hasNativeOpenButton: !!document.querySelector('[data-testid="workspace-onboarding-open-folder"]'),
    }))

    assert.deepEqual(state, {
      hostIsBrowser: true,
      directory: projectPath,
      savedDirectory: projectPath,
      persistedDirectory: projectPath,
      hasNativeOpenButton: false,
    })
    assert.ok(requestedDirectories.includes(projectPath))
  } finally {
    await browser.close()
    await server.close()
  }
})
