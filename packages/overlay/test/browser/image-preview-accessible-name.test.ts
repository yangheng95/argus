import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">
  <rect width="160" height="90" rx="8" fill="#f8fafc"/>
  <path d="M16 70 L52 48 L88 58 L124 24 L144 32" fill="none" stroke="#2563eb" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="124" cy="24" r="7" fill="#16a34a"/>
</svg>`

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

test("mounted markdown image triggers use the shared preview contract", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-markdown-image-preview"
  const projectRoot = "D:/overlay/workspace/image-preview"
  const task = {
    id: taskID,
    title: "Markdown image preview",
    directory: projectRoot,
    status: "completed",
    sessionID: "session-markdown-image-preview",
    time: { created: now - 20_000, updated: now - 1_000 },
  }
  const markdownText = [
    "Review these screenshots.",
    "",
    "![Revenue chart](/attachment/project/chart.svg)",
    "",
    "![Cash flow screenshot](/attachment/project/chart.svg)",
    "",
    "Done.",
  ].join("\n")
  const board = {
    snapshotVersion: "markdown-image-preview-board",
    lastSequence: 0,
    task,
    overview: {
      headline: "Markdown image preview",
      summary: "Markdown image triggers should open the shared preview host.",
      controls: {},
    },
    goalWorkflows: [],
    requirements: [],
    changes: [],
    interactions: [],
  }
  const transcript = [
    {
      parts: [{ type: "text", text: markdownText }],
      info: {
        id: "msg-markdown-images",
        sessionID: "session-markdown-image-preview",
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: now - 8_000 },
      },
    },
  ]

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/attachment/project/chart.svg")
      return new Response(chartSvg, { headers: { "content-type": "image/svg+xml; charset=utf-8" } })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "markdown-image-preview" })
    if (path === "/global/projects/discover") return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/mission") return send([])
    if (path === "/executor") return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: projectRoot })
    if (path === "/vcs")
      return send({
        branch: "image-preview",
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
        transcript,
        timeline: transcript,
        events: [],
        view: {
          sessions: [
            {
              sessionID: "session-markdown-image-preview",
              stage: "assistant",
              messageIDs: ["msg-markdown-images"],
              firstMessageTime: now - 8_000,
              placement: "top_level",
            },
          ],
        },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    if (path === `/task/${taskID}/operator-model-context`)
      return send({ taskID, sessionID: "session-markdown-image-preview", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`) return send({ target: null, verification: null })
    if (path === `/task/${taskID}/conversation/events`) return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send(transcript)
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace` })
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
    await page.setViewport({ width: 960, height: 720 })
    await page.evaluateOnNewDocument((seed: { serverUrl: string; taskID: string; projectRoot: string }) => {
      ;(window as any).__visibleMarkdownImageTriggers = () =>
        Array.from(document.querySelectorAll<HTMLElement>(".msg-text [data-image-preview-trigger]")).filter((trigger) => {
          const style = getComputedStyle(trigger)
          const rect = trigger.getBoundingClientRect()
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0
        })
      localStorage.setItem("oc_locale", "zh-CN")
      localStorage.setItem("oc_theme", "light")
      localStorage.setItem("oc_server_url", seed.serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", seed.projectRoot)
      localStorage.setItem("oc_workspace_directory", seed.projectRoot)
      localStorage.setItem("oc_workspace_task", seed.taskID)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, { serverUrl: server.origin, taskID, projectRoot })

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(
      () =>
        typeof (window as any).applyDirectory === "function" &&
        typeof (window as any).loadTasks === "function" &&
        typeof (window as any).selectTask === "function",
    )
    await page.evaluate(async (seed: { taskID: string; projectRoot: string }) => {
      await (window as any).applyDirectory(seed.projectRoot, { persist: false, restoreWorkspace: false, save: false })
      await (window as any).loadTasks()
      await (window as any).selectTask(seed.taskID, { directory: seed.projectRoot })
    }, { taskID, projectRoot })

    await page
      .waitForFunction(() => (window as any).__visibleMarkdownImageTriggers().length === 2, {
        timeout: 15_000,
      })
      .catch(async (error: unknown) => {
        const state = await page.evaluate(() => ({
          cards: Object.keys((window as any).cardTree?.cards ?? {}),
          selectedSource: (window as any).boardStore?.selectedSource ?? null,
          boardTask: (window as any).boardStore?.board?.task ?? null,
          triggerCount: document.querySelectorAll("[data-image-preview-trigger]").length,
          visibleTriggerCount: (window as any).__visibleMarkdownImageTriggers().length,
          messageText: Array.from(document.querySelectorAll(".msg-text")).map((node) => node.textContent?.trim() ?? ""),
          bodySample: document.body.textContent?.slice(0, 1200) ?? "",
        }))
        throw new Error(`markdown image preview triggers did not render: ${JSON.stringify(state)}`, { cause: error })
      })

    const triggerState = await page.evaluate(() => {
      const triggers = (window as any).__visibleMarkdownImageTriggers() as HTMLElement[]
      return triggers.map((trigger) => ({
        ariaLabel: trigger.getAttribute("aria-label"),
        title: trigger.getAttribute("title"),
        dataUi: trigger.getAttribute("data-ui"),
        dataVariant: trigger.getAttribute("data-variant"),
        dataSize: trigger.getAttribute("data-size"),
        dataTone: trigger.getAttribute("data-tone"),
        src: trigger.getAttribute("data-image-preview-src"),
        alt: trigger.getAttribute("data-image-preview-alt"),
        imageAlt: trigger.querySelector("img")?.getAttribute("alt"),
        inMountedMessage: Boolean(trigger.closest(".msg-text")),
        usesButtonPrimitive: trigger.classList.contains("oc-button"),
      }))
    })
    assert.deepEqual(triggerState, [
      {
        ariaLabel: "打开图片预览：Revenue chart",
        title: "打开图片预览：Revenue chart",
        dataUi: "image-preview-trigger",
        dataVariant: "ghost",
        dataSize: "md",
        dataTone: "neutral",
        src: "/attachment/project/chart.svg",
        alt: "Revenue chart",
        imageAlt: "Revenue chart",
        inMountedMessage: true,
        usesButtonPrimitive: true,
      },
      {
        ariaLabel: "打开图片预览：Cash flow screenshot",
        title: "打开图片预览：Cash flow screenshot",
        dataUi: "image-preview-trigger",
        dataVariant: "ghost",
        dataSize: "md",
        dataTone: "neutral",
        src: "/attachment/project/chart.svg",
        alt: "Cash flow screenshot",
        imageAlt: "Cash flow screenshot",
        inMountedMessage: true,
        usesButtonPrimitive: true,
      },
    ])

    await page.keyboard.press("Tab")
    const focusAttempt = await page.evaluate(() => {
      const trigger = ((window as any).__visibleMarkdownImageTriggers() as HTMLElement[])[0]
      if (!trigger) throw new Error("missing visible markdown image trigger")
      trigger.focus()
      const style = getComputedStyle(trigger)
      return {
        active: document.activeElement === trigger,
        activeTag: document.activeElement?.tagName ?? "",
        activeClass: (document.activeElement as HTMLElement | null)?.className ?? "",
        disabled: (trigger as HTMLButtonElement).disabled,
        tabIndex: trigger.tabIndex,
        display: style.display,
        visibility: style.visibility,
        outerHTML: trigger.outerHTML.slice(0, 240),
      }
    })
    assert.equal(focusAttempt.active, true, `expected markdown trigger to accept focus: ${JSON.stringify(focusAttempt)}`)
    const focusState = await page.evaluate(() => {
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!trigger?.matches(".msg-text [data-image-preview-trigger]")) return { active: false }
      const style = getComputedStyle(trigger)
      return {
        active: true,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineColor: style.outlineColor,
      }
    })
    assert.equal(focusState.active, true)
    assert.notEqual(focusState.outlineStyle, "none")
    assert.ok(focusState.outlineWidth >= 1, `expected visible focus outline: ${JSON.stringify(focusState)}`)
    assert.notEqual(focusState.outlineColor, "rgba(0, 0, 0, 0)")

    const focusScreenshot = await saveElementScreenshot(page, ".chat-scroll", "image-preview-mounted-markdown-focus.png")
    await page.evaluate(() => {
      const trigger = ((window as any).__visibleMarkdownImageTriggers() as HTMLElement[])[0]
      if (!trigger) throw new Error("missing visible markdown image trigger")
      trigger.click()
    })
    await page.waitForSelector("#imagePreviewDialog .image-preview-dialog__image")
    const dialogState = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>("#imagePreviewDialog")
      const image = dialog?.querySelector<HTMLImageElement>(".image-preview-dialog__image")
      return {
        open: Boolean(dialog),
        title: dialog?.querySelector<HTMLElement>(".dialog-title")?.textContent?.trim() ?? "",
        imageAlt: image?.getAttribute("alt") ?? "",
        imageSrc: image?.getAttribute("src") ?? "",
      }
    })
    assert.equal(dialogState.open, true)
    assert.equal(dialogState.title, "Revenue chart")
    assert.equal(dialogState.imageAlt, "Revenue chart")
    assert.equal(dialogState.imageSrc, "/attachment/project/chart.svg")
    const dialogScreenshot = await saveElementScreenshot(page, "#imagePreviewDialog", "image-preview-mounted-markdown-dialog.png")

    assert.ok(focusScreenshot.endsWith("image-preview-mounted-markdown-focus.png"))
    assert.ok(dialogScreenshot.endsWith("image-preview-mounted-markdown-dialog.png"))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
