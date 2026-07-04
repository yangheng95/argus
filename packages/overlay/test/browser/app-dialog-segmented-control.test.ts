import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

const expertSquadCatalog = generalExpertSquadCatalog()

type DecisionMode = "enter-start" | "space-queue" | "click-queue"

async function withTaskDecisionFixture(
  mode: DecisionMode,
  run: (input: {
    page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>
    taskBodies: unknown[]
    requestLog: string[]
    waitForTaskPost: () => Promise<void>
  }) => Promise<void>,
) {
  const taskBodies: unknown[] = []
  const requestLog: string[] = []
  const taskID = `task-${mode}`
  const projectRoot = "D:/overlay/workspace/app"
  let resolveTaskPost: (() => void) | null = null
  const taskPostSeen = new Promise<void>((resolve) => {
    resolveTaskPost = resolve
  })
  async function waitForTaskPost(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        taskPostSeen,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`task POST was not observed\n${JSON.stringify({ requestLog, taskBodies }, null, 2)}`))
          }, 5_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${path}${url.search}`)
    if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "app-dialog-task-decision" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/mission" || path === "/session") return send([])
    if (path === "/path") return send({ directory: projectRoot, exists: true, git: true })
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
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
    if (path === "/config/prompt") return send([])
    if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
    if (path === "/terminal/profiles") return send({ defaultProfileID: "powershell", profiles: [] })
    if (path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/agent" || path === "/channel") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: {}, unmounted_count: 0 })
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/task/events") return eventStream()
    if (path === "/task" && req.method === "POST") {
      taskBodies.push(await req.json())
      resolveTaskPost?.()
      return send({ task_id: taskID })
    }
    if (path === `/task/${taskID}/operator-model-context`)
      return send({
        taskID,
        sessionID: "",
        agent: "",
        model: { providerID: "opencorvus", modelID: "gpt-5-nano" },
      })
    if (path === `/task/${taskID}/conversation`)
      return send({
        board: {
          snapshotVersion: `${taskID}:conversation`,
          task: {
            id: taskID,
            title: `Task decision ${mode}`,
            directory: projectRoot,
            status: "queued",
            time: { created: 1, updated: 1 },
          },
          cards: [],
          goals: [],
          goalWorkflows: [],
          interactions: [],
          changes: [],
        },
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
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
      })
    if (path === `/task/${taskID}/board`)
      return send(
        {
          snapshotVersion: `${taskID}:board`,
          task: {
            id: taskID,
            title: `Task decision ${mode}`,
            directory: projectRoot,
            status: "queued",
            time: { created: 1, updated: 1 },
          },
          cards: [],
          goals: [],
          goalWorkflows: [],
          interactions: [],
          changes: [],
        },
        { headers: { etag: `"${taskID}"` } },
      )
    if (path === `/task/${taskID}/conversation/events`)
      return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send([])
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace` })
    if (path === `/task/${taskID}/followup`) return send({ followup: null })
    if (path === `/task/${taskID}/browser-preview`) return send({ target: null, verification: null })
    if (path === `/task/${taskID}/events`) return eventStream()
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page)
    await page.setViewport({ width: 720, height: 560 })
    await page.evaluateOnNewDocument(
      ({ serverUrl, directory }) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  theme: "light",
                  directory,
                }
              }
              if (command === "overlay_settings_save") return true
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                hide: async () => undefined,
                minimize: async () => undefined,
                startDragging: async () => undefined,
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
                onMoved: async () => ({ unlisten: async () => undefined }),
                listen: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
      },
      { serverUrl: server.origin, directory: projectRoot },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]', {
      visible: true,
    })
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.waitForSelector("#btnCreateTask", { visible: true })
    await page.click("#btnCreateTask")
    try {
      await page.waitForSelector("#chatTextarea:not([disabled])", { visible: true, timeout: 15_000 })
    } catch (error) {
      const snapshot = await page.evaluate(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>("#chatTextarea")
        const send = document.querySelector<HTMLButtonElement>("#chatSend")
        return {
          connection: document.body.dataset.connection ?? "",
          workspace: document.body.dataset.workspace ?? "",
          textareaExists: !!textarea,
          textareaDisabled: textarea?.disabled ?? null,
          sendExists: !!send,
          sendDisabled: send?.disabled ?? null,
          bodyText: document.body.textContent?.slice(0, 1600) ?? "",
        }
      })
      assert.fail(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(
          { snapshot, requestLog, unexpectedErrors: errors.unexpectedErrors },
          null,
          2,
        )}`,
      )
    }
    await page.type("#chatTextarea", `Task decision ${mode}`)
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#chatSend")?.disabled)
    await page.click("#chatSend")
    await page.waitForSelector('#appDialogBody[data-kind="task-queue-decision"] .app-dialog-decision__choice', {
      visible: true,
    })

    await run({ page, taskBodies, requestLog, waitForTaskPost })

    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
}

test("app dialog task decision uses the real host and segmented control", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  await withTaskDecisionFixture("enter-start", async ({ page, taskBodies, requestLog, waitForTaskPost }) => {
    const initial = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>("#appDialog")
      const choices = document.querySelector<HTMLElement>(".app-dialog-decision__choices")
      const start = document.querySelector<HTMLElement>('.app-dialog-decision__choice[data-value="start"]')
      const queue = document.querySelector<HTMLElement>('.app-dialog-decision__choice[data-value="queue"]')
      const form = document.querySelector<HTMLElement>(".app-dialog-form--decision")
      const startStyle = start ? getComputedStyle(start) : null
      const queueStyle = queue ? getComputedStyle(queue) : null
      const badge = document.querySelector<HTMLElement>('[data-ui="app-dialog-recommended-badge"]')
      const badgeStyle = badge ? getComputedStyle(badge) : null
      const bodyStyle = document.querySelector<HTMLElement>(".app-dialog-decision__choice-body")
        ? getComputedStyle(document.querySelector<HTMLElement>(".app-dialog-decision__choice-body")!)
        : null
      const formRect = form?.getBoundingClientRect()
      const choicesRect = choices?.getBoundingClientRect()
      const queueRect = queue?.getBoundingClientRect()
      return {
        dialogRole: dialog?.getAttribute("role") ?? "",
        modal: dialog?.getAttribute("aria-modal") ?? "",
        choiceGroupLabel: choices?.getAttribute("aria-label") ?? "",
        choiceGroupDisplay: choices ? getComputedStyle(choices).display : "",
        activeTag: start?.tagName ?? "",
        activeValue: start?.dataset.value ?? "",
        activePressed: start?.getAttribute("aria-pressed") ?? "",
        activeDataPressed: start?.hasAttribute("data-pressed") ?? false,
        activeDataSelected: start?.getAttribute("data-selected") ?? null,
        queuePressed: queue?.getAttribute("aria-pressed") ?? "",
        queueDataPressed: queue?.hasAttribute("data-pressed") ?? false,
        recommended: start?.dataset.recommended ?? "",
        retiredBadgePresent: document.querySelector(".app-dialog-decision__badge") !== null,
        badgeText: badge?.textContent?.trim() ?? "",
        badgeClass: badge?.className ?? "",
        badgeTone: badge?.dataset.tone ?? "",
        badgeSize: badge?.dataset.size ?? "",
        focusedValue: (document.activeElement as HTMLElement | null)?.dataset?.value ?? "",
        startBorder: startStyle?.borderColor ?? "",
        queueBorder: queueStyle?.borderColor ?? "",
        startBackground: startStyle?.backgroundColor ?? "",
        queueBackground: queueStyle?.backgroundColor ?? "",
        badgeColor: badgeStyle?.color ?? "",
        bodyColor: bodyStyle?.color ?? "",
        activeAppearance: startStyle?.appearance ?? "",
        formWidth: Math.round(formRect?.width ?? 0),
        formHeight: Math.round(formRect?.height ?? 0),
        choicesClientWidth: Math.round(choices?.clientWidth ?? 0),
        choicesScrollWidth: Math.round(choices?.scrollWidth ?? 0),
        queueRight: Math.round(queueRect?.right ?? 0),
        choicesRight: Math.round(choicesRect?.right ?? 0),
      }
    })
    assert.deepEqual(
      {
        dialogRole: initial.dialogRole,
        modal: initial.modal,
        choiceGroupLabel: initial.choiceGroupLabel,
        choiceGroupDisplay: initial.choiceGroupDisplay,
        activeTag: initial.activeTag,
        activeValue: initial.activeValue,
        activePressed: initial.activePressed,
        activeDataPressed: initial.activeDataPressed,
        activeDataSelected: initial.activeDataSelected,
        queuePressed: initial.queuePressed,
        queueDataPressed: initial.queueDataPressed,
        recommended: initial.recommended,
        retiredBadgePresent: initial.retiredBadgePresent,
        badgeText: initial.badgeText,
        badgeTone: initial.badgeTone,
        badgeSize: initial.badgeSize,
        focusedValue: initial.focusedValue,
        activeAppearance: initial.activeAppearance,
      },
      {
        dialogRole: "dialog",
        modal: "true",
        choiceGroupLabel: "Start mode",
        choiceGroupDisplay: "grid",
        activeTag: "BUTTON",
        activeValue: "start",
        activePressed: "true",
        activeDataPressed: true,
        activeDataSelected: null,
        queuePressed: "false",
        queueDataPressed: false,
        recommended: "true",
        retiredBadgePresent: false,
        badgeText: "Recommended",
        badgeTone: "accent",
        badgeSize: "sm",
        focusedValue: "start",
        activeAppearance: "none",
      },
      JSON.stringify({ initial, requestLog }, null, 2),
    )
    assert.match(initial.badgeClass, /\boc-badge\b/)
    assert.notEqual(initial.startBorder, initial.queueBorder)
    assert.notEqual(initial.startBackground, initial.queueBackground)
    assert.notEqual(initial.badgeColor, "transparent")
    assert.notEqual(initial.bodyColor, "transparent")
    assert.ok(initial.formWidth > 400)
    assert.ok(initial.formHeight >= 220, JSON.stringify(initial, null, 2))
    assert.ok(initial.choicesScrollWidth <= initial.choicesClientWidth)
    assert.ok(initial.queueRight <= initial.choicesRight)

    const screenshotPath = resolve(".scratch/app-dialog-real-task-decision-focus.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const form = await page.$(".app-dialog-form--decision")
    assert.ok(form)
    writeFileSync(screenshotPath, await form.screenshot({}))

    await page.hover('.app-dialog-decision__choice[data-value="queue"]')
    const hoverScreenshotPath = resolve(".scratch/app-dialog-real-task-decision-hover.png")
    writeFileSync(hoverScreenshotPath, await form.screenshot({}))

    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector("#appDialog") === null)
    await waitForTaskPost()
    assert.equal(taskBodies.length, 1)
    assert.equal((taskBodies[0] as { queue?: unknown }).queue, false)
  })
})

test("app dialog task decision settles queue with keyboard and pointer activation", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  await withTaskDecisionFixture("space-queue", async ({ page, taskBodies, waitForTaskPost }) => {
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset?.value === "start")
    await page.keyboard.press("ArrowRight")
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset?.value === "queue")
    const queueFocus = await page.$eval('.app-dialog-decision__choice[data-value="queue"]', (node) => {
      const element = node as HTMLElement
      const styles = getComputedStyle(element)
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    assert.equal(queueFocus.focusVisible, true)
    assert.notEqual(queueFocus.outlineStyle, "none")
    assert.notEqual(queueFocus.outlineWidth, "0px")
    const queueFocusScreenshotPath = resolve(".scratch/app-dialog-real-task-decision-queue-focus.png")
    mkdirSync(dirname(queueFocusScreenshotPath), { recursive: true })
    const form = await page.$(".app-dialog-form--decision")
    assert.ok(form)
    writeFileSync(queueFocusScreenshotPath, await form.screenshot({}))
    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.querySelector("#appDialog") === null)
    await waitForTaskPost()
    assert.equal(taskBodies.length, 1)
    assert.equal((taskBodies[0] as { queue?: unknown }).queue, true)
  })

  await withTaskDecisionFixture("click-queue", async ({ page, taskBodies, waitForTaskPost }) => {
    await page.click('.app-dialog-decision__choice[data-value="queue"]')
    await page.waitForFunction(() => document.querySelector("#appDialog") === null)
    await waitForTaskPost()
    assert.equal(taskBodies.length, 1)
    assert.equal((taskBodies[0] as { queue?: unknown }).queue, true)
  })
})
