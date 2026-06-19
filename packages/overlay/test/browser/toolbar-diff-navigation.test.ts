import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_ID = "tsk_file_changes_filter"

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

const fileChangesFixture = [
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
  ...Array.from({ length: 4 }, (_, index) => ({
    file: `src/added-filter-${index + 1}.ts`,
    patch: "",
    additions: index + 1,
    deletions: 0,
    status: "added",
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    file: `src/deleted-filter-${index + 1}.ts`,
    patch: "",
    additions: 0,
    deletions: index + 1,
    status: "deleted",
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    file: `src/modified-filter-${index + 1}.ts`,
    patch: "",
    additions: index + 2,
    deletions: 1,
    status: "modified",
  })),
]

test("right toolbar Diff returns to the diff subview after the user switches to Changes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestLog: string[] = []
  const now = Date.now()
  const task = {
    id: TASK_ID,
    title: "File changes filter fixture",
    directory: "D:/overlay/workspace/app",
    status: "running",
    time: { created: now - 10_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "file-changes-filter-toolbar-board",
    task,
    changes: fileChangesFixture,
    interactions: [],
    goalWorkflows: [],
    lastSequence: 0,
  }
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${path}${url.search}`)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
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
    if (path === "/vcs/diff") return send(fileChangesFixture)
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
    if (path === `/task/${TASK_ID}/board`) return send(board, { headers: { etag: '"file-changes-filter-board"' } })
    if (path === `/task/${TASK_ID}/conversation`)
      return send({
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        agentView: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
        history: { hasMoreBefore: false },
        messageWatermark: null,
        lastSequence: 0,
      })
    if (path === `/task/${TASK_ID}/events`) return eventStream()
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
    await page.evaluate(async (taskID) => {
      await (window as any).loadTasks()
      await (window as any).selectTask(taskID)
    }, TASK_ID)
    await page.waitForFunction(
      (expectedCount) => ((window as any).boardStore?.board?.changes?.length ?? 0) === expectedCount,
      {},
      fileChangesFixture.length,
    )
    await page.waitForFunction(
      () =>
        typeof (window as any).openWorkspaceDiff === "function" &&
        document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "changes",
    )

    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      ;(window as any).openWorkspaceDiff({ filePath: "src/live-file.ts", goalRunID: "gr_diff_preview" })
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".file-changes-panel")?.dataset.activeView === "diff",
    )
    await page.waitForSelector('.diff-preview-panel .diff-row[data-kind="add"]')
    const diffTabPanelState = await page.$eval('[data-ui="file-changes-view-tab"][data-value="diff"]', (node) => {
      const tab = node as HTMLElement
      const controls = tab.getAttribute("aria-controls") ?? ""
      const panel = controls ? document.getElementById(controls) : null
      const box = panel?.getBoundingClientRect()
      return {
        role: tab.getAttribute("role") ?? "",
        selected: tab.getAttribute("aria-selected") ?? "",
        controls,
        tabID: tab.id,
        panelRole: panel?.getAttribute("role") ?? "",
        labelledby: panel?.getAttribute("aria-labelledby") ?? "",
        panelSelected: panel?.hasAttribute("data-selected") ?? false,
        panelActive: panel?.getAttribute("data-active") ?? null,
        panelVisible: Boolean(box && box.width > 0 && box.height > 0),
      }
    })
    assert.equal(diffTabPanelState.role, "tab")
    assert.equal(diffTabPanelState.selected, "true")
    assert.ok(diffTabPanelState.controls)
    assert.equal(diffTabPanelState.panelRole, "tabpanel")
    assert.equal(diffTabPanelState.labelledby, diffTabPanelState.tabID)
    assert.equal(diffTabPanelState.panelSelected, true)
    assert.equal(diffTabPanelState.panelActive, null)
    assert.equal(diffTabPanelState.panelVisible, true)

    await page.$eval('[data-ui="file-changes-view-tab"][data-value="changes"]', (node) =>
      (node as HTMLButtonElement).click(),
    )
    assert.equal(await page.$eval(".file-changes-panel", (node) => (node as HTMLElement).dataset.activeView), "changes")
    await page.waitForSelector('[data-ui="file-changes-status-filter-option"][data-status="added"]')
    const changesTabPanelState = await page.$eval('[data-ui="file-changes-view-tab"][data-value="changes"]', (node) => {
      const tab = node as HTMLElement
      const controls = tab.getAttribute("aria-controls") ?? ""
      const panel = controls ? document.getElementById(controls) : null
      const box = panel?.getBoundingClientRect()
      return {
        selected: tab.getAttribute("aria-selected") ?? "",
        controls,
        tabID: tab.id,
        panelRole: panel?.getAttribute("role") ?? "",
        labelledby: panel?.getAttribute("aria-labelledby") ?? "",
        panelSelected: panel?.hasAttribute("data-selected") ?? false,
        panelActive: panel?.getAttribute("data-active") ?? null,
        panelVisible: Boolean(box && box.width > 0 && box.height > 0),
      }
    })
    assert.equal(changesTabPanelState.selected, "true")
    assert.ok(changesTabPanelState.controls)
    assert.equal(changesTabPanelState.panelRole, "tabpanel")
    assert.equal(changesTabPanelState.labelledby, changesTabPanelState.tabID)
    assert.equal(changesTabPanelState.panelSelected, true)
    assert.equal(changesTabPanelState.panelActive, null)
    assert.equal(changesTabPanelState.panelVisible, true)

    const listboxSelectedState = await page.evaluate(() => {
      const selected = document.querySelector<HTMLElement>(".change-row[data-selected]")
      return {
        selectedCount: document.querySelectorAll(".change-row[data-selected]").length,
        falseSelectedCount: document.querySelectorAll('.change-row[data-selected="false"]').length,
        selectedAttrValue: selected?.getAttribute("data-selected") ?? "",
        selectedRole: selected?.getAttribute("role") ?? "",
        selectedAria: selected?.getAttribute("aria-selected") ?? "",
      }
    })
    assert.equal(listboxSelectedState.selectedCount, 1)
    assert.equal(listboxSelectedState.falseSelectedCount, 0)
    assert.equal(listboxSelectedState.selectedAttrValue, "")
    assert.equal(listboxSelectedState.selectedRole, "option")
    assert.equal(listboxSelectedState.selectedAria, "true")

    await page.focus(".change-row")
    const focusedRowBeforeKeyboard = await page.$eval(".change-row", (node) => ({
      active: document.activeElement === node,
      expanded: node.getAttribute("aria-expanded") ?? "",
    }))
    assert.deepEqual(focusedRowBeforeKeyboard, { active: true, expanded: "false" })

    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector(".change-row")?.getAttribute("aria-expanded") === "true")
    await page.waitForSelector(".change-inline-diff")
    const enterActivationState = await page.$eval(".change-row", (node) => ({
      active: document.activeElement === node,
      expanded: node.getAttribute("aria-expanded") ?? "",
      inlineDiffs: document.querySelectorAll(".change-inline-diff").length,
    }))
    assert.deepEqual(enterActivationState, { active: true, expanded: "true", inlineDiffs: 1 })

    const keyboardScreenshotPath = resolve(".scratch/file-changes-keyboard-row-focus.png")
    mkdirSync(dirname(keyboardScreenshotPath), { recursive: true })
    const keyboardChangesPanel = await page.$(".file-changes-panel")
    assert.ok(keyboardChangesPanel)
    writeFileSync(keyboardScreenshotPath, await keyboardChangesPanel.screenshot({}))

    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.querySelector(".change-row")?.getAttribute("aria-expanded") === "false")
    const spaceActivationState = await page.$eval(".change-row", (node) => ({
      active: document.activeElement === node,
      expanded: node.getAttribute("aria-expanded") ?? "",
      inlineDiffs: document.querySelectorAll(".change-inline-diff").length,
    }))
    assert.deepEqual(spaceActivationState, { active: true, expanded: "false", inlineDiffs: 0 })

    const initialFilterControlState = await page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>(".changes-status-strip")
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui="file-changes-status-filter-option"]'),
      ).map((node) => ({
        tag: node.tagName,
        className: node.className,
        status: node.dataset.status ?? "",
        dataPressed: node.hasAttribute("data-pressed"),
        ariaPressed: node.getAttribute("aria-pressed"),
      }))
      return {
        stripRole: strip?.getAttribute("role") ?? "",
        rawStatusChips: document.querySelectorAll(".changes-status-chip").length,
        options,
      }
    })
    assert.equal(initialFilterControlState.stripRole, "")
    assert.equal(initialFilterControlState.rawStatusChips, 0)
    assert.deepEqual(
      initialFilterControlState.options.map((item) => item.status),
      ["all", "modified", "added", "deleted"],
    )
    assert.equal(initialFilterControlState.options.every((item) => item.className.includes("oc-tab")), true)
    assert.equal(initialFilterControlState.options.find((item) => item.status === "all")?.dataPressed, true)

    await page.type(".changes-filter-input", "added-filter")
    await page.waitForSelector('[data-ui="file-changes-filter-clear"]')
    const clearFilterState = await page.$eval('[data-ui="file-changes-filter-clear"]', (node) => {
      const button = node as HTMLButtonElement
      const box = button.getBoundingClientRect()
      return {
        tag: button.tagName,
        className: button.className,
        dataChrome: button.dataset.chrome ?? "",
        ariaLabel: button.getAttribute("aria-label") ?? "",
        width: Math.round(box.width),
        height: Math.round(box.height),
      }
    })
    assert.equal(clearFilterState.tag, "BUTTON")
    assert.match(clearFilterState.className, /\boc-button\b/)
    assert.equal(clearFilterState.dataChrome, "icon-action")
    assert.ok(clearFilterState.ariaLabel)
    assert.ok(clearFilterState.width >= 20)
    assert.ok(clearFilterState.height >= 20)

    const filterScreenshotPath = resolve(".scratch/file-changes-filter-toolbar.png")
    mkdirSync(dirname(filterScreenshotPath), { recursive: true })
    const changesPanel = await page.$(".file-changes-panel")
    assert.ok(changesPanel)
    writeFileSync(filterScreenshotPath, await changesPanel.screenshot({}))

    await page.click('[data-ui="file-changes-filter-clear"]')
    const clearedFilterState = await page.$eval(".changes-filter-input", (node) => ({
      value: (node as HTMLInputElement).value,
      focused: document.activeElement === node,
    }))
    assert.deepEqual(clearedFilterState, { value: "", focused: true })

    await page.click('[data-ui="file-changes-status-filter-option"][data-status="added"]')
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-ui="file-changes-status-filter-option"][data-status="added"]')
          ?.hasAttribute("data-pressed") === true,
    )
    const addedFilterState = await page.evaluate(() => {
      const rowStatuses = Array.from(document.querySelectorAll<HTMLElement>(".change-row .change-status")).map(
        (node) => node.dataset.status ?? "",
      )
      return {
        activeAdded:
          document.querySelector<HTMLElement>('[data-ui="file-changes-status-filter-option"][data-status="added"]')
            ?.hasAttribute("data-pressed") ?? false,
        rowStatuses,
      }
    })
    assert.equal(addedFilterState.activeAdded, true)
    assert.ok(addedFilterState.rowStatuses.length > 0)
    assert.equal(addedFilterState.rowStatuses.every((status) => status === "added"), true)

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
        retiredWorkspaceNodes: oldSelectors.reduce(
          (count, selector) => count + document.querySelectorAll(selector).length,
          0,
        ),
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
          document.querySelectorAll<HTMLElement>(
            '.app-notification[data-tone="error"] .app-notification__details-body',
          ),
        ).map((node) => node.textContent?.trim() ?? ""),
      }
    })
    assert.deepEqual(visualState.retiredWorkspaceNodes, 0)
    assert.deepEqual(
      visualState.errorNotifications,
      [],
      JSON.stringify({ visualState, pageErrors, consoleErrors, requestLog }, null, 2),
    )
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
