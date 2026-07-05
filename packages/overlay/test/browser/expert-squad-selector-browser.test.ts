import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { installBrowserErrorCollector, type BrowserErrorCollector } from "./error-collector.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

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

test("expert squad selector clears stale catalog state before task submit after reload failure", { timeout: 60_000 }, async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const taskID = "tsk_catalog_reload_failure"
  const projectRoot = "D:/overlay/workspace/app"
  const taskBodies: unknown[] = []
  let failCatalog = false
  const expertSquadCatalog = expertSquadCatalogFixture({
    active: "frontend-replica",
    projectActive: "frontend-replica",
    squads: [
      { id: "general", label: "General", description: "General Baseline expert squad.", built_in: true },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Visual UI verification squad.",
        built_in: false,
      },
    ],
  })
  const board = {
    snapshotVersion: `${taskID}:board`,
    task: {
      id: taskID,
      title: "Catalog reload failure task",
      directory: projectRoot,
      sessionID: "ses_catalog_failure",
      status: "active",
      time: { created: 1, updated: 1 },
    },
    cards: [],
    goals: [],
    goalWorkflows: [],
    interactions: [],
    changes: [],
  }

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)

    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse

    if (path === "/global/health") return send({ version: "1.2.3" })
    if (path === "/global/tasks") return send({ tasks: [] })
    if (path === "/global/projects/discover") return send([])
    if (path === "/session") return send([])
    if (path === "/mission") return send([])
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: projectRoot })
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
    if (path === "/expert-squad/catalog") {
      return failCatalog
        ? send({ error: "catalog invalid after scope change" }, { status: 500 })
        : send(expertSquadCatalog)
    }
    if (path === "/config" && req.method === "GET")
      return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "frontend-replica" } })
    if (path === "/config" && req.method === "PATCH") {
      const body = await req.text()
      if (body.includes("prompt_profile") && body.includes("general")) failCatalog = true
      return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "general" } })
    }
    if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
    if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
    if (path === "/task" && req.method === "POST") {
      taskBodies.push(await req.json())
      return send({ task_id: taskID })
    }
    if (path === "/task/events" || path === `/task/${taskID}/events` || path === `/task/${taskID}/conversation/events`)
      return new Response(null, { status: 204 })
    if (path === `/task/${taskID}/operator-model-context`)
      return send({
        taskID,
        sessionID: "",
        agent: "",
        model: { providerID: "opencorvus", modelID: "gpt-5-nano" },
      })
    if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"${taskID}"` } })
    if (path === `/task/${taskID}/conversation`)
      return send({
        lastSequence: 1,
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        eventReplay: { cursor: 1, latestSequence: 1, complete: true, limit: 500, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
      })
    if (path === `/task/${taskID}/transcript`) return send([])
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace` })
    if (path === `/task/${taskID}/browser-preview`) return send({ target: null, verification: null })
    if (path === `/task/${taskID}/followup`) return send({ followup: null })
    if (path === `/task/${taskID}/message` && req.method === "POST") {
      return send({
        task_id: taskID,
        user_message: {
          id: "msg_user_catalog_failure",
          session_id: "ses_catalog_failure",
          role: "user",
          author: "user",
          created_at: 1,
          parts: [],
        },
      })
    }
    if (path === "/agent") return send([])
    if (path === "/channel") return send([])
    if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/mounts")
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
    if (path === "/mcp") return send({})
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors = installBrowserErrorCollector(page, {
      allowResponse(response) {
        return response.status === 500 && response.path === "/expert-squad/catalog"
      },
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument(
      ({ serverUrl, directory, taskID }) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_directory", directory)
        localStorage.setItem("oc_workspace_directory", directory)
        ;(window as any).__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return { serverUrl, autoServer: false, locale: "en-US", theme: "light", directory }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
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
              }
            },
          },
        }
      },
      { serverUrl: server.origin, directory: projectRoot, taskID },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await waitForAssistantButton(page, errors)
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
    await waitForPageState(page, "expert squad selector enabled", () => {
      const selector = document.querySelector('[data-ui="expert-squad-selector"]') as HTMLButtonElement | null
      return !!selector && !selector.disabled
    })
    assert.match(
      await page.$eval('[data-ui="expert-squad-selector"]', (node: HTMLElement) => node.textContent || ""),
      /Frontend Replica/,
    )

    await page.click('[data-menu-trigger="settings"]')
    await page.waitForSelector('[data-testid="titlebar-settings-expert-squad"]')
    await page.click('[data-testid="titlebar-settings-expert-squad"]')
    await page.waitForSelector('[data-config-panel="expert-squad"] [data-ui="expert-squad-panel"]')
    await page.click('[data-ui="expert-squad-list"] .expert-squad-list-row:first-child')
    await page.click('[data-ui="expert-squad-activate-project"]')
    await page.waitForSelector('[data-ui="expert-squad-action-error"]')
    await page.click('[data-ui="config-dialog-close"]')
    await waitForPageState(page, "config dialog hidden", () => !document.querySelector("#configDialog"))
    await waitForPageState(page, "expert squad selector disabled", () => {
      const selector = document.querySelector('[data-ui="expert-squad-selector"]') as HTMLButtonElement | null
      return !!selector && selector.disabled
    })

    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await waitForPageState(
      page,
      "tasks panel active before ordinary task submit",
      () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
    )
    await page.click("#solidChatComposer textarea")
    await page.type("#solidChatComposer textarea", "continue without stale expert squad")
    await waitForPageState(page, "chat send enabled", () => {
      const send = document.querySelector("#chatSend") as HTMLButtonElement | null
      return !!send && !send.disabled
    })
    await page.click("#chatSend")
    for (let i = 0; i < 40 && taskBodies.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await waitForPageState(
      page,
      "retired queue dialog remains absent",
      () => !document.querySelector('#appDialogBody[data-kind="task-queue-decision"]'),
    )
    assert.equal(taskBodies.length, 1)
    assert.equal((taskBodies[0] as Record<string, unknown>).queue, false)
    assert.equal((taskBodies[0] as Record<string, unknown>).promptProfile, undefined)
    assert.equal(JSON.stringify(taskBodies[0]).includes("frontend-replica"), false)
    errors.assertNoUnexpectedErrors()
  } finally {
    await browser.close()
    await server.close()
  }
})

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

