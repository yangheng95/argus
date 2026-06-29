import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

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

function missionListPayload() {
  return Array.from({ length: 36 }, (_, index) => ({
    missionID: `mis_scroll_${index}`,
    sessionID: `ses_mission_scroll_${index}`,
    title: `Mission scrollbar row ${String(index + 1).padStart(2, "0")}`,
    directory: PROJECT_DIRECTORY,
    created: 1_735_689_600_000 + index,
    updated: 1_735_689_660_000 + index,
    interruptible: false,
    taskStats: { total: 1, queued: 0, active: 1, completed: 0, failed: 0, cancelled: 0 },
    tasks: Array.from({ length: 4 }, (__, taskIndex) => ({
      id: `tsk_mission_scroll_${index}_${taskIndex}`,
      title: `Mission ${index + 1} task ${taskIndex + 1}`,
      status: "active",
      executionStatus: "running",
      priority: "normal",
      source: "mission",
      directory: PROJECT_DIRECTORY,
      created: 1_735_689_600_000 + index + taskIndex,
      updated: 1_735_689_660_000 + index + taskIndex,
    })),
  }))
}

function codingSessionsPayload() {
  return {
    sessions: Array.from({ length: 36 }, (_, index) => ({
      id: `ses_assistant_scroll_${index}`,
      kind: "assistant",
      title: `Coding assistant scrollbar row ${String(index + 1).padStart(2, "0")}`,
      directory: PROJECT_DIRECTORY,
      metadata: { codingAssistant: { surface: "right-sidebar" } },
    })),
  }
}

function conversationPayload(sessionID: string) {
  return {
    board: {
      kind: "session",
      sessionID,
      status: "active",
      title: sessionID,
      directory: PROJECT_DIRECTORY,
    },
    transcript: [],
    timeline: [],
    events: [],
    view: { rootID: "root", cards: {}, order: [] },
    agentView: { rootID: "root", cards: {}, order: [] },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 0 },
    messageWatermark: 0,
  }
}

async function screenshotElement(page: any, selector: string, name: string) {
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  const screenshotPath = resolve(".scratch", name)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const bytes = await element.screenshot({})
  assert.ok(bytes.length > 0, `${name} screenshot should not be empty`)
  writeFileSync(screenshotPath, bytes)
  return screenshotPath
}

async function waitForRows(
  page: any,
  selector: string,
  minimum: number,
  label: string,
  badResponses: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const count = await page.$$eval(selector, (nodes: Element[]) => nodes.length)
    if (count >= minimum) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diagnostics = await page.evaluate(() => ({
    leftMission: document.querySelector<HTMLElement>("#leftPanelMissions")?.dataset.active ?? "",
    leftAssistant: document.querySelector<HTMLElement>("#leftPanelAssistant")?.dataset.active ?? "",
    missionRows: document.querySelectorAll('[data-ui="mission-row"]').length,
    assistantRows: document.querySelectorAll('[data-ui="coding-assistant-row"]').length,
    missionError: document.querySelector<HTMLElement>("#leftPanelMissions [role='alert']")?.textContent ?? "",
    assistantError: document.querySelector<HTMLElement>("#leftPanelAssistant [role='alert']")?.textContent ?? "",
    bodyText: document.body.textContent?.slice(0, 1200) ?? "",
  }))
  assert.fail(`${label} rows did not render\n${JSON.stringify({ diagnostics, badResponses }, null, 2)}`)
}

