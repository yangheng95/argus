import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { testMessageOrderKey, testPartOrderKey, testSessionOrderKey } from "../fixtures/timeline-order.ts"

await ensureOverlayDist()

const TASK_ID = "task_chat_header_toolbar"
const PROJECT_ROOT = "D:/overlay/workspace/app"
const STARTED_AT = Date.now() - 95_000
const COMPLETED_AT = Date.now()
const USAGE_MESSAGE_AT = STARTED_AT + 1_000
const EXPERT_SQUAD_CATALOG = generalExpertSquadCatalog()

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

function taskRecord() {
  return {
    id: TASK_ID,
    title: "Codex message panel toolbar",
    directory: PROJECT_ROOT,
    status: "completed",
    sessionID: "session_chat_header_toolbar",
    time: { created: STARTED_AT, started: STARTED_AT, completed: COMPLETED_AT, updated: COMPLETED_AT },
  }
}

function boardPayload(snapshotVersion: string) {
  return {
    snapshotVersion,
    task: taskRecord(),
    cards: [],
    goals: [],
    goalWorkflows: [],
    interactions: [],
    changes: [],
  }
}

function conversationPayload() {
  const usageMessage = {
    info: {
      id: "msg_chat_header_usage",
      sessionID: "session_chat_header_toolbar",
      orderKey: testMessageOrderKey("msg_chat_header_usage", USAGE_MESSAGE_AT),
      channel: "assistant",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "assistant",
      parentSessionID: null,
      time: { created: USAGE_MESSAGE_AT },
      providerID: "openai",
      modelID: "gpt-5",
      tokens: { input: 1_200_000, output: 800_000, reasoning: 0, total: 2_000_000, cache: { read: 0, write: 0 } },
      cost: 1.23,
    },
    parts: [
      {
        id: "part_chat_header_usage",
        orderKey: testPartOrderKey("part_chat_header_usage", USAGE_MESSAGE_AT + 1),
        messageID: "msg_chat_header_usage",
        sessionID: "session_chat_header_toolbar",
        type: "text",
        text: "Usage-bearing header layout fixture.",
      },
    ],
  }
  return {
    board: boardPayload(`${TASK_ID}:conversation`),
    transcript: [usageMessage],
    timeline: [],
    events: [],
    view: {
      topLevelSessionIDs: ["session_chat_header_toolbar"],
      sessions: [
        {
          sessionID: "session_chat_header_toolbar",
          stage: "assistant",
          orderKey: testSessionOrderKey("session_chat_header_toolbar", USAGE_MESSAGE_AT),
          messageIDs: ["msg_chat_header_usage"],
          lastDisplayMessageID: "msg_chat_header_usage",
          firstMessageTime: USAGE_MESSAGE_AT,
          lastMessageTime: USAGE_MESSAGE_AT,
          status: "completed",
          placement: "top_level",
        },
      ],
      messages: [
        {
          messageID: "msg_chat_header_usage",
          sessionID: "session_chat_header_toolbar",
          stage: "assistant",
          orderKey: testMessageOrderKey("msg_chat_header_usage", USAGE_MESSAGE_AT),
          time: USAGE_MESSAGE_AT,
          placement: "top_level",
        },
      ],
    },
    agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
    eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
    history: {
      oldestTimestamp: null,
      oldestOrderKey: null,
      oldestMessageID: null,
      hasMore: false,
      limit: 50,
    },
    messageWatermark: 0,
    lastSequence: 0,
  }
}

