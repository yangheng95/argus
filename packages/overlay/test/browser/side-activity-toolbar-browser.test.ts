import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

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

const SIDE_ACTIVITY_TASK = {
  id: "tsk_side_activity",
  title: "Side activity task",
  status: "active",
  directory: "D:/overlay/workspace/app",
  sessionID: "ses_side_activity",
  time: { created: 1_735_689_600_000, updated: 1_735_689_660_000 },
}

function taskListPayload() {
  return {
    tasks: [
      {
        task: SIDE_ACTIVITY_TASK,
      },
    ],
  }
}

function taskConversationPayload() {
  return {
    lastSequence: 1,
    board: {
      snapshotVersion: "board:tsk_side_activity",
      task: SIDE_ACTIVITY_TASK,
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { rootID: "root", cards: {}, order: [] },
    agentView: { rootID: "root", cards: {}, order: [] },
    messageWatermark: 0,
  }
}

function persistedUserMessage(sessionID: string, messageID: string, text: string, created: number) {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      resolvedRole: "user",
      agent: "user",
      channel: "main",
      time: { created },
    },
    parts: [
      {
        id: `${messageID}:text`,
        messageID,
        sessionID,
        type: "text",
        text,
        role: "user",
        resolvedRole: "user",
        agent: "user",
        channel: "main",
      },
    ],
  }
}

function missionListPayload(interruptible = true) {
  return [
    {
      missionID: "mis_side_activity",
      sessionID: "ses_mission_side_activity",
      title: "Mission side activity",
      directory: "D:/overlay/workspace/app",
      created: 1_735_689_600_000,
      updated: 1_735_689_660_000,
      interruptible,
      taskStats: { total: 1, queued: 0, active: 1, completed: 0, failed: 0, cancelled: 0 },
      tasks: [
        {
          id: SIDE_ACTIVITY_TASK.id,
          title: SIDE_ACTIVITY_TASK.title,
          status: "active",
          executionStatus: "running",
          priority: "normal",
          source: "mission",
          directory: SIDE_ACTIVITY_TASK.directory,
          created: SIDE_ACTIVITY_TASK.time.created,
          updated: SIDE_ACTIVITY_TASK.time.updated,
        },
      ],
    },
  ]
}

function assertMatchObject(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, key)
  }
}

