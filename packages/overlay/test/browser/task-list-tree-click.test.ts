import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function scratchPath(name: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true })
  return resolve(SCRATCH_ROOT, name)
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function taskItem(id: string, title: string, created: number, parentTaskID?: string): any {
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: title, summary: title },
    task: {
      id,
      requestID: `req-${id}`,
      title,
      request: title,
      directory: "D:/tree-click/workspace",
      status: "queued",
      parentTaskID,
      metadata: parentTaskID ? { parent_task_id: parentTaskID } : {},
      queue: { order: created, revision: "rev-tree-click" },
      sessionID: `session-${id}`,
      time: { created, updated: created + 1 },
    },
  }
}

function boardForTask(item: any): any {
  return {
    task: item.task,
    overview: item.overview,
    goalWorkflows: [],
    interactions: [],
    lastSequence: 1,
    snapshotVersion: `snapshot-${item.task.id}`,
  }
}

const PROMPT_PROFILE_CATALOG = {
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

async function visibleTaskRows(page: any) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".task-row-main")).map((node) => ({
      id: node.dataset.taskId,
      current: node.getAttribute("aria-current"),
      text: node.textContent?.trim().slice(0, 80),
    })),
  )
}

async function waitForCurrentTask(page: any, taskID: string) {
  const selector = `.task-row-main[data-task-id="${taskID}"]`
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = await page.$eval(selector, (node: HTMLElement) => node.getAttribute("aria-current") || "")
    if (current === "page") return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const state = await visibleTaskRows(page)
  throw new Error(`Timed out waiting for selected task ${taskID}: ${JSON.stringify(state)}`)
}