async function fixtureResponse(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = route(url)
  if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
  if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
  const staticResponse = await overlayStaticResponse(path)
  if (staticResponse) return staticResponse

  if (path === "/global/health") return send({ version: "1.2.3" })
  if (path === "/global/projects/discover")
    return send({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
  if (path === "/global/tasks") return send({ tasks: [{ task: taskRecord() }] })
  if (path === "/work-ledger") return send({ rows: [], nextCursor: null })
  if (path === "/work-ledger/events") return eventStream()
  if (path === "/gateway/stats") return send({ missions: 0, tasks: 0, active: 0, queued: 0, failed: 0 })
  if (path === "/path") return send({ directory: PROJECT_ROOT })
  if (path === "/vcs")
    return send({
      branch: "main",
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
  if (path === "/expert-squad/catalog") return send(EXPERT_SQUAD_CATALOG)
  if (path === "/config") return send({ model: "openai/gpt-5", prompt_profile: { active: "general" } })
  if (path === "/agent") return send([])
  if (path === "/channel") return send([])
  if (path === "/executor")
    return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
  if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
  if (path === "/skill/mounts")
    return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
  if (path === "/mcp") return send({})
  if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
  if (path === "/project/current/worktrees") return send([])
  if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
  if (path === "/mission") return send([])
  if (path === "/session") return send([])
  if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream()
  if (path === `/task/${TASK_ID}/conversation`) return send(conversationPayload())
  if (path === `/task/${TASK_ID}/operator-model-context`)
    return send({
      taskID: TASK_ID,
      sessionID: "session_chat_header_toolbar",
      agent: "",
      model: { providerID: "openai", modelID: "gpt-5" },
    })
  if (path === `/task/${TASK_ID}/conversation/events`)
    return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
  if (path === `/task/${TASK_ID}/board`) {
    return send(boardPayload(`${TASK_ID}:board`), { headers: { etag: `"${TASK_ID}"` } })
  }
  if (path === `/task/${TASK_ID}/transcript`) return send([])
  if (path === `/task/${TASK_ID}/trace`) return send({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace` })
  if (path === `/task/${TASK_ID}/followup`) return send({ followup: null })
  if (path === `/task/${TASK_ID}/browser-preview`) return send({ target: null, verification: null })
  if (path === `/task/${TASK_ID}/status`)
    return send({ taskID: TASK_ID, status: "completed", executionStatus: "terminal", title: taskRecord().title })
  if (path === "/log" && req.method === "POST") return send({ ok: true })
  if (path === "/log/tail")
    return send({
      path: "D:/overlay/logs/server.log",
      lines: ['{"level":30,"time":"2026-07-08T00:00:00.000Z","msg":"ready"}'],
    })

  return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
}

async function screenshot(page: any, selector: string, name: string) {
  const target = resolve(".scratch", name)
  mkdirSync(dirname(target), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const image = await element.screenshot({})
  assert.ok(image.length > 0, `${name} screenshot should not be empty`)
  await writeFile(target, image)
  return target
}

async function pageDiagnostics(page: any) {
  try {
    return await page.evaluate(() => {
      const rect = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) return null
        const box = node.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          text: node.textContent?.trim() || "",
          display: getComputedStyle(node).display,
          visibility: getComputedStyle(node).visibility,
          pointerEvents: getComputedStyle(node).pointerEvents,
          dataset: { ...node.dataset },
        }
      }
      return {
        url: location.href,
        bodyText: document.body.textContent?.slice(0, 500) || "",
        links: Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']")).map((node) => ({
          href: node.href,
          sheet: Boolean(node.sheet),
        })),
        scripts: Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((node) => node.src),
        resources: performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.includes("/assets/") || name.includes("/i18n/"))
          .slice(0, 20),
        titlebar: rect(".titlebar"),
        usage: rect("#chatUsage"),
        editor: rect('[data-ui="workspace-editor-open-default"]'),
        toggle: rect('[data-ui="chat-header-right-toolbar-toggle"]'),
        rightToolbar: rect("#solidRightActivityToolbar"),
        taskStatus: rect("#taskStatus"),
        taskElapsed: rect("#taskElapsed"),
        chatHeader: rect(".chat-header"),
      }
    })
  } catch (error) {
    return { diagnosticsFailed: error instanceof Error ? error.message : String(error) }
  }
}

test("message panel titlebar opens right toolbar without hover and keeps runtime centered", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(fixtureResponse)
  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  let page: any
  let failure: unknown
  const cleanupErrors: unknown[] = []
  try {
    page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 1280, height: 760 })
    await page.evaluateOnNewDocument(
      ({ serverUrl, directory }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "dark")
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string, args?: Record<string, unknown>) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  theme: "dark",
                  directory,
                  projectEditor: "vscode",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
              if (command === "overlay_open_project_editor") return { ok: true, args }
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                hide: async () => undefined,
                minimize: async () => undefined,
                toggleMaximize: async () => undefined,
                startDragging: async () => undefined,
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
      },
      { serverUrl: server.origin, directory: PROJECT_ROOT },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="workspace-editor-open-default"]', { visible: true })
    await page.evaluate((taskID, directory) => (window as any).selectTask(taskID, { directory }), TASK_ID, PROJECT_ROOT)
    await page.waitForSelector("#taskStatus .elapsed", { visible: true })
    await page.waitForFunction(() => (document.getElementById("chatUsage")?.textContent || "").trim().length > 0)

    const closed = await page.evaluate(() => {
      const mount = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!
      const toolbar = mount.querySelector<HTMLElement>(".side-activity-toolbar")!
      const editor = document.querySelector<HTMLElement>('[data-ui="workspace-editor-open-default"]')!
      const usage = document.querySelector<HTMLElement>("#chatUsage")!
      const toggle = document.querySelector<HTMLElement>('[data-ui="chat-header-right-toolbar-toggle"]')!
      const titlebar = document.querySelector<HTMLElement>(".titlebar")!
      const chatHeader = document.querySelector<HTMLElement>(".chat-header")!
      const usageRect = usage.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      const toggleRect = toggle.getBoundingClientRect()
      return {
        mountOpen: mount.dataset.open || "",
        width: mount.getBoundingClientRect().width,
        pointerEvents: getComputedStyle(toolbar).pointerEvents,
        visibility: getComputedStyle(toolbar).visibility,
        usageText: usage.textContent?.trim() || "",
        usageRight: usageRect.right,
        editorLeft: editorRect.left,
        editorRight: editorRect.right,
        toggleLeft: toggleRect.left,
        editorText: editor.textContent?.trim() || "",
        titlebarText: titlebar.textContent?.trim() || "",
        chatHeaderText: chatHeader.textContent?.trim() || "",
      }
    })
    assert.equal(closed.mountOpen, "false")
    assert.ok(closed.width <= 1, JSON.stringify(closed))
    assert.equal(closed.pointerEvents, "none")
    assert.equal(closed.visibility, "hidden")
    assert.equal(closed.usageText, "2.0m tok · $1.23")
    assert.ok(closed.usageRight <= closed.editorLeft, JSON.stringify(closed))
    assert.ok(closed.editorRight <= closed.toggleLeft, JSON.stringify(closed))
    assert.equal(closed.editorText.includes("Open in"), true)
    assert.equal(closed.titlebarText.includes("Open in"), false)
    assert.equal(closed.chatHeaderText.includes("Open in"), true)
    const closedPath = await screenshot(page, ".chat-header", "codex-message-header-toolbar-closed.png")

    await page.mouse.move(1278, 380)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const afterHover = await page.$eval("#solidRightActivityToolbar", (node) => ({
      open: (node as HTMLElement).dataset.open || "",
      width: (node as HTMLElement).getBoundingClientRect().width,
    }))
    assert.equal(afterHover.open, "false")
    assert.ok(afterHover.width <= 1, JSON.stringify(afterHover))

    await page.click('[data-ui="chat-header-right-toolbar-toggle"]')
    await page.waitForFunction(
      () => {
        const mount = document.querySelector<HTMLElement>("#solidRightActivityToolbar")
        if (!mount || mount.dataset.open !== "true") return false
        const probe = document.createElement("div")
        probe.style.position = "fixed"
        probe.style.visibility = "hidden"
        probe.style.width = "var(--ui-collapsed-pane-width)"
        document.body.append(probe)
        const expected = probe.getBoundingClientRect().width
        probe.remove()
        return mount.getBoundingClientRect().width >= expected - 1
      },
    )

    const open = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".chat-header")!.getBoundingClientRect()
      const status = document.querySelector<HTMLElement>("#taskStatus")!.getBoundingClientRect()
      const mount = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!
      const toolbar = mount.querySelector<HTMLElement>(".side-activity-toolbar")!
      const toggle = document.querySelector<HTMLElement>('[data-ui="chat-header-right-toolbar-toggle"]')!
      const firstTool = document.querySelector<HTMLElement>(
        '[data-ui="side-activity-button"][data-side="right"]',
      )!.getBoundingClientRect()
      const runtimeTool = document.querySelector<HTMLElement>(
        '[data-ui="project-runtime-status-dropdown"]',
      )!.getBoundingClientRect()
      const probe = document.createElement("div")
      probe.style.position = "fixed"
      probe.style.visibility = "hidden"
      probe.style.width = "var(--ui-collapsed-pane-width)"
      document.body.append(probe)
      const expectedWidth = probe.getBoundingClientRect().width
      probe.remove()
      return {
        mountOpen: mount.dataset.open || "",
        width: mount.getBoundingClientRect().width,
        expectedWidth,
        pointerEvents: getComputedStyle(toolbar).pointerEvents,
        visibility: getComputedStyle(toolbar).visibility,
        togglePressed: toggle.getAttribute("aria-pressed"),
        centerDelta: Math.abs(header.left + header.width / 2 - (status.left + status.width / 2)),
        headerHeight: header.height,
        firstToolWidth: firstTool.width,
        firstToolHeight: firstTool.height,
        runtimeToolWidth: runtimeTool.width,
        runtimeToolHeight: runtimeTool.height,
        elapsed: document.querySelector<HTMLElement>("#taskElapsed")?.textContent?.trim() || "",
      }
    })
    assert.equal(open.mountOpen, "true")
    assert.ok(Math.abs(open.width - open.expectedWidth) <= 1.5, JSON.stringify(open))
    assert.equal(open.pointerEvents, "auto")
    assert.equal(open.visibility, "visible")
    assert.equal(open.togglePressed, "true")
    assert.ok(open.centerDelta <= 1.5, JSON.stringify(open))
    assert.ok(Math.abs(open.firstToolWidth - open.expectedWidth) <= 1.5, JSON.stringify(open))
    assert.ok(Math.abs(open.firstToolHeight - open.expectedWidth) <= 1.5, JSON.stringify(open))
    assert.ok(Math.abs(open.runtimeToolWidth - open.expectedWidth) <= 1.5, JSON.stringify(open))
    assert.ok(Math.abs(open.runtimeToolHeight - open.expectedWidth) <= 1.5, JSON.stringify(open))
    assert.ok(Math.abs(open.firstToolHeight - open.headerHeight) <= 1.5, JSON.stringify(open))
    assert.notEqual(open.elapsed, "")
    const openPath = await screenshot(page, "body", "codex-message-header-toolbar-open.png")

    errors.assertNoUnexpectedErrors()
    assert.ok(closedPath.endsWith("codex-message-header-toolbar-closed.png"))
    assert.ok(openPath.endsWith("codex-message-header-toolbar-open.png"))
  } catch (error) {
    failure = error
    console.error("message panel titlebar toolbar browser diagnostics", JSON.stringify(await pageDiagnostics(page), null, 2))
  } finally {
    await browser.close().catch((error) => cleanupErrors.push(error))
    await server.close().catch((error) => cleanupErrors.push(error))
  }
  if (failure) throw failure
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "message panel titlebar toolbar browser test cleanup failed")
  }
})
