import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

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

function conversationPayload(sessionID: string) {
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: `board:${sessionID}`,
      task: null,
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
  }
}

test("right activity toolbar opens center workbench tabs while side panels stay mounted", async () => {
  const requestLog: Array<{ method: string; path: string }> = []
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push({ method: req.method, path })
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/coding/sessions") {
        return send({
          sessions: [{
            id: "ses_right_sidebar_assistant",
            kind: "assistant",
            title: "Coding assistant",
            directory: "D:/overlay/workspace/app",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          }],
        })
      }
      if (path === "/coding/session") {
        return send({
          session: {
            id: "ses_right_sidebar_assistant",
            kind: "assistant",
            title: "Coding assistant",
            directory: "D:/overlay/workspace/app",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          },
        }, { status: 201 })
      }
      if (path === "/session/ses_right_sidebar_assistant/conversation") {
        return send({
          board: {
            kind: "session",
            sessionID: "ses_right_sidebar_assistant",
            status: "active",
            title: "Coding assistant",
            directory: "D:/overlay/workspace/app",
          },
          transcript: [],
          timeline: [],
          events: [],
          view: { rootID: "root", cards: {}, order: [] },
          agentView: { rootID: "root", cards: {}, order: [] },
          history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 0 },
          messageWatermark: 0,
        })
      }
      if (path === "/session/ses_right_sidebar_assistant/prompt_async") {
        return send({ taskID: "tsk_right_sidebar_prompt" }, { status: 202 })
      }
      if (path === "/session/ses_right_sidebar_assistant/events") {
        return new Response(
          `data: ${JSON.stringify({
            event_id: "session-connected-test",
            session_id: "ses_right_sidebar_assistant",
            type: "session.connected",
            emittedAt: Date.now(),
            timestamp: Date.now(),
            sequence: 0,
            summary: "connected",
            payload: { sessionID: "ses_right_sidebar_assistant" },
          })}\n\n`,
          { headers: { "content-type": "text/event-stream; charset=utf-8" } },
        )
      }
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/file") return send({ entries: [{ path: "src/main.tsx", name: "main.tsx", type: "file" }] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('#solidRightActivityToolbar')
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="assistant"]')

    const clickButton = async (selector: string) => {
      await page.$eval(selector, (node) => (node as HTMLButtonElement).click())
    }

    const activeState = async () => await page.evaluate(() => {
      const active = (selector: string) => document.querySelector<HTMLElement>(selector)?.dataset.active ?? ""
      const display = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).display
      return {
        leftTasks: active("#leftPanelTasks"),
        rightInspector: active("#rightPanelInspector"),
        centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open ?? "",
        centerWorkflow: active("#centerWorkbenchWorkflow"),
        centerInspector: active("#centerWorkbenchInspector"),
        centerNotifications: active("#centerWorkbenchNotifications"),
        centerExplorer: active("#centerWorkbenchExplorer"),
        centerDiff: active("#centerWorkbenchDiff"),
        centerPreview: active("#centerWorkbenchBrowser"),
        leftToolbarExists: !!document.querySelector("#solidLeftActivityToolbar"),
        rightToolbarDisplay: display("#solidRightActivityToolbar"),
        centerResizerHidden: document.querySelector<HTMLElement>("#centerWorkbenchResizer")?.hidden ?? true,
        rightActivityButtons: document.querySelectorAll('[data-ui="side-activity-button"][data-side="right"]').length,
        rightTuiButtonExists: !!document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]'),
        rightWorkflowButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')?.dataset.active ?? "",
        rightExplorerButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')?.dataset.active ?? "",
        rightDiffButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]')?.dataset.active ?? "",
        rightAssistantButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="assistant"]')?.dataset.active ?? "",
        rightPreviewButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')?.dataset.active ?? "",
        rightInspectorButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')?.dataset.active ?? "",
        rightNotificationsButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="notifications"]')?.dataset.active ?? "",
        rightNotifications: active("#rightPanelNotifications"),
        notificationPanelExists: !!document.querySelector("#solidNotificationCenterMount"),
        chatTitle: document.querySelector<HTMLElement>("#chatViewTitle")?.textContent ?? "",
        rightTitle: document.querySelector<HTMLElement>("#rightPanelTitle")?.textContent ?? "",
        notificationTitle: document.querySelector<HTMLElement>("#notificationPanelTitle")?.textContent ?? "",
        workbenchStartsAtWorkspace: (() => {
          const workspace = document.querySelector<HTMLElement>("#conversationWorkspace")?.getBoundingClientRect()
          const workbench = document.querySelector<HTMLElement>("#centerWorkbench")?.getBoundingClientRect()
          return !!workspace && !!workbench && Math.abs(workbench.left - workspace.left) <= 1
        })(),
        tabs: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-tab")).map((node) => node.textContent?.trim() ?? ""),
      }
    })

    expect(await activeState()).toMatchObject({
      leftTasks: "true",
      rightInspector: "false",
      centerOpen: "true",
      centerWorkflow: "true",
      centerInspector: "false",
      centerNotifications: "false",
      centerExplorer: "false",
      centerDiff: "false",
      centerPreview: "false",
      leftToolbarExists: false,
      rightToolbarDisplay: "flex",
      centerResizerHidden: true,
      rightActivityButtons: 7,
      rightTuiButtonExists: false,
      rightWorkflowButton: "true",
      rightExplorerButton: "false",
      rightDiffButton: "false",
      rightAssistantButton: "false",
      rightPreviewButton: "false",
      rightInspectorButton: "false",
      rightNotificationsButton: "false",
      rightNotifications: "false",
      notificationPanelExists: true,
      chatTitle: "Workflow",
      rightTitle: "Inspector",
      notificationTitle: "Notifications",
      workbenchStartsAtWorkspace: true,
    })

    await clickButton(".center-workbench-tab-close")
    expect(await activeState()).toMatchObject({
      centerOpen: "false",
      centerWorkflow: "false",
      rightWorkflowButton: "false",
      rightInspectorButton: "false",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
    expect(await activeState()).toMatchObject({
      centerOpen: "true",
      centerWorkflow: "true",
      rightWorkflowButton: "true",
      chatTitle: "Workflow",
    })

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("acceptance:focus-changes")))
    expect(await activeState()).toMatchObject({ centerOpen: "true", centerDiff: "true", centerWorkflow: "false", rightDiffButton: "true" })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
    expect(await activeState()).toMatchObject({
      centerOpen: "true",
      centerExplorer: "true",
      centerDiff: "false",
      rightExplorerButton: "true",
      rightDiffButton: "false",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
    expect(await activeState()).toMatchObject({
      centerPreview: "true",
      centerExplorer: "false",
      rightPreviewButton: "true",
      rightInspector: "false",
      chatTitle: "Workflow",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="notifications"]')
    expect(await activeState()).toMatchObject({
      centerNotifications: "true",
      centerPreview: "false",
      rightNotificationsButton: "true",
      rightPreviewButton: "false",
      rightInspector: "false",
      rightNotifications: "true",
      notificationTitle: "Notifications",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
    expect(await activeState()).toMatchObject({
      centerInspector: "true",
      centerNotifications: "false",
      rightInspectorButton: "true",
      rightNotificationsButton: "false",
      rightInspector: "true",
      rightNotifications: "false",
      rightTitle: "Inspector",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="assistant"]')
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="assistant"]')?.dataset.active === "true")
    expect(await activeState()).toMatchObject({
      centerPreview: "false",
      centerWorkflow: "true",
      rightAssistantButton: "true",
      rightPreviewButton: "false",
      chatTitle: "Assistant",
    })

    expect((await activeState()).tabs).toEqual(expect.arrayContaining(["Workflow", "Diff", "Explorer", "Preview", "Notifications", "Inspector"]))

    await page.$eval("#chatTextarea", (node) => {
      const textarea = node as HTMLTextAreaElement
      textarea.value = "independent assistant ping"
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "independent assistant ping",
      }))
    })
    await clickButton("#chatSend")
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (requestLog.some((entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async")) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(requestLog).toContainEqual({
      method: "POST",
      path: "/session/ses_right_sidebar_assistant/prompt_async",
    })
    expect(requestLog.some((entry) => /^\/task\/[^/]+\/message$/.test(entry.path))).toBe(false)
    expect(requestLog.some((entry) => entry.path.includes("coding-agent-tui") || entry.path.startsWith("/tui/"))).toBe(false)

    expect(await page.$('[data-ui="right-panel-header-collapse-toggle"]')).toBeNull()
    expect(await page.$("#rightPaneResizer")).toBeNull()

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
    expect(await activeState()).toMatchObject({ centerOpen: "true", centerPreview: "true" })
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 60_000 })