test("Mission and Coding Assistant ledgers expose the shared visible scrollbar source", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission") return send(missionListPayload())
    if (path === "/coding/sessions") return send(codingSessionsPayload())
    const codingSessionMatch = path.match(/^\/coding\/session\/([^/]+)$/)
    if (codingSessionMatch) {
      const sessionID = decodeURIComponent(codingSessionMatch[1] ?? "")
      return send({
        session: {
          id: sessionID,
          kind: "assistant",
          title: sessionID,
          directory: PROJECT_DIRECTORY,
          metadata: { codingAssistant: { surface: "right-sidebar" } },
        },
      })
    }
    if (path === "/session") return send([])
    const sessionMatch = path.match(/^\/session\/([^/]+)\/conversation$/)
    if (sessionMatch) return send(conversationPayload(decodeURIComponent(sessionMatch[1] ?? "")))
    if (path.match(/^\/session\/[^/]+\/events$/)) {
      return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
    }
    if (path === "/path") return send({ directory: PROJECT_DIRECTORY })
    if (path === "/global/projects/discover") {
      return send({
        root: "D:/overlay/workspace",
        defaultDirectory: PROJECT_DIRECTORY,
        projects: [{ directory: PROJECT_DIRECTORY, name: "app", marker: "package.json" }],
      })
    }
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
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile")
      return send({ active: "general", project_active: "general", default: "general", targets: [], profiles: [] })
    if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
    if (path === "/agent" || path === "/channel" || path === "/executor") return send([])
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/terminal/profiles") return send({ defaultProfileID: "", profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    if (path === "/task/events") {
      return new Response(":\n\n", {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
    }
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
    await page.evaluateOnNewDocument(
      (input: { directory: string; serverUrl: string }) => {
        localStorage.setItem("oc_directory", input.directory)
        localStorage.setItem("oc_saved_directory", input.directory)
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_server_url", input.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
      },
      { directory: PROJECT_DIRECTORY, serverUrl: server.origin },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]', {
      visible: true,
    })

    async function inspectLedger(selector: string, activePanelSelector: string) {
      return page.$eval(
        selector,
        (node: HTMLElement, panelSelector: string) => {
          const style = getComputedStyle(node)
          const webkitScrollbar = getComputedStyle(node, "::-webkit-scrollbar")
          const activePanel = document.querySelector<HTMLElement>(panelSelector)
          const overflowing = Array.from(activePanel?.querySelectorAll<HTMLElement>("*") ?? [])
            .filter((item) => {
              const itemStyle = getComputedStyle(item)
              return (
                item.scrollHeight > item.clientHeight + 1 &&
                (itemStyle.overflowY === "auto" || itemStyle.overflowY === "scroll")
              )
            })
            .map((item) => ({
              id: item.id,
              className: item.className,
              dataUi: item.dataset.ui || "",
            }))
          return {
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            overflowY: style.overflowY,
            scrollbarWidth: style.scrollbarWidth,
            webkitScrollbarWidth: webkitScrollbar.width,
            box: {
              width: node.getBoundingClientRect().width,
              height: node.getBoundingClientRect().height,
            },
            uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
            overflowing,
          }
        },
        activePanelSelector,
      )
    }

    function assertScaledScrollbarWidth(value: string, uiScale: string) {
      const actual = Number.parseFloat(value)
      const scale = Number.parseFloat(uiScale || "1")
      assert.ok(Number.isFinite(actual), `scrollbar width should be numeric: ${value}`)
      assert.ok(Number.isFinite(scale), `ui scale should be numeric: ${uiScale}`)
      assert.ok(Math.abs(actual - 12 * scale) < 0.01, JSON.stringify({ value, uiScale, actual, expected: 12 * scale }))
    }

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
    await page.waitForSelector(".mission-ledger-list", { visible: true })
    await waitForRows(page, '[data-ui="mission-row"]', 10, "Mission", badResponses)
    const missionState = await inspectLedger(".mission-ledger-list", "#leftPanelMissions")
    assert.equal(missionState.overflowY, "auto")
    assert.equal(missionState.scrollbarWidth, "auto")
    assertScaledScrollbarWidth(missionState.webkitScrollbarWidth, missionState.uiScale)
    assert.ok(missionState.scrollHeight > missionState.clientHeight, JSON.stringify(missionState))
    assert.ok(missionState.box.height > 240, JSON.stringify(missionState.box))
    assert.equal(missionState.overflowing.length, 1, JSON.stringify(missionState.overflowing))
    assert.match(missionState.overflowing[0].className, /\bmission-ledger-list\b/)
    const missionScreenshot = await screenshotElement(
      page,
      ".mission-ledger-list",
      "mission-ledger-scrollbar-visible.png",
    )
    assert.ok(missionScreenshot.endsWith("mission-ledger-scrollbar-visible.png"))

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
    await page.waitForSelector(".coding-assistant-ledger-list", { visible: true })
    await waitForRows(page, '[data-ui="coding-assistant-row"]', 30, "Coding Assistant", badResponses)
    const assistantState = await inspectLedger(".coding-assistant-ledger-list", "#leftPanelAssistant")
    assert.equal(assistantState.overflowY, "auto")
    assert.equal(assistantState.scrollbarWidth, "auto")
    assertScaledScrollbarWidth(assistantState.webkitScrollbarWidth, assistantState.uiScale)
    assert.ok(assistantState.scrollHeight > assistantState.clientHeight, JSON.stringify(assistantState))
    assert.ok(assistantState.box.height > 240, JSON.stringify(assistantState.box))
    assert.equal(assistantState.overflowing.length, 1, JSON.stringify(assistantState.overflowing))
    assert.match(assistantState.overflowing[0].className, /\bcoding-assistant-ledger-list\b/)
    const assistantScreenshot = await screenshotElement(
      page,
      ".coding-assistant-ledger-list",
      "coding-assistant-ledger-scrollbar-visible.png",
    )
    assert.ok(assistantScreenshot.endsWith("coding-assistant-ledger-scrollbar-visible.png"))

    assert.deepEqual(badResponses, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
