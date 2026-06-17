import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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

const promptProfileCatalog = {
  active: "general",
  project_active: "general",
  session_active: null,
  default: "general",
  targets: [],
  profiles: [
    {
      id: "general",
      label: "General",
      description: "Default prompt profile",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

test("right toolbar Diff returns to the diff subview after the user switches to Changes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestLog: string[] = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${path}${url.search}`)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send([])
    if (path === "/session") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
      return send({
        branch: "dev",
        clean: false,
        dirty: true,
        staged: 0,
        modified: 1,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/vcs/diff") {
      return send([
        {
          file: "src/live-file.ts",
          patch: [
            "Index: src/live-file.ts",
            "===================================================================",
            "--- src/live-file.ts",
            "+++ src/live-file.ts",
            "@@ -1,2 +1,3 @@",
            " export const value = 1;",
            "+export const next = 2;",
            " export const end = true;",
            "",
          ].join("\n"),
          additions: 1,
          deletions: 0,
          status: "modified",
        },
      ])
    }
    if (path === "/goal-run/gr_diff_preview/acceptance") {
      return send({
        result: {
          diffs: [
            {
              file: "src/live-file.ts",
              status: "modified",
              additions: 1,
              deletions: 0,
              before: "export const value = 1;\nexport const end = true;\n",
              after: "export const value = 1;\nexport const next = 2;\nexport const end = true;\n",
            },
          ],
        },
      })
    }
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [] })
    if (path === "/config") return send({ model: "" })
    if (path === "/config/prompt-profile") return send(promptProfileCatalog)
    if (path === "/terminal/profiles") {
      return send({
        defaultProfileID: "powershell",
        profiles: [{ id: "powershell", label: "PowerShell", icon: "powershell" }],
      })
    }
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/file") return send({ entries: [] })
    if (path === "/find/file") return send({ entries: [] })
    if (path === "/task/events") return eventStream()
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (item) => {
      const type = item.type()
      if (type === "error" || type === "warning") consoleErrors.push(`[${type}] ${item.text()}`)
    })
    page.on("pageerror", (error) => {
      pageErrors.push(`${error.message}\n${error.stack ?? ""}`)
    })
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.port)

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]')

    await page.evaluate(() => {
      ;(window as any).openWorkspaceDiff({ filePath: "src/live-file.ts", goalRunID: "gr_diff_preview" })
    })
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "diff",
    )
    await page.waitForSelector('.diff-preview-panel .diff-row[data-kind="add"]')

    await page.$eval('[data-ui="file-changes-view-tab"][data-value="changes"]', (node) =>
      (node as HTMLButtonElement).click(),
    )
    assert.equal(await page.$eval(".file-changes-panel", (node) => (node as HTMLElement).dataset.activeView), "changes")

    await page.$eval('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]', (node) =>
      (node as HTMLButtonElement).click(),
    )
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "diff" &&
        document.querySelector<HTMLElement>("#centerWorkbenchDiff")?.dataset.active === "true",
    )

    const state = await page.evaluate(() => ({
      centerDiff: document.querySelector<HTMLElement>("#centerWorkbenchDiff")?.dataset.active ?? "",
      toolbarDiff:
        document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]')
          ?.dataset.active ?? "",
      fileChangesView: document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView ?? "",
    }))
    assert.deepEqual(state, {
      centerDiff: "true",
      toolbarDiff: "true",
      fileChangesView: "diff",
    })

    await page.$$eval('[data-ui="app-notification-details-toggle"]', (nodes) => {
      for (const node of nodes) (node as HTMLButtonElement).click()
    })

    const visualState = await page.evaluate(() => {
      const oldSelectors = [
        ".workspace-mount",
        ".workspace-header",
        ".workspace-tabs",
        ".workspace-tab",
        ".workspace-view",
      ]
      const diffPanel = document.querySelector<HTMLElement>("#centerWorkbenchDiff")
      const closeButton = document.querySelector<HTMLElement>(
        '.file-changes-diff-header .oc-button[data-ui="file-changes-diff-close"]',
      )
      const previewPanel = document.querySelector<HTMLElement>(".diff-preview-panel")
      const rect = (node: HTMLElement | null) => {
        const box = node?.getBoundingClientRect()
        return box ? { width: box.width, height: box.height } : null
      }

      return {
        retiredWorkspaceNodes: oldSelectors.reduce((count, selector) => count + document.querySelectorAll(selector).length, 0),
        closeButtonTag: closeButton?.tagName ?? "",
        closeButtonBox: rect(closeButton),
        diffPanelBox: rect(diffPanel),
        previewPanelBox: rect(previewPanel),
        addRows: document.querySelectorAll('.diff-preview-panel .diff-row[data-kind="add"]').length,
        deleteRows: document.querySelectorAll('.diff-preview-panel .diff-row[data-kind="del"]').length,
        errorNotifications: Array.from(
          document.querySelectorAll<HTMLElement>('.app-notification[data-tone="error"] .app-notification__message'),
        ).map((node) => node.textContent?.trim() ?? ""),
        errorDetails: Array.from(
          document.querySelectorAll<HTMLElement>('.app-notification[data-tone="error"] .app-notification__details-body'),
        ).map((node) => node.textContent?.trim() ?? ""),
      }
    })
    assert.deepEqual(visualState.retiredWorkspaceNodes, 0)
    assert.deepEqual(visualState.errorNotifications, [], JSON.stringify({ visualState, pageErrors, consoleErrors, requestLog }, null, 2))
    assert.equal(visualState.closeButtonTag, "BUTTON")
    assert.ok((visualState.closeButtonBox?.width ?? 0) > 20)
    assert.ok((visualState.closeButtonBox?.height ?? 0) > 20)
    assert.ok((visualState.diffPanelBox?.width ?? 0) > 300)
    assert.ok((visualState.diffPanelBox?.height ?? 0) > 240)
    assert.ok((visualState.previewPanelBox?.width ?? 0) > 200)
    assert.ok((visualState.previewPanelBox?.height ?? 0) > 160)
    assert.ok(visualState.addRows > 0)
    assert.equal(visualState.deleteRows, 0)

    const screenshotPath = resolve(".scratch/workspace-diff-center-workbench.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const diffElement = await page.$("#centerWorkbenchDiff")
    assert.ok(diffElement)
    const screenshot = await diffElement.screenshot({})
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
  } finally {
    await browser.close()
    await server.close()
  }
})
