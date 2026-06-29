import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIR = "D:/ledger/workspace"
const PROJECT_NAME = "Ledger Renamed Project"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function taskItem(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_100_000_000 + index
  const id = `ledger-task-${index}`
  return {
    updated_at: created + 10,
    pending_interactions: 0,
    overview: {
      headline: `Ledger task ${index}`,
      summary: "Project group browser fixture task.",
    },
    task: {
      id,
      requestID: `req-${id}`,
      title: `Ledger task ${index}`,
      request: `Review project group ${index}`,
      directory,
      status: "queued",
      priority: "normal",
      queue: { order: index },
      sessionID: `session-${id}`,
      time: {
        created,
        updated: created + 10,
      },
    },
    project: {
      id: "project-ledger-browser",
      name: PROJECT_NAME,
      worktree: directory,
    },
  }
}

function missionRecord(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_200_000_000 + index
  return {
    missionID: `ledger-mission-${index}`,
    sessionID: `ledger-mission-session-${index}`,
    title: `Ledger mission ${index}`,
    directory,
    created,
    updated: created + 10,
    interruptible: true,
    tasks: [],
    taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  }
}

function codingAssistantSession(index: number, directory = PROJECT_DIR): any {
  const created = 1_776_300_000_000 + index
  return {
    id: `ledger-assistant-session-${index}`,
    kind: "coding-assistant",
    title: `Ledger assistant ${index}`,
    directory,
    metadata: null,
    time: {
      created,
      updated: created + 10,
    },
  }
}

const tasks = [taskItem(1), taskItem(2)]
const missions = [missionRecord(1), missionRecord(2)]
const sessions = [codingAssistantSession(1), codingAssistantSession(2)]
const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
const sessionsByID = new Map(sessions.map((session) => [session.id, session]))

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

async function saveElementScreenshot(page: OverlayPage, selector: string, filename: string) {
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const target = resolve(".scratch", filename)
  mkdirSync(dirname(target), { recursive: true })
  const screenshot = await element.screenshot({})
  assert.ok(screenshot.length > 0, `${filename} screenshot should not be empty`)
  writeFileSync(target, screenshot)
  return target
}

