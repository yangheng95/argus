import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const enUSMessages = JSON.parse(readFileSync(resolve("packages/overlay/src/i18n/en-US.json"), "utf8")) as Record<
  string,
  string
>
const browserPreviewLoadingText = enUSMessages["browser_preview.loading"]

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

test("loading spinners animate through shared motion tokens and stop for reduced motion", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-spinner-motion"
  const projectRoot = "D:/overlay/workspace/spinner-motion"
  const task = {
    id: taskID,
    title: "Spinner motion",
    directory: projectRoot,
    status: "active",
    sessionID: "session-spinner-motion",
    time: { created: now - 30_000, started: now - 25_000, updated: now - 1_000 },
  }
  const board = {
    snapshotVersion: "spinner-motion-board",
    lastSequence: 0,
    task,
    run: { executor: "opencorvus", phase: "build", status: "active" },
    overview: {
      headline: "Spinner motion",
      summary: "Hold browser preview target resolution to inspect the loading spinner.",
      controls: {},
    },
    interactions: [],
  }
  let releasePreviewTarget: ((response: Response) => void) | undefined
  const previewTargetHold = new Promise<Response>((resolve) => {
    releasePreviewTarget = resolve
  })

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "spinner-motion" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/mission") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: projectRoot })
    if (path === "/vcs")
      return send({
        branch: "spinner-motion",
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
      return send({
        active: "general",
        project_active: "general",
        session_active: null,
        default: "general",
        targets: [],
        profiles: [],
      })
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
      return send({ taskID, sessionID: "session-spinner-motion", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`) return previewTargetHold
    if (path === `/task/${taskID}/conversation/events`)
      return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send([])
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
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string; projectRoot: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID, projectRoot },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(`.task-row-main[data-task-id="${taskID}"]`, { state: "attached", timeout: 15_000 })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]', {
      visible: true,
      timeout: 15_000,
    })
    await page.click('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
    await page.waitForSelector('.browser-preview-empty[data-status="loading"] .card__spinner', {
      visible: true,
      timeout: 15_000,
    })
    const previewLoadingStatus = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.browser-preview-empty[data-status="loading"]')
      const status = document.querySelector<HTMLElement>('.browser-preview-status[data-status="loading"]')
      return {
        stageRole: stage?.getAttribute("role") ?? "",
        stageLive: stage?.getAttribute("aria-live") ?? "",
        stageText: stage?.textContent?.trim() ?? "",
        statusRole: status?.getAttribute("role") ?? "",
        statusLive: status?.getAttribute("aria-live") ?? "",
        statusText: status?.textContent?.trim() ?? "",
      }
    })
    assert.equal(previewLoadingStatus.stageRole, "status")
    assert.equal(previewLoadingStatus.stageLive, "polite")
    assert.equal(previewLoadingStatus.stageText, browserPreviewLoadingText)
    assert.equal(previewLoadingStatus.statusRole, "status")
    assert.equal(previewLoadingStatus.statusLive, "polite")
    assert.equal(previewLoadingStatus.statusText, browserPreviewLoadingText)

    await page.waitForSelector('.app-notifications[data-surface="toast"]', { state: "attached", timeout: 15_000 })
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.app-notifications[data-surface="toast"]')
      if (!root) throw new Error("toast notification surface missing")
      const notice = document.createElement("section")
      notice.className = "app-notification"
      notice.dataset.tone = "progress"
      notice.setAttribute("role", "status")
      notice.setAttribute("aria-live", "polite")
      notice.innerHTML = [
        '<div class="app-notification__mark" aria-hidden="true"><span class="app-notification__spinner"></span></div>',
        '<div class="app-notification__copy">',
        '<div class="app-notification__title">Loading fixture</div>',
        '<div class="app-notification__message">Progress spinner motion fixture.</div>',
        "</div>",
      ].join("")
      root.appendChild(notice)
    })
    await page.waitForSelector('.app-notification[data-tone="progress"] .app-notification__spinner', {
      visible: true,
      timeout: 15_000,
    })
    assert.deepEqual(errors, [])

    const motion = await page.evaluate(() => {
      const styleFor = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`missing ${selector}`)
        const style = getComputedStyle(node)
        return {
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          animationTimingFunction: style.animationTimingFunction,
          animationPlayState: style.animationPlayState,
        }
      }
      return {
        card: styleFor('.browser-preview-empty[data-status="loading"] .card__spinner'),
        notification: styleFor('.app-notification[data-tone="progress"] .app-notification__spinner'),
      }
    })
    assert.deepEqual(motion, {
      card: {
        animationName: "oc-spin",
        animationDuration: "0.7s",
        animationTimingFunction: "linear",
        animationPlayState: "running",
      },
      notification: {
        animationName: "oc-spin",
        animationDuration: "0.9s",
        animationTimingFunction: "linear",
        animationPlayState: "running",
      },
    })

    const previewScreenshot = await saveElementScreenshot(
      page,
      '.browser-preview-empty[data-status="loading"]',
      "loading-spinner-browser-preview.png",
    )
    const notificationScreenshot = await saveElementScreenshot(
      page,
      '.app-notification[data-tone="progress"]',
      "loading-spinner-notification.png",
    )
    assert.ok(previewScreenshot.endsWith("loading-spinner-browser-preview.png"))
    assert.ok(notificationScreenshot.endsWith("loading-spinner-notification.png"))

    await page.emulateMedia({ reducedMotion: "reduce" })
    const reduced = await page.evaluate(() => {
      const styleFor = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`missing ${selector}`)
        const style = getComputedStyle(node)
        return { animationName: style.animationName, animationDuration: style.animationDuration }
      }
      return {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        card: styleFor('.browser-preview-empty[data-status="loading"] .card__spinner'),
        notification: styleFor('.app-notification[data-tone="progress"] .app-notification__spinner'),
      }
    })
    assert.equal(reduced.reducedMotion, true)
    assert.equal(reduced.card.animationName, "none")
    assert.equal(reduced.notification.animationName, "none")
  } finally {
    releasePreviewTarget?.(
      send({
        taskID,
        kind: "missing",
        status: "missing",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      }),
    )
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
