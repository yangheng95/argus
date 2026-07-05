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

test("default queue behavior bypasses the retired task decision dialog", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const taskBodies: unknown[] = []
  const requestLog: string[] = []
  const taskID = "task-default-queue"
  const projectRoot = "D:/overlay/workspace/app"
  const expertSquadCatalog = generalExpertSquadCatalog()
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
    if (path === "/global/health") return send({ version: "task-create-default-queue" })
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
            title: "Task default queue",
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
            title: "Task default queue",
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
    if (path === `/task/${taskID}/conversation/events`) return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
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
    await page.waitForSelector("#chatTextarea:not([disabled])", { visible: true, timeout: 15_000 })
    await page.type("#chatTextarea", "Task default queue")
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#chatSend")?.disabled)
    await page.click("#chatSend")

    await waitForTaskPost()
    await page.waitForFunction(() => !document.querySelector('#appDialogBody[data-kind="task-queue-decision"]'))

    assert.equal(taskBodies.length, 1)
    assert.equal((taskBodies[0] as { queue?: unknown }).queue, false)

    const dialogPresent = await page.evaluate(
      () => !!document.querySelector('#appDialogBody[data-kind="task-queue-decision"]'),
    )
    assert.equal(dialogPresent, false)

    const screenshotPath = resolve(".scratch/task-create-default-queue-no-dialog.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await page.screenshot({ fullPage: true }))

    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})