async function waitForAssistantButton(page: any, diagnostics: BrowserErrorCollector): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const exists = await page.evaluate(
      () => !!document.querySelector('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]'),
    )
    if (exists) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Assistant activity button did not mount: ${JSON.stringify(diagnostics.unexpectedErrors)}`)
}

async function waitForPageState(page: any, description: string, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await page.evaluate(predicate)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const scenarios = [
  {
    locale: "en-US",
    triggerLabel: "Expert Squad",
    screenshotName: "expert-squad-selector-runtime-highlighted-en-US.png",
    labels: [
      "General Baseline expert squad.",
      "Frontend Replica Visual UI verification squad.",
      "Backend Contract and data integrity squad.",
    ],
  },
  {
    locale: "zh-CN",
    triggerLabel: "专家团",
    screenshotName: "expert-squad-selector-runtime-highlighted-zh-CN.png",
    labels: ["通用 基础专家团。", "前端 视觉界面验证专家团。", "后端 契约和数据完整性专家团。"],
  },
] satisfies Array<{ locale: "en-US" | "zh-CN"; triggerLabel: string; screenshotName: string; labels: string[] }>

for (const scenario of scenarios) {
  test(`expert squad selector options remain readable on the light popup surface (${scenario.locale})`, async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const localized = scenario.locale === "zh-CN"
    const expertSquadCatalog = expertSquadCatalogFixture({
      active: "frontend-replica",
      projectActive: "frontend-replica",
      squads: [
        {
          id: "general",
          label: localized ? "通用" : "General",
          description: localized ? "基础专家团。" : "Baseline expert squad.",
          built_in: true,
        },
        {
          id: "frontend-replica",
          label: localized ? "前端" : "Frontend Replica",
          description: localized ? "视觉界面验证专家团。" : "Visual UI verification squad.",
          built_in: false,
        },
        {
          id: "backend",
          label: localized ? "后端" : "Backend",
          description: localized ? "契约和数据完整性专家团。" : "Contract and data integrity squad.",
          built_in: false,
        },
      ],
    })

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/global/projects/discover")
        return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
      if (path === "/session") return send([])
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
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
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt") return send([])
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
      if (path === "/config") return send({ model: "opencorvus/gpt-5-nano", prompt_profile: { active: "frontend-replica" } })
      if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/task/events") return eventStream()
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/mounts")
        return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const errors = installBrowserErrorCollector(page)
      await page.setViewport({ width: 1280, height: 860 })
      await page.evaluateOnNewDocument(
        ({ serverUrl, locale }) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = locale
          localStorage.setItem("oc_locale", locale)
          localStorage.setItem("oc_theme", "light")
          ;(window as any).__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl,
                    autoServer: false,
                    locale,
                    theme: "light",
                    directory: "D:/overlay/workspace/app",
                  }
                }
                if (command === "overlay_settings_save") return true
                if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
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
                }
              },
            },
          }
        },
        { serverUrl: server.origin, locale: scenario.locale },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await waitForAssistantButton(page, errors)
      await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]')
      await page.waitForSelector('[data-ui="expert-squad-selector"]:not([disabled])')
      await page.click('[data-ui="expert-squad-selector"]')
      await page.waitForSelector(".expert-squad-select-content")
      await page.waitForSelector(".expert-squad-select-option")
      await page.keyboard.press("ArrowDown")

      const contentElement = await page.$(".expert-squad-select-content")
      assert.ok(contentElement)
      const screenshot = await saveScreenshot(contentElement, scenario.screenshotName)
      assert.ok(screenshot.endsWith(scenario.screenshotName))

      const result = await page.evaluate(() => {
        const trigger = document.querySelector('[data-ui="expert-squad-selector"]') as HTMLElement | null
        const content = document.querySelector(".expert-squad-select-content") as HTMLElement | null
        if (!trigger || !content) throw new Error("Missing expert squad selector")
        const contentStyle = getComputedStyle(content)
        const options = Array.from(document.querySelectorAll<HTMLElement>(".expert-squad-select-option")).map((option) => {
          const style = getComputedStyle(option)
          const parts = Array.from(option.querySelectorAll<HTMLElement>(".expert-squad-select-option-copy > *")).map(
            (node) => {
              const nodeStyle = getComputedStyle(node)
              const rect = node.getBoundingClientRect()
              return {
                text: node.textContent?.trim() ?? "",
                color: nodeStyle.color,
                display: nodeStyle.display,
                visibility: nodeStyle.visibility,
                opacity: Number.parseFloat(nodeStyle.opacity),
                width: rect.width,
                height: rect.height,
              }
            },
          )
          const rect = option.getBoundingClientRect()
          return {
            label: parts.map((part) => part.text).filter(Boolean).join(" "),
            squadID: option.dataset.squadId ?? "",
            role: option.getAttribute("role"),
            selected: option.getAttribute("aria-selected"),
            highlighted: option.hasAttribute("data-highlighted"),
            display: style.display,
            visibility: style.visibility,
            opacity: Number.parseFloat(style.opacity),
            width: rect.width,
            height: rect.height,
            background: style.backgroundColor,
            parts,
          }
        })
        const triggerRect = trigger.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        return {
          theme: document.documentElement.dataset.theme,
          triggerText: trigger.textContent?.replace(/\s+/g, " ").trim() ?? "",
          triggerWidth: triggerRect.width,
          contentWidth: contentRect.width,
          contentBackground: contentStyle.backgroundColor,
          options,
        }
      })

      assert.equal(result.theme, "light")
      assert.ok(result.triggerText.includes(scenario.triggerLabel))
      assert.ok(result.triggerWidth >= 220)
      assert.ok(result.contentWidth >= result.triggerWidth - 1)
      assert.match(result.contentBackground, /^rgb/)
      assert.deepEqual(
        result.options.map((option) => option.label),
        scenario.labels,
      )
      assert.deepEqual(
        result.options.map((option) => option.squadID),
        ["general", "frontend-replica", "backend"],
      )
      assert.equal(result.options.every((option) => option.role === "option"), true)
      assert.equal(result.options.some((option) => option.highlighted && option.selected === "false"), true)
      assert.equal(result.options.every((option) => option.display !== "none" && option.visibility === "visible"), true)
      assert.equal(result.options.every((option) => option.opacity >= 0.95 && option.width > 0 && option.height > 0), true)
      assert.equal(
        result.options.every((option) =>
          option.parts.every(
            (part) =>
              part.display !== "none" &&
              part.visibility === "visible" &&
              part.opacity >= 0.95 &&
              part.width > 0 &&
              part.height > 0,
          ),
        ),
        true,
      )
      errors.assertNoUnexpectedErrors()
    } finally {
      await browser.close()
      await server.close()
    }
  })
}
