import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"

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
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

const expertSquadCatalog = expertSquadCatalogFixture({
  active: "default",
  projectActive: "default",
  defaultSquad: "general",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  squads: [
    {
      id: "general",
      label: "General",
      description: "General implementation profile.",
      built_in: true,
    },
    {
      id: "default",
      label: "Default",
      description: "Default implementation profile.",
      built_in: false,
    },
  ],
})

async function waitForPageState(page: any, predicate: () => boolean, label: string, diagnostics?: () => unknown) {
  for (let i = 0; i < 100; i += 1) {
    if (await page.evaluate(predicate)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const snapshot = await page.evaluate(() => ({
    centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
    browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
    openPanels: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']")).map(
      (node) => node.dataset.workbenchView || node.id,
    ),
    rightPreviewButton:
      document.querySelector<HTMLElement>(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]',
      )?.outerHTML || "",
    rightButtons: Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="side-activity-button"][data-side="right"]'),
    ).map((node) => ({
      activity: node.dataset.activity || "",
      active: node.dataset.active || "",
      pressed: node.getAttribute("aria-pressed") || "",
    })),
    activeTask:
      document.querySelector<HTMLElement>(".global-task-row[data-active='true'] .task-row-main")?.dataset.taskId || "",
    taskRows: Array.from(document.querySelectorAll<HTMLElement>(".task-row-main")).map((node) => ({
      taskID: node.dataset.taskId || "",
      ariaCurrent: node.getAttribute("aria-current") || "",
      text: node.textContent?.trim().slice(0, 120) || "",
    })),
    browserPreviewStage: document.querySelector<HTMLElement>(".browser-preview-stage")?.outerHTML.slice(0, 3000) || "",
    bodyText: document.body.textContent?.slice(0, 1400) || "",
  }))
  assert.fail(`Timed out waiting for ${label}\n${JSON.stringify({ snapshot, diagnostics: diagnostics?.() }, null, 2)}`)
}

