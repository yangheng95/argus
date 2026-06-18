import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const PROJECT_DIRECTORY = "D:/overlay/workspace/app"

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

async function saveScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await page.screenshot({ fullPage: false }))
  return target
}

test("cwd breadcrumb buttons are outside the recent-directory menu trigger", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    const directory = url.searchParams.get("directory")
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/session" || path === "/mission" || path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: directory ?? PROJECT_DIRECTORY })
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
    if (path === "/global/projects/discover") {
      return send({
        root: "D:/overlay/workspace",
        defaultDirectory: PROJECT_DIRECTORY,
        projects: [
          {
            directory: PROJECT_DIRECTORY,
            name: "app",
            marker: "package.json",
          },
        ],
      })
    }
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile") return send({ active: "general", targets: [], profiles: [] })
    if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) return send({ model: "" })
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
    if (path === "/task/events") {
      return new Response(":\n\n", {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
    }
    if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
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
    page.on("response", (response: any) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((input: { directory: string; serverUrl: string }) => {
      localStorage.setItem("oc_directory", input.directory)
      localStorage.setItem("oc_saved_directory", input.directory)
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_server_url", input.serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem(
        "oc_recent_directories",
        JSON.stringify([input.directory, "D:/overlay/workspace/tools", "D:/overlay/workspace/docs"]),
      )
    }, { directory: PROJECT_DIRECTORY, serverUrl: server.origin })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(".task-cwd-dropdown", { visible: true })
    await page.waitForSelector(".task-dir-step", { visible: true })
    await page.waitForSelector('[data-ui="cwd-recent-trigger"]', { visible: true })

    const semantics = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLElement>('[data-ui="cwd-recent-trigger"]')
      const pathButton = document.querySelector<HTMLElement>(".task-dir-step")
      const currentNode = document.querySelector<HTMLElement>(".task-dir-node[data-current='true']")
      return {
        triggerTag: trigger?.tagName ?? "",
        triggerType: trigger?.getAttribute("type") ?? "",
        pathButtonTag: pathButton?.tagName ?? "",
        triggerContainsPathButton: !!trigger && !!pathButton && trigger.contains(pathButton),
        pathButtonTriggerAncestor: !!pathButton?.closest('[data-ui="cwd-recent-trigger"]'),
        currentNodeTag: currentNode?.tagName ?? "",
        currentNodeCurrent: currentNode?.getAttribute("aria-current") ?? "",
        currentNodeSelected: currentNode?.getAttribute("aria-selected") ?? "",
        currentNodePressed: currentNode?.getAttribute("aria-pressed") ?? "",
      }
    })

    assert.deepEqual(
      {
        triggerTag: semantics.triggerTag,
        triggerType: semantics.triggerType,
        pathButtonTag: semantics.pathButtonTag,
        triggerContainsPathButton: semantics.triggerContainsPathButton,
        pathButtonTriggerAncestor: semantics.pathButtonTriggerAncestor,
      },
      {
        triggerTag: "BUTTON",
        triggerType: "button",
        pathButtonTag: "BUTTON",
        triggerContainsPathButton: false,
        pathButtonTriggerAncestor: false,
      },
    )
    assert.ok(["BUTTON", "SPAN"].includes(semantics.currentNodeTag), JSON.stringify(semantics))
    assert.deepEqual({
      currentNodeCurrent: semantics.currentNodeCurrent,
      currentNodeSelected: semantics.currentNodeSelected,
      currentNodePressed: semantics.currentNodePressed,
    }, {
      currentNodeCurrent: "location",
      currentNodeSelected: "",
      currentNodePressed: "",
    })

    await page.focus(".task-dir-step")
    await page.keyboard.press("Enter")
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterPathKey = await page.evaluate(() => ({
      panelPresent: !!document.querySelector(".recent-dir-panel"),
      triggerExpanded: document.querySelector('[data-ui="cwd-recent-trigger"]')?.getAttribute("aria-expanded") ?? "",
    }))
    assert.deepEqual(afterPathKey, { panelPresent: false, triggerExpanded: "false" })

    await page.focus('[data-ui="cwd-recent-trigger"]')
    await page.keyboard.press("Enter")
    await page.waitForSelector(".recent-dir-panel", { visible: true })
    await page.waitForSelector('[data-ui="cwd-path-input"]', { visible: true })
    await page.waitForFunction(
      () => document.querySelectorAll('.recent-dir-row[data-active="true"] .recent-dir-item[aria-current="location"]').length >= 1,
    )

    const openState = await page.evaluate(() => ({
      panelVisible: !!document.querySelector(".recent-dir-panel"),
      triggerExpanded: document.querySelector('[data-ui="cwd-recent-trigger"]')?.getAttribute("aria-expanded") ?? "",
      shellOpen: document.querySelector(".task-cwd-dropdown")?.getAttribute("data-open") ?? "",
      recentRows: document.querySelectorAll('.recent-dir-list[data-kind="recent"] .recent-dir-row').length,
      currentRows: Array.from(document.querySelectorAll<HTMLElement>(".recent-dir-row")).map((row) => {
        const item = row.querySelector<HTMLElement>(".recent-dir-item")
        return {
          title: item?.getAttribute("title") ?? "",
          active: row.dataset.active ?? "",
          current: item?.getAttribute("aria-current") ?? "",
          selected: item?.getAttribute("aria-selected") ?? "",
          pressed: item?.getAttribute("aria-pressed") ?? "",
        }
      }),
      geometry: (() => {
        const shell = document.querySelector<HTMLElement>(".task-cwd-dropdown")?.getBoundingClientRect()
        const panel = document.querySelector<HTMLElement>(".recent-dir-panel")?.getBoundingClientRect()
        return shell && panel
          ? {
              leftDelta: Math.abs(Math.round(shell.left) - Math.round(panel.left)),
              panelWidth: Math.round(panel.width),
              shellWidth: Math.round(shell.width),
            }
          : null
      })(),
    }))
    assert.equal(openState.panelVisible, true)
    assert.equal(openState.triggerExpanded, "true")
    assert.equal(openState.shellOpen, "true")
    assert.ok(openState.recentRows >= 3)
    assert.ok(openState.currentRows.filter((row) => row.active === "true").length >= 1)
    for (const row of openState.currentRows) {
      assert.equal(row.current, row.active === "true" ? "location" : "", JSON.stringify(openState.currentRows))
      assert.equal(row.selected, "")
      assert.equal(row.pressed, "")
    }
    assert.ok(openState.geometry)
    assert.ok(openState.geometry.leftDelta <= 2)
    assert.ok(openState.geometry.panelWidth > 240)
    assert.ok(openState.geometry.panelWidth <= openState.geometry.shellWidth)
    assert.deepEqual(badResponses, [])

    await saveScreenshot(page, "task-dirbar-recent-trigger-keyboard.png")
  } finally {
    await browser.close()
    await server.close()
  }
}, { timeout: 60_000 })