test(
  "side activity toolbars open the focused center panel and equal-width workbench panels",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const requestLog: Array<{ method: string; path: string }> = []
    let missionInterruptible = true
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push({ method: req.method, path })
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send(taskListPayload())
      if (path === "/mission") return send(missionListPayload(missionInterruptible))
      if (path === "/mission/mis_side_activity/abort") {
        missionInterruptible = false
        return send(true)
      }
      if (path === "/session/ses_mission_side_activity/conversation") {
        return send({
          board: {
            kind: "session",
            sessionID: "ses_mission_side_activity",
            status: "active",
            title: "Mission side activity",
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
      if (path === "/session/ses_mission_side_activity/prompt_async") {
        return send(
          {
            taskID: "tsk_mission_continue_prompt",
            user_message: persistedUserMessage(
              "ses_mission_side_activity",
              "msg_mission_continue_prompt",
              "continue mission",
              1_735_689_670_000,
            ),
          },
          { status: 202 },
        )
      }
      if (path === "/session/ses_mission_side_activity/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/mission/wake") {
        return send({ missionID: "mis_mission_new", sessionID: "ses_mission_new", created: true })
      }
      if (path === "/session/ses_mission_new/conversation") {
        return send({
          board: {
            kind: "session",
            sessionID: "ses_mission_new",
            status: "active",
            title: "New mission",
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
      if (path === "/session/ses_mission_new/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/task/tsk_side_activity/conversation") return send(taskConversationPayload())
      if (path === "/task/tsk_side_activity/events") {
        return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } })
      }
      if (path === "/session") return send([])
      if (path === "/coding/sessions") {
        return send({
          sessions: [
            {
              id: "ses_right_sidebar_assistant",
              kind: "assistant",
              title: "Coding assistant",
              directory: "D:/overlay/workspace/app",
              metadata: { codingAssistant: { surface: "right-sidebar" } },
            },
          ],
        })
      }
      if (path === "/coding/session") {
        return send(
          {
            session: {
              id: "ses_right_sidebar_assistant",
              kind: "assistant",
              title: "Coding assistant",
              directory: "D:/overlay/workspace/app",
              metadata: { codingAssistant: { surface: "right-sidebar" } },
            },
          },
          { status: 201 },
        )
      }
      if (path === "/coding/session/ses_right_sidebar_assistant") {
        return send({
          session: {
            id: "ses_right_sidebar_assistant",
            kind: "assistant",
            title: "Coding assistant",
            directory: "D:/overlay/workspace/app",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          },
        })
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
        return send(
          {
            taskID: "tsk_right_sidebar_prompt",
            user_message: persistedUserMessage(
              "ses_right_sidebar_assistant",
              "msg_right_sidebar_prompt",
              "ask assistant",
              1_735_689_680_000,
            ),
          },
          { status: 202 },
        )
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
      if (path === "/skill/installed" || path === "/skill")
        return send([
          {
            name: "research-report",
            description:
              "Produce a multi-source research report, comparison matrix, capability survey, market analysis, and recommendation document backed by web research.",
            location: "builtin",
            builtin: true,
          },
        ])
      if (path === "/mcp")
        return send({
          docs: {
            status: "connected",
          },
        })
      if (path === "/panel/knowledge/memory") {
        if (
          url.searchParams.get("directory") !== SIDE_ACTIVITY_TASK.directory ||
          url.searchParams.get("taskID") !== SIDE_ACTIVITY_TASK.id
        ) {
          return send(
            {
              error: "memory panel must send the selected task and project directory",
            },
            { status: 400 },
          )
        }
        return send([
          {
            id: "mem_side_activity_context",
            title: "Project decision memory",
            scope: "cwd",
            source: "memory.md",
            timeUpdated: 1_735_689_660_000,
            snippet: "Remember that the left tool panels use the selected project directory.",
          },
        ])
      }
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/file") return send({ entries: [{ path: "src/main.tsx", name: "main.tsx", type: "file" }] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_workspace_task", "tsk_side_activity")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_right_panel_collapsed", "false")
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')

      const clickButton = async (selector: string) => {
        await page.$eval(selector, (node) => (node as HTMLButtonElement).click())
      }

      const activeState = async () =>
        await page.evaluate(() => {
          const active = (selector: string) => document.querySelector<HTMLElement>(selector)?.dataset.active ?? ""
          const display = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).display
          return {
            leftTasks: active("#leftPanelTasks"),
            leftMission: active("#leftPanelMissions"),
            leftAssistant: active("#leftPanelAssistant"),
            rightInspector: active("#rightPanelInspector"),
            centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open ?? "",
            centerWorkflow: active("#centerWorkbenchWorkflow"),
            centerInspector: active("#centerWorkbenchInspector"),
            centerNotifications: active("#centerWorkbenchNotifications"),
            centerExplorer: active("#centerWorkbenchExplorer"),
            centerDiff: active("#centerWorkbenchDiff"),
            centerPreview: active("#centerWorkbenchBrowser"),
            leftToolbarExists: !!document.querySelector("#solidLeftActivityToolbar"),
            leftActivityButtons: document.querySelectorAll('[data-ui="side-activity-button"][data-side="left"]').length,
            leftTasksButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
              )?.dataset.active ?? "",
            leftMissionButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
              )?.dataset.active ?? "",
            leftAssistantButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
              )?.dataset.active ?? "",
            leftSkillButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]',
              )?.dataset.active ?? "",
            leftMcpButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]',
              )?.dataset.active ?? "",
            leftMemoryButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]',
              )?.dataset.active ?? "",
            rightToolbarDisplay: display("#solidRightActivityToolbar"),
            centerResizerHidden: document.querySelector<HTMLElement>("#centerWorkbenchResizer")?.hidden ?? true,
            rightActivityButtons: document.querySelectorAll('[data-ui="side-activity-button"][data-side="right"]')
              .length,
            rightTuiButtonExists: !!document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]',
            ),
            rightWorkflowButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]',
              )?.dataset.active ?? "",
            rightExplorerButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]',
              )?.dataset.active ?? "",
            rightDiffButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="diff"]',
              )?.dataset.active ?? "",
            rightAssistantButtonExists: !!document.querySelector<HTMLElement>(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="assistant"]',
            ),
            rightPreviewButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]',
              )?.dataset.active ?? "",
            rightInspectorButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
              )?.dataset.active ?? "",
            rightNotificationsButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="right"][data-activity="notifications"]',
              )?.dataset.active ?? "",
            rightNotifications: active("#rightPanelNotifications"),
            notificationPanelExists: !!document.querySelector("#solidNotificationCenterMount"),
            appDialogOpen: document.querySelector<HTMLElement>("#appDialog")?.style.pointerEvents === "auto",
            taskStatusInWorkflowHeader: !!document.querySelector("#chatSection .chat-header #solidTaskStatusMount"),
            centerWorkbenchHeaderExists: !!document.querySelector("#solidCenterWorkbenchTabs"),
            chatTitle: document.querySelector<HTMLElement>("#chatViewTitle")?.textContent ?? "",
            selectedSourceKind: (window as any).boardStore?.selectedSource?.kind ?? "",
            selectedSourceID: (window as any).boardStore?.selectedSource?.id ?? "",
            missionRows: document.querySelectorAll('[data-ui="mission-row"]').length,
            missionAbortButtons: document.querySelectorAll('.mission-ledger [data-ui="task-row-cancel"]').length,
            missionTaskProjectionButtons: document.querySelectorAll('[data-ui="mission-task-projection-select"]')
              .length,
            renderedCardCount: Array.isArray((window as any).renderConversation?.())
              ? (window as any).renderConversation().length
              : -1,
            rightTitle: document.querySelector<HTMLElement>("#rightPanelTitle")?.textContent ?? "",
            notificationTitle: document.querySelector<HTMLElement>("#notificationPanelTitle")?.textContent ?? "",
            workbenchStartsAtWorkspace: (() => {
              const workspace = document.querySelector<HTMLElement>("#conversationWorkspace")?.getBoundingClientRect()
              const workbench = document.querySelector<HTMLElement>("#centerWorkbench")?.getBoundingClientRect()
              return !!workspace && !!workbench && Math.abs(workbench.left - workspace.left) <= 1
            })(),
            tabCount: document.querySelectorAll<HTMLElement>(".center-workbench-tab").length,
            openPanels: Array.from(
              document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']"),
            ).map((node) => node.dataset.workbenchView || ""),
            openPanelWidths: Array.from(
              document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']"),
            ).map((node) => Math.round(node.getBoundingClientRect().width)),
            workflowResizableNext:
              document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")?.dataset.resizableNext ?? "",
          }
        })

      const waitForState = async (
        label: string,
        predicate: (state: Record<string, unknown>) => boolean,
        attempts = 50,
      ) => {
        let state = await activeState()
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          state = await activeState()
          if (predicate(state)) return state
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error(`${label}: ${JSON.stringify(state)} requests=${JSON.stringify(requestLog.slice(-20))}`)
      }

      assertMatchObject(await activeState(), {
        leftTasks: "false",
        leftMission: "true",
        leftAssistant: "false",
        rightInspector: "false",
        centerOpen: "true",
        centerWorkflow: "true",
        centerInspector: "false",
        centerNotifications: "false",
        centerExplorer: "false",
        centerDiff: "false",
        centerPreview: "false",
        leftToolbarExists: true,
        leftActivityButtons: 6,
        leftTasksButton: "false",
        leftMissionButton: "true",
        leftAssistantButton: "false",
        leftSkillButton: "false",
        leftMcpButton: "false",
        leftMemoryButton: "false",
        rightToolbarDisplay: "flex",
        centerResizerHidden: true,
        rightActivityButtons: 7,
        rightTuiButtonExists: false,
        rightWorkflowButton: "false",
        rightExplorerButton: "false",
        rightDiffButton: "false",
        rightAssistantButtonExists: false,
        rightPreviewButton: "false",
        rightInspectorButton: "false",
        rightNotificationsButton: "false",
        rightNotifications: "false",
        notificationPanelExists: true,
        taskStatusInWorkflowHeader: true,
        centerWorkbenchHeaderExists: false,
        chatTitle: "Mission",
        rightTitle: "Inspector",
        notificationTitle: "Notifications",
        workbenchStartsAtWorkspace: true,
      })

      await page.setViewport({ width: 960, height: 720 })
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector<HTMLElement>("#panelBody")!).flexDirection === "column",
      )
      const narrowLeftActivityLayout = await page.evaluate(() => {
        const panelBody = document.querySelector<HTMLElement>("#panelBody")!
        const shell = document.querySelector<HTMLElement>("#leftActivityShell")!
        const toolbar = document.querySelector<HTMLElement>("#solidLeftActivityToolbar")!
        const sidebar = document.querySelector<HTMLElement>("#sidebar")!
        const headerActions = document.querySelector<HTMLElement>("#leftPanelTaskActions")!
        const toolbarRect = toolbar.getBoundingClientRect()
        const sidebarRect = sidebar.getBoundingClientRect()
        const shellRect = shell.getBoundingClientRect()
        return {
          panelDirection: getComputedStyle(panelBody).flexDirection,
          shellDirection: getComputedStyle(shell).flexDirection,
          toolbarLeftOfSidebar: toolbarRect.right <= sidebarRect.left + 1,
          toolbarTopAlignedWithSidebar: Math.abs(toolbarRect.top - sidebarRect.top) <= 1,
          shellContainsToolbar: toolbarRect.left >= shellRect.left - 1 && toolbarRect.right <= shellRect.right + 1,
          shellContainsSidebar: sidebarRect.left >= shellRect.left - 1 && sidebarRect.right <= shellRect.right + 1,
          headerActionText: Array.from(headerActions.querySelectorAll<HTMLElement>("[data-left-action]:not([hidden])"))
            .map((node) => node.textContent || "")
            .join(" ")
            .trim(),
          missionActivityInHeader: !!headerActions.querySelector('[data-activity="mission"]'),
        }
      })
      assertMatchObject(narrowLeftActivityLayout, {
        panelDirection: "column",
        shellDirection: "row",
        toolbarLeftOfSidebar: true,
        toolbarTopAlignedWithSidebar: true,
        shellContainsToolbar: true,
        shellContainsSidebar: true,
        missionActivityInHeader: false,
      })
      assert.equal(narrowLeftActivityLayout.headerActionText.includes("Mission"), true)
      await page.setViewport({ width: 1440, height: 900 })

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const state = await activeState()
        if (state.leftMission === "true" && state.missionRows === 1 && state.selectedSourceKind !== "session") break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assertMatchObject(await activeState(), {
        leftTasks: "false",
        leftMission: "true",
        leftMissionButton: "true",
        leftTasksButton: "false",
        chatTitle: "Mission",
        selectedSourceKind: "task",
        selectedSourceID: "tsk_side_activity",
        missionRows: 1,
        missionAbortButtons: 1,
        missionTaskProjectionButtons: 1,
      })
      assert.deepEqual((await activeState()).openPanels, ["mission"])
      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        leftMission: "true",
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "false",
        chatTitle: "Mission",
      })
      const missionCreatePlacement = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>("#leftPanelTaskActions")!
        const button = document.querySelector<HTMLButtonElement>('[data-ui="mission-new"]')!
        return {
          inHeader: header.contains(button),
          hidden: button.hidden,
          listButtons: document.querySelectorAll('.mission-ledger-controls [data-ui="mission-new"]').length,
        }
      })
      assert.deepEqual(missionCreatePlacement, { inHeader: true, hidden: false, listButtons: 0 })
      assert.ok(requestLog.some((entry) => entry.method === "GET" && entry.path === "/mission"))
      assert.equal(
        requestLog.some(
          (entry) => entry.method === "GET" && entry.path === "/session/ses_mission_side_activity/conversation",
        ),
        false,
      )

      await clickButton('.mission-ledger [data-ui="task-row-cancel"]')
      await clickButton('.mission-ledger [data-ui="task-row-cancel"][data-confirm="true"]')
      await waitForState(
        "mission abort button should disappear after accepted abort",
        (state) => state.missionAbortButtons === 0,
      )
      assert.ok(
        requestLog.some((entry) => entry.method === "POST" && entry.path === "/mission/mis_side_activity/abort"),
      )

      await page.click('[data-ui="mission-row"][data-session-id="ses_mission_side_activity"]')
      await waitForState("mission row should select its session", (state) => state.selectedSourceID === "ses_mission_side_activity")
      assertMatchObject(await activeState(), {
        selectedSourceKind: "session",
        selectedSourceID: "ses_mission_side_activity",
      })
      assert.ok(
        requestLog.some(
          (entry) => entry.method === "GET" && entry.path === "/session/ses_mission_side_activity/conversation",
        ),
      )

      await page.$eval("#chatTextarea", (node) => {
        const textarea = node as HTMLTextAreaElement
        textarea.value = "continue mission"
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "continue mission",
          }),
        )
      })
      await clickButton("#chatSend")
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (
          requestLog.some(
            (entry) => entry.method === "POST" && entry.path === "/session/ses_mission_side_activity/prompt_async",
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.deepEqual(
        requestLog.find(
          (entry) => entry.method === "POST" && entry.path === "/session/ses_mission_side_activity/prompt_async",
        ),
        {
          method: "POST",
          path: "/session/ses_mission_side_activity/prompt_async",
        },
      )
      assert.equal(
        requestLog.some((entry) => entry.method === "POST" && entry.path === "/task/tsk_side_activity/message"),
        false,
      )

      await clickButton('[data-ui="mission-new"]')
      await waitForState(
        "mission new should clear the old session",
        (state) => state.selectedSourceKind === "" && state.chatTitle === "New Mission",
      )
      assertMatchObject(await activeState(), {
        selectedSourceKind: "",
        selectedSourceID: "",
        chatTitle: "New Mission",
      })

      await page.$eval("#chatTextarea", (node) => {
        const textarea = node as HTMLTextAreaElement
        textarea.value = "start a fresh mission"
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "start a fresh mission",
          }),
        )
      })
      await clickButton("#chatSend")
      await waitForState("mission wake should select new session", (state) => state.selectedSourceID === "ses_mission_new")
      assert.ok(requestLog.some((entry) => entry.method === "POST" && entry.path === "/mission/wake"))
      assert.ok(
        requestLog.some((entry) => entry.method === "GET" && entry.path === "/session/ses_mission_new/conversation"),
      )
      assertMatchObject(await activeState(), {
        selectedSourceKind: "session",
        selectedSourceID: "ses_mission_new",
      })

      await waitForState(
        "mission task projection button should render after mission wake refresh",
        (state) => state.missionTaskProjectionButtons === 1,
      )
      await clickButton('[data-ui="mission-task-projection-select"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true" &&
          document
            .querySelector<HTMLElement>(".task-row-main[data-task-id='tsk_side_activity']")
            ?.getAttribute("aria-current") === "page",
      )
      assertMatchObject(await activeState(), {
        leftTasks: "true",
        leftMission: "false",
        leftTasksButton: "true",
        leftMissionButton: "false",
        selectedSourceKind: "task",
        selectedSourceID: "tsk_side_activity",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
      await page.waitForSelector("#leftPanelSkills[data-active='true'] .extension-row")
      const skillPanelState = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#leftPanelSkills")!
        const toolbar = panel.querySelector<HTMLElement>(".tool-panel-toolbar")
        const internalHeader = panel.querySelector<HTMLElement>('.oc-surface-header[data-surface="settings-group"]')
        const buttons = Array.from(panel.querySelectorAll<HTMLElement>('[data-ui="tool-panel-action"]')).map(
          (node) => ({
            text: (node.textContent || "").trim(),
            title: node.getAttribute("title") || "",
            width: Math.round(node.getBoundingClientRect().width),
          }),
        )
        const row = panel.querySelector<HTMLElement>(".extension-row")!
        const desc = row.querySelector<HTMLElement>(".extension-row-main > span")!
        const path = row.querySelector<HTMLElement>(".extension-row-main > small")
        const title = row.querySelector<HTMLElement>(".extension-row-main > strong")!
        const actions = row.querySelector<HTMLElement>(".extension-row-actions")!
        const drop = panel.querySelector<HTMLElement>(".skill-drop-zone")!
        return {
          active: panel.dataset.active,
          hasToolbar: !!toolbar,
          hasInternalHeader: !!internalHeader,
          buttonTexts: buttons.map((item) => item.text),
          buttonTitles: buttons.map((item) => item.title),
          buttonWidths: buttons.map((item) => item.width),
          rowDisplay: getComputedStyle(row).display,
          rowColumns: getComputedStyle(row).gridTemplateColumns,
          descClamp: getComputedStyle(desc).webkitLineClamp,
          descOverflow: getComputedStyle(desc).overflow,
          titleWhiteSpace: getComputedStyle(title).whiteSpace,
          pathWhiteSpace: path ? getComputedStyle(path).whiteSpace : "",
          actionsWidth: Math.round(actions.getBoundingClientRect().width),
          dropHeight: Math.round(drop.getBoundingClientRect().height),
        }
      })
      assertMatchObject(skillPanelState, {
        active: "true",
        hasToolbar: true,
        hasInternalHeader: false,
        buttonTexts: ["", "", ""],
        rowDisplay: "grid",
        descClamp: "3",
        descOverflow: "hidden",
        titleWhiteSpace: "nowrap",
        pathWhiteSpace: "nowrap",
      })
      assert.deepEqual(skillPanelState.buttonTitles, ["Reload", "Add Skill", "Delete All"])
      assert.equal(
        skillPanelState.buttonWidths.every((width) => width <= 32),
        true,
      )
      assert.ok(skillPanelState.rowColumns.includes("px"))
      assert.ok(skillPanelState.actionsWidth < 140)
      assert.ok(skillPanelState.dropHeight < 58)

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
      )

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]')
      await page.waitForSelector("#leftPanelMcp[data-active='true'] .extension-row")
      const mcpPanelState = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#leftPanelMcp")!
        const row = panel.querySelector<HTMLElement>(".extension-row")!
        return {
          active: panel.dataset.active,
          name: row.querySelector<HTMLElement>(".extension-row-main > strong")?.textContent || "",
          detail: row.querySelector<HTMLElement>(".extension-row-main > span")?.textContent || "",
          status: row.querySelector<HTMLElement>(".extension-status")?.textContent || "",
        }
      })
      assert.deepEqual(mcpPanelState, {
        active: "true",
        name: "docs",
        detail: "Connected",
        status: "Connected",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
      )

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]')
      await page.waitForSelector("#leftPanelMemory[data-active='true'] .knowledge-item")
      const memoryPanelState = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#leftPanelMemory")!
        const item = panel.querySelector<HTMLElement>(".knowledge-item")!
        return {
          active: panel.dataset.active,
          title: item.querySelector<HTMLElement>(".knowledge-item-title")?.textContent || "",
          meta: item.querySelector<HTMLElement>(".knowledge-item-meta")?.textContent || "",
          scope: item.querySelector<HTMLElement>(".knowledge-scope")?.textContent || "",
          empty: panel.querySelector<HTMLElement>(".empty-hint")?.textContent || "",
        }
      })
      assert.equal(memoryPanelState.active, "true")
      assert.equal(memoryPanelState.title, "Project decision memory")
      assert.equal(memoryPanelState.meta.startsWith("memory.md"), true)
      assert.equal(memoryPanelState.scope.length > 0, true)
      assert.equal(memoryPanelState.empty, "")

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
      )

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
        rightInspectorButton: "false",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
        chatTitle: "Task",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      const twoPanelState = await activeState()
      assertMatchObject(twoPanelState, {
        centerWorkflow: "true",
        centerInspector: "true",
        rightInspectorButton: "true",
        workflowResizableNext: "true",
        appDialogOpen: false,
      })
      assert.deepEqual(twoPanelState.openPanels, ["task", "inspector"])
      assert.ok(Math.abs(twoPanelState.openPanelWidths[0]! - twoPanelState.openPanelWidths[1]!) <= 2)

      const workflowEdge = await page.evaluate(() => {
        const rect = document.querySelector<HTMLElement>("#centerWorkbenchWorkflow")!.getBoundingClientRect()
        return { x: rect.right - 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(workflowEdge.x, workflowEdge.y)
      await page.mouse.down()
      await page.mouse.move(workflowEdge.x + 120, workflowEdge.y, { steps: 8 })
      await page.mouse.up()
      const resizedTwoPanelState = await activeState()
      assert.deepEqual(resizedTwoPanelState.openPanels, ["task", "inspector"])
      assert.ok(resizedTwoPanelState.openPanelWidths[0]! - resizedTwoPanelState.openPanelWidths[1]! > 80)

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      assertMatchObject(await activeState(), {
        centerInspector: "false",
        rightInspectorButton: "false",
      })

      await page.evaluate(() => window.dispatchEvent(new CustomEvent("acceptance:focus-changes")))
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerDiff: "true",
        centerWorkflow: "true",
        rightDiffButton: "true",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="explorer"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerExplorer: "true",
        centerDiff: "true",
        rightExplorerButton: "true",
        rightDiffButton: "true",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      assertMatchObject(await activeState(), {
        centerPreview: "true",
        centerExplorer: "true",
        rightPreviewButton: "true",
        rightInspector: "false",
        chatTitle: "Task",
      })
      const previewWidth = async () =>
        await page.evaluate(() =>
          Math.round(document.querySelector<HTMLElement>("#centerWorkbenchBrowser")!.getBoundingClientRect().width),
        )
      const previewLeftEdge = async () =>
        await page.evaluate(() => {
          const rect = document.querySelector<HTMLElement>("#centerWorkbenchBrowser")!.getBoundingClientRect()
          return { x: rect.left + 2, y: rect.top + rect.height / 2 }
        })
      const previewWidthBeforeDrag = await previewWidth()
      let previewEdge = await previewLeftEdge()
      await page.mouse.move(previewEdge.x, previewEdge.y)
      await page.mouse.down()
      await page.mouse.move(previewEdge.x - 80, previewEdge.y, { steps: 8 })
      await page.mouse.up()
      const previewWidthAfterWiden = await previewWidth()
      assert.ok(previewWidthAfterWiden - previewWidthBeforeDrag > 50)
      previewEdge = await previewLeftEdge()
      await page.mouse.move(previewEdge.x, previewEdge.y)
      await page.mouse.down()
      await page.mouse.move(previewEdge.x + 80, previewEdge.y, { steps: 8 })
      await page.mouse.up()
      const previewWidthAfterNarrow = await previewWidth()
      assert.ok(previewWidthAfterWiden - previewWidthAfterNarrow > 50)

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="notifications"]')
      assertMatchObject(await activeState(), {
        centerNotifications: "true",
        centerPreview: "true",
        rightNotificationsButton: "true",
        rightPreviewButton: "true",
        rightInspector: "false",
        rightNotifications: "true",
        notificationTitle: "Notifications",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      const inspectorOpenState = await activeState()
      assertMatchObject(inspectorOpenState, {
        centerInspector: "true",
        centerNotifications: "true",
        rightInspectorButton: "true",
        rightNotificationsButton: "true",
        rightInspector: "true",
        rightNotifications: "true",
        rightTitle: "Inspector",
      })
      assert.equal(inspectorOpenState.tabCount, 0)
      assert.deepEqual(inspectorOpenState.openPanels, [
        "task",
        "explorer",
        "diff",
        "browser",
        "inspector",
        "notifications",
      ])
      assert.equal(
        inspectorOpenState.openPanelWidths.every((width) => width > 0),
        true,
      )
      assert.equal(inspectorOpenState.workflowResizableNext, "true")

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
          )?.dataset.active === "true",
      )
      await page.waitForSelector('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await waitForState(
        "assistant activity should select its focused chat session",
        (state) => state.chatTitle === "Chat" && state.selectedSourceID === "ses_right_sidebar_assistant",
      )
      assertMatchObject(await activeState(), {
        leftAssistant: "true",
        leftAssistantButton: "true",
        centerPreview: "false",
        rightPreviewButton: "false",
        chatTitle: "Chat",
        selectedSourceKind: "session",
        selectedSourceID: "ses_right_sidebar_assistant",
      })
      assert.deepEqual((await activeState()).openPanels, ["chat"])
      const assistantCreatePlacement = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>("#leftPanelTaskActions")!
        const button = document.querySelector<HTMLButtonElement>('[data-ui="coding-assistant-new"]')!
        return {
          inHeader: header.contains(button),
          hidden: button.hidden,
          listButtons: document.querySelectorAll('.coding-assistant-ledger-toolbar [data-ui="coding-assistant-new"]')
            .length,
        }
      })
      assert.deepEqual(assistantCreatePlacement, { inHeader: true, hidden: false, listButtons: 0 })
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await page.waitForFunction(() => (window as any).boardStore?.selectedSource?.kind === "session")
      assertMatchObject(await activeState(), {
        centerPreview: "false",
        centerWorkflow: "true",
        leftAssistant: "true",
        leftAssistantButton: "true",
        rightPreviewButton: "false",
        chatTitle: "Chat",
        selectedSourceKind: "session",
        selectedSourceID: "ses_right_sidebar_assistant",
      })
      assert.deepEqual((await activeState()).openPanels, ["chat"])
      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerWorkflow: "true",
        leftAssistant: "true",
        leftAssistantButton: "true",
        rightWorkflowButton: "false",
        chatTitle: "Chat",
      })

      assert.equal((await activeState()).tabCount, 0)

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
      await waitForState(
        "mission activity should clear assistant session",
        (state) =>
          state.leftMission === "true" &&
          state.chatTitle === "Mission" &&
          state.selectedSourceKind === "",
      )
      assertMatchObject(await activeState(), {
        leftMission: "true",
        leftAssistantButton: "false",
        centerPreview: "false",
        rightPreviewButton: "false",
        chatTitle: "Mission",
        selectedSourceKind: "",
        selectedSourceID: "",
        renderedCardCount: 0,
      })
      assert.deepEqual((await activeState()).openPanels, ["mission"])

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForSelector('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await waitForState(
        "assistant row should reselect assistant session",
        (state) => state.selectedSourceID === "ses_right_sidebar_assistant",
      )

      await page.$eval("#chatTextarea", (node) => {
        const textarea = node as HTMLTextAreaElement
        textarea.value = "independent assistant ping"
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "independent assistant ping",
          }),
        )
      })
      await clickButton("#chatSend")
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (
          requestLog.some(
            (entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async",
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        requestLog.some(
          (entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async",
        ),
      )
      assert.deepEqual(
        requestLog.find(
          (entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async",
        ),
        {
          method: "POST",
          path: "/session/ses_right_sidebar_assistant/prompt_async",
        },
      )
      assert.equal(
        requestLog.some((entry) => /^\/task\/[^/]+\/message$/.test(entry.path)),
        false,
      )
      assert.equal(
        requestLog.some((entry) => entry.path.includes("coding-agent-tui") || entry.path.startsWith("/tui/")),
        false,
      )

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true" &&
          document.querySelector<HTMLElement>("#chatViewTitle")?.textContent === "Task" &&
          !(window as any).boardStore?.selectedSource,
      )
      assertMatchObject(await activeState(), {
        centerWorkflow: "true",
        centerPreview: "false",
        leftTasksButton: "true",
        leftAssistantButton: "false",
        rightPreviewButton: "false",
        chatTitle: "Task",
        selectedSourceKind: "",
        selectedSourceID: "",
        renderedCardCount: 0,
      })
      assert.deepEqual((await activeState()).openPanels, ["task"])

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
          )?.dataset.active === "true",
      )
      await page.waitForSelector('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]')
      await page.waitForFunction(() => (window as any).boardStore?.selectedSource?.kind === "session")
      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>("#leftPanelSkills")?.dataset.active === "true" &&
          document.querySelector<HTMLElement>("#chatViewTitle")?.textContent === "Task" &&
          !(window as any).boardStore?.selectedSource,
      )
      assertMatchObject(await activeState(), {
        centerWorkflow: "true",
        leftSkillButton: "true",
        leftAssistantButton: "false",
        chatTitle: "Task",
        selectedSourceKind: "",
        selectedSourceID: "",
        renderedCardCount: 0,
      })

      assert.equal(await page.$('[data-ui="right-panel-header-collapse-toggle"]'), null)
      assert.equal(await page.$("#rightPaneResizer"), null)

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerPreview: "true",
        rightPreviewButton: "true",
      })
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 180_000 },
)
