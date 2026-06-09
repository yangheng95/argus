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

function assertMatchObject(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, key)
  }
}

test(
  "side activity toolbars open equal-width workbench panels while workflow keeps its header",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const requestLog: Array<{ method: string; path: string }> = []
    const server = await startBrowserFixture(async (req) => {
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
              name: "aivest-design-system",
              description:
                "Aivest financial product design system. Use this skill whenever the user asks to generate, design, optimize, adjust, or add anything for the Aivest platform.",
              location: "C:\\Users\\hengu\\.cache\\opencorvus\\builtin-skills\\aivest-design-system\\SKILL.md",
              builtin: true,
            },
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
        if (path === "/panel/knowledge/memory") return send([])
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
            taskStatusInWorkflowHeader: !!document.querySelector("#chatSection .chat-header #solidTaskStatusMount"),
            centerWorkbenchHeaderExists: !!document.querySelector("#solidCenterWorkbenchTabs"),
            chatTitle: document.querySelector<HTMLElement>("#chatViewTitle")?.textContent ?? "",
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

      assertMatchObject(await activeState(), {
        leftTasks: "true",
        rightInspector: "false",
        centerOpen: "true",
        centerWorkflow: "true",
        centerInspector: "false",
        centerNotifications: "false",
        centerExplorer: "false",
        centerDiff: "false",
        centerPreview: "false",
        leftToolbarExists: true,
        leftActivityButtons: 5,
        leftTasksButton: "true",
        leftAssistantButton: "false",
        leftSkillButton: "false",
        leftMcpButton: "false",
        leftMemoryButton: "false",
        rightToolbarDisplay: "flex",
        centerResizerHidden: true,
        rightActivityButtons: 6,
        rightTuiButtonExists: false,
        rightWorkflowButton: "true",
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
        chatTitle: "Workflow",
        rightTitle: "Inspector",
        notificationTitle: "Notifications",
        workbenchStartsAtWorkspace: true,
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
        buttonTexts: ["", "", "", ""],
        rowDisplay: "grid",
        descClamp: "3",
        descOverflow: "hidden",
        titleWhiteSpace: "nowrap",
        pathWhiteSpace: "nowrap",
      })
      assert.deepEqual(skillPanelState.buttonTitles, ["Reload", "Open Dir", "Add Skill", "Delete All"])
      assert.equal(skillPanelState.buttonWidths.every((width) => width <= 32), true)
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

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "false",
        centerWorkflow: "false",
        rightWorkflowButton: "false",
        rightInspectorButton: "false",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="workflow"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerWorkflow: "true",
        rightWorkflowButton: "true",
        chatTitle: "Workflow",
      })

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
      const twoPanelState = await activeState()
      assertMatchObject(twoPanelState, {
        centerWorkflow: "true",
        centerInspector: "true",
        rightInspectorButton: "true",
        workflowResizableNext: "true",
      })
      assert.deepEqual(twoPanelState.openPanels, ["workflow", "inspector"])
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
      assert.deepEqual(resizedTwoPanelState.openPanels, ["workflow", "inspector"])
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
        chatTitle: "Workflow",
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
        "workflow",
        "explorer",
        "diff",
        "browser",
        "inspector",
        "notifications",
      ])
      assert.equal(inspectorOpenState.openPanelWidths.every((width) => width > 0), true)
      assert.equal(inspectorOpenState.workflowResizableNext, "true")

      await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
          )?.dataset.active === "true",
      )
      assertMatchObject(await activeState(), {
        centerPreview: "true",
        centerWorkflow: "true",
        leftAssistantButton: "true",
        rightPreviewButton: "true",
        chatTitle: "Assistant",
      })

      assert.equal((await activeState()).tabCount, 0)

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
        requestLog.some((entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async"),
      )
      assert.deepEqual(requestLog.find((entry) => entry.method === "POST" && entry.path === "/session/ses_right_sidebar_assistant/prompt_async"), {
        method: "POST",
        path: "/session/ses_right_sidebar_assistant/prompt_async",
      })
      assert.equal(requestLog.some((entry) => /^\/task\/[^/]+\/message$/.test(entry.path)), false)
      assert.equal(
        requestLog.some((entry) => entry.path.includes("coding-agent-tui") || entry.path.startsWith("/tui/")),
        false,
      )

      assert.equal(await page.$('[data-ui="right-panel-header-collapse-toggle"]'), null)
      assert.equal(await page.$("#rightPaneResizer"), null)

      await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
      assertMatchObject(await activeState(), {
        centerOpen: "true",
        centerPreview: "false",
        rightPreviewButton: "false",
      })
    } finally {
      await browser.close()
      await server.close()
    }
  },
  { timeout: 180_000 },
)