test("task tree parent selection does not leave later task-row clicks trapped in the right-side chrome", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const requestLog: Array<{ method: string; path: string }> = []
  const parent = taskItem("task-parent", "Parent with children", 1_776_000_000_003)
  const child = taskItem("task-child", "Nested child", 1_776_000_000_002, "task-parent")
  const sibling = taskItem("task-sibling", "Sibling task", 1_776_000_000_001)
  const tasks = [parent, child, sibling]
  const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push({ method: req.method, path })
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "task-tree-click-test" })
    if (path === "/global/projects/discover") return send([])
    if (path === "/global/tasks") return send({ tasks })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/tree-click/workspace", exists: true, git: true })
    if (path === "/vcs") return send({ branch: "main", dirty: false })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config") {
      return send({
        server: {},
        provider: {},
        channel: {},
        mcp: {},
        model: "",
        directory: "D:/tree-click/workspace",
      })
    }
    if (path === "/config/prompt" || path === "/config/prompt-profile") return send(PROMPT_PROFILE_CATALOG)
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: 3, completed: 0, failed: 0 })
    if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
      return new Response(":\n\n", {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/mounts") {
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
    }
    if (path === "/skill/directories")
      return send({
        global_config: "D:/tree-click/config",
        managed_skills: "D:/tree-click/config/skills-market",
        remote_cache: "D:/tree-click/cache/skills",
      })
    if (path === "/skill/market") return send([])
    if (path === "/mcp") return send({})
    if (path === "/agent") return send([])
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
      const sessionID = tasksByID.get(taskID)?.task.sessionID || `session-${taskID}`
      return send({
        taskID,
        sessionID,
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
      return send({
        taskID,
        kind: "missing",
        status: "missing",
        projectRoot: "D:/tree-click/workspace",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    }
    if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
    if (/^\/task\/[^/]+\/cancel$/.test(path)) return send({ ok: true })
    const conversationMatch = /^\/task\/([^/]+)\/conversation$/.exec(path)
    if (conversationMatch) {
      const item = tasksByID.get(decodeURIComponent(conversationMatch[1])) ?? parent
      return send({
        board: boardForTask(item),
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
        messageWatermark: 0,
        lastSequence: 0,
      })
    }
    const boardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
    if (boardMatch) {
      const item = tasksByID.get(decodeURIComponent(boardMatch[1]))
      return item ? send(boardForTask(item)) : send({ error: "not found" }, 404)
    }
    return send({ error: `unhandled ${path}` }, 404)
  })

  const browser = await launchBrowser()
  const page = await browser.newPage()
  const errors = installBrowserErrorCollector(page)

  try {
    await page.evaluateOnNewDocument((origin) => {
      localStorage.setItem("oc_server_url", origin)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/tree-click/workspace")
      localStorage.setItem("oc_theme", "light")
    }, server.origin)
    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]', {
      visible: true,
    })
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.waitForSelector('.task-row-main[data-task-id="task-parent"]')

    const toggleSelector = '.task-row-mini[data-task-row-id="task-parent"] [data-ui="task-row-children-toggle"]'
    await page.waitForSelector(toggleSelector, { visible: true })
    await page.focus(toggleSelector)
    const toggleContract = await page.$eval(toggleSelector, (node: HTMLElement) => ({
      classList: Array.from(node.classList),
      variant: node.dataset.variant,
      size: node.dataset.size,
      tone: node.dataset.tone,
      expanded: node.getAttribute("aria-expanded"),
      draggable: node.getAttribute("draggable"),
    }))
    assert.ok(toggleContract.classList.includes("oc-button"))
    assert.equal(toggleContract.variant, "ghost")
    assert.equal(toggleContract.size, "mini")
    assert.equal(toggleContract.tone, "neutral")
    assert.equal(toggleContract.expanded, "false")
    assert.equal(toggleContract.draggable, "false")
    const taskListPanel = await page.$(".task-list-panel")
    assert.ok(taskListPanel)
    writeFileSync(scratchPath("task-row-children-toggle-focus.png"), await taskListPanel.screenshot({}))

    await page.keyboard.press("Enter")
    await page.waitForSelector('.task-row-main[data-task-id="task-child"]', { visible: true })
    assert.equal(await page.$eval(toggleSelector, (node: HTMLElement) => node.getAttribute("aria-expanded")), "true")
    await page.keyboard.press("Space")
    await page.waitForFunction(() => !document.querySelector('.task-row-main[data-task-id="task-child"]'))
    assert.equal(await page.$eval(toggleSelector, (node: HTMLElement) => node.getAttribute("aria-expanded")), "false")

    await page.click('.task-row-main[data-task-id="task-parent"]')
    await waitForCurrentTask(page, "task-parent")

    const siblingRowSelector = '.task-row-mini[data-task-row-id="task-sibling"]'
    const siblingMainSelector = `${siblingRowSelector} .task-row-main[data-task-id="task-sibling"]`
    const siblingActionsSelector = `${siblingRowSelector} .task-row-actions`
    await page.focus(siblingMainSelector)
    const hiddenActions = await page.$eval(siblingRowSelector, (row: HTMLElement) => {
      const actions = Array.from(row.querySelectorAll<HTMLElement>(".task-row-actions .oc-button"))
      return {
        open: row.getAttribute("data-actions-keyboard-open"),
        actionCount: actions.length,
        tabIndexes: actions.map((action) => action.getAttribute("tabindex")),
        opacities: actions.map((action) => getComputedStyle(action).opacity),
        activeInActions: row.querySelector(".task-row-actions")?.contains(document.activeElement) ?? false,
      }
    })
    assert.equal(hiddenActions.open, null)
    assert.ok(hiddenActions.actionCount > 0)
    assert.deepEqual(hiddenActions.tabIndexes, Array(hiddenActions.actionCount).fill("-1"))
    assert.equal(
      hiddenActions.opacities.every((value) => value === "0"),
      true,
    )
    assert.equal(hiddenActions.activeInActions, false)

    await page.keyboard.press("Tab")
    const skippedHiddenAction = await page.evaluate((selector) => {
      const row = document.querySelector(selector)
      const active = document.activeElement as HTMLElement | null
      return {
        activeDataUi: active?.dataset.ui ?? "",
        activeTaskID: active?.dataset.taskId ?? "",
        activeInSiblingActions: !!row?.querySelector(".task-row-actions")?.contains(active),
      }
    }, siblingRowSelector)
    assert.equal(skippedHiddenAction.activeInSiblingActions, false, JSON.stringify(skippedHiddenAction, null, 2))

    await page.focus(siblingMainSelector)
    await page.keyboard.press("ArrowRight")
    await new Promise((resolve) => setTimeout(resolve, 50))
    const arrowState = await page.evaluate((selector) => {
      const row = document.querySelector(selector)
      const active = document.activeElement as HTMLElement | null
      const main = row?.querySelector<HTMLElement>(".task-row-main")
      const actions = Array.from(row?.querySelectorAll<HTMLElement>(".task-row-actions .oc-button") ?? [])
      return {
        open: row?.getAttribute("data-actions-keyboard-open"),
        activeTag: active?.tagName ?? "",
        activeClass: active?.className ?? "",
        activeDataUi: active?.dataset.ui ?? "",
        activeTaskID: active?.dataset.taskId ?? "",
        mainFocused: active === main,
        actionCount: actions.length,
        tabIndexes: actions.map((action) => action.getAttribute("tabindex")),
      }
    }, siblingRowSelector)
    assert.equal(arrowState.open, "true", JSON.stringify(arrowState, null, 2))
    let keyboardAction = {
      open: "",
      activeDataUi: "",
      activeInSiblingActions: false,
      tabIndexes: [] as Array<string | null>,
      opacities: [] as string[],
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      keyboardAction = await page.evaluate((selector) => {
        const row = document.querySelector(selector)
        const active = document.activeElement as HTMLElement | null
        const actions = Array.from(row?.querySelectorAll<HTMLElement>(".task-row-actions .oc-button") ?? [])
        return {
          open: row?.getAttribute("data-actions-keyboard-open") ?? "",
          activeDataUi: active?.dataset.ui ?? "",
          activeInSiblingActions: !!row?.querySelector(".task-row-actions")?.contains(active),
          tabIndexes: actions.map((action) => action.getAttribute("tabindex")),
          opacities: actions.map((action) => getComputedStyle(action).opacity),
        }
      }, siblingRowSelector)
      if (
        keyboardAction.opacities.length > 0 &&
        keyboardAction.opacities.every((value) => Number.parseFloat(value) > 0.95)
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(keyboardAction.open, "true")
    assert.equal(keyboardAction.activeDataUi, "task-row-start-now")
    assert.equal(keyboardAction.activeInSiblingActions, true)
    assert.equal(
      keyboardAction.tabIndexes.every((value) => value === null),
      true,
    )
    assert.equal(
      keyboardAction.opacities.every((value) => Number.parseFloat(value) > 0.95),
      true,
    )
    assert.ok(taskListPanel)
    writeFileSync(scratchPath("task-row-actions-keyboard-open.png"), await taskListPanel.screenshot({}))

    await page.keyboard.press("Escape")
    const closedActionRail = await page.evaluate((selector) => {
      const row = document.querySelector(selector)
      const active = document.activeElement as HTMLElement | null
      const actions = Array.from(row?.querySelectorAll<HTMLElement>(".task-row-actions .oc-button") ?? [])
      return {
        open: row?.getAttribute("data-actions-keyboard-open"),
        activeTaskID: active?.dataset.taskId ?? "",
        activeInSiblingActions: !!row?.querySelector(".task-row-actions")?.contains(active),
        tabIndexes: actions.map((action) => action.getAttribute("tabindex")),
      }
    }, siblingRowSelector)
    assert.equal(closedActionRail.open, null)
    assert.equal(closedActionRail.activeTaskID, "task-sibling")
    assert.equal(closedActionRail.activeInSiblingActions, false)
    assert.deepEqual(closedActionRail.tabIndexes, Array(closedActionRail.tabIndexes.length).fill("-1"))

    await page.hover('.task-row-mini[data-task-row-id="task-sibling"]')
    const siblingHitPoint = await page.$eval('.task-row-main[data-task-id="task-sibling"]', (row) => {
      const rect = (row as HTMLElement).getBoundingClientRect()
      return { x: rect.right - 96, y: rect.top + rect.height / 2 }
    })
    const siblingHitTarget = await page.evaluate((point) => {
      const target = document.elementFromPoint(point.x, point.y)
      if (!(target instanceof Element)) return ""
      const row = target.closest<HTMLElement>(".task-row-mini, .task-row-main")
      return {
        target: `${target.tagName}.${target.className}`,
        rowID: row?.dataset.taskRowId || row?.dataset.taskId || "",
      }
    }, siblingHitPoint)
    await page.mouse.click(siblingHitPoint.x, siblingHitPoint.y)
    try {
      await waitForCurrentTask(page, "task-sibling")
    } catch (error) {
      const rows = await visibleTaskRows(page)
      throw new Error(
        `Sibling click did not select task; hit=${JSON.stringify(siblingHitTarget)} rows=${JSON.stringify(rows)}`,
        { cause: error },
      )
    }

    const siblingCancelSelector = '.task-row-mini[data-task-row-id="task-sibling"] [data-ui="task-row-cancel"]'
    await page.hover('.task-row-mini[data-task-row-id="task-sibling"]')
    await page.waitForSelector(siblingCancelSelector, { visible: true })
    const cancelHitTarget = await page.$eval(siblingCancelSelector, (button) => {
      const rect = (button as HTMLElement).getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return target instanceof Element ? (target.closest<HTMLElement>("[data-ui]")?.dataset.ui ?? "") : ""
    })
    assert.equal(cancelHitTarget, "task-row-cancel")
    await page.click(siblingCancelSelector)
    await page.hover('.task-row-mini[data-task-row-id="task-sibling"]')
    await page.waitForSelector(`${siblingCancelSelector}[data-confirm="true"]`, { visible: true })
    const cancelArmedState = await page.$eval(siblingCancelSelector, (button: HTMLElement) => {
      const descriptionID = button.getAttribute("aria-describedby") || ""
      return {
        confirm: button.dataset.confirm || "",
        pressed: button.getAttribute("aria-pressed") || "",
        describedBy: descriptionID,
        description: descriptionID ? document.getElementById(descriptionID)?.textContent?.trim() || "" : "",
        role: descriptionID ? document.getElementById(descriptionID)?.getAttribute("role") || "" : "",
        live: descriptionID ? document.getElementById(descriptionID)?.getAttribute("aria-live") || "" : "",
      }
    })
    assert.equal(cancelArmedState.confirm, "true")
    assert.equal(cancelArmedState.pressed, "true")
    assert.ok(cancelArmedState.describedBy)
    assert.match(cancelArmedState.description, /Press again within 3 seconds to cancel this task/)
    assert.equal(cancelArmedState.role, "status")
    assert.equal(cancelArmedState.live, "polite")
    assert.ok(taskListPanel)
    writeFileSync(scratchPath("task-row-cancel-armed-confirm.png"), await taskListPanel.screenshot({}))
    await page.click(`${siblingCancelSelector}[data-confirm="true"]`)
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (requestLog.some((entry) => entry.method === "POST" && entry.path === "/task/task-sibling/cancel")) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(
      requestLog.some((entry) => entry.method === "POST" && entry.path === "/task/task-sibling/cancel"),
      true,
    )
    assert.equal(
      requestLog.some((entry) => entry.path === "/global/tasks"),
      true,
      JSON.stringify(requestLog, null, 2),
    )
    assert.equal(
      requestLog.some((entry) => entry.path === "/tasks"),
      false,
      JSON.stringify(requestLog, null, 2),
    )

    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
