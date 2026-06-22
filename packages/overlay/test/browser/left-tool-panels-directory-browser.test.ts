import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const WORKSPACE_DIR = "D:/overlay/workspace/app"
const TASK_ID = "tsk_left_tool_panels"

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

test("left Skill, MCP, and Memory panels load from the active task directory", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestLog: Array<{ method: string; path: string; directory: string }> = []
  let memoryFiles = [
    {
      id: "mem_left_tool_panels",
      title: "Left panel memory loaded from selected task",
      scope: "cwd",
      source: "memory.md",
      timeUpdated: 1,
    },
  ]
  const memoryDetails: Record<string, unknown> = {
    mem_left_tool_panels: {
      file: {
        id: "mem_left_tool_panels",
        title: "Left panel memory loaded from selected task",
        scope: "cwd",
        source: "memory.md",
        timeCreated: 1,
        timeUpdated: 2,
      },
      content: "Remember that the left Memory panel uses sibling controls.",
    },
  }
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push({ method: req.method, path, directory: url.searchParams.get("directory") || "" })
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/tasks" || path === "/global/tasks")
      return send({
        tasks: [
          {
            task: {
              id: TASK_ID,
              title: "Left tool panels task",
              status: "active",
              directory: WORKSPACE_DIR,
              sessionID: "ses_left_tool_panels",
              time: { created: 1, updated: 2 },
            },
          },
        ],
      })
    if (path === `/task/${TASK_ID}/conversation`)
      return send({
        lastSequence: 1,
        board: {
          snapshotVersion: "board:left-tool-panels",
          task: {
            id: TASK_ID,
            title: "Left tool panels task",
            status: "active",
            directory: WORKSPACE_DIR,
            sessionID: "ses_left_tool_panels",
            time: { created: 1, updated: 2 },
          },
          goalWorkflows: [],
          interactions: [],
        },
        transcript: [],
        timeline: [],
        events: [],
        eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
        view: { sessions: [] },
        agentView: { sessions: [] },
      })
    if (path === `/task/${TASK_ID}/board`)
      return send({
        snapshotVersion: "board:left-tool-panels",
        task: {
          id: TASK_ID,
          title: "Left tool panels task",
          status: "active",
          directory: WORKSPACE_DIR,
          sessionID: "ses_left_tool_panels",
          time: { created: 1, updated: 2 },
        },
        goalWorkflows: [],
        interactions: [],
      })
    if (path === "/path") return send({ directory: WORKSPACE_DIR })
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
    if (path === "/config") return send({ model: "" })
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/session") return send([])
    if (path === "/coding/sessions") return send({ sessions: [] })
    if (path === "/skill/installed" || path === "/skill")
      return send([
        {
          name: "project-review",
          description: "Project skill loaded from the active workspace directory.",
          location: `${WORKSPACE_DIR}/.opencorvus/skills/project-review/SKILL.md`,
          builtin: false,
          duplicate_locations: [],
        },
      ])
    if (path === "/mcp") return send({ docs: { status: "connected" } })
    if (path === "/panel/knowledge/memory") {
      if (url.searchParams.get("directory") !== WORKSPACE_DIR || url.searchParams.get("taskID") !== TASK_ID) {
        return send({ error: "memory requires taskID and directory" }, { status: 400 })
      }
      return send(memoryFiles)
    }
    if (path.startsWith("/panel/knowledge/memory/")) {
      const id = decodeURIComponent(path.slice("/panel/knowledge/memory/".length))
      if (req.method === "GET") return send(memoryDetails[id])
      if (req.method === "DELETE") {
        memoryFiles = memoryFiles.filter((item) => item.id !== id)
        delete memoryDetails[id]
        return send({ ok: true })
      }
    }
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/file") return send({ entries: [] })
    if (path === "/find/file") return send({ entries: [] })
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 365 })
    await page.evaluateOnNewDocument(
      (input) => {
        const { serverUrl, directory } = input as { serverUrl: string; directory: string }
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_workspace_directory", directory)
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_workspace_task", TASK_ID)
      },
      { serverUrl: server.origin, directory: WORKSPACE_DIR },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.waitForSelector("#solidLeftActivityToolbar")
    await page.waitForFunction(() => (window as any).__overlayInitSettled === true)
    requestLog.length = 0
    assert.equal(requestLog.some((item) => item.path === "/skill/installed"), false)
    assert.equal(requestLog.some((item) => item.path === "/mcp"), false)

    const skillButton = '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]'
    await page.waitForSelector(skillButton, { visible: true })
    await page.click(skillButton)
    await page.waitForSelector("#leftPanelSkills[data-active='true'] .extension-settings-row")
    assert.equal(requestLog.some((item) => item.path === "/skill/installed"), true)
    assert.equal(requestLog.some((item) => item.path === "/mcp"), false)
    const skillName = await page.$eval(
      "#leftPanelSkills .extension-settings-row .s-row-title",
      (node) => node.textContent || "",
    )
    assert.equal(skillName, "project-review")
    const skillListMetrics = await page.$eval("#leftPanelSkills .extension-list", (node) => {
      const rect = node.getBoundingClientRect()
      return { height: rect.height, text: node.textContent || "" }
    })
    assert.ok(skillListMetrics.height > 24)
    assert.match(skillListMetrics.text, /project-review/)
    const skillPanel = await page.$("#leftPanelSkills")
    assert.ok(skillPanel, "skill panel should exist before screenshot")
    const skillScreenshotPath = resolve(".scratch", "left-skill-panel-primitive-row.png")
    mkdirSync(dirname(skillScreenshotPath), { recursive: true })
    writeFileSync(skillScreenshotPath, await skillPanel.screenshot({}))

    const mcpButton = '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]'
    await page.waitForSelector(mcpButton, { visible: true })
    await page.click(mcpButton)
    await page.waitForSelector("#leftPanelMcp[data-active='true'] .extension-settings-row")
    assert.equal(requestLog.some((item) => item.path === "/mcp"), true)
    const mcpName = await page.$eval(
      "#leftPanelMcp .extension-settings-row .s-row-title",
      (node) => node.textContent || "",
    )
    assert.equal(mcpName, "docs")
    const mcpListMetrics = await page.$eval("#leftPanelMcp .extension-list", (node) => {
      const rect = node.getBoundingClientRect()
      return { height: rect.height, text: node.textContent || "" }
    })
    assert.ok(mcpListMetrics.height > 24)
    assert.match(mcpListMetrics.text, /docs/)

    const memoryButton = '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]'
    await page.waitForSelector(memoryButton, { visible: true })
    await page.click(memoryButton)
    await page.waitForSelector("#leftPanelMemory[data-active='true'] .knowledge-item")
    const memoryName = await page.$eval("#leftPanelMemory .knowledge-item-title", (node) => node.textContent || "")
    assert.equal(memoryName, "Left panel memory loaded from selected task")
    const memoryStructure = await page.$eval("#leftPanelMemory .knowledge-item", (item) => {
      const row = item as HTMLElement
      const main = row.querySelector<HTMLElement>(".knowledge-item-main")!
      const del = row.querySelector<HTMLElement>('[data-action="delete-memory"]')!
      return {
        rowRole: row.getAttribute("role"),
        rowTabIndex: row.getAttribute("tabindex"),
        mainTag: main.tagName,
        mainExpanded: main.getAttribute("aria-expanded"),
        deleteInsideMain: main.contains(del),
      }
    })
    assert.deepEqual(memoryStructure, {
      rowRole: null,
      rowTabIndex: null,
      mainTag: "BUTTON",
      mainExpanded: "false",
      deleteInsideMain: false,
    })

    await page.focus("#leftPanelMemory .knowledge-item-main")
    await page.keyboard.press("Enter")
    await page.waitForSelector("#leftPanelMemory .memory-inline-detail")
    await page.waitForFunction(() =>
      /sibling controls/.test(document.querySelector("#leftPanelMemory .memory-inline-detail")?.textContent || ""),
    )
    const expandedState = await page.$eval("#leftPanelMemory .knowledge-item", (item) => {
      const row = item as HTMLElement
      const main = row.querySelector<HTMLElement>(".knowledge-item-main")!
      const detail = row.querySelector<HTMLElement>(".memory-inline-detail")!
      return {
        expanded: row.dataset.expanded,
        mainExpanded: main.getAttribute("aria-expanded"),
        controls: main.getAttribute("aria-controls"),
        detailId: detail.id,
        detailText: detail.textContent || "",
      }
    })
    assert.equal(expandedState.expanded, "true")
    assert.equal(expandedState.mainExpanded, "true")
    assert.equal(expandedState.controls, expandedState.detailId)
    assert.match(expandedState.detailText, /sibling controls/)

    await page.keyboard.press("Tab")
    const deleteFocused = await page.evaluate(() =>
      document.activeElement?.matches('#leftPanelMemory [data-action="delete-memory"]'),
    )
    assert.equal(deleteFocused, true)

    const memoryItem = await page.$("#leftPanelMemory .knowledge-item")
    assert.ok(memoryItem)
    const screenshotPath = resolve(".scratch", "memory-row-sibling-controls.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await memoryItem.screenshot({}))

    await page.keyboard.press("Enter")
    await page.waitForFunction(() => !document.querySelector("#leftPanelMemory .knowledge-item"))
    await page.waitForSelector("#leftPanelMemory .empty-hint")
    const deletedState = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("#leftPanelMemory")!
      const active = document.activeElement as HTMLElement | null
      return {
        itemCount: panel.querySelectorAll(".knowledge-item").length,
        emptyText: panel.querySelector<HTMLElement>(".empty-hint")?.textContent?.trim() || "",
        deleteStillFocused: active?.matches('#leftPanelMemory [data-action="delete-memory"]') ?? false,
      }
    })
    assert.equal(deletedState.itemCount, 0)
    assert.ok(deletedState.emptyText.length > 0)
    assert.equal(deletedState.deleteStillFocused, false)
    const deleteRequest = requestLog.find(
      (item) =>
        item.method === "DELETE" &&
        item.path === "/panel/knowledge/memory/mem_left_tool_panels" &&
        item.directory === WORKSPACE_DIR,
    )
    assert.ok(deleteRequest)

    const memoryPanel = await page.$("#leftPanelMemory")
    assert.ok(memoryPanel)
    const deletedScreenshotPath = resolve(".scratch", "memory-panel-delete-empty-state.png")
    mkdirSync(dirname(deletedScreenshotPath), { recursive: true })
    writeFileSync(deletedScreenshotPath, await memoryPanel.screenshot({}))

    const skillRequest = requestLog.find((item) => item.path === "/skill/installed")
    const mcpRequest = requestLog.find((item) => item.path === "/mcp")
    const memoryRequest = requestLog.find((item) => item.path === "/panel/knowledge/memory")
    assert.equal(skillRequest?.directory, WORKSPACE_DIR)
    assert.equal(mcpRequest?.directory, WORKSPACE_DIR)
    assert.equal(memoryRequest?.directory, WORKSPACE_DIR)
  } finally {
    await browser.close()
    await server.close()
  }
})
