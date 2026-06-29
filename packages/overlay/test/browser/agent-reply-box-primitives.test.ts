import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const TASK_ID = "tsk_agent_reply_box_component"
const SESSION_ID = "ses_agent_reply_child"
const PROJECT_ROOT = "D:/overlay/workspace/agent-reply-box"
const T0 = 1_776_000_000_000

async function saveScreenshot(
  element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> },
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function text(value: string, init?: ResponseInit): Response {
  return new Response(value, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function eventStream(): Response {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

function orderKey(rank: number, time: number, id: string, sequence = 0): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:browser:${id}`
}

function taskOrderKey(id: string, time: number): string {
  return orderKey(10, time, id)
}

function messageOrderKey(id: string, time: number): string {
  return orderKey(30, time, id)
}

function sessionOrderKey(id: string, time: number): string {
  return orderKey(50, time, id)
}

function assistantMessage() {
  return {
    info: {
      id: "msg_agent_reply_child",
      sessionID: SESSION_ID,
      channel: "architect",
      role: "assistant",
      resolvedRole: "assistant",
      agent: "architect",
      providerID: "openai",
      modelID: "gpt-5-mini",
      orderKey: messageOrderKey("msg_agent_reply_child", T0 + 100),
      time: { created: T0 + 100 },
    },
    parts: [
      {
        id: "part_agent_reply_child",
        messageID: "msg_agent_reply_child",
        sessionID: SESSION_ID,
        type: "text",
        text: "Architect session is waiting for scoped operator guidance.",
      },
    ],
  }
}

test(
  "agent reply box component keeps draft and shows structured attachment errors",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const attachmentReferenceError =
      "One of the attached files is no longer a stored project attachment. Reattach the file before steering this session."
    const task = {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, T0),
      title: "Agent reply box component path",
      directory: PROJECT_ROOT,
      status: "active",
      sessionID: "ses_agent_reply_root",
      time: { created: T0, started: T0 + 1, updated: T0 + 200 },
    }
    const board = {
      snapshotVersion: "agent-reply-box-board",
      lastSequence: 0,
      task,
      run: { executor: "opencorvus", phase: "architect", status: "active" },
      overview: {
        headline: "Agent reply box component path",
        summary: "Render the real reply box and submit a structured backend error.",
        controls: {},
      },
      requirements: [],
      acceptance: null,
      interactions: [],
      goalWorkflows: [],
    }
    const transcript = [assistantMessage()]
    const sessions = [
      {
        sessionID: SESSION_ID,
        stage: "architect",
        parentSessionID: task.sessionID,
        messageIDs: ["msg_agent_reply_child"],
        lastDisplayMessageID: "msg_agent_reply_child",
        firstMessageTime: T0 + 100,
        lastMessageTime: T0 + 100,
        placement: "top_level",
        orderKey: sessionOrderKey(SESSION_ID, T0 + 100),
      },
    ]
    const messages = [
      {
        messageID: "msg_agent_reply_child",
        sessionID: SESSION_ID,
        stage: "architect",
        parentSessionID: task.sessionID,
        orderKey: messageOrderKey("msg_agent_reply_child", T0 + 100),
        time: T0 + 100,
        placement: "top_level",
      },
    ]
    const conversation = {
      lastSequence: 0,
      messageWatermark: T0 + 200,
      board,
      transcript,
      timeline: [],
      events: [],
      eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
      history: { oldestTimestamp: null, oldestMessageID: null, oldestOrderKey: null, hasMore: false, limit: 160 },
      view: { sessions, messages, topLevelSessionIDs: [SESSION_ID] },
      agentView: { sessions, messages, topLevelSessionIDs: [SESSION_ID] },
    }
    const postedReplies: unknown[] = []

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/global/health") return json({ version: "agent-reply-box-component" })
      if (path === "/mission" || path === "/session") return json([])
      if (path === "/global/projects/discover")
        return json({ root: "D:/overlay", defaultDirectory: PROJECT_ROOT, projects: [] })
      if (path === "/project/current/worktrees") return json([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return json([])
      if (path === "/global/tasks") return json({ tasks: [{ task, updated_at: T0 + 200 }] })
      if (path === "/path") return json({ directory: PROJECT_ROOT })
      if (path === "/vcs")
        return json({
          branch: "agent-reply-box",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      if (path === "/provider") return json({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return json({})
      if (path === "/config/providers") return json({ providers: [], default: {} })
      if (path === "/config/prompt") return json([])
      if (path === "/config/prompt-profile")
        return json({
          active: "general",
          project_active: "general",
          session_active: null,
          default: "general",
          targets: [],
          profiles: [],
        })
      if (path === "/config") return json({ model: "openai/gpt-5-mini", directory: PROJECT_ROOT })
      if (path === "/channel") return json([])
      if (path === "/executor") return json([])
      if (path === "/agent") return json([])
      if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return json([])
      if (path === "/skill/mounts")
        return json({
          scope: "project",
          skills: [],
          agents: [],
          matrix: [],
          project_mounts: { agents: {} },
          unmounted_count: 0,
        })
      if (path === "/skill/directories")
        return json({
          global_config: "D:/skills/config",
          managed_skills: "D:/skills/config/skills-market",
          remote_cache: "D:/skills/cache",
        })
      if (path === "/mcp") return json({})
      if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return json([])
      if (path === "/control/timeline") return json([])
      if (path === `/task/${TASK_ID}/board`) return json(board, { headers: { etag: '"agent-reply-box-board"' } })
      if (path === `/task/${TASK_ID}/conversation`) return json(conversation)
      if (path === `/task/${TASK_ID}/conversation/events`)
        return json({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
      if (path === `/task/${TASK_ID}/operator-model-context`)
        return json({ taskID: TASK_ID, sessionID: task.sessionID, agent: "orchestrator", model: null })
      if (path === `/task/${TASK_ID}/browser-preview`)
        return json({
          taskID: TASK_ID,
          kind: "missing",
          status: "missing",
          viewports: [],
          diagnostics: [],
          candidates: [],
          source: "none",
        })
      if (path === `/task/${TASK_ID}/transcript`) return json(transcript)
      if (path === `/task/${TASK_ID}/trace`) return json({ events: [], traceDir: `${PROJECT_ROOT}/.opencorvus/trace` })
      if (path === `/task/${TASK_ID}/session/${SESSION_ID}/reply` && req.method === "POST") {
        postedReplies.push(await req.json())
        return json(
          {
            name: "AgentSessionAttachmentReferenceError",
            data: { reason: "metadata_mismatch", url: "opencorvus-attachment://dangling" },
          },
          { status: 400 },
        )
      }
      if (path === "/task/events" || path === `/task/${TASK_ID}/events`) return eventStream()
      if (path === "/log" && req.method === "POST") return json({ ok: true })
      return text(`unhandled ${req.method} ${url.pathname}${url.search}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page, {
        allowResponse(response) {
          return response.status === 400 && response.path === `/task/${TASK_ID}/session/${SESSION_ID}/reply`
        },
      })
      await page.setViewport({ width: 900, height: 720 })
      await page.evaluateOnNewDocument(
        (seed: { serverUrl: string; taskID: string }) => {
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_theme", "light")
          localStorage.setItem("oc_server_url", seed.serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_directory", "D:/overlay/workspace/agent-reply-box")
          localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/agent-reply-box")
          localStorage.setItem("oc_workspace_task", seed.taskID)
        },
        { serverUrl: server.origin, taskID: TASK_ID },
      )

      await page.goto(`${server.origin}/ui/index.html?taskID=${encodeURIComponent(TASK_ID)}`, { waitUntil: "load" })
      await page.waitForSelector(".card__agent-reply-input", { visible: true })
      await page.evaluate(() => {
        const input = document.querySelector<HTMLTextAreaElement>(".card__agent-reply-input")
        if (!input) throw new Error("missing AgentSessionReplyBox textarea")
        input.value =
          "Please retry the layout pass.\nKeep the follow-up instruction visible.\nConfirm the screenshot evidence.\nReport the exact terminal state."
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.value }))
      })
      await page.waitForFunction(() => {
        const send = document.querySelector<HTMLButtonElement>('[data-ui="agent-reply-send"]')
        return !!send && !send.disabled
      })
      await page.click('[data-ui="agent-reply-send"]')
      await page.waitForSelector(".card__agent-reply-error", { visible: true })

      const metrics = await page.evaluate(() => {
        const stage = document.querySelector(".conversation") || document.querySelector(".chat") || document.body
        const activeForm = document.querySelector(".card__agent-reply") as HTMLElement
        const activeInput = activeForm.querySelector(".card__agent-reply-input") as HTMLTextAreaElement
        const activeSend = activeForm.querySelector('[data-ui="agent-reply-send"]') as HTMLButtonElement
        const error = activeForm.querySelector(".card__agent-reply-error") as HTMLElement
        const dismiss = error.querySelector('[data-ui="agent-reply-error-dismiss"]') as HTMLElement
        const formRect = activeForm.getBoundingClientRect()
        const inputRect = activeInput.getBoundingClientRect()
        const sendRect = activeSend.getBoundingClientRect()
        const errorRect = error.getBoundingClientRect()
        const stageRect = (stage as HTMLElement).getBoundingClientRect()
        const dismissRect = dismiss.getBoundingClientRect()
        const inputStyle = getComputedStyle(activeInput)
        const sendStyle = getComputedStyle(activeSend)
        const dismissStyle = getComputedStyle(dismiss)
        return {
          draftValue: activeInput.value,
          sendDisabled: activeSend.disabled,
          inputOverflowY: inputStyle.overflowY,
          inputScrolls: activeInput.scrollHeight > activeInput.clientHeight,
          inputHeight: Math.round(inputRect.height),
          sendVisible: sendRect.width > 32 && sendRect.height > 24,
          sendInsideForm: sendRect.right <= formRect.right && sendRect.left >= formRect.left,
          sendClass: activeSend.className,
          sendVariant: activeSend.getAttribute("data-variant"),
          sendSize: activeSend.getAttribute("data-size"),
          sendBg: sendStyle.backgroundColor,
          errorInsideStage: errorRect.left >= stageRect.left && errorRect.right <= stageRect.right,
          dismissInsideError: dismissRect.right <= errorRect.right && dismissRect.left >= errorRect.left,
          errorText: error.textContent?.trim() || "",
          dismissClass: dismiss.className,
          dismissSize: dismiss.getAttribute("data-size"),
          dismissColor: dismissStyle.color,
        }
      })

      const expectedDraft =
        "Please retry the layout pass.\nKeep the follow-up instruction visible.\nConfirm the screenshot evidence.\nReport the exact terminal state."
      assert.deepEqual(postedReplies, [{ message: expectedDraft }])
      assert.equal(metrics.draftValue, expectedDraft)
      assert.equal(metrics.sendDisabled, false)
      assert.equal(metrics.inputOverflowY, "auto")
      assert.equal(metrics.inputScrolls, true)
      assert.equal(metrics.inputHeight > 40, true)
      assert.equal(metrics.sendVisible, true)
      assert.equal(metrics.sendInsideForm, true)
      assert.match(metrics.sendClass, /\boc-button\b/)
      assert.equal(metrics.sendVariant, "solid")
      assert.equal(metrics.sendSize, "sm")
      assert.notEqual(metrics.sendBg, "rgba(0, 0, 0, 0)")
      assert.equal(metrics.errorInsideStage, true)
      assert.equal(metrics.dismissInsideError, true)
      assert.equal(metrics.errorText, attachmentReferenceError)
      assert.match(metrics.dismissClass, /\boc-button\b/)
      assert.equal(metrics.dismissSize, "icon")
      assert.notEqual(metrics.dismissColor, "rgba(0, 0, 0, 0)")

      const form = await page.$(".card__agent-reply")
      assert.ok(form)
      const screenshot = await saveScreenshot(form, "agent-reply-box-attachment-reference-error.png")
      assert.ok(screenshot.endsWith("agent-reply-box-attachment-reference-error.png"))
      await page.click('[data-ui="agent-reply-error-dismiss"]')
      await page.waitForFunction(() => !document.querySelector(".card__agent-reply-error"))
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close().catch(() => undefined)
      await server.close().catch(() => undefined)
    }
  },
  { timeout: 60_000 },
)
