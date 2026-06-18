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

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

async function savePageScreenshot(page: any, filename: string) {
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  writeFileSync(screenshotPath, await page.screenshot({ fullPage: true }))
  return screenshotPath
}

test("AcceptancePanel actions use Button primitives without layout overlap", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-acceptance-buttons"
  const task = {
    id: taskID,
    directory: "D:/overlay/workspace/app",
    status: "completed",
    sessionID: "session-acceptance",
    time: { created: now - 90_000, started: now - 80_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "acceptance-button-owner-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "deliver", status: "completed" },
    overview: {
      headline: "Acceptance button owner",
      summary: "Validate acceptance panel primitive routing.",
      controls: {},
    },
    goalWorkflows: [],
    requirements: [],
    acceptance: {
      status: "candidate",
      verdict: "rejected",
      summary: Array.from({ length: 12 }, (_, index) => `Summary line ${index + 1}: acceptance evidence stays readable.`).join(
        "\n",
      ),
      evidenceManifest: {
        iteration: 3,
        checkResults: [
          {
            id: "typecheck",
            label: "Typecheck",
            status: "passed",
            goalRunID: "gr_acceptance_typecheck",
          },
          {
            id: "visual",
            label: "Visual acceptance screenshot with a long row name",
            status: "failed",
            goalRunID: "gr_acceptance_visual",
          },
        ],
        reviewEvidence: [
          {
            id: "reviewer",
            reviewer: "UI reviewer",
            status: "concerns",
            goalRunID: "gr_acceptance_review",
          },
          {
            id: "release-review",
            reviewer: "Release reviewer without linked goal run",
            status: "passed",
          },
        ],
      },
      result: {
        summary: "One acceptance diff is available.",
        changedFiles: ["src/app.ts", "src/styles.css"],
      },
    },
    interactions: [],
  }
  const requestLog: string[] = []

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    requestLog.push(`${req.method} ${url.pathname}${url.search}`)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "acceptance-button-owner" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: "D:/overlay/workspace/app", projects: [] })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
    if (path === "/vcs")
      return send({
        branch: "acceptance-buttons",
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
    if (path === "/agent") return send([])
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/config/prompt-profile")
      return send({ active: "general", project_active: "general", session_active: null, default: "general", targets: [], profiles: [] })
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/channel") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/directories")
      return send({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/session") return send([])
    if (path === "/control/timeline") return send([])
    if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"board-${now}"` } })
    if (path === `/task/${taskID}/conversation`)
      return send({
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    if (path === `/task/${taskID}/operator-model-context`)
      return send({ taskID, sessionID: "session-acceptance", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`)
      return send({ taskID, kind: "missing", status: "missing", viewports: [], diagnostics: [], candidates: [], source: "none" })
    if (path === `/task/${taskID}/conversation/events`) return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send([])
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: "D:/overlay/workspace/app/.opencorvus/trace" })
    if (path === "/task/events" || path === `/task/${taskID}/events`) return eventStream()
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on("pageerror", (error: any) => errors.push(`pageerror: ${error.message || String(error)}`))
    page.on("console", (message: any) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`)
    })
    page.on("response", (response: any) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument((seed: { serverUrl: string; taskID: string }) => {
      const serverUrl = seed.serverUrl
      const selectedTaskID = seed.taskID
      ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
      ;(window as any).__acceptanceFocusEvents = []
      ;(window as any).__acceptanceSettingsInvokes = []
      window.addEventListener("acceptance:focus-changes", (event: Event) => {
        ;(window as any).__acceptanceFocusEvents.push((event as CustomEvent).detail ?? null)
      })
      localStorage.setItem("oc_locale", "en-US")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_workspace_task", selectedTaskID)
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            ;(window as any).__acceptanceSettingsInvokes.push({ command, args })
            if (command === "overlay_settings_load") {
              return {
                serverUrl,
                autoServer: false,
                locale: "en-US",
                theme: "light",
                directory: "D:/overlay/workspace/app",
                workspaceDirectory: "D:/overlay/workspace/app",
                workspaceTaskID: selectedTaskID,
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
    }, { serverUrl: server.origin, taskID })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { state: "attached", timeout: 15_000 })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]', {
      visible: true,
      timeout: 15_000,
    })
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
    try {
      await page.waitForSelector(".acceptance-panel", { visible: true, timeout: 15_000 })
    } catch (error) {
      const debugScreenshot = await savePageScreenshot(page, "acceptance-panel-button-owner-timeout.png")
      const diagnostics = await page.evaluate((screenshotPath: string) => {
        const rightButtons = Array.from(
          document.querySelectorAll<HTMLElement>('[data-ui="side-activity-button"][data-side="right"]'),
        ).map((node) => ({
          activity: node.dataset.activity || "",
          selected: node.getAttribute("aria-pressed") || node.getAttribute("data-selected") || "",
          text: node.textContent?.trim() || "",
        }))
        return {
          debugScreenshot: screenshotPath,
          bodyText: document.body.innerText.slice(0, 1600),
          hasAcceptanceSection: Boolean(document.querySelector("#acceptanceSection")),
          acceptanceSection: document.querySelector("#acceptanceSection")?.outerHTML.slice(0, 1200) || "",
          workflowStackText: document.querySelector('[data-ui="workflow-section-stack"]')?.textContent?.slice(0, 1200) || "",
          localStorageWorkspaceTask: localStorage.getItem("oc_workspace_task") || "",
          settingsInvokes: (window as any).__acceptanceSettingsInvokes || [],
          rightButtons,
        }
      }, debugScreenshot)
      throw new Error(
        `acceptance panel not visible: ${JSON.stringify({ ...diagnostics, errors, requestLog })}; original=${String(error)}`,
      )
    }
    assert.deepEqual(errors, [])

    const state = await page.$eval(".acceptance-panel", (panel: HTMLElement) => {
      const summary = panel.querySelector<HTMLButtonElement>('[data-ui="acceptance-summary-toggle"]')
      const files = panel.querySelector<HTMLButtonElement>('[data-ui="acceptance-files-link"]')
      const goal = panel.querySelector<HTMLButtonElement>('[data-ui="acceptance-evidence-goal-pill"]')
      const rowWithPill = panel.querySelector<HTMLElement>(".acceptance-evidence-row[data-has-pill]")
      const rowWithoutPill = panel.querySelector<HTMLElement>(".acceptance-evidence-row:not([data-has-pill])")
      return {
        rawActionCount: panel.querySelectorAll(".acceptance-summary-toggle, .acceptance-files-link, .acceptance-evidence-goal-pill").length,
        summary: {
          tag: summary?.tagName ?? "",
          className: summary?.className ?? "",
          variant: summary?.dataset.variant ?? "",
          size: summary?.dataset.size ?? "",
          tone: summary?.dataset.tone ?? "",
        },
        files: {
          tag: files?.tagName ?? "",
          className: files?.className ?? "",
          variant: files?.dataset.variant ?? "",
          size: files?.dataset.size ?? "",
          tone: files?.dataset.tone ?? "",
        },
        goal: {
          tag: goal?.tagName ?? "",
          className: goal?.className ?? "",
          variant: goal?.dataset.variant ?? "",
          size: goal?.dataset.size ?? "",
          tone: goal?.dataset.tone ?? "",
        },
        rowWithPillColumns: rowWithPill ? getComputedStyle(rowWithPill).gridTemplateColumns.split(" ").length : 0,
        rowWithoutPillColumns: rowWithoutPill ? getComputedStyle(rowWithoutPill).gridTemplateColumns.split(" ").length : 0,
      }
    })
    assert.deepEqual(state, {
      rawActionCount: 0,
      summary: { tag: "BUTTON", className: "oc-button", variant: "ghost", size: "mini", tone: "accent" },
      files: { tag: "BUTTON", className: "oc-button", variant: "outline", size: "sm", tone: "neutral" },
      goal: { tag: "BUTTON", className: "oc-button", variant: "outline", size: "mini", tone: "neutral" },
      rowWithPillColumns: 3,
      rowWithoutPillColumns: 2,
    })

    await page.focus('[data-ui="acceptance-summary-toggle"]')
    assert.equal(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ui ?? ""),
      "acceptance-summary-toggle",
    )
    await page.click('[data-ui="acceptance-summary-toggle"]')
    await page.waitForFunction(() => document.querySelector(".acceptance-summary")?.getAttribute("data-clamped") === "false")

    const desktopScreenshot = await saveElementScreenshot(page, ".acceptance-panel", "acceptance-panel-button-owner-desktop.png")
    assert.ok(desktopScreenshot.endsWith("acceptance-panel-button-owner-desktop.png"))
    await page.setViewport({ width: 760, height: 820 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    try {
      await page.waitForSelector(".acceptance-panel", { visible: true, timeout: 15_000 })
    } catch (error) {
      const debugScreenshot = await savePageScreenshot(page, "acceptance-panel-button-owner-narrow-timeout.png")
      const diagnostics = await page.evaluate((screenshotPath: string) => {
        const chain: Array<Record<string, unknown>> = []
        let node: HTMLElement | null = document.querySelector(".acceptance-panel")
        while (node && chain.length < 8) {
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          chain.push({
            tag: node.tagName,
            id: node.id,
            className: node.className,
            hidden: node.hidden,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
            dataActive: node.dataset.active,
            dataSelected: node.dataset.selected,
            dataCollapsed: node.dataset.collapsed,
          })
          node = node.parentElement
        }
        return { debugScreenshot: screenshotPath, chain, bodyText: document.body.innerText.slice(0, 1200) }
      }, debugScreenshot)
      throw new Error(`acceptance panel hidden after narrow resize: ${JSON.stringify(diagnostics)}; original=${String(error)}`)
    }
    const narrowScreenshot = await saveElementScreenshot(
      page,
      "#rightPanelInspector .sections-stack",
      "acceptance-panel-button-owner-narrow.png",
    )
    assert.ok(narrowScreenshot.endsWith("acceptance-panel-button-owner-narrow.png"))
    await page.$eval("#rightPanelInspector .sections-stack", (node: HTMLElement) => {
      node.scrollTop = node.scrollHeight
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const narrowBottomScreenshot = await saveElementScreenshot(
      page,
      "#rightPanelInspector .sections-stack",
      "acceptance-panel-button-owner-narrow-bottom.png",
    )
    assert.ok(narrowBottomScreenshot.endsWith("acceptance-panel-button-owner-narrow-bottom.png"))

    await page.click('[data-ui="acceptance-evidence-goal-pill"]')
    await page.click('[data-ui="acceptance-files-link"]')
    assert.deepEqual(await page.evaluate(() => (window as any).__acceptanceFocusEvents), [
      { goalRunID: "gr_acceptance_typecheck" },
      { goalRunID: null },
    ])
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