async function verifyProjectGroup(
  page: OverlayPage,
  input: {
    activity: "tasks" | "mission" | "assistant"
    groupSelector: string
    expectedCount: string
    expectedName?: string
    expectedProjectActions: boolean
    screenshot: string
    requestLog?: string[]
  },
) {
  await page.click(`[data-ui="side-activity-button"][data-side="left"][data-activity="${input.activity}"]`)
  try {
    await page.waitForSelector(`${input.groupSelector} [data-ui="project-group-toggle"]`, {
      visible: true,
      timeout: 10_000,
    })
  } catch (error) {
    const diagnostics = await page.evaluate(
      (requestLog) => ({
        selectedLeftActivity: (window as any).selectedLeftPanelActivity?.(),
        taskCount: ((window as any).boardStore?.tasks || []).length,
        tasksLoaded: (window as any).boardStore?.tasksLoaded,
        tasksError: (window as any).boardStore?.tasksError,
        leftPanels: Array.from(document.querySelectorAll<HTMLElement>("[id^='leftPanel']")).map((item) => ({
          id: item.id,
          active: item.dataset.active || "",
          groupCount: item.querySelectorAll(".project-group").length,
          text: item.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) || "",
        })),
        requestLog,
      }),
      input.requestLog || [],
    )
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics, null, 2)}`,
    )
  }

  const openState = await page.$eval(input.groupSelector, (node) => {
    const group = node as HTMLElement
    const heading = group.querySelector<HTMLButtonElement>('[data-ui="project-group-toggle"]')
    const copyButton = group.querySelector<HTMLButtonElement>('[data-ui="project-group-copy"]')
    const renameButton = group.querySelector<HTMLButtonElement>('[data-ui="project-group-rename"]')
    const deleteButton = group.querySelector<HTMLButtonElement>('[data-ui="project-group-delete"]')
    const actions = group.querySelector<HTMLElement>(".project-group-actions")
    const body = group.querySelector<HTMLElement>(".project-group-body")
    const actionStyle = actions ? window.getComputedStyle(actions) : null
    const count = group.querySelector<HTMLElement>(".project-group-count")
    const chevron = group.querySelector<HTMLElement>(".project-group-chevron")
    const countStyle = count ? window.getComputedStyle(count) : null
    const chevronStyle = chevron ? window.getComputedStyle(chevron) : null
    const headingControls = heading?.getAttribute("aria-controls") ?? ""
    const headingRect = heading?.getBoundingClientRect()
    const copyRect = copyButton?.getBoundingClientRect()
    const renameRect = renameButton?.getBoundingClientRect()
    const deleteRect = deleteButton?.getBoundingClientRect()
    const copyIconRect = copyButton?.querySelector("svg")?.getBoundingClientRect()
    const renameIconRect = renameButton?.querySelector("svg")?.getBoundingClientRect()
    const deleteIconRect = deleteButton?.querySelector("svg")?.getBoundingClientRect()
    return {
      tag: group.tagName,
      className: group.className,
      collapsed: group.dataset.collapsed ?? "",
      projectActions: group.dataset.projectActions ?? "",
      headingTag: heading?.tagName ?? "",
      headingClass: heading?.className ?? "",
      headingVariant: heading?.dataset.variant ?? "",
      headingSize: heading?.dataset.size ?? "",
      headingTone: heading?.dataset.tone ?? "",
      actionsExists: !!actions,
      actionsOpacity: actionStyle?.opacity ?? "",
      actionsVisibility: actionStyle?.visibility ?? "",
      actionsPointerEvents: actionStyle?.pointerEvents ?? "",
      copyExists: !!copyButton,
      copyInsideActions: !!actions?.contains(copyButton),
      copyInsideToggle: !!heading?.querySelector('[data-ui="project-group-copy"]'),
      copyTag: copyButton?.tagName ?? "",
      copyVariant: copyButton?.dataset.variant ?? "",
      copySize: copyButton?.dataset.size ?? "",
      copyTone: copyButton?.dataset.tone ?? "",
      copyChrome: copyButton?.dataset.chrome ?? "",
      copyLabel: copyButton?.getAttribute("aria-label") ?? "",
      copyWidth: copyRect?.width ?? 0,
      copyHeight: copyRect?.height ?? 0,
      copyIconWidth: copyIconRect?.width ?? 0,
      copyIconHeight: copyIconRect?.height ?? 0,
      copyNearHeaderEnd: !!headingRect && !!copyRect && copyRect.left >= headingRect.right - 70,
      renameExists: !!renameButton,
      renameInsideActions: !!actions?.contains(renameButton),
      renameInsideToggle: !!heading?.querySelector('[data-ui="project-group-rename"]'),
      renameTag: renameButton?.tagName ?? "",
      renameVariant: renameButton?.dataset.variant ?? "",
      renameSize: renameButton?.dataset.size ?? "",
      renameTone: renameButton?.dataset.tone ?? "",
      renameChrome: renameButton?.dataset.chrome ?? "",
      renameLabel: renameButton?.getAttribute("aria-label") ?? "",
      renameWidth: renameRect?.width ?? 0,
      renameHeight: renameRect?.height ?? 0,
      renameIconWidth: renameIconRect?.width ?? 0,
      renameIconHeight: renameIconRect?.height ?? 0,
      renameAfterCopy: !!copyRect && !!renameRect && renameRect.left >= copyRect.right - 0.5,
      deleteExists: !!deleteButton,
      deleteInsideActions: !!actions?.contains(deleteButton),
      deleteInsideToggle: !!heading?.querySelector('[data-ui="project-group-delete"]'),
      deleteTag: deleteButton?.tagName ?? "",
      deleteClass: deleteButton?.className ?? "",
      deleteVariant: deleteButton?.dataset.variant ?? "",
      deleteSize: deleteButton?.dataset.size ?? "",
      deleteTone: deleteButton?.dataset.tone ?? "",
      deleteChrome: deleteButton?.dataset.chrome ?? "",
      deleteLabel: deleteButton?.getAttribute("aria-label") ?? "",
      deletePressed: deleteButton?.getAttribute("aria-pressed") ?? "",
      deleteVisible: !!deleteButton && deleteButton.getClientRects().length > 0,
      deleteWidth: deleteRect?.width ?? 0,
      deleteHeight: deleteRect?.height ?? 0,
      deleteIconWidth: deleteIconRect?.width ?? 0,
      deleteIconHeight: deleteIconRect?.height ?? 0,
      deleteAfterRename: !!renameRect && !!deleteRect && deleteRect.left >= renameRect.right - 0.5,
      headingExpanded: heading?.getAttribute("aria-expanded") ?? "",
      headingControls,
      headingLabel: heading?.getAttribute("aria-label") ?? "",
      headingTabIndex: heading?.tabIndex ?? null,
      name: group.querySelector<HTMLElement>(".project-group-name")?.textContent?.trim() ?? "",
      count: count?.textContent?.trim() ?? "",
      countOpacity: countStyle?.opacity ?? "",
      chevronOpacity: chevronStyle?.opacity ?? "",
      bodyID: body?.id ?? "",
      bodyMatchesControls:
        !!headingControls && body?.id === headingControls && document.getElementById(headingControls) === body,
      bodyVisible: !!body && body.getClientRects().length > 0,
    }
  })

  assert.equal(openState.tag, "SECTION")
  assert.match(openState.className, /\bproject-group\b/)
  assert.equal(openState.collapsed, "")
  assert.equal(openState.headingTag, "BUTTON")
  assert.equal(openState.headingClass, "oc-button")
  assert.equal(openState.headingVariant, "ghost")
  assert.equal(openState.headingSize, "mini")
  assert.equal(openState.headingTone, "neutral")
  assert.equal(openState.actionsExists, true)
  assert.equal(openState.projectActions, input.expectedProjectActions ? "true" : "")
  assert.equal(openState.copyExists, input.expectedProjectActions)
  assert.equal(openState.copyInsideToggle, false)
  assert.equal(openState.renameExists, input.expectedProjectActions)
  assert.equal(openState.renameInsideToggle, false)
  assert.equal(openState.deleteExists, input.expectedProjectActions)
  assert.equal(openState.deleteInsideToggle, false)
  if (input.expectedProjectActions) {
    assert.equal(openState.copyTag, "BUTTON")
    assert.equal(openState.actionsOpacity, "0")
    assert.equal(openState.actionsVisibility, "hidden")
    assert.equal(openState.actionsPointerEvents, "none")
    assert.equal(openState.copyInsideActions, true)
    assert.equal(openState.copyVariant, "ghost")
    assert.equal(openState.copySize, "icon")
    assert.equal(openState.copyTone, "neutral")
    assert.equal(openState.copyChrome, "icon-action")
    assert.match(openState.copyLabel, /Copy project directory/)
    assert.ok(openState.copyWidth <= 20, `copy width should be compact, got ${openState.copyWidth}`)
    assert.ok(openState.copyHeight <= 20, `copy height should be compact, got ${openState.copyHeight}`)
    assert.ok(Math.abs(openState.copyWidth - openState.copyHeight) <= 0.5)
    assert.ok(openState.copyIconWidth <= 11, `copy icon should be compact, got ${openState.copyIconWidth}`)
    assert.ok(openState.copyIconHeight <= 11, `copy icon should be compact, got ${openState.copyIconHeight}`)
    assert.equal(openState.copyNearHeaderEnd, true)
    assert.equal(openState.renameTag, "BUTTON")
    assert.equal(openState.renameInsideActions, true)
    assert.equal(openState.renameVariant, "ghost")
    assert.equal(openState.renameSize, "icon")
    assert.equal(openState.renameTone, "neutral")
    assert.equal(openState.renameChrome, "icon-action")
    assert.match(openState.renameLabel, /Rename project/)
    assert.ok(openState.renameWidth <= 20, `rename width should be compact, got ${openState.renameWidth}`)
    assert.ok(openState.renameHeight <= 20, `rename height should be compact, got ${openState.renameHeight}`)
    assert.ok(Math.abs(openState.renameWidth - openState.renameHeight) <= 0.5)
    assert.ok(openState.renameIconWidth <= 11, `rename icon should be compact, got ${openState.renameIconWidth}`)
    assert.ok(openState.renameIconHeight <= 11, `rename icon should be compact, got ${openState.renameIconHeight}`)
    assert.equal(openState.renameAfterCopy, true)
    assert.equal(openState.deleteTag, "BUTTON")
    assert.equal(openState.deleteInsideActions, true)
    assert.equal(openState.deleteClass, "oc-button")
    assert.equal(openState.deleteVariant, "ghost")
    assert.equal(openState.deleteSize, "icon")
    assert.equal(openState.deleteTone, "danger")
    assert.equal(openState.deleteChrome, "icon-action")
    assert.match(openState.deleteLabel, /Delete this project/)
    assert.equal(openState.deletePressed, "false")
    assert.equal(openState.deleteVisible, true)
    assert.ok(openState.deleteWidth <= 20, `delete width should be compact, got ${openState.deleteWidth}`)
    assert.ok(openState.deleteHeight <= 20, `delete height should be compact, got ${openState.deleteHeight}`)
    assert.ok(Math.abs(openState.deleteWidth - openState.deleteHeight) <= 0.5)
    assert.ok(openState.deleteIconWidth <= 11, `delete icon should be compact, got ${openState.deleteIconWidth}`)
    assert.ok(openState.deleteIconHeight <= 11, `delete icon should be compact, got ${openState.deleteIconHeight}`)
    assert.equal(openState.deleteAfterRename, true)
  }
  assert.equal(openState.headingExpanded, "true")
  assert.ok(openState.headingControls.length > 0)
  assert.ok(openState.headingLabel.length > 0)
  assert.equal(openState.headingTabIndex, 0)
  if (input.expectedName) assert.equal(openState.name, input.expectedName)
  assert.equal(openState.count, input.expectedCount)
  assert.equal(openState.countOpacity, "1")
  assert.equal(openState.chevronOpacity, "1")
  assert.equal(openState.bodyID, openState.headingControls)
  assert.equal(openState.bodyMatchesControls, true)
  assert.equal(openState.bodyVisible, true)

  if (input.expectedProjectActions) {
    await page.hover(`${input.groupSelector} .project-group-head`)
    await page.waitForFunction(
      (selector) => {
        const actions = document.querySelector<HTMLElement>(`${selector} .project-group-actions`)
        if (!actions) return false
        const style = window.getComputedStyle(actions)
        return style.visibility === "visible" && Number(style.opacity) > 0.95
      },
      { timeout: 5_000 },
      input.groupSelector,
    )
    const hoverState = await page.$eval(input.groupSelector, (node) => {
      const group = node as HTMLElement
      const actions = group.querySelector<HTMLElement>(".project-group-actions")
      const count = group.querySelector<HTMLElement>(".project-group-count")
      const chevron = group.querySelector<HTMLElement>(".project-group-chevron")
      const actionStyle = actions ? window.getComputedStyle(actions) : null
      const countStyle = count ? window.getComputedStyle(count) : null
      const chevronStyle = chevron ? window.getComputedStyle(chevron) : null
      return {
        actionsOpacity: actionStyle?.opacity ?? "",
        actionsVisibility: actionStyle?.visibility ?? "",
        actionsPointerEvents: actionStyle?.pointerEvents ?? "",
        countOpacity: countStyle?.opacity ?? "",
        chevronOpacity: chevronStyle?.opacity ?? "",
      }
    })
    assert.ok(Number(hoverState.actionsOpacity) > 0.95)
    assert.equal(hoverState.actionsVisibility, "visible")
    assert.equal(hoverState.actionsPointerEvents, "auto")
    assert.ok(Number(hoverState.countOpacity) < 0.05)
    assert.ok(Number(hoverState.chevronOpacity) < 0.05)
    await page.mouse.move(0, 0)
    await page.waitForFunction(
      (selector) => {
        const actions = document.querySelector<HTMLElement>(`${selector} .project-group-actions`)
        if (!actions) return false
        const style = window.getComputedStyle(actions)
        return style.visibility === "hidden" && Number(style.opacity) < 0.05
      },
      { timeout: 5_000 },
      input.groupSelector,
    )
  }

  await page.focus(`${input.groupSelector} [data-ui="project-group-toggle"]`)
  if (input.expectedProjectActions) {
    await page.waitForFunction(
      (selector) => {
        const actions = document.querySelector<HTMLElement>(`${selector} .project-group-actions`)
        if (!actions) return false
        const style = window.getComputedStyle(actions)
        return style.visibility === "visible" && Number(style.opacity) > 0.95
      },
      { timeout: 5_000 },
      input.groupSelector,
    )
    const focusState = await page.$eval(input.groupSelector, (node) => {
      const actions = (node as HTMLElement).querySelector<HTMLElement>(".project-group-actions")
      const style = actions ? window.getComputedStyle(actions) : null
      return {
        actionsOpacity: style?.opacity ?? "",
        actionsVisibility: style?.visibility ?? "",
      }
    })
    assert.ok(Number(focusState.actionsOpacity) > 0.95)
    assert.equal(focusState.actionsVisibility, "visible")
  }
  await page.keyboard.press("Enter")
  await page.waitForFunction(
    (selector) => document.querySelector<HTMLElement>(selector)?.dataset.collapsed === "true",
    { timeout: 5_000 },
    input.groupSelector,
  )
  const collapsedState = await page.$eval(input.groupSelector, (node) => {
    const group = node as HTMLElement
    return {
      expanded:
        group.querySelector<HTMLButtonElement>('[data-ui="project-group-toggle"]')?.getAttribute("aria-expanded") ?? "",
      controls:
        group.querySelector<HTMLButtonElement>('[data-ui="project-group-toggle"]')?.getAttribute("aria-controls") ?? "",
      bodyCount: group.querySelectorAll(".project-group-body").length,
    }
  })
  assert.deepEqual(collapsedState, { expanded: "false", controls: "", bodyCount: 0 })

  await page.focus(`${input.groupSelector} [data-ui="project-group-toggle"]`)
  await page.keyboard.press(" ")
  await page.waitForFunction(
    (selector) => document.querySelector<HTMLElement>(selector)?.dataset.collapsed !== "true",
    { timeout: 5_000 },
    input.groupSelector,
  )
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.mouse.move(0, 0)
  if (input.expectedProjectActions) {
    await page.waitForFunction(
      (selector) => {
        const actions = document.querySelector<HTMLElement>(`${selector} .project-group-actions`)
        if (!actions) return false
        const style = window.getComputedStyle(actions)
        return style.visibility === "hidden" && Number(style.opacity) < 0.05
      },
      { timeout: 5_000 },
      input.groupSelector,
    )
  }
  await saveElementScreenshot(page, input.groupSelector, input.screenshot)
}

test(
  "project ledger grouping is shared across Task, Mission, and Coding Assistant ledgers",
  { timeout: 90_000 },
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const requestLog: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${path}${url.search}`)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })

      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse

      if (path === "/global/health") return json({ version: "project-ledger-group-test" })
      if (path === "/global/projects/discover") {
        return json({ root: "D:/ledger", defaultDirectory: PROJECT_DIR, projects: [] })
      }
      if (path === "/global/tasks") return json({ tasks })
      if (path === "/mission") return json(missions)
      if (path === "/coding/sessions") return json({ sessions, nextCursor: null })
      if (path === "/log") return json({})
      if (path === "/log/tail") return json({ path: "D:/overlay/logs/server.log", lines: [] })
      if (path === "/executor") return json([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return json({ profiles: [] })
      if (path === "/path") return json({ directory: PROJECT_DIR, exists: true, git: true })
      if (path === "/project/current/worktrees") return json({ worktrees: [] })
      if (path === "/vcs") return json({ branch: "coding-assistant", dirty: false })
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config") {
        return json({
          server: {},
          provider: {},
          channel: {},
          mcp: {},
          model: "",
          directory: PROJECT_DIR,
        })
      }
      if (path === "/config/prompt" || path === "/config/prompt-profile") {
        return json({
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
        })
      }
      if (path === "/channel") return json([])
      if (path === "/channel/runtime") return json({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return json({ active: 0, queued: tasks.length, completed: 0, failed: 0 })
      if (path === "/skill/installed" || path === "/skill") return json([])
      if (path === "/skill/mounts")
        return json({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
      if (path === "/skill/directories") {
        return json({
          global_config: "D:/ledger/config",
          managed_skills: "D:/ledger/config/skills-market",
          remote_cache: "D:/ledger/cache",
        })
      }
      if (path === "/skill/market") return json([])
      if (path === "/mcp") return json({})
      if (path === "/agent") return json([])
      if (path === "/file") return json([])
      if (path === "/panel/knowledge/memory") return json([])
      if (path === "/panel/knowledge/preference") return json([])
      if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
        const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
        const item = tasksByID.get(taskID) || tasks[0]
        return json({
          taskID,
          sessionID: item.task.sessionID,
          agent: "orchestrator",
          model: { providerID: "openai", modelID: "gpt-4o-mini" },
        })
      }
      if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
        const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
        return json({
          taskID,
          kind: "missing",
          status: "missing",
          projectRoot: PROJECT_DIR,
          viewports: [],
          diagnostics: [],
          candidates: [],
          source: "none",
        })
      }
      const taskBoardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
      if (taskBoardMatch) {
        const item = tasksByID.get(decodeURIComponent(taskBoardMatch[1]))
        return item ? json(boardForTask(item)) : json({ error: "task not found" }, 404)
      }
      if (/^\/task\/[^/]+\/conversation$/.test(path)) {
        const taskID = decodeURIComponent(path.split("/")[2] || "")
        const item = tasksByID.get(taskID) || tasks[0]
        return json({
          board: boardForTask(item),
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 100 },
          messageWatermark: 0,
          lastSequence: 0,
        })
      }
      const codingSessionMatch = /^\/coding\/session\/([^/]+)$/.exec(path)
      if (codingSessionMatch) {
        const session = sessionsByID.get(decodeURIComponent(codingSessionMatch[1]))
        return session ? json({ session }) : json({ error: "session not found" }, 404)
      }
      if (/^\/session\/[^/]+\/conversation$/.test(path)) {
        const sessionID = decodeURIComponent(path.split("/")[2] || "")
        const session = sessionsByID.get(sessionID)
        return json({
          board: {
            kind: "session",
            sessionID,
            status: "active",
            title: session?.title ?? null,
            directory: session?.directory ?? PROJECT_DIR,
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
          history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
          messageWatermark: 0,
          lastSequence: 0,
        })
      }
      if (/^\/session\/[^/]+\/events$/.test(path)) {
        return new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        })
      }
      if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
        return new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        })
      }

      return json({ error: `unhandled ${path}` }, 404)
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const badResponses: string[] = []

    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) consoleErrors.push(msg.text())
    })
    page.on("pageerror", (error) => consoleErrors.push(error.message))
    page.on("requestfailed", (request) => {
      if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      if (/\/session\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      failedRequests.push(request.url())
    })
    page.on("response", (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })

    try {
      await page.setViewport({ width: 1180, height: 760 })
      await page.evaluateOnNewDocument((origin) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "true")
        localStorage.setItem("oc_directory", "D:/ledger/workspace")
        localStorage.setItem("oc_workspace_directory", "D:/ledger/workspace")
        localStorage.setItem("oc_directory_mode", "custom")
        localStorage.setItem("oc_theme", "light")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")

      await verifyProjectGroup(page, {
        activity: "tasks",
        groupSelector: "#leftPanelTasks .project-group",
        expectedCount: "2",
        expectedName: PROJECT_NAME,
        expectedProjectActions: true,
        screenshot: "project-ledger-group-tasks.png",
        requestLog,
      })
      await verifyProjectGroup(page, {
        activity: "mission",
        groupSelector: '[data-ui="mission-project-group"]',
        expectedCount: "2",
        expectedProjectActions: false,
        screenshot: "project-ledger-group-mission.png",
        requestLog,
      })
      await verifyProjectGroup(page, {
        activity: "assistant",
        groupSelector: '[data-ui="coding-assistant-project-group"]',
        expectedCount: "2",
        expectedProjectActions: false,
        screenshot: "project-ledger-group-coding-assistant.png",
        requestLog,
      })
      await page.setViewport({ width: 390, height: 720 })
      await verifyProjectGroup(page, {
        activity: "tasks",
        groupSelector: "#leftPanelTasks .project-group",
        expectedCount: "2",
        expectedName: PROJECT_NAME,
        expectedProjectActions: true,
        screenshot: "project-ledger-group-tasks-mobile.png",
        requestLog,
      })

      assert.deepEqual(
        { consoleErrors, failedRequests, badResponses },
        { consoleErrors: [], failedRequests: [], badResponses: [] },
      )
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
)
