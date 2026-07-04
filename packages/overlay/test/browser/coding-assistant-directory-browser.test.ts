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

const TASK_ID = "tsk_directory_scoped_chat"
const TASK_DIRECTORY = "D:/overlay/workspace/current-task"
const OTHER_DIRECTORY = "D:/overlay/workspace/other-task"
const SESSION_ID = "ses_directory_scoped_assistant"

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

const task = {
  id: TASK_ID,
  title: "Directory scoped task",
  status: "active",
  directory: TASK_DIRECTORY,
  sessionID: "ses_task_root_directory_scoped",
  request: "verify coding assistant directory scope",
  time: { created: 1_782_000_000_000, updated: 1_782_000_100_000 },
  attachments: [],
}

const assistantSession = {
  id: SESSION_ID,
  kind: "assistant",
  title: "Current task assistant",
  directory: TASK_DIRECTORY,
  metadata: { codingAssistant: { surface: "right-sidebar" } },
  time: { created: 1_782_000_200_000, updated: 1_782_000_200_000 },
}

function taskConversationPayload() {
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: `board:${TASK_ID}`,
      task,
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { topLevelSessionIDs: [], sessions: [], messages: [] },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    messageWatermark: 0,
  }
}

function sessionConversationPayload() {
  return {
    board: {
      kind: "session",
      sessionID: SESSION_ID,
      status: "active",
      title: "Current task assistant",
      directory: TASK_DIRECTORY,
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { topLevelSessionIDs: [], sessions: [], messages: [] },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 0 },
    messageWatermark: 0,
  }
}

test(
  "Coding Assistant session list is scoped to the selected task directory",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const codingSessionQueries: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") return send({ version: "coding-assistant-directory" })
      if (path === "/global/projects/discover")
        return send({
          root: "D:/overlay/workspace",
          defaultDirectory: TASK_DIRECTORY,
          projects: [
            { directory: TASK_DIRECTORY, name: "current-task", marker: "package.json" },
            { directory: OTHER_DIRECTORY, name: "other-task", marker: "package.json" },
          ],
        })
      if (path === "/global/tasks") return send({ tasks: [{ task }] })
      if (path === `/task/${TASK_ID}/conversation`) return send(taskConversationPayload())
      if (path === `/task/${TASK_ID}/operator-model-context`)
        return send({ taskID: TASK_ID, sessionID: task.sessionID, agent: "orchestrator", model: null })
      if (path === `/task/${TASK_ID}/events` || path === "/task/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: url.searchParams.get("directory") || TASK_DIRECTORY })
      if (path === "/vcs")
        return send({
          branch: "directory-scope",
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
      if (path === "/expert-squad/catalog") return send(generalExpertSquadCatalog())
      if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send([])
      if (path === "/coding/sessions") {
        const directory = url.searchParams.get("directory") || ""
        codingSessionQueries.push(directory)
        return send({ sessions: directory === TASK_DIRECTORY ? [assistantSession] : [], nextCursor: null })
      }
      if (path === `/coding/session/${SESSION_ID}`) return send({ session: assistantSession })
      if (path === `/session/${SESSION_ID}/conversation`) return send(sessionConversationPayload())
      if (path === `/session/${SESSION_ID}/events`) {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page)
      await page.setViewport({ width: 1360, height: 820 })
      await page.evaluateOnNewDocument(
        (input: { serverUrl: string }) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_directory", "D:/overlay/workspace/other-task")
          localStorage.setItem("oc_saved_directory", "D:/overlay/workspace/other-task")
          localStorage.setItem("oc_workspace_task", "tsk_directory_scoped_chat")
          localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/current-task")
          localStorage.setItem("oc_server_url", input.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
        },
        { serverUrl: server.origin },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(
        (taskID) =>
          (window as any).boardStore?.selectedSource?.kind === "task" &&
          (window as any).boardStore.selectedSource.id === taskID,
        {},
        TASK_ID,
      )
      await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForSelector(`[data-ui="coding-assistant-row"][data-session-id="${SESSION_ID}"]`, {
        visible: true,
      })
      await page.waitForFunction(
        (sessionID) => (window as any).boardStore?.selectedSource?.id === sessionID,
        {},
        SESSION_ID,
      )

      assert.deepEqual(codingSessionQueries, [TASK_DIRECTORY])
      assert.equal(await page.$('[data-ui="coding-assistant-row"][data-session-id="ses_other_directory"]'), null)
      errors.assertNoUnexpectedErrors()

      const ledger = await page.$('[data-ui="coding-assistant-ledger"]')
      assert.ok(ledger)
      const screenshotPath = resolve(".scratch/coding-assistant-directory-filter.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      const screenshot = await ledger.screenshot({})
      assert.ok(screenshot.length > 0)
      writeFileSync(screenshotPath, screenshot)
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 60_000 },
)
