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

test("command palette delegates modal semantics to Kobalte while preserving hotkey focus flow", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/session") return send([])
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
    if (path === "/config/providers") return send({ providers: [] })
    if (path === "/config") return send({ model: "" })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
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
    await page.waitForSelector('[data-menu-trigger="help"]')
    await page.focus('[data-menu-trigger="help"]')

    await page.keyboard.down("Control")
    await page.keyboard.press("k")
    await page.keyboard.up("Control")
    await page.waitForSelector(".cmdk-panel")

    const openState = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".cmdk-panel")
      return {
        role: panel?.getAttribute("role"),
        ariaModal: panel?.getAttribute("aria-modal"),
        activeClass: (document.activeElement as HTMLElement | null)?.className || "",
      }
    })
    assert.equal(openState.role, "dialog")
    assert.equal(openState.ariaModal, "true")
    assert.match(String(openState.activeClass), /cmdk-input/)

    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector(".cmdk-panel"))
    const restored = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.menuTrigger || "",
    )
    assert.equal(restored, "help")
  } finally {
    await browser.close()
    await server.close()
  }
})