async function waitForPageText(page: any, text: string, label: string) {
  for (let i = 0; i < 100; i += 1) {
    if (await page.evaluate((value) => document.body.textContent?.includes(value) ?? false, text)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const snapshot = await page.evaluate(() => ({
    centerOpen: document.querySelector<HTMLElement>("#centerWorkbench")?.dataset.open || "",
    browserActive: document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active || "",
    openPanels: Array.from(document.querySelectorAll<HTMLElement>(".center-workbench-view[data-open='true']")).map(
      (node) => node.dataset.workbenchView || node.id,
    ),
    rightPreviewButton:
      document.querySelector<HTMLElement>(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]',
      )?.outerHTML || "",
    activeTask:
      document.querySelector<HTMLElement>(".global-task-row[data-active='true'] .task-row-main")?.dataset.taskId || "",
    bodyText: document.body.textContent?.slice(0, 1400) || "",
  }))
  assert.fail(`Timed out waiting for ${label}\n${JSON.stringify(snapshot, null, 2)}`)
}

async function openBrowserPreviewFromTask(page: any, taskID: string, label: string, diagnostics?: () => unknown) {
  const tasksButton =
    '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]'
  await page.waitForSelector(tasksButton, { visible: true })
  await page.click(tasksButton)
  await waitForPageState(
    page,
    () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
    `${label} task activity visible before preview selection`,
    diagnostics,
  )
  const taskRow = `.task-row-main[data-task-id="${taskID}"]`
  const browserButton = '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]'
  await page.waitForSelector(taskRow, { visible: true })
  await page.click(taskRow)
  await page.waitForSelector(browserButton, { visible: true })
  await page.click(browserButton)
}

test(
  "browser preview panel captures task-scoped manifest evidence through the backend",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const taskID = "tsk_browserpreview_e2e"
    const targetID = "art_previewtarget_e2e"
    const alternateTargetID = "art_previewtarget_alt_e2e"
    const failingTargetID = "art_previewtarget_fail_e2e"
    const evidenceID = "art_previewevidence_desktop"
    const projectRoot = "D:/overlay/workspace/app"
    const captureBodies: unknown[] = []
    const selectedTargets: unknown[] = []
    const errors: string[] = []
    const requestLog: string[] = []
    let selectedTargetID = targetID

    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAABACAYAAADbER1AAAAAdElEQVR4AQXBAQ3AIAADsGaqEDMxFzMvyOKt892XqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZ+SrVB/bxIzVQAAAAASUVORK5CYII=",
      "base64",
    )
    let serverOrigin = ""
    const previewTarget = () => `${serverOrigin}/preview-target`
    const alternatePreviewTarget = () => `${serverOrigin}/preview-target-alt`
    const failingPreviewTarget = () => `${serverOrigin}/preview-target-fail`
    const selectedPreviewTarget = () =>
      selectedTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget()
    let releaseRepeatedPrimaryCapture: (() => void) | undefined
    const repeatedPrimaryCaptureGate = new Promise<void>((resolve) => {
      releaseRepeatedPrimaryCapture = resolve
    })
    let pauseNextTargetResponse = false
    let releaseTargetRefetch: (() => void) | undefined
    let targetRefetchGate = Promise.resolve()
    const pauseTargetRefetchOnce = () => {
      pauseNextTargetResponse = true
      targetRefetchGate = new Promise<void>((resolve) => {
        releaseTargetRefetch = resolve
      })
    }
    const captureSummary = (target: string, primaryCaptureIndex = 1) =>
      target === alternateTargetID
        ? "alternate target desktop capture passed"
        : primaryCaptureIndex > 1
          ? "primary target desktop recapture passed"
          : "primary target desktop capture passed"
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const task = {
      id: taskID,
      orderKey: testTaskOrderKey(taskID, now - 10_000),
      directory: projectRoot,
      status: "active",
      sessionID: "ses_preview_e2e",
      request: "Verify preview evidence",
      title: "Verify preview evidence",
      time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
    }
    const board = {
      snapshotVersion: "preview-e2e-board",
      lastSequence: 0,
      task,
      overview: {
        headline: "Preview evidence",
        summary: "Backend-owned preview target is ready.",
        controls: {},
      },
      lanes: [],
      interactions: [],
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${url.pathname}${url.search}`)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/preview-target")
        return new Response("<main>Preview target is live</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      if (path === "/preview-target-alt")
        return new Response("<main>Alternate preview target is live</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/projects/discover")
        return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/mission") return send([])
      if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/path") return send({ directory: projectRoot })
      if (path === "/vcs") {
        return send({
          branch: "preview-e2e",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config" && req.method === "PATCH") return send({ model: "" })
      if (path === "/config") return send({ model: "" })
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/agent") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === `/task/${taskID}/board`) {
        return send(board, {
          headers: { etag: `"board-${board.task.time.updated}"` },
        })
      }
      if (path === `/task/${taskID}/conversation`) {
        return send({
          lastSequence: 0,
          board,
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
          history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          messageWatermark: 0,
        })
      }
      if (path === `/task/${taskID}/transcript`) return send([])
      if (path === `/task/${taskID}/trace`)
        return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
      if (
        path === "/task/events" ||
        path === `/task/${taskID}/events` ||
        path === `/task/${taskID}/conversation/events`
      ) {
        return eventStream()
      }
      if (path === `/task/${taskID}/browser-preview`) {
        if (pauseNextTargetResponse) {
          pauseNextTargetResponse = false
          await targetRefetchGate
        }
        return send({
          id: selectedTargetID,
          taskID,
          kind: "task-url",
          status: "ready",
          projectRoot,
          url: selectedPreviewTarget(),
          viewports,
          diagnostics: ["Resolved saved browser preview target."],
          candidates: [
            {
              id: targetID,
              url: previewTarget(),
              source: "task-artifact",
              selected: selectedTargetID === targetID,
              timeUpdated: now - 500,
            },
            {
              id: alternateTargetID,
              url: alternatePreviewTarget(),
              source: "task-artifact",
              selected: selectedTargetID === alternateTargetID,
              timeUpdated: now - 250,
            },
            {
              id: failingTargetID,
              url: failingPreviewTarget(),
              source: "task-artifact",
              selected: false,
              timeUpdated: now - 100,
            },
          ],
          source: "task-artifact",
        })
      }
      if (path === `/task/${taskID}/browser-preview/target` && req.method === "PUT") {
        const body = await req.json()
        selectedTargets.push(body)
        if (body?.targetID === failingTargetID) {
          return send({ message: "target selection unavailable" }, { status: 500 })
        }
        if (body?.targetID === alternateTargetID || body?.targetID === targetID) {
          selectedTargetID = body.targetID
        }
        return send({
          id: selectedTargetID,
          taskID,
          kind: "task-url",
          status: "ready",
          projectRoot,
          url: selectedPreviewTarget(),
          viewports,
          diagnostics: [`Selected task browser preview target ${selectedTargetID}.`],
          candidates: [
            {
              id: targetID,
              url: previewTarget(),
              source: "task-artifact",
              selected: selectedTargetID === targetID,
              timeUpdated: now - 500,
            },
            {
              id: alternateTargetID,
              url: alternatePreviewTarget(),
              source: "task-artifact",
              selected: selectedTargetID === alternateTargetID,
              timeUpdated: now - 250,
            },
            {
              id: failingTargetID,
              url: failingPreviewTarget(),
              source: "task-artifact",
              selected: false,
              timeUpdated: now - 100,
            },
          ],
          source: "task-artifact",
        })
      }
      if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
        const body = await req.json()
        captureBodies.push(body)
        const responseTargetID = body?.targetID === alternateTargetID ? alternateTargetID : targetID
        const primaryCaptureIndex =
          responseTargetID === targetID
            ? captureBodies.filter((entry) => (entry as { targetID?: string })?.targetID === targetID).length
            : 0
        if (responseTargetID === targetID && primaryCaptureIndex > 1) {
          await repeatedPrimaryCaptureGate
        }
        if (responseTargetID === alternateTargetID) {
          await new Promise((resolve) => setTimeout(resolve, 1_200))
        }
        const desktopSummary = captureSummary(responseTargetID, primaryCaptureIndex)
        return send({
          status: "passed",
          projectRoot,
          target: {
            id: responseTargetID,
            taskID,
            latestEvidenceIDs: {
              desktop: evidenceID,
              tablet: "art_previewevidence_tablet",
              mobile: "art_previewevidence_mobile",
            },
            kind: "task-url",
            status: "ready",
            projectRoot,
            url: responseTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget(),
            viewports,
            diagnostics: ["Resolved saved browser preview target."],
            candidates: [],
            source: "task-artifact",
          },
          viewports,
          captures: {
            desktop: {
              captured: true,
              passed: true,
              url: responseTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget(),
              requested_viewport: { width: 1440, height: 900 },
              viewport: { width: 1440, height: 900, capped: false },
              summary: desktopSummary,
              path: `${projectRoot}/.opencorvus/tasks/${taskID}/browser-preview/desktop.png`,
              manifest: {
                operations: [{ viewportIDs: ["desktop", "tablet", "mobile"], diagnosticsPath: "diagnostics.json" }],
              },
            },
            tablet: {
              captured: true,
              passed: true,
              url: responseTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget(),
              requested_viewport: { width: 834, height: 1112 },
              viewport: { width: 834, height: 1112, capped: false },
              summary: "manifest-backed tablet capture passed",
              path: `${projectRoot}/.opencorvus/tasks/${taskID}/browser-preview/tablet.png`,
              manifest: {
                operations: [{ viewportIDs: ["desktop", "tablet", "mobile"], diagnosticsPath: "diagnostics.json" }],
              },
            },
            mobile: {
              captured: true,
              passed: true,
              url: responseTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget(),
              requested_viewport: { width: 390, height: 844 },
              viewport: { width: 390, height: 844, capped: false },
              summary: "manifest-backed mobile capture passed",
              path: `${projectRoot}/.opencorvus/tasks/${taskID}/browser-preview/mobile.png`,
              manifest: {
                operations: [{ viewportIDs: ["desktop", "tablet", "mobile"], diagnosticsPath: "diagnostics.json" }],
              },
            },
          },
          evidenceIDs: {
            desktop: evidenceID,
            tablet: "art_previewevidence_tablet",
            mobile: "art_previewevidence_mobile",
          },
          diagnostics: [
            desktopSummary,
            "manifest-backed tablet capture passed",
            "manifest-backed mobile capture passed",
          ],
        })
      }
      if (path === `/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`) {
        return new Response(pngBytes, {
          headers: { "content-type": "image/png" },
        })
      }
      return send({})
    })
    serverOrigin = server.origin

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      installBrowserErrorCollector(page, {
        allowResponse(response) {
          return response.status === 500 && response.path === `/task/${taskID}/browser-preview/target`
        },
      })
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceTaskID: "tsk_browserpreview_e2e",
          workspaceDirectory: "D:/overlay/workspace/app",
        }
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") return settings
              if (command === "overlay_settings_save") {
                Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                return true
              }
              if (command === "overlay_open_path") return true
              if (command === "overlay_open_url") return true
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => true,
                hide: async () => true,
                startDragging: async () => true,
                minimize: async () => true,
              }
            },
          },
        }
      }, server.origin)
      page.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`)
      })
      page.on("requestfailed", (request) => {
        if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
        errors.push(`requestfailed: ${request.url()}`)
      })
      page.on("response", (response) => {
        if (response.status() === 500 && response.url().includes(`/task/${taskID}/browser-preview/target`)) return
        if (response.status() >= 400) errors.push(`response${response.status()}: ${response.url()}`)
      })
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      await waitForPageState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "online connection badge",
        () => ({ errors, requestLog }),
      )
      await waitForPageState(
        page,
        () =>
          document.querySelector<HTMLElement>(".task-row-main[data-task-id='tsk_browserpreview_e2e']")?.dataset
            .taskId === "tsk_browserpreview_e2e",
        "browser preview task row rendered",
        () => ({ errors, requestLog }),
      )
      await openBrowserPreviewFromTask(page, taskID, "browser preview", () => ({ errors, requestLog }))
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true",
        "browser workbench active",
        () => ({ errors, requestLog }),
      )
      await waitForPageText(page, previewTarget(), "preview target text")
      const candidateTriggerSelector = '[data-ui="browser-preview-candidate-trigger"]'
      await page.waitForSelector(candidateTriggerSelector, { visible: true })
      let triggerFocusedByKeyboard = false
      for (let idx = 0; idx < 80; idx += 1) {
        await page.keyboard.press("Tab")
        triggerFocusedByKeyboard = await page.$eval(candidateTriggerSelector, (node) => document.activeElement === node)
        if (triggerFocusedByKeyboard) break
      }
      assert.equal(triggerFocusedByKeyboard, true)
      const triggerFocusState = await page.$eval(candidateTriggerSelector, (node) => {
        const element = node as HTMLElement
        const styles = getComputedStyle(element)
        return {
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: styles.outlineStyle,
          outlineWidth: styles.outlineWidth,
          outlineColor: styles.outlineColor,
        }
      })
      assert.equal(triggerFocusState.focusVisible, true)
      assert.notEqual(triggerFocusState.outlineStyle, "none")
      assert.notEqual(triggerFocusState.outlineWidth, "0px")
      assert.notEqual(triggerFocusState.outlineColor, "rgba(0, 0, 0, 0)")

      const triggerFocusScreenshotPath = resolve(".scratch/browser-preview-candidate-trigger-focus-visible.png")
      mkdirSync(dirname(triggerFocusScreenshotPath), { recursive: true })
      const previewPanel = await page.$(".browser-preview-panel")
      assert.ok(previewPanel)
      writeFileSync(triggerFocusScreenshotPath, await previewPanel.screenshot({}))

      await page.click('[aria-label="Capture Playwright evidence from the saved backend preview target."]')
      await waitForPageText(page, "primary target desktop capture passed", "primary target evidence summary")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
          return (
            evidence?.textContent?.includes("primary target desktop capture passed") === true &&
            !live &&
            !!img &&
            img.complete &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
          )
        },
        "primary browser preview evidence screenshot rendered in the stage",
        () => ({ errors, requestLog }),
      )
      const evidenceScreenshotPath = resolve(".scratch/browser-preview-evidence-previewable-image.png")
      writeFileSync(evidenceScreenshotPath, await previewPanel.screenshot({}))

      pauseTargetRefetchOnce()
      await page.click('button[title="Refresh the saved preview evidence."]')
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const capture = document.querySelector<HTMLButtonElement>(".browser-preview-capture-button")
          const candidate = document.querySelector<HTMLButtonElement>(
            '[data-ui="browser-preview-candidate-trigger"]',
          )
          const viewports = [
            ...document.querySelectorAll<HTMLButtonElement>('[data-ui="browser-preview-viewport"]'),
          ]
          return (
            stage?.querySelector<HTMLElement>("[data-status='loading']") !== null &&
            stage.textContent?.includes("Resolving preview target") === true &&
            capture?.disabled === true &&
            candidate?.disabled === true &&
            viewports.length > 0 &&
            viewports.every((button) => button.disabled)
          )
        },
        "capture, target selection, and viewport controls are disabled while preview target refetch is pending",
        () => ({ errors, requestLog, captureBodies }),
      )
      const targetRefetchLoadingScreenshotPath = resolve(".scratch/browser-preview-target-refetch-loading.png")
      writeFileSync(targetRefetchLoadingScreenshotPath, await previewPanel.screenshot({}))
      const capturesBeforeTargetRefetchSettles = captureBodies.length
      releaseTargetRefetch?.()
      await waitForPageState(
        page,
        () =>
          document.querySelector<HTMLButtonElement>(".browser-preview-capture-button")?.disabled === false &&
          document.querySelector<HTMLButtonElement>('[data-ui="browser-preview-candidate-trigger"]')?.disabled ===
            false &&
          [
            ...document.querySelectorAll<HTMLButtonElement>('[data-ui="browser-preview-viewport"]'),
          ].every((button) => !button.disabled),
        "capture, target selection, and viewport controls are enabled after preview target refetch settles",
        () => ({ errors, requestLog, captureBodies }),
      )
      assert.equal(
        captureBodies.length,
        capturesBeforeTargetRefetchSettles,
        "target refresh loading must not submit a stale capture",
      )

      await page.click('[aria-label="Capture Playwright evidence from the saved backend preview target."]')
      await waitForPageState(
        page,
        () =>
          document
            .querySelector<HTMLElement>(".browser-preview-evidence-status")
            ?.textContent?.includes("Capturing evidence") === true,
        "repeat capture enters a loading state",
        () => ({ errors, requestLog, captureBodies }),
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const status = document.querySelector<HTMLElement>(".browser-preview-evidence-status")
          const staleImage = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const refresh = document.querySelector<HTMLButtonElement>(
            'button[title="Refresh the saved preview evidence."]',
          )
          return (
            !status?.textContent?.includes("primary target desktop capture passed") &&
            stage?.textContent?.includes("primary target desktop capture passed") !== true &&
            refresh?.disabled === true &&
            !staleImage
          )
        },
        "stale primary evidence is hidden and refresh is disabled while same-target recapture is pending",
        () => ({ errors, requestLog, captureBodies }),
      )
      const boardRequestsBeforeRefresh = requestLog.filter((entry) =>
        entry.includes(`/task/${taskID}/board`),
      ).length
      await page.evaluate(() => (window as any).loadBoard({ sync: true }))
      assert.ok(
        requestLog.filter((entry) => entry.includes(`/task/${taskID}/board`)).length > boardRequestsBeforeRefresh,
        `board refresh during capture did not reach the backend: ${JSON.stringify(requestLog, null, 2)}`,
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const loading = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-capture-loading"]')
          const refresh = document.querySelector<HTMLButtonElement>(
            'button[title="Refresh the saved preview evidence."]',
          )
          const staleImage = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            loading?.dataset.status === "loading" &&
            loading.textContent?.includes("Capturing evidence") === true &&
            refresh?.disabled === true &&
            !staleImage &&
            stage?.textContent?.includes("primary target desktop capture passed") !== true
          )
        },
        "board refresh preserves pending same-target recapture state",
        () => ({ errors, requestLog, captureBodies }),
      )
      releaseRepeatedPrimaryCapture?.()
      await waitForPageText(
        page,
        "primary target desktop recapture passed",
        "primary target recapture evidence summary",
      )

      await page.click('[data-ui="browser-preview-candidate-trigger"]')
      await page.waitForSelector(`[data-ui="browser-preview-candidate-option"][data-target-id="${failingTargetID}"]`)
      await page.click(`[data-ui="browser-preview-candidate-option"][data-target-id="${failingTargetID}"]`)
      await waitForPageState(
        page,
        () => {
          const error = document.querySelector<HTMLElement>('[data-ui="browser-preview-selection-failed"]')
          const loading = document.querySelector<HTMLElement>(".browser-preview-stage [data-status='loading']")
          return (
            error?.textContent?.includes("Preview target selection failed.") === true &&
            error.textContent.includes("target selection unavailable") &&
            !loading
          )
        },
        "failed target selection clears pending state and shows a visible error",
        () => ({ errors, requestLog, selectedTargets }),
      )
      pauseTargetRefetchOnce()
      const boardRequestsBeforeSelectionRefresh = requestLog.filter((entry) =>
        entry.includes(`/task/${taskID}/board`),
      ).length
      await page.evaluate(() => (window as any).loadBoard({ sync: true }))
      assert.ok(
        requestLog.filter((entry) => entry.includes(`/task/${taskID}/board`)).length >
          boardRequestsBeforeSelectionRefresh,
        `board refresh after failed target selection did not reach the backend: ${JSON.stringify(requestLog, null, 2)}`,
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const loading = stage?.querySelector<HTMLElement>("[data-status='loading']")
          const selectionError = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-selection-failed"]')
          return (
            loading?.textContent?.includes("Resolving preview target") === true &&
            selectionError === null &&
            stage?.textContent?.includes("target selection unavailable") !== true
          )
        },
        "board refresh clears stale target selection failure while target refetch is pending",
        () => ({ errors, requestLog, selectedTargets }),
      )
      const selectionRefreshLoadingScreenshotPath = resolve(
        ".scratch/browser-preview-selection-error-refetch-loading.png",
      )
      writeFileSync(selectionRefreshLoadingScreenshotPath, await previewPanel.screenshot({}))
      releaseTargetRefetch?.()
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          return stage?.querySelector<HTMLElement>('[data-ui="browser-preview-selection-failed"]') === null
        },
        "stale target selection failure remains cleared after target refetch settles",
        () => ({ errors, requestLog, selectedTargets }),
      )
      await page.click('[data-ui="browser-preview-candidate-trigger"]')
      await page.waitForSelector(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await page.click(`[data-ui="browser-preview-candidate-option"][data-target-id="${alternateTargetID}"]`)
      await waitForPageText(page, alternatePreviewTarget(), "alternate preview target text")
      await waitForPageState(
        page,
        () => !(document.body.textContent || "").includes("primary target desktop capture passed"),
        "stale preview evidence hidden after alternate target selection",
        () => ({ errors, requestLog, captureBodies }),
      )
      await page.click('[aria-label="Capture Playwright evidence from the saved backend preview target."]')
      await waitForPageText(page, "alternate target desktop capture passed", "alternate target evidence summary")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
          return !!evidence && !live && !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "alternate browser preview evidence screenshot rendered in the stage",
        () => ({ errors, requestLog }),
      )

      const preview = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
        const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
        const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
        const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
        return {
          status: evidence?.dataset.status || "",
          text: document.body.textContent || "",
          liveVisible: !!live,
          imageLoaded: !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
        }
      })
      assert.equal(preview.status, "passed")
      assert.equal(preview.liveVisible, false)
      assert.equal(preview.imageLoaded, true)
      assert.match(preview.text, /alternate target desktop capture passed/)
      assert.doesNotMatch(preview.text, /primary target desktop capture passed/)
      assert.match(preview.text, new RegExp(alternatePreviewTarget().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.deepEqual(selectedTargets, [{ targetID: failingTargetID }, { targetID: alternateTargetID }])
      assert.ok(
        captureBodies.some(
          (body) => JSON.stringify(body) === JSON.stringify({ targetID, viewportIDs: ["desktop", "tablet", "mobile"] }),
        ),
        "capture route should use the primary task browser preview target ID",
      )
      assert.ok(
        captureBodies.some(
          (body) =>
            JSON.stringify(body) ===
            JSON.stringify({ targetID: alternateTargetID, viewportIDs: ["desktop", "tablet", "mobile"] }),
        ),
        "capture route should use the selected alternate task browser preview target ID",
      )
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/capture`)),
        "capture route should be called through the task-scoped backend",
      )
      assert.ok(
        requestLog.some((entry) =>
          entry.startsWith(`GET /task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`),
        ),
        "evidence screenshot route should be loaded through the task-scoped backend",
      )
    } finally {
      releaseTargetRefetch?.()
      try {
        await browser.close()
      } finally {
        await server.close()
      }
    }
  },
  { timeout: 60_000 },
)

test(
  "browser preview panel hides persisted evidence while manual recapture is pending",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const taskID = "tsk_browserpreview_persisted_recapture"
    const targetID = "art_previewtarget_persisted_recapture"
    const evidenceID = "art_previewevidence_persisted_recapture"
    const projectRoot = "D:/overlay/workspace/persisted-recapture"
    const captureBodies: unknown[] = []
    const errors: string[] = []
    const requestLog: string[] = []
    let releaseCapture: (() => void) | undefined
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAABACAYAAADbER1AAAAAdElEQVR4AQXBAQ3AIAADsGaqEDMxFzMvyOKt892XqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZ+SrVB/bxIzVQAAAAASUVORK5CYII=",
      "base64",
    )
    const viewports = [{ id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 }]
    const task = {
      id: taskID,
      orderKey: testTaskOrderKey(taskID, now - 10_000),
      directory: projectRoot,
      status: "active",
      sessionID: "ses_preview_persisted_recapture",
      request: "Verify persisted recapture loading",
      title: "Verify persisted recapture loading",
      time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
    }
    const board = {
      snapshotVersion: "preview-persisted-recapture-board",
      lastSequence: 0,
      task,
      overview: { headline: "Preview evidence", summary: "Persisted preview evidence is visible.", controls: {} },
      lanes: [],
      interactions: [],
    }
    let serverOrigin = ""
    const previewTarget = () => `${serverOrigin}/preview-target`
    const targetResponse = () => ({
      id: targetID,
      taskID,
      latestEvidenceIDs: { desktop: evidenceID },
      kind: "task-url",
      status: "ready",
      projectRoot,
      url: previewTarget(),
      viewports,
      diagnostics: ["Resolved saved browser preview target."],
      candidates: [{ id: targetID, url: previewTarget(), source: "task-artifact", selected: true, timeUpdated: now }],
      source: "task-artifact",
    })
    const evidence = {
      id: evidenceID,
      taskID,
      targetID,
      viewportID: "desktop",
      status: "passed",
      summary: "old persisted desktop evidence should be hidden during recapture",
      capture: { captured: true, passed: true, path: `${projectRoot}/desktop.png`, sha: "oldsha" },
      diagnostics: ["old persisted desktop evidence should be hidden during recapture"],
      timeCompleted: now - 100,
      timeCreated: now - 100,
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${url.pathname}${url.search}`)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/preview-target")
        return new Response("<main>Persisted recapture preview target is live</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/projects/discover")
        return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/mission") return send([])
      if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/path") return send({ directory: projectRoot })
      if (path === "/vcs")
        return send({
          branch: "preview-e2e",
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
      if (path === "/config" && req.method === "PATCH") return send({ model: "" })
      if (path === "/config") return send({ model: "" })
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/agent") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"board-${now}"` } })
      if (path === `/task/${taskID}/conversation`)
        return send({
          lastSequence: 0,
          board,
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
          history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          messageWatermark: 0,
        })
      if (path === `/task/${taskID}/transcript`) return send([])
      if (path === `/task/${taskID}/trace`)
        return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
      if (
        path === "/task/events" ||
        path === `/task/${taskID}/events` ||
        path === `/task/${taskID}/conversation/events`
      ) {
        return eventStream()
      }
      if (path === `/task/${taskID}/browser-preview`) return send(targetResponse())
      if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
        captureBodies.push(await req.json())
        await captureGate
        return send({
          status: "failed",
          projectRoot,
          target: targetResponse(),
          viewports,
          captures: {},
          evidenceIDs: {},
          diagnostics: ["manual recapture failed after loading state was visible"],
        })
      }
      if (path === `/task/${taskID}/browser-preview/evidence/${evidenceID}`) return send(evidence)
      if (path === `/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`) {
        return new Response(pngBytes, { headers: { "content-type": "image/png" } })
      }
      return send({})
    })
    serverOrigin = server.origin

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      installBrowserErrorCollector(page)
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument(
        (serverUrl) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
          localStorage.setItem("oc_locale", "en-US")
          localStorage.setItem("oc_directory", "D:/overlay/workspace/persisted-recapture")
          localStorage.setItem("oc_server_url", serverUrl)
          const settings = {
            serverUrl,
            autoServer: false,
            locale: "en-US",
            directory: "D:/overlay/workspace/persisted-recapture",
            directoryMode: "custom",
            workspaceTaskID: "tsk_browserpreview_persisted_recapture",
            workspaceDirectory: "D:/overlay/workspace/persisted-recapture",
          }
          localStorage.setItem("oc_settings", JSON.stringify(settings))
          ;(window as any).__TAURI__ = {
            core: {
              invoke: async (command: string, args: Record<string, unknown> = {}) => {
                if (command === "overlay_settings_load") return settings
                if (command === "overlay_settings_save") {
                  Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                  return true
                }
                if (command === "overlay_open_path") return true
                if (command === "overlay_open_url") return true
                return null
              },
            },
            event: {
              listen: async () => () => undefined,
            },
            window: {
              getCurrentWindow: () => ({
                isMaximized: async () => false,
                minimize: async () => true,
              }),
            },
          }
        },
        server.origin,
      )
      page.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`)
      })
      page.on("requestfailed", (request) => {
        if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
        errors.push(`requestfailed: ${request.url()}`)
      })
      page.on("response", (response) => {
        if (response.status() >= 400) errors.push(`response${response.status()}: ${response.url()}`)
      })
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
      })
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await waitForPageState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "persisted recapture online connection badge",
        () => ({ errors, requestLog }),
      )
      await waitForPageState(
        page,
        () =>
          document.querySelector<HTMLElement>(".task-row-main[data-task-id='tsk_browserpreview_persisted_recapture']")
            ?.dataset.taskId === "tsk_browserpreview_persisted_recapture",
        "persisted recapture task row rendered",
        () => ({ errors, requestLog }),
      )
      await openBrowserPreviewFromTask(page, taskID, "persisted recapture browser preview", () => ({
        errors,
        requestLog,
      }))
      await waitForPageText(page, evidence.summary, "old persisted evidence visible before recapture")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidenceCard = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            evidenceCard?.textContent?.includes("old persisted desktop evidence should be hidden during recapture") ===
              true &&
            !!img &&
            img.complete &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
          )
        },
        "old persisted evidence screenshot visible before recapture",
        () => ({ errors, requestLog }),
      )
      await page.click(".browser-preview-capture-button")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const loading = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-capture-loading"]')
          const evidenceCard = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            loading?.dataset.status === "loading" &&
            loading.textContent?.includes("Capturing evidence") === true &&
            !evidenceCard &&
            !img &&
            stage?.textContent?.includes("old persisted desktop evidence should be hidden during recapture") !== true
          )
        },
        "manual recapture hides old persisted evidence while capture is pending",
        () => ({ errors, requestLog, captureBodies }),
      )
      const loadingScreenshotPath = resolve(".scratch/browser-preview-persisted-recapture-loading.png")
      mkdirSync(dirname(loadingScreenshotPath), { recursive: true })
      const previewPanel = await page.$(".browser-preview-panel")
      assert.ok(previewPanel)
      writeFileSync(loadingScreenshotPath, await previewPanel.screenshot({}))
      releaseCapture?.()
      await waitForPageText(
        page,
        "manual recapture failed after loading state was visible",
        "manual recapture response settled",
      )
      assert.deepEqual(captureBodies, [{ targetID, viewportIDs: ["desktop"] }])
      assert.equal(
        errors.some((entry) => entry.startsWith("pageerror:")),
        false,
        JSON.stringify(errors),
      )
    } finally {
      releaseCapture?.()
      try {
        await browser.close()
      } finally {
        await server.close()
      }
    }
  },
  { timeout: 60_000 },
)

test(
  "browser preview panel binds persisted evidence to the selected viewport",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const taskID = "tsk_browserpreview_persisted_viewport"
    const targetID = "art_previewtarget_persisted_viewport"
    const projectRoot = "D:/overlay/workspace/app"
    const requestLog: string[] = []
    const errors: string[] = []
    const captureBodies: unknown[] = []
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAABACAYAAADbER1AAAAAdElEQVR4AQXBAQ3AIAADsGaqEDMxFzMvyOKt892XqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZSk6nUZCo1mUpNplKTqdRkKjWZSk2mUpOp1GQqNZlKTaZ+SrVB/bxIzVQAAAAASUVORK5CYII=",
      "base64",
    )
    const evidenceByID = {
      art_previewevidence_desktop_persisted: {
        id: "art_previewevidence_desktop_persisted",
        taskID,
        targetID,
        viewportID: "desktop",
        status: "passed",
        summary: "persisted desktop evidence passed",
        capture: { captured: true, passed: true, path: `${projectRoot}/desktop.png`, sha: "desktopsha" },
        diagnostics: ["persisted desktop evidence passed"],
        timeCompleted: now - 300,
        timeCreated: now - 300,
      },
      art_previewevidence_tablet_persisted: {
        id: "art_previewevidence_tablet_persisted",
        taskID,
        targetID,
        viewportID: "tablet",
        status: "passed",
        summary: "persisted tablet evidence passed",
        capture: { captured: true, passed: true, path: `${projectRoot}/tablet.png`, sha: "tabletsha" },
        diagnostics: ["persisted tablet evidence passed"],
        timeCompleted: now - 200,
        timeCreated: now - 200,
      },
      art_previewevidence_mobile_persisted: {
        id: "art_previewevidence_mobile_persisted",
        taskID,
        targetID,
        viewportID: "mobile",
        status: "passed",
        summary: "persisted mobile evidence passed",
        capture: { captured: true, passed: true, path: `${projectRoot}/mobile.png`, sha: "mobilesha" },
        diagnostics: ["persisted mobile evidence passed"],
        timeCompleted: now - 100,
        timeCreated: now - 100,
      },
      art_previewevidence_mobile_refreshed: {
        id: "art_previewevidence_mobile_refreshed",
        taskID,
        targetID,
        viewportID: "mobile",
        status: "passed",
        summary: "refreshed mobile evidence passed",
        capture: {
          captured: true,
          passed: true,
          path: `${projectRoot}/mobile-refreshed.png`,
          sha: "mobilerefreshedsha",
        },
        diagnostics: ["refreshed mobile evidence passed"],
        timeCompleted: now,
        timeCreated: now,
      },
      art_previewevidence_mobile_after_capture_refreshed: {
        id: "art_previewevidence_mobile_after_capture_refreshed",
        taskID,
        targetID,
        viewportID: "mobile",
        status: "passed",
        summary: "saved mobile evidence refreshed after capture",
        capture: {
          captured: true,
          passed: true,
          path: `${projectRoot}/mobile-after-capture-refreshed.png`,
          sha: "mobileaftercapturerefreshedsha",
        },
        diagnostics: ["saved mobile evidence refreshed after capture"],
        timeCompleted: now + 100,
        timeCreated: now + 100,
      },
    } as const
    let mobileLatestEvidenceID = evidenceByID.art_previewevidence_mobile_persisted.id
    let releaseRefreshedEvidence: (() => void) | undefined
    const refreshedEvidenceGate = new Promise<void>((resolve) => {
      releaseRefreshedEvidence = resolve
    })
    let releaseAfterCaptureEvidence: (() => void) | undefined
    const afterCaptureEvidenceGate = new Promise<void>((resolve) => {
      releaseAfterCaptureEvidence = resolve
    })
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const task = {
      id: taskID,
      orderKey: testTaskOrderKey(taskID, now - 10_000),
      directory: projectRoot,
      status: "active",
      sessionID: "ses_preview_persisted_viewport",
      request: "Verify persisted preview evidence",
      title: "Verify persisted preview evidence",
      time: { created: now - 10_000, started: now - 9_000, updated: now - 1_000 },
    }
    const board = {
      snapshotVersion: "preview-persisted-viewport-board",
      lastSequence: 0,
      task,
      overview: { headline: "Preview evidence", summary: "Persisted preview evidence is ready.", controls: {} },
      lanes: [],
      interactions: [],
    }
    let serverOrigin = ""
    const previewTarget = () => `${serverOrigin}/preview-target`
    const targetResponse = () => ({
      id: targetID,
      taskID,
      latestEvidenceIDs: {
        desktop: evidenceByID.art_previewevidence_desktop_persisted.id,
        tablet: evidenceByID.art_previewevidence_tablet_persisted.id,
        mobile: mobileLatestEvidenceID,
      },
      kind: "task-url",
      status: "ready",
      projectRoot,
      url: previewTarget(),
      viewports,
      diagnostics: ["Resolved saved browser preview target."],
      candidates: [{ id: targetID, url: previewTarget(), source: "task-artifact", selected: true, timeUpdated: now }],
      source: "task-artifact",
    })

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      requestLog.push(`${req.method} ${url.pathname}${url.search}`)
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/preview-target")
        return new Response("<main>Persisted viewport preview target is live</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/mission") return send([])
      if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
      if (path === "/path") return send({ directory: projectRoot })
      if (path === "/vcs")
        return send({
          branch: "preview-e2e",
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
      if (path === "/config" && req.method === "PATCH") return send({ model: "" })
      if (path === "/config") return send({ model: "" })
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/agent") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"board-${now}"` } })
      if (path === `/task/${taskID}/conversation`)
        return send({
          lastSequence: 0,
          board,
          transcript: [],
          timeline: [],
          events: [],
          view: { topLevelSessionIDs: [], sessions: [], messages: [] },
          agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
          history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          messageWatermark: 0,
        })
      if (path === `/task/${taskID}/transcript`) return send([])
      if (path === `/task/${taskID}/trace`)
        return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace`, enabled: true })
      if (
        path === "/task/events" ||
        path === `/task/${taskID}/events` ||
        path === `/task/${taskID}/conversation/events`
      ) {
        return eventStream()
      }
      if (path === `/task/${taskID}/browser-preview`) return send(targetResponse())
      if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
        captureBodies.push(await req.json())
        return send({
          status: "failed",
          projectRoot,
          target: targetResponse(),
          viewports,
          captures: {},
          evidenceIDs: {},
          diagnostics: [],
        })
      }
      const evidenceMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)$`))
      if (evidenceMatch) {
        if (evidenceMatch[1] === evidenceByID.art_previewevidence_mobile_refreshed.id) {
          await refreshedEvidenceGate
        }
        if (evidenceMatch[1] === evidenceByID.art_previewevidence_mobile_after_capture_refreshed.id) {
          await afterCaptureEvidenceGate
        }
        const evidence = evidenceByID[evidenceMatch[1] as keyof typeof evidenceByID]
        return evidence ? send(evidence) : send({ message: "missing" }, { status: 404 })
      }
      const captureMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)/capture\\.png$`))
      if (captureMatch) {
        if (captureMatch[1] === evidenceByID.art_previewevidence_tablet_persisted.id) {
          await new Promise((resolve) => setTimeout(resolve, 300))
          return send({ message: "tablet capture image intentionally missing" }, { status: 404 })
        }
        return new Response(pngBytes, { headers: { "content-type": "image/png" } })
      }
      return send({})
    })
    serverOrigin = server.origin

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      installBrowserErrorCollector(page, {
        allowResponse(response) {
          return (
            response.status === 404 &&
            (response.path ===
              `/task/${taskID}/browser-preview/evidence/art_previewevidence_tablet_persisted/capture.png` ||
              response.path === `/task/${taskID}/browser-preview/evidence/art_previewevidence_mobile_missing`)
          )
        },
      })
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceTaskID: "tsk_browserpreview_persisted_viewport",
          workspaceDirectory: "D:/overlay/workspace/app",
        }
        window.__TAURI__ = {
          core: {
            invoke: async (command: string, args: Record<string, unknown> = {}) => {
              if (command === "overlay_settings_load") return settings
              if (command === "overlay_settings_save") {
                Object.assign(settings, (args.settings as Record<string, unknown>) || {})
                return true
              }
              if (command === "overlay_open_path") return true
              if (command === "overlay_open_url") return true
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => true,
                hide: async () => true,
                startDragging: async () => true,
                minimize: async () => true,
              }
            },
          },
        }
      }, server.origin)
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
      page.on("response", (response) => {
        if (response.url().includes("/art_previewevidence_tablet_persisted/capture.png")) return
        if (response.url().includes("/art_previewevidence_mobile_missing")) return
        if (response.status() >= 400) errors.push(`response${response.status()}: ${response.url()}`)
      })
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
      })

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#solidRightActivityToolbar")
      await waitForPageState(
        page,
        () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
        "online connection badge",
        () => ({ errors, requestLog }),
      )
      await waitForPageState(
        page,
        () =>
          document.querySelector<HTMLElement>(".task-row-main[data-task-id='tsk_browserpreview_persisted_viewport']")
            ?.dataset.taskId === "tsk_browserpreview_persisted_viewport",
        "persisted browser preview task row rendered",
        () => ({ errors, requestLog }),
      )
      await openBrowserPreviewFromTask(page, taskID, "persisted preview", () => ({ errors, requestLog }))
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true",
        "browser preview workbench active",
        () => ({ errors, requestLog }),
      )
      await waitForPageText(page, "persisted desktop evidence passed", "desktop persisted evidence")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
          return (
            evidence?.dataset.status === "passed" &&
            !live &&
            !!img &&
            img.complete &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
          )
        },
        "desktop persisted evidence screenshot rendered in the stage",
        () => ({ errors, requestLog }),
      )
      const persistedPreviewScreenshotPath = resolve(".scratch/browser-preview-persisted-evidence-no-live.png")
      const persistedPreviewPanel = await page.$(".browser-preview-panel")
      assert.ok(persistedPreviewPanel)
      writeFileSync(persistedPreviewScreenshotPath, await persistedPreviewPanel.screenshot({}))
      let text = await page.evaluate(
        () => document.querySelector(".browser-preview-evidence-status")?.textContent || "",
      )
      assert.match(text, /persisted desktop evidence passed/)
      assert.doesNotMatch(text, /persisted mobile evidence passed/)

      await page.click('[data-ui="browser-preview-viewport"][data-viewport-id="tablet"]')
      await waitForPageText(page, "persisted tablet evidence passed", "tablet persisted evidence")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const imageError = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-capture-image-error"]')
          return (
            evidence?.dataset.status === "failed" &&
            evidence?.textContent?.includes("persisted tablet evidence passed") === true &&
            imageError?.textContent?.includes("Capture image failed") === true &&
            imageError?.textContent?.includes("tablet capture image intentionally missing") === true &&
            !img
          )
        },
        "tablet persisted evidence shows image load failure instead of passed screenshot evidence",
        () => ({ errors, requestLog }),
      )
      text = await page.evaluate(() => document.querySelector(".browser-preview-evidence-status")?.textContent || "")
      assert.match(text, /Capture image failed/)
      assert.doesNotMatch(text, /persisted desktop evidence passed/)
      const tabletImageErrorScreenshotPath = resolve(".scratch/browser-preview-tablet-capture-image-error.png")
      const tabletImageErrorPanel = await page.$(".browser-preview-panel")
      assert.ok(tabletImageErrorPanel)
      writeFileSync(tabletImageErrorScreenshotPath, await tabletImageErrorPanel.screenshot({}))

      await page.click('[data-ui="browser-preview-viewport"][data-viewport-id="mobile"]')
      await waitForPageText(page, "persisted mobile evidence passed", "mobile persisted evidence")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
          return (
            evidence?.textContent?.includes("persisted mobile evidence passed") === true &&
            !live &&
            !!img &&
            img.dataset.evidenceId === "art_previewevidence_mobile_persisted" &&
            img.complete &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
          )
        },
        "mobile persisted evidence screenshot rendered in the stage",
        () => ({ errors, requestLog }),
      )
      text = await page.evaluate(() => document.querySelector(".browser-preview-evidence-status")?.textContent || "")
      assert.match(text, /persisted mobile evidence passed/)
      assert.doesNotMatch(text, /persisted desktop evidence passed/)
      assert.deepEqual(captureBodies, [])
      assert.equal(
        requestLog.some((entry) => entry.includes("/browser-preview/live/")),
        false,
        `persisted evidence restore must not call retired PNG live routes: ${JSON.stringify(requestLog, null, 2)}`,
      )

      mobileLatestEvidenceID = evidenceByID.art_previewevidence_mobile_refreshed.id
      await page.click('button[title="Refresh the saved preview evidence."]')
      for (let i = 0; i < 100; i += 1) {
        if (
          requestLog.some((entry) => entry.includes("/browser-preview/evidence/art_previewevidence_mobile_refreshed"))
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        requestLog.some((entry) => entry.includes("/browser-preview/evidence/art_previewevidence_mobile_refreshed")),
        `refreshed mobile evidence request did not start: ${JSON.stringify(requestLog, null, 2)}`,
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidenceText = document.querySelector<HTMLElement>(".browser-preview-evidence-status")?.textContent || ""
          const staleImage = stage?.querySelector<HTMLImageElement>(
            '[data-ui="browser-preview-screenshot"][data-evidence-id="art_previewevidence_mobile_persisted"]',
          )
          const loading = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence-loading"]')
          const missing = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence-missing"]')
          const capture = document.querySelector<HTMLButtonElement>(".browser-preview-capture-button")
          return (
            !evidenceText.includes("persisted mobile evidence passed") &&
            evidenceText.includes("Loading saved evidence") &&
            loading?.dataset.status === "loading" &&
            capture?.disabled === true &&
            !missing &&
            !staleImage
          )
        },
        "stale mobile evidence hidden and loading state shown while refreshed evidence is pending",
        () => ({ errors, requestLog }),
      )
      const loadingEvidenceScreenshotPath = resolve(".scratch/browser-preview-persisted-evidence-loading.png")
      const loadingEvidencePanel = await page.$(".browser-preview-panel")
      assert.ok(loadingEvidencePanel)
      writeFileSync(loadingEvidenceScreenshotPath, await loadingEvidencePanel.screenshot({}))
      assert.deepEqual(captureBodies, [])
      releaseRefreshedEvidence?.()
      await waitForPageText(page, "refreshed mobile evidence passed", "refreshed mobile evidence")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            stage?.textContent?.includes("refreshed mobile evidence passed") === true &&
            !!img &&
            img.dataset.evidenceId === "art_previewevidence_mobile_refreshed"
          )
        },
        "refreshed mobile evidence screenshot rendered",
        () => ({ errors, requestLog }),
      )
      const refreshedEvidenceScreenshotPath = resolve(".scratch/browser-preview-refreshed-evidence-id.png")
      const refreshedEvidencePanel = await page.$(".browser-preview-panel")
      assert.ok(refreshedEvidencePanel)
      writeFileSync(refreshedEvidenceScreenshotPath, await refreshedEvidencePanel.screenshot({}))

      mobileLatestEvidenceID = "art_previewevidence_mobile_missing"
      await page.click('button[title="Refresh the saved preview evidence."]')
      await waitForPageText(page, "Saved preview evidence failed to load.", "missing persisted evidence error")
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const missing = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence-load-failed"]')
          const live = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          return (
            missing?.dataset.status === "failed" &&
            missing.textContent?.includes("art_previewevidence_mobile_missing") === true &&
            missing.textContent?.includes("missing") === true &&
            !live &&
            !evidence
          )
        },
        "missing persisted evidence renders an explicit failure card",
        () => ({ errors, requestLog }),
      )
      const missingEvidenceScreenshotPath = resolve(".scratch/browser-preview-missing-persisted-evidence.png")
      const missingEvidencePanel = await page.$(".browser-preview-panel")
      assert.ok(missingEvidencePanel)
      writeFileSync(missingEvidenceScreenshotPath, await missingEvidencePanel.screenshot({}))

      await page.click(".browser-preview-capture-button")
      await waitForPageText(
        page,
        "Verification failed before persisted evidence was available for Mobile",
        "failed capture without persisted evidence id",
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const evidence = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence"]')
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            evidence?.dataset.status === "failed" &&
            evidence?.textContent?.includes(
              "Verification failed before persisted evidence was available for Mobile",
            ) === true &&
            !evidence.querySelector("code") &&
            !img
          )
        },
        "failed verification response renders a failed evidence card without a synthetic evidence id",
        () => ({ errors, requestLog, captureBodies }),
      )
      assert.deepEqual(captureBodies, [{ targetID, viewportIDs: ["desktop", "tablet", "mobile"] }])
      assert.equal(
        errors.some((entry) => entry.startsWith("pageerror:")),
        false,
        JSON.stringify(errors),
      )
      const failedVerificationScreenshotPath = resolve(
        ".scratch/browser-preview-failed-verification-no-evidence-id.png",
      )
      const failedVerificationPanel = await page.$(".browser-preview-panel")
      assert.ok(failedVerificationPanel)
      writeFileSync(failedVerificationScreenshotPath, await failedVerificationPanel.screenshot({}))

      mobileLatestEvidenceID = evidenceByID.art_previewevidence_mobile_after_capture_refreshed.id
      await page.click('button[title="Refresh the saved preview evidence."]')
      for (let i = 0; i < 100; i += 1) {
        if (
          requestLog.some((entry) =>
            entry.includes("/browser-preview/evidence/art_previewevidence_mobile_after_capture_refreshed"),
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        requestLog.some((entry) =>
          entry.includes("/browser-preview/evidence/art_previewevidence_mobile_after_capture_refreshed"),
        ),
        `post-capture saved evidence refresh did not start: ${JSON.stringify(requestLog, null, 2)}`,
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const loading = stage?.querySelector<HTMLElement>('[data-ui="browser-preview-evidence-loading"]')
          const verificationText = "Verification failed before persisted evidence was available for Mobile"
          return (
            loading?.dataset.status === "loading" &&
            stage?.textContent?.includes(verificationText) !== true &&
            document.querySelector<HTMLButtonElement>(".browser-preview-capture-button")?.disabled === true
          )
        },
        "saved evidence refresh after capture clears the stale verification stage",
        () => ({ errors, requestLog }),
      )
      releaseAfterCaptureEvidence?.()
      await waitForPageText(
        page,
        "saved mobile evidence refreshed after capture",
        "post-capture saved evidence refresh settled",
      )
      await waitForPageState(
        page,
        () => {
          const stage = document.querySelector<HTMLElement>(".browser-preview-stage")
          const img = stage?.querySelector<HTMLImageElement>('[data-ui="browser-preview-screenshot"]')
          return (
            stage?.textContent?.includes("saved mobile evidence refreshed after capture") === true &&
            !!img &&
            img.dataset.evidenceId === "art_previewevidence_mobile_after_capture_refreshed"
          )
        },
        "post-capture saved evidence replaces stale verification evidence",
        () => ({ errors, requestLog }),
      )
      const postCaptureRefreshScreenshotPath = resolve(".scratch/browser-preview-post-capture-evidence-refresh.png")
      const postCaptureRefreshPanel = await page.$(".browser-preview-panel")
      assert.ok(postCaptureRefreshPanel)
      writeFileSync(postCaptureRefreshScreenshotPath, await postCaptureRefreshPanel.screenshot({}))
    } finally {
      releaseAfterCaptureEvidence?.()
      try {
        await browser.close()
      } finally {
        await server.close()
      }
    }
  },
  { timeout: 60_000 },
)
