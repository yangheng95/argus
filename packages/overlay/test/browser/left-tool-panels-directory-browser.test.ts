import assert from "node:assert/strict"
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

  const requestLog: Array<{ path: string; directory: string }> = []
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push({ path, directory: url.searchParams.get("directory") || "" })
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
      return send([
        {
          id: "mem_left_tool_panels",
          title: "Left panel memory loaded from selected task",
          scope: "cwd",
          source: "memory.md",
          timeUpdated: 1,
        },
      ])
    }
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/file") return send({ entries: [] })
    if (path === "/find/file") return send({ entries: [] })
    return send({})
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument((input) => {
      const { serverUrl, directory } = input as { serverUrl: string; directory: string }
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      localStorage.setItem("oc_directory", directory)
      localStorage.setItem("oc_workspace_directory", directory)
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_workspace_task", TASK_ID)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, { serverUrl: server.origin, directory: WORKSPACE_DIR })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.waitForSelector("#solidLeftActivityToolbar")
    await page.waitForFunction(() => (window as any).__overlayInitSettled === true)

    await page.$eval(
      '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]',
      (node) => (node as HTMLButtonElement).click(),
    )
    await page.waitForSelector("#leftPanelSkills[data-active='true'] .extension-row")
    const skillName = await page.$eval(
      "#leftPanelSkills .extension-row .extension-row-main > strong",
      (node) => node.textContent || "",
    )
    assert.equal(skillName, "project-review")

    await page.$eval(
      '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]',
      (node) => (node as HTMLButtonElement).click(),
    )
    await page.waitForSelector("#leftPanelMcp[data-active='true'] .extension-row")
    const mcpName = await page.$eval("#leftPanelMcp .extension-row .extension-row-main > strong", (node) => node.textContent || "")
    assert.equal(mcpName, "docs")

    await page.$eval(
      '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]',
      (node) => (node as HTMLButtonElement).click(),
    )
    await page.waitForSelector("#leftPanelMemory[data-active='true'] .knowledge-item")
    const memoryName = await page.$eval("#leftPanelMemory .knowledge-item-title", (node) => node.textContent || "")
    assert.equal(memoryName, "Left panel memory loaded from selected task")

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
