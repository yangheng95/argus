import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser, type OverlayPage } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const PROJECT_DIR = "D:/ledger/workspace"
const CREATED_SESSION_ID = "ses_project_directory_new_chat"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

async function waitForLog(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  message: () => string | Promise<string>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(await message())
}

function taskRow(): any {
  return {
    kind: "task",
    id: "task-project-directory-row",
    title: "Existing project task",
    directory: PROJECT_DIR,
    created: 1_776_400_000_000,
    updated: 1_776_400_000_100,
    lifecycleStatus: "completed",
    executionStatus: "completed",
    priority: "normal",
    source: "project-directory-new-chat-test",
  }
}

function sessionRow(id = CREATED_SESSION_ID): any {
  return {
    id,
    kind: "coding-assistant",
    title: "New project chat",
    directory: PROJECT_DIR,
    metadata: null,
    time: {
      created: 1_776_400_000_200,
      updated: 1_776_400_000_200,
    },
  }
}

function workLedgerRows(createdSession: any | null): any[] {
  const rows = [taskRow()]
  if (createdSession) {
    rows.unshift({
      kind: "chat",
      id: createdSession.id,
      sessionID: createdSession.id,
      title: createdSession.title,
      directory: createdSession.directory,
      created: createdSession.time.created,
      updated: createdSession.time.updated,
      status: "idle",
    })
  }
  return rows
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

test(
  "opened project directory row creates a real Coding Assistant chat",
  { timeout: 120_000 },
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const requestLog: string[] = []
    let createdSession: any | null = null
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${path}${url.search}`)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })

      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse

      if (path === "/global/health") return json({ version: "project-directory-new-chat-test" })
      if (path === "/global/projects/discover") {
        return json({ root: "D:/ledger", defaultDirectory: PROJECT_DIR, projects: [] })
      }
      if (path === "/global/tasks") return json({ tasks: [] })
      if (path === "/work-ledger") return json({ rows: workLedgerRows(createdSession), nextCursor: null })
      if (path === "/mission") return json([])
      if (path === "/coding/sessions") return json({ sessions: createdSession ? [createdSession] : [], nextCursor: null })
      if (path === "/coding/session" && req.method === "POST") {
        assert.equal(url.searchParams.get("directory"), PROJECT_DIR)
        createdSession = sessionRow()
        return json({ session: createdSession })
      }
      const codingSessionMatch = /^\/coding\/session\/([^/]+)$/.exec(path)
      if (codingSessionMatch) {
        assert.equal(url.searchParams.get("directory"), PROJECT_DIR)
        const sessionID = decodeURIComponent(codingSessionMatch[1] || "")
        if (!createdSession || sessionID !== createdSession.id) return json({ error: "session not found" }, 404)
        return json({ session: createdSession })
      }
      if (/^\/session\/[^/]+\/conversation$/.test(path)) {
        assert.equal(url.searchParams.get("directory"), PROJECT_DIR)
        const sessionID = decodeURIComponent(path.split("/")[2] || "")
        return json({
          board: {
            kind: "session",
            sessionID,
            status: "idle",
            title: createdSession?.title ?? "New project chat",
            directory: PROJECT_DIR,
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
      if (path === "/work-ledger/events" || path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
        return new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        })
      }
      if (path === "/path") return json({ directory: PROJECT_DIR, exists: true, git: true })
      if (path === "/project/current/worktrees") return json({ worktrees: [] })
      if (path === "/vcs") return json({ branch: "project-directory-new-chat", dirty: false })
      if (path === "/log") return json({})
      if (path === "/log/tail") return json({ path: "D:/overlay/logs/server.log", lines: [] })
      if (path === "/executor") return json([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return json({ profiles: [] })
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
      if (path === "/config/prompt" || path === "/expert-squad/catalog") return json(generalExpertSquadCatalog())
      if (path === "/channel") return json([])
      if (path === "/channel/runtime") return json({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return json({ active: 0, queued: 0, completed: 1, failed: 0 })
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
      return json({ error: `unhandled ${req.method} ${path}` }, 404)
    })

    const browser = await launchBrowser()
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const badResponses: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) consoleErrors.push(msg.text())
    })
    page.on("pageerror", (error) => consoleErrors.push(error.message))
    page.on("requestfailed", (request) => {
      if (/\/task\/events(?:\?.*)?$/.test(request.url())) return
      if (/\/session\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      failedRequests.push(request.url())
    })
    page.on("response", (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
    })

    try {
      await page.setViewport({ width: 1024, height: 720 })
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
      const groupSelector = '[data-ui="work-ledger-project-group"]'
      await page.waitForSelector(`${groupSelector} [data-ui="project-group-toggle"]`, { visible: true })
      await page.waitForFunction(
        (selector) => {
          const button = document.querySelector<HTMLElement>(`${selector} [data-ui="project-group-new-chat"]`)
          const actions = document.querySelector<HTMLElement>(`${selector} .project-group-actions`)
          if (!button) return false
          if (!actions) return false
          const style = window.getComputedStyle(button)
          const actionsStyle = window.getComputedStyle(actions)
          return (
            style.visibility === "visible" &&
            actionsStyle.visibility === "visible" &&
            Number(actionsStyle.opacity) > 0.95 &&
            button.getClientRects().length > 0
          )
        },
        { timeout: 5_000 },
        groupSelector,
      )

      const readProjectActionState = async () =>
        await page.$eval(groupSelector, (node) => {
          const group = node as HTMLElement
          const toggle = group.querySelector<HTMLElement>('[data-ui="project-group-toggle"]')
          const button = group.querySelector<HTMLElement>('[data-ui="project-group-new-chat"]')
          const actions = group.querySelector<HTMLElement>(".project-group-actions")
          const count = group.querySelector<HTMLElement>(".project-group-count")
          const chevron = group.querySelector<HTMLElement>(".project-group-chevron")
          const actionsStyle = actions ? window.getComputedStyle(actions) : null
          const countStyle = count ? window.getComputedStyle(count) : null
          const chevronStyle = chevron ? window.getComputedStyle(chevron) : null
          const buttonRect = button?.getBoundingClientRect()
          const iconRect = button?.querySelector("svg")?.getBoundingClientRect()
          const name = group.querySelector<HTMLElement>(".project-group-name")
          const nameStyle = name ? window.getComputedStyle(name) : null
          return {
            collapsed: group.dataset.collapsed ?? "",
            buttonTag: button?.tagName ?? "",
            buttonLabel: button?.getAttribute("aria-label") ?? "",
            buttonTitle: button?.getAttribute("title") ?? "",
            buttonInsideToggle: !!toggle?.contains(button),
            buttonWidth: buttonRect?.width ?? 0,
            buttonHeight: buttonRect?.height ?? 0,
            iconWidth: iconRect?.width ?? 0,
            iconHeight: iconRect?.height ?? 0,
            nameFontSize: nameStyle ? Number.parseFloat(nameStyle.fontSize) : 0,
            actionsOpacity: actionsStyle?.opacity ?? "",
            actionsPointerEvents: actionsStyle?.pointerEvents ?? "",
            countOpacity: countStyle?.opacity ?? "",
            chevronOpacity: chevronStyle?.opacity ?? "",
          }
        })
      const defaultState = await readProjectActionState()
      assert.deepEqual(
        {
          collapsed: defaultState.collapsed,
          buttonTag: defaultState.buttonTag,
          buttonLabel: defaultState.buttonLabel,
          buttonTitle: defaultState.buttonTitle,
          buttonInsideToggle: defaultState.buttonInsideToggle,
          actionsPointerEvents: defaultState.actionsPointerEvents,
        },
        {
          collapsed: "",
          buttonTag: "BUTTON",
          buttonLabel: "New chat for this project",
          buttonTitle: "New chat for this project",
          buttonInsideToggle: false,
          actionsPointerEvents: "auto",
        },
      )
      assert.ok(defaultState.buttonWidth <= 20, `new-chat button should be compact, got ${defaultState.buttonWidth}`)
      assert.ok(defaultState.buttonHeight <= 20, `new-chat button should be compact, got ${defaultState.buttonHeight}`)
      assert.ok(
        Math.abs(defaultState.iconWidth - defaultState.nameFontSize) <= 1,
        `new-chat icon should match body text size, got icon=${defaultState.iconWidth} font=${defaultState.nameFontSize}`,
      )
      assert.ok(
        Math.abs(defaultState.iconHeight - defaultState.nameFontSize) <= 1,
        `new-chat icon should match body text size, got icon=${defaultState.iconHeight} font=${defaultState.nameFontSize}`,
      )
      assert.ok(Number(defaultState.actionsOpacity) > 0.95)
      assert.ok(Number(defaultState.countOpacity) > 0.95)
      assert.ok(Number(defaultState.chevronOpacity) > 0.95)
      await saveElementScreenshot(page, groupSelector, "project-directory-new-chat-default.png")
      await page.hover(`${groupSelector} .project-group-head`)
      const hoverState = await readProjectActionState()
      assert.ok(Number(hoverState.actionsOpacity) > 0.95)
      assert.ok(Number(hoverState.countOpacity) > 0.95)
      assert.ok(Number(hoverState.chevronOpacity) > 0.95)
      await saveElementScreenshot(page, groupSelector, "project-directory-new-chat-hover.png")

      const workLedgerRequestCountBeforeClick = requestLog.filter((entry) => entry.startsWith("GET /work-ledger")).length
      await page.click(`${groupSelector} [data-ui="project-group-new-chat"]`)
      await page.waitForFunction((sessionID) => (window as any).boardStore?.selectedSource?.id === sessionID, {
        timeout: 10_000,
      }, CREATED_SESSION_ID)
      await page.waitForFunction(
        () => document.querySelector("#chatViewTitle")?.textContent?.trim() === "Chat",
        { timeout: 5_000 },
      )
      await waitForLog(
        () => requestLog.filter((entry) => entry.startsWith("GET /work-ledger")).length > workLedgerRequestCountBeforeClick,
        5_000,
        () => `Work Ledger did not reload after creating chat:\n${requestLog.join("\n")}`,
      )
      await waitForLog(
        async () =>
          (await page.$eval(
            groupSelector,
            (node) => node.querySelectorAll('[data-ui="work-ledger-row"][data-kind="chat"]').length,
          )) === 1,
        10_000,
        async () => {
          const groupDom = await page.$eval(groupSelector, (node) => {
            const group = node as HTMLElement
            return {
              text: group.textContent?.replace(/\s+/g, " ").trim() ?? "",
              rowKinds: [...group.querySelectorAll<HTMLElement>('[data-ui="work-ledger-row"]')].map(
                (row) => row.dataset.kind ?? "",
              ),
              html: group.innerHTML.slice(0, 2_000),
            }
          })
          return `Created chat row did not render after Work Ledger reload:\n${requestLog.join("\n")}\n${JSON.stringify(groupDom, null, 2)}`
        },
      )

      const afterClick = await page.$eval(groupSelector, (node) => ({
        collapsed: (node as HTMLElement).dataset.collapsed ?? "",
        chatRows: node.querySelectorAll('[data-ui="work-ledger-row"][data-kind="chat"]').length,
        activeRows: node.querySelectorAll('[data-active="true"]').length,
        selectedSource: (window as any).boardStore?.selectedSource ?? null,
      }))
      assert.equal(afterClick.collapsed, "")
      assert.equal(afterClick.chatRows, 1)
      assert.equal(afterClick.activeRows, 1)
      assert.deepEqual(afterClick.selectedSource, { kind: "session", id: CREATED_SESSION_ID })
      assert.ok(
        requestLog.some((entry) => entry === `POST /coding/session?directory=${encodeURIComponent(PROJECT_DIR)}`),
        requestLog.join("\n"),
      )
      await saveElementScreenshot(page, groupSelector, "project-directory-new-chat-selected.png")

      assert.deepEqual({ consoleErrors, failedRequests, badResponses }, { consoleErrors: [], failedRequests: [], badResponses: [] })
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
)
