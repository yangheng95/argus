import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
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

async function armedConfirmState(page: any, selector: string) {
  return page.$eval(selector, (button: HTMLElement) => {
    const descriptionID = button.getAttribute("aria-describedby") || ""
    const description = descriptionID ? document.getElementById(descriptionID) : null
    return {
      confirm: button.dataset.confirm || "",
      pressed: button.getAttribute("aria-pressed") || "",
      describedBy: descriptionID,
      description: description?.textContent?.trim() || "",
      role: description?.getAttribute("role") || "",
      live: description?.getAttribute("aria-live") || "",
    }
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
    let resolveMissionArchive: ((response: Response) => void) | null = null
    const promptProfileCatalog = {
      active: "general",
      project_active: "general",
      session_active: null,
      default: "general",
      targets: [],
      profiles: [
        {
          id: "general",
          label: "General",
          description: "Baseline prompt set.",
          built_in: true,
          editable: false,
          agents: {},
        },
      ],
    }
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
      if (path === "/mission/mis_side_activity/project-archive") {
        return await new Promise<Response>((resolve) => {
          resolveMissionArchive = resolve
        })
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
            {
              id: "ses_right_sidebar_delete",
              kind: "assistant",
              title: "Coding assistant delete target",
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
        if (req.method === "DELETE") return send({ ok: true })
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
      if (path === "/coding/session/ses_right_sidebar_delete") {
        if (req.method === "DELETE") return send({ ok: true })
        return send({
          session: {
            id: "ses_right_sidebar_delete",
            kind: "assistant",
            title: "Coding assistant delete target",
            directory: "D:/overlay/workspace/app",
            metadata: { codingAssistant: { surface: "right-sidebar" } },
          },
        })
      }
      if (path === "/coding/session/ses_right_sidebar_assistant/abort") return send({ ok: true })
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
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === "/config") return send({ model: "", prompt_profile: { active: "general" } })
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
      }, server.origin)

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')

      const clickButton = async (selector: string) => {
        await page.waitForSelector(selector, { visible: true })
        await page.click(selector)
      }
      const hitTestDataUi = async (selector: string) =>
        await page.$eval(selector, (node) => {
          const rect = (node as HTMLElement).getBoundingClientRect()
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return target instanceof Element ? target.closest<HTMLElement>("[data-ui]")?.dataset.ui ?? "" : ""
        })

      const activeState = async () =>
        await page.evaluate(() => {
          const active = (selector: string) => document.querySelector<HTMLElement>(selector)?.dataset.active ?? ""
          const attr = (selector: string, name: string) =>
            document.querySelector<HTMLElement>(selector)?.getAttribute(name) ?? ""
          const display = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).display
          const leftHeaderActions = document.querySelector<HTMLElement>("#leftPanelTaskActions")
          return {
            leftTasks: active("#leftPanelTasks"),
            leftMission: active("#leftPanelMissions"),
            leftAssistant: active("#leftPanelAssistant"),
            leftHeaderTitle: document.querySelector<HTMLElement>("#leftPanelTitle")?.textContent ?? "",
            leftHeaderAriaLabel: leftHeaderActions?.getAttribute("aria-label") ?? "",
            leftHeaderI18nKey: leftHeaderActions?.dataset.i18nAriaLabel ?? "",
            leftHeaderActionScope: leftHeaderActions?.dataset.activityActions ?? "",
            leftHeaderActionsActive: leftHeaderActions?.dataset.active ?? "",
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
            leftTasksCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
              "aria-current",
            ),
            leftTasksPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
              "aria-pressed",
            ),
            leftMissionButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
              )?.dataset.active ?? "",
            leftMissionCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
              "aria-current",
            ),
            leftMissionPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
              "aria-pressed",
            ),
            leftAssistantButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
              )?.dataset.active ?? "",
            leftAssistantCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
              "aria-current",
            ),
            leftAssistantPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
              "aria-pressed",
            ),
            leftSkillButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]',
              )?.dataset.active ?? "",
            leftSkillCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]',
              "aria-current",
            ),
            leftSkillPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]',
              "aria-pressed",
            ),
            leftMcpButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]',
              )?.dataset.active ?? "",
            leftMcpCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]',
              "aria-current",
            ),
            leftMcpPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="mcp"]',
              "aria-pressed",
            ),
            leftMemoryButton:
              document.querySelector<HTMLElement>(
                '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]',
              )?.dataset.active ?? "",
            leftMemoryCurrent: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]',
              "aria-current",
            ),
            leftMemoryPressed: attr(
              '[data-ui="side-activity-button"][data-side="left"][data-activity="memory"]',
              "aria-pressed",
            ),
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
            rightWorkflowCurrent: attr(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]',
              "aria-current",
            ),
            rightWorkflowPressed: attr(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]',
              "aria-pressed",
            ),
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
            rightInspectorCurrent: attr(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
              "aria-current",
            ),
            rightInspectorPressed: attr(
              '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
              "aria-pressed",
            ),
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
            chatAttachmentItems: document.querySelectorAll("#chatAttachments .chat-attachment-item").length,
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
            workflowSeparator: (() => {
              const separator = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")
              return {
                hidden: separator?.hidden ?? true,
                disabled: separator?.dataset.disabled ?? "",
                role: separator?.getAttribute("role") ?? "",
                orientation: separator?.getAttribute("aria-orientation") ?? "",
                controls: separator?.getAttribute("aria-controls") ?? "",
                tabIndex: separator?.tabIndex ?? -1,
                min: Number(separator?.getAttribute("aria-valuemin")),
                max: Number(separator?.getAttribute("aria-valuemax")),
                now: Number(separator?.getAttribute("aria-valuenow")),
                focused: document.activeElement === separator,
              }
            })(),
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
      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
      await waitForState(
        "mission activity should be active before mission layout assertions",
        (state) => state.leftMission === "true" && state.leftTasks === "false",
      )
      assertMatchObject(await activeState(), {
        leftTasks: "false",
        leftMission: "true",
        leftAssistant: "false",
        leftHeaderTitle: "Mission",
        leftHeaderAriaLabel: "Mission",
        leftHeaderI18nKey: "mission.title",
        leftHeaderActionScope: "mission",
        leftHeaderActionsActive: "true",
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
        leftTasksCurrent: "",
        leftTasksPressed: "",
        leftMissionButton: "true",
        leftMissionCurrent: "page",
        leftMissionPressed: "",
        leftAssistantButton: "false",
        leftAssistantCurrent: "",
        leftAssistantPressed: "",
        leftSkillButton: "false",
        leftSkillCurrent: "",
        leftSkillPressed: "",
        leftMcpButton: "false",
        leftMcpCurrent: "",
        leftMcpPressed: "",
        leftMemoryButton: "false",
        leftMemoryCurrent: "",
        leftMemoryPressed: "",
        rightToolbarDisplay: "flex",
        centerResizerHidden: true,
        rightActivityButtons: 7,
        rightTuiButtonExists: false,
        rightWorkflowButton: "true",
        rightWorkflowCurrent: "",
        rightWorkflowPressed: "true",
        rightExplorerButton: "false",
        rightDiffButton: "false",
        rightAssistantButtonExists: false,
        rightPreviewButton: "false",
        rightInspectorButton: "false",
        rightInspectorCurrent: "",
        rightInspectorPressed: "false",
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
      const legalLeftShellLayout = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>("#leftActivityShell")!
        const probe = document.createElement("div")
        probe.style.position = "fixed"
        probe.style.visibility = "hidden"
        probe.style.width = "calc(var(--ui-collapsed-pane-width) + var(--ui-rail-min-width))"
        document.body.appendChild(probe)
        const tokenMinWidth = probe.getBoundingClientRect().width
        probe.remove()
        const shellRect = shell.getBoundingClientRect()
        const shellStyle = getComputedStyle(shell)
        return {
          shellWidth: Math.round(shellRect.width),
          tokenMinWidth: Math.round(tokenMinWidth),
          minWidth: shellStyle.minWidth,
        }
      })
      assert.notEqual(legalLeftShellLayout.minWidth, "0px", JSON.stringify(legalLeftShellLayout))
      assert.ok(
        legalLeftShellLayout.shellWidth >= legalLeftShellLayout.tokenMinWidth - 1,
        JSON.stringify(legalLeftShellLayout),
      )
      const leftToolbarElement = await page.$("#solidLeftActivityToolbar")
      assert.ok(leftToolbarElement, "left activity toolbar should exist before screenshot")
      const leftActivityScreenshotPath = resolve(".scratch/left-activity-toolbar-current-page.png")
      mkdirSync(dirname(leftActivityScreenshotPath), { recursive: true })
      writeFileSync(leftActivityScreenshotPath, await leftToolbarElement.screenshot({}))

      await page.setViewport({ width: 960, height: 720 })
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector<HTMLElement>("#panelBody")!).flexDirection === "row",
      )
      const illegalNarrowLeftActivityLayout = await page.evaluate(() => {
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
      assertMatchObject(illegalNarrowLeftActivityLayout, {
        panelDirection: "row",
        shellDirection: "row",
        toolbarLeftOfSidebar: true,
        toolbarTopAlignedWithSidebar: true,
        shellContainsToolbar: true,
        shellContainsSidebar: true,
        missionActivityInHeader: false,
      })
      assert.equal(illegalNarrowLeftActivityLayout.headerActionText.includes("Mission"), true)

      const rightToolbarLegalFrameLayout = async (viewport: { width: number; height: number }) => {
        await page.setViewport(viewport)
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector<HTMLElement>("#workspaceMain")!).flexDirection === "row",
        )
        return page.evaluate(() => {
          const panelBody = document.querySelector<HTMLElement>("#panelBody")!
          const workspace = document.querySelector<HTMLElement>("#workspaceMain")!
          const toolbarMount = document.querySelector<HTMLElement>("#solidRightActivityToolbar")!
          const toolbar = toolbarMount.querySelector<HTMLElement>(".side-activity-toolbar")!
          const items = toolbar.querySelector<HTMLElement>(".side-activity-toolbar__items")!
          const panelBodyRect = panelBody.getBoundingClientRect()
          const workspaceRect = workspace.getBoundingClientRect()
          const toolbarRect = toolbarMount.getBoundingClientRect()
          const overlayMinProbe = document.createElement("div")
          overlayMinProbe.style.position = "fixed"
          overlayMinProbe.style.visibility = "hidden"
          overlayMinProbe.style.width = "var(--ui-overlay-min-width)"
          document.body.appendChild(overlayMinProbe)
          const overlayMinWidth = overlayMinProbe.getBoundingClientRect().width
          overlayMinProbe.remove()
          const buttons = Array.from(
            toolbarMount.querySelectorAll<HTMLElement>('[data-ui="side-activity-button"][data-side="right"]'),
          )
          const clippedButtons = buttons
            .map((button) => {
              const rect = button.getBoundingClientRect()
              return {
                activity: button.dataset.activity || "",
                insideWorkspace:
                  rect.left >= workspaceRect.left - 1 &&
                  rect.right <= workspaceRect.right + 1 &&
                  rect.top >= workspaceRect.top - 1 &&
                  rect.bottom <= workspaceRect.bottom + 1,
                insideToolbar:
                  rect.left >= toolbarRect.left - 1 &&
                  rect.right <= toolbarRect.right + 1 &&
                  rect.top >= toolbarRect.top - 1 &&
                  rect.bottom <= toolbarRect.bottom + 1,
              }
            })
            .filter((item) => !item.insideWorkspace || !item.insideToolbar)
          const hitMisses = buttons
            .map((button) => {
              const rect = button.getBoundingClientRect()
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
              const hitButton = hit instanceof Element ? hit.closest('[data-ui="side-activity-button"]') : null
              return {
                activity: button.dataset.activity || "",
                hit: hitButton === button,
              }
            })
            .filter((item) => !item.hit)
          return {
            workspaceDirection: getComputedStyle(workspace).flexDirection,
            toolbarDirection: getComputedStyle(toolbar).flexDirection,
            itemsDirection: getComputedStyle(items).flexDirection,
            buttonCount: buttons.length,
            toolbarWithinWorkspace:
              toolbarRect.left >= workspaceRect.left - 1 &&
              toolbarRect.right <= workspaceRect.right + 1 &&
              toolbarRect.top >= workspaceRect.top - 1 &&
              toolbarRect.bottom <= workspaceRect.bottom + 1,
            toolbarWidth: toolbarRect.width,
            toolbarHeight: toolbarRect.height,
            panelBodyWidth: panelBodyRect.width,
            bodyWidth: document.body.getBoundingClientRect().width,
            workspaceWidth: workspaceRect.width,
            viewportWidth: window.innerWidth,
            overlayMinWidth,
            clippedButtons,
            hitMisses,
          }
        })
      }
      const illegalDesktopToolbarLayout = await rightToolbarLegalFrameLayout({ width: 960, height: 720 })
      assertMatchObject(illegalDesktopToolbarLayout, {
        workspaceDirection: "row",
        toolbarDirection: "column",
        itemsDirection: "column",
        buttonCount: 7,
        toolbarWithinWorkspace: true,
      })
      assert.ok(
        illegalDesktopToolbarLayout.viewportWidth < illegalDesktopToolbarLayout.overlayMinWidth,
        JSON.stringify(illegalDesktopToolbarLayout),
      )
      assert.ok(
        illegalDesktopToolbarLayout.panelBodyWidth >= illegalDesktopToolbarLayout.overlayMinWidth - 1,
        JSON.stringify(illegalDesktopToolbarLayout),
      )
      assert.ok(illegalDesktopToolbarLayout.toolbarWidth <= 48, JSON.stringify(illegalDesktopToolbarLayout))
      assert.deepEqual(illegalDesktopToolbarLayout.clippedButtons, [], JSON.stringify(illegalDesktopToolbarLayout))

      const illegalNarrowToolbarLayout = await rightToolbarLegalFrameLayout({ width: 390, height: 760 })
      assertMatchObject(illegalNarrowToolbarLayout, {
        workspaceDirection: "row",
        toolbarDirection: "column",
        itemsDirection: "column",
        buttonCount: 7,
        toolbarWithinWorkspace: true,
      })
      assert.ok(
        illegalNarrowToolbarLayout.viewportWidth < illegalNarrowToolbarLayout.overlayMinWidth,
        JSON.stringify(illegalNarrowToolbarLayout),
      )
      assert.ok(
        illegalNarrowToolbarLayout.panelBodyWidth >= illegalNarrowToolbarLayout.overlayMinWidth - 1,
        JSON.stringify(illegalNarrowToolbarLayout),
      )
      assert.ok(illegalNarrowToolbarLayout.toolbarWidth <= 48, JSON.stringify(illegalNarrowToolbarLayout))
      assert.deepEqual(illegalNarrowToolbarLayout.clippedButtons, [], JSON.stringify(illegalNarrowToolbarLayout))
      const illegalNarrowToolbarScreenshotPath = resolve(".scratch/side-activity-toolbar-illegal-narrow-legal-frame.png")
      mkdirSync(dirname(illegalNarrowToolbarScreenshotPath), { recursive: true })
      writeFileSync(illegalNarrowToolbarScreenshotPath, await page.screenshot({ fullPage: true }))
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "auto" }))
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
        leftHeaderTitle: "Mission",
        leftHeaderAriaLabel: "Mission",
        leftHeaderI18nKey: "mission.title",
        leftHeaderActionScope: "mission",
        leftHeaderActionsActive: "true",
        chatTitle: "Mission",
        selectedSourceKind: "task",
        selectedSourceID: "tsk_side_activity",
        missionRows: 1,
        missionAbortButtons: 1,
        missionTaskProjectionButtons: 1,
      })
      assert.deepEqual((await activeState()).openPanels, ["mission"])
      const missionLedgerComposer = await page.$eval("#chatTextarea", (node) => {
        const textarea = node as HTMLTextAreaElement
        return {
          disabled: textarea.disabled,
          dataUI: textarea.getAttribute("data-ui"),
        }
      })
      assert.deepEqual(missionLedgerComposer, { disabled: true, dataUI: null })
      await page.evaluate(() => {
        const form = document.querySelector<HTMLFormElement>("#solidChatComposer form")
        if (!form) throw new Error("missing chat composer form")
        const data = new DataTransfer()
        data.items.add(new File(["disabled mission ledger"], "mission-ledger.txt", { type: "text/plain" }))
        form.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }))
        form.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal((await activeState()).chatAttachmentItems, 0)
      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        leftMission: "true",
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
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

      const missionRowSelector = '.mission-ledger [data-ui="mission-row"][data-session-id="ses_mission_side_activity"]'
      const missionAbortSelector = `${missionRowSelector} [data-ui="task-row-cancel"]`
      const missionDownloadSelector = `${missionRowSelector} [data-ui="task-row-download"]`
      const missionRenameSelector = `${missionRowSelector} [data-ui="task-row-rename"]`
      const missionDeleteSelector = `${missionRowSelector} [data-ui="task-row-delete"]`
      await page.hover(missionRowSelector)
      await clickButton(missionDownloadSelector)
      await waitForState("mission project archive request should start", () =>
        requestLog.some(
          (entry) => entry.method === "GET" && entry.path === "/mission/mis_side_activity/project-archive",
        ),
      )
      const missionActionBusyState = await page.evaluate(
        ([rowSelector, selectors]) => {
          const row = document.querySelector<HTMLElement>(rowSelector)
          if (!row) throw new Error("missing mission row")
          return Object.entries(selectors as Record<string, string>).map(([name, selector]) => {
            const button = document.querySelector<HTMLButtonElement>(selector)
            if (!button) throw new Error(`missing mission action ${name}`)
            const style = getComputedStyle(button)
            return {
              name,
              disabled: button.disabled,
              busy: button.dataset.busy || "",
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
            }
          })
        },
        [
          missionRowSelector,
          {
            abort: missionAbortSelector,
            download: missionDownloadSelector,
            rename: missionRenameSelector,
            delete: missionDeleteSelector,
          },
        ],
      )
      assert.deepEqual(
        missionActionBusyState.map((item: any) => ({ name: item.name, disabled: item.disabled, busy: item.busy })),
        [
          { name: "abort", disabled: true, busy: "" },
          { name: "download", disabled: true, busy: "true" },
          { name: "rename", disabled: true, busy: "" },
          { name: "delete", disabled: true, busy: "" },
        ],
      )
      assert.ok(missionActionBusyState.every((item: any) => item.opacity !== "1"))
      await page.evaluate((selector) => {
        document.querySelector<HTMLButtonElement>(selector)?.click()
      }, missionAbortSelector)
      assert.equal(
        requestLog.some((entry) => entry.method === "POST" && entry.path === "/mission/mis_side_activity/abort"),
        false,
      )
      const missionBusyLedger = await page.$('[data-ui="mission-ledger"]')
      assert.ok(missionBusyLedger)
      const missionBusyScreenshotPath = resolve(".scratch/mission-action-busy-disabled.png")
      mkdirSync(dirname(missionBusyScreenshotPath), { recursive: true })
      writeFileSync(missionBusyScreenshotPath, await missionBusyLedger.screenshot({}))
      assert.ok(resolveMissionArchive, "mission archive request should be held by the fixture")
      resolveMissionArchive(
        new Response(JSON.stringify({ message: "archive unavailable after busy-state verification" }), {
          status: 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }),
      )
      await page.waitForFunction((selector) => {
        const button = document.querySelector<HTMLButtonElement>(selector)
        return !!button && !button.disabled
      }, {}, missionDownloadSelector)

      await page.hover(missionRowSelector)
      await clickButton(missionAbortSelector)
      await page.hover(missionRowSelector)
      await page.waitForSelector(`${missionAbortSelector}[data-confirm="true"]`, { visible: true })
      const missionAbortArmed = await armedConfirmState(page, missionAbortSelector)
      assert.equal(missionAbortArmed.confirm, "true")
      assert.equal(missionAbortArmed.pressed, "true")
      assert.ok(missionAbortArmed.describedBy)
      assert.match(missionAbortArmed.description, /Press again within 3 seconds to stop this mission/)
      assert.equal(missionAbortArmed.role, "status")
      assert.equal(missionAbortArmed.live, "polite")
      const missionLedger = await page.$('[data-ui="mission-ledger"]')
      assert.ok(missionLedger)
      const missionAbortScreenshotPath = resolve(".scratch/mission-abort-armed-confirm.png")
      mkdirSync(dirname(missionAbortScreenshotPath), { recursive: true })
      writeFileSync(missionAbortScreenshotPath, await missionLedger.screenshot({}))
      await clickButton(`${missionAbortSelector}[data-confirm="true"]`)
      await waitForState(
        "mission abort button should disappear after accepted abort",
        (state) => state.missionAbortButtons === 0,
      )
      assert.ok(
        requestLog.some((entry) => entry.method === "POST" && entry.path === "/mission/mis_side_activity/abort"),
      )

      await page.click('[data-ui="mission-row"][data-session-id="ses_mission_side_activity"] .mission-row-main')
      await waitForState(
        "mission row should select its session",
        (state) => state.selectedSourceID === "ses_mission_side_activity",
      )
      const missionCurrentState = await page.$eval(missionRowSelector, (node) => {
        const row = node as HTMLElement
        return {
          rowActive: row.dataset.active || "",
          current: row.querySelector<HTMLElement>(".mission-row-main")?.getAttribute("aria-current") || "",
        }
      })
      assert.deepEqual(missionCurrentState, { rowActive: "true", current: "page" })
      assertMatchObject(await activeState(), {
        selectedSourceKind: "session",
        selectedSourceID: "ses_mission_side_activity",
      })
      await waitForState("mission row should request its session conversation", () =>
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
      await waitForState(
        "mission wake should select new session",
        (state) => state.selectedSourceID === "ses_mission_new",
      )
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
      const projectionSelector = '[data-ui="mission-task-projection-select"]'
      await page.waitForSelector(projectionSelector, { visible: true })
      let projectionFocused = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await page.keyboard.press("Tab")
        projectionFocused = await page.$eval(
          projectionSelector,
          (node) => document.activeElement === node,
        )
        if (projectionFocused) break
      }
      assert.equal(projectionFocused, true)
      const projectionFocus = await page.$eval(projectionSelector, (node) => {
        const button = node as HTMLElement
        const styles = getComputedStyle(button)
        return {
          className: button.className,
          variant: button.dataset.variant,
          size: button.dataset.size,
          tone: button.dataset.tone,
          focusVisible: button.matches(":focus-visible"),
          outlineStyle: styles.outlineStyle,
          outlineWidth: styles.outlineWidth,
        }
      })
      assert.equal(projectionFocus.className, "oc-button")
      assert.equal(projectionFocus.variant, "ghost")
      assert.equal(projectionFocus.size, "md")
      assert.equal(projectionFocus.tone, "neutral")
      assert.equal(projectionFocus.focusVisible, true)
      assert.notEqual(projectionFocus.outlineStyle, "none")
      assert.notEqual(projectionFocus.outlineWidth, "0px")
      const missionPanel = await page.$("#leftPanelMissions")
      assert.ok(missionPanel)
      const screenshotPath = resolve(".scratch/mission-task-projection-row-focus.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await missionPanel.screenshot({}))
      await clickButton(projectionSelector)
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
        leftTasksCurrent: "page",
        leftTasksPressed: "",
        leftMissionButton: "false",
        leftMissionCurrent: "",
        leftMissionPressed: "",
        leftHeaderTitle: "Recent Tasks",
        leftHeaderAriaLabel: "Recent Tasks",
        leftHeaderI18nKey: "task.ledger.title",
        leftHeaderActionScope: "tasks",
        leftHeaderActionsActive: "true",
        selectedSourceKind: "task",
        selectedSourceID: "tsk_side_activity",
        chatAttachmentItems: 0,
      })

      const missionRequestsBeforeReturn = requestLog.filter(
        (entry) => entry.method === "GET" && entry.path === "/mission",
      ).length
      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
      await waitForState(
        "mission activity should reload rows after switching away and back",
        (state) =>
          state.leftMission === "true" &&
          state.leftTasks === "false" &&
          state.missionRows === 1 &&
          state.missionTaskProjectionButtons === 1,
      )
      assert.equal(
        requestLog.filter((entry) => entry.method === "GET" && entry.path === "/mission").length >
          missionRequestsBeforeReturn,
        true,
      )

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="skill"]')
      await page.waitForSelector("#leftPanelSkills[data-active='true'] .extension-settings-row")
      assertMatchObject(await activeState(), {
        leftHeaderTitle: "Skills",
        leftHeaderAriaLabel: "Skills",
        leftHeaderI18nKey: "skill.title",
        leftHeaderActionScope: "skill",
        leftHeaderActionsActive: "false",
        leftSkillButton: "true",
        leftSkillCurrent: "page",
        leftSkillPressed: "",
      })
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
        const row = panel.querySelector<HTMLElement>(".extension-settings-row")!
        const desc = row.querySelector<HTMLElement>(".s-row-desc")!
        const path = row.querySelector<HTMLElement>(".s-row-meta")
        const title = row.querySelector<HTMLElement>(".s-row-title")!
        const actions = row.querySelector<HTMLElement>(".extension-settings-actions")!
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
      await page.waitForSelector("#leftPanelMcp[data-active='true'] .extension-settings-row")
      const mcpPanelState = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#leftPanelMcp")!
        const row = panel.querySelector<HTMLElement>(".extension-settings-row")!
        return {
          active: panel.dataset.active,
          name: row.querySelector<HTMLElement>(".s-row-title")?.textContent || "",
          detail: row.querySelector<HTMLElement>(".s-row-desc")?.textContent || "",
          status: row.querySelector<HTMLElement>(".s-pill")?.textContent || "",
        }
      })
      assert.deepEqual(mcpPanelState, {
        active: "true",
        name: "docs",
        detail: "Connected",
        status: "Connected",
      })
      assertMatchObject(await activeState(), {
        leftMcpButton: "true",
        leftMcpCurrent: "page",
        leftMcpPressed: "",
        leftTasksButton: "false",
        leftTasksCurrent: "",
        leftTasksPressed: "",
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
      assertMatchObject(await activeState(), {
        leftMemoryButton: "true",
        leftMemoryCurrent: "page",
        leftMemoryPressed: "",
        leftTasksButton: "false",
        leftTasksCurrent: "",
        leftTasksPressed: "",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
      )

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
        rightWorkflowCurrent: "",
        rightWorkflowPressed: "true",
        rightInspectorButton: "false",
        rightInspectorCurrent: "",
        rightInspectorPressed: "false",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
        rightWorkflowCurrent: "",
        rightWorkflowPressed: "true",
        chatTitle: "Task",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      const twoPanelState = await activeState()
      assertMatchObject(twoPanelState, {
        centerWorkflow: "true",
        centerInspector: "true",
        rightWorkflowPressed: "true",
        rightInspectorButton: "true",
        rightInspectorCurrent: "",
        rightInspectorPressed: "true",
        appDialogOpen: false,
      })
      assert.deepEqual(twoPanelState.openPanels, ["task", "inspector"])
      assert.ok(Math.abs(twoPanelState.openPanelWidths[0]! - twoPanelState.openPanelWidths[1]!) <= 2)
      const separatorSemantics = twoPanelState.workflowSeparator as {
        hidden: boolean
        disabled: string
        role: string
        orientation: string
        controls: string
        tabIndex: number
        min: number
        max: number
        now: number
      }
      assert.equal(separatorSemantics.hidden, false)
      assert.equal(separatorSemantics.disabled, "false")
      assert.equal(separatorSemantics.role, "separator")
      assert.equal(separatorSemantics.orientation, "vertical")
      assert.equal(separatorSemantics.controls, "centerWorkbenchWorkflow centerWorkbenchInspector")
      assert.equal(separatorSemantics.tabIndex, 0)
      assert.ok(separatorSemantics.min < separatorSemantics.max)
      assert.ok(separatorSemantics.now >= separatorSemantics.min)
      assert.ok(separatorSemantics.now <= separatorSemantics.max)

      const workflowEdge = await page.evaluate(() => {
        const rect = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorWorkflow")!.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(workflowEdge.x, workflowEdge.y)
      await page.mouse.down()
      await page.mouse.move(workflowEdge.x + 120, workflowEdge.y, { steps: 8 })
      await page.mouse.up()
      const resizedTwoPanelState = await activeState()
      assert.deepEqual(resizedTwoPanelState.openPanels, ["task", "inspector"])
      assert.ok(resizedTwoPanelState.openPanelWidths[0]! - resizedTwoPanelState.openPanelWidths[1]! > 80)
      const keyboardWidthBefore = resizedTwoPanelState.openPanelWidths[0]!
      await page.focus("#centerWorkbenchSeparatorWorkflow")
      await page.keyboard.press("ArrowLeft")
      const keyboardResizedState = await waitForState(
        "separator keyboard resize should shrink the left panel",
        (state) => (state.openPanelWidths as number[])[0]! < keyboardWidthBefore - 10,
      )
      assert.equal((keyboardResizedState.workflowSeparator as { focused: boolean }).focused, true)
      assert.ok(keyboardResizedState.openPanelWidths[0]! < keyboardWidthBefore)

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
      await page.setViewport({ width: 2000, height: 1200 })
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector<HTMLElement>("#workspaceMain")!).flexDirection === "row",
      )
      const previewWidth = async () =>
        await page.evaluate(() =>
          Math.round(document.querySelector<HTMLElement>("#centerWorkbenchBrowser")!.getBoundingClientRect().width),
        )
      const previewLeftEdge = async () =>
        await page.evaluate(() => {
          const rect = document.querySelector<HTMLElement>("#centerWorkbenchSeparatorDiff")!.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })
      const previewWidthBeforeDrag = await previewWidth()
      let previewEdge = await previewLeftEdge()
      await page.mouse.move(previewEdge.x, previewEdge.y)
      await page.mouse.down()
      await page.mouse.move(previewEdge.x - 80, previewEdge.y, { steps: 8 })
      await page.mouse.up()
      const previewWidthAfterWiden = await previewWidth()
      assert.ok(
        previewWidthAfterWiden - previewWidthBeforeDrag > 50,
        JSON.stringify({ previewWidthBeforeDrag, previewWidthAfterWiden }),
      )
      previewEdge = await previewLeftEdge()
      await page.mouse.move(previewEdge.x, previewEdge.y)
      await page.mouse.down()
      await page.mouse.move(previewEdge.x + 80, previewEdge.y, { steps: 8 })
      await page.mouse.up()
      const previewWidthAfterNarrow = await previewWidth()
      assert.ok(
        previewWidthAfterWiden - previewWidthAfterNarrow > 50,
        JSON.stringify({ previewWidthAfterWiden, previewWidthAfterNarrow }),
      )

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
      assert.equal((inspectorOpenState.workflowSeparator as { hidden: boolean }).hidden, false)

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
        leftHeaderTitle: "Coding Assistant",
        leftHeaderAriaLabel: "Coding Assistant",
        leftHeaderI18nKey: "coding_assistant.title",
        leftHeaderActionScope: "assistant",
        leftHeaderActionsActive: "true",
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
      const assistantRowSelector = '[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"]'
      const assistantStopSelector = `${assistantRowSelector} [data-ui="task-row-cancel"]`
      await page.hover(assistantRowSelector)
      await page.waitForSelector(assistantStopSelector, { visible: true })
      assert.equal(await hitTestDataUi(assistantStopSelector), "task-row-cancel")
      await clickButton(assistantStopSelector)
      await page.hover(assistantRowSelector)
      await page.waitForSelector(`${assistantStopSelector}[data-confirm="true"]`, { visible: true })
      const assistantStopArmed = await armedConfirmState(page, assistantStopSelector)
      assert.equal(assistantStopArmed.confirm, "true")
      assert.equal(assistantStopArmed.pressed, "true")
      assert.ok(assistantStopArmed.describedBy)
      assert.match(assistantStopArmed.description, /Press again within 3 seconds to stop this assistant chat/)
      assert.equal(assistantStopArmed.role, "status")
      assert.equal(assistantStopArmed.live, "polite")
      const assistantLedger = await page.$('[data-ui="coding-assistant-ledger"]')
      assert.ok(assistantLedger)
      const assistantStopScreenshotPath = resolve(".scratch/coding-assistant-stop-armed-confirm.png")
      mkdirSync(dirname(assistantStopScreenshotPath), { recursive: true })
      writeFileSync(assistantStopScreenshotPath, await assistantLedger.screenshot({}))
      await clickButton(`${assistantStopSelector}[data-confirm="true"]`)
      await waitForState("assistant stop button should call session abort", () =>
        requestLog.some(
          (entry) => entry.method === "POST" && entry.path === "/coding/session/ses_right_sidebar_assistant/abort",
        ),
      )
      const assistantDeleteRowSelector = '[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_delete"]'
      const assistantDeleteSelector = `${assistantDeleteRowSelector} [data-ui="task-row-delete"]`
      await page.hover(assistantDeleteRowSelector)
      await page.waitForSelector(assistantDeleteSelector, { visible: true })
      assert.equal(await hitTestDataUi(assistantDeleteSelector), "task-row-delete")
      await clickButton(assistantDeleteSelector)
      await page.hover(assistantDeleteRowSelector)
      await page.waitForSelector(`${assistantDeleteSelector}[data-confirm="true"]`, { visible: true })
      const assistantDeleteArmed = await armedConfirmState(page, assistantDeleteSelector)
      assert.equal(assistantDeleteArmed.confirm, "true")
      assert.equal(assistantDeleteArmed.pressed, "true")
      assert.ok(assistantDeleteArmed.describedBy)
      assert.match(assistantDeleteArmed.description, /Press again within 3 seconds to delete this assistant chat/)
      assert.equal(assistantDeleteArmed.role, "status")
      assert.equal(assistantDeleteArmed.live, "polite")
      const assistantDeleteScreenshotPath = resolve(".scratch/coding-assistant-delete-armed-confirm.png")
      mkdirSync(dirname(assistantDeleteScreenshotPath), { recursive: true })
      writeFileSync(assistantDeleteScreenshotPath, await assistantLedger.screenshot({}))
      await clickButton(`${assistantDeleteSelector}[data-confirm="true"]`)
      await waitForState("assistant delete button should call session delete", () =>
        requestLog.some(
          (entry) => entry.method === "DELETE" && entry.path === "/coding/session/ses_right_sidebar_delete",
        ),
      )
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"] .coding-assistant-row-main')
      await page.waitForFunction(() => (window as any).boardStore?.selectedSource?.kind === "session")
      const assistantCurrentState = await page.$eval(assistantRowSelector, (node) => {
        const row = node as HTMLElement
        return {
          rowActive: row.dataset.active || "",
          current: row.querySelector<HTMLElement>(".coding-assistant-row-main")?.getAttribute("aria-current") || "",
        }
      })
      assert.deepEqual(assistantCurrentState, { rowActive: "true", current: "page" })
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
        rightWorkflowButton: "true",
        chatTitle: "Chat",
      })

      assert.equal((await activeState()).tabCount, 0)

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]')
      await waitForState(
        "mission activity should clear assistant session",
        (state) => state.leftMission === "true" && state.chatTitle === "Mission" && state.selectedSourceKind === "",
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
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"] .coding-assistant-row-main')
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
      await clickButton('[data-ui="coding-assistant-row"][data-session-id="ses_right_sidebar_assistant"] .coding-assistant-row-main')
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
