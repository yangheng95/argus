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

function eventStream() {
  return new Response(":\n\n", {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  })
}

function projectDiscovery(projectRoot: string) {
  return {
    root: projectRoot,
    defaultDirectory: projectRoot,
    projects: [{ directory: projectRoot, name: "app", marker: `${projectRoot}/.opencorvus` }],
  }
}

const promptProfileCatalog = {
  active: "default",
  project_active: "default",
  session_active: null,
  default: "default",
  targets: [{ id: "build", label: "Build", description: "Build agent prompt.", editable: true, built_in_only: false }],
  profiles: [
    {
      id: "default",
      label: "Default",
      description: "Default implementation profile.",
      built_in: true,
      editable: false,
      agents: {},
    },
  ],
}

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

test(
  "browser preview panel captures task-scoped manifest evidence through the backend",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const now = Date.now()
    const taskID = "tsk_browserpreview_e2e"
    const targetID = "art_previewtarget_e2e"
    const alternateTargetID = "art_previewtarget_alt_e2e"
    const evidenceID = "art_previewevidence_desktop"
    const projectRoot = "D:/overlay/workspace/app"
    const captureBodies: unknown[] = []
    const liveSnapshotBodies: unknown[] = []
    const liveInputBodies: unknown[] = []
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
    const selectedPreviewTarget = () =>
      selectedTargetID === alternateTargetID ? alternatePreviewTarget() : previewTarget()
    const captureSummary = (target: string) =>
      target === alternateTargetID ? "alternate target desktop capture passed" : "primary target desktop capture passed"
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const task = {
      id: taskID,
      directory: projectRoot,
      status: "running",
      sessionID: "ses_preview_e2e",
      request: "Verify preview evidence",
      title: "Verify preview evidence",
      time: { created: now - 10_000, updated: now - 1_000 },
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
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send(projectDiscovery(projectRoot))
      if (path === "/project/current/worktrees") return send([])
      if (path === "/mission") return send([])
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
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
          view: { rootID: "root", cards: {}, order: [] },
          agentView: { rootID: "root", cards: {}, order: [] },
          history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
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
          ],
          source: "task-artifact",
        })
      }
      if (path === `/task/${taskID}/browser-preview/target` && req.method === "PUT") {
        const body = await req.json()
        selectedTargets.push(body)
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
          ],
          source: "task-artifact",
        })
      }
      if (path === `/task/${taskID}/browser-preview/capture` && req.method === "POST") {
        const body = await req.json()
        captureBodies.push(body)
        const responseTargetID = body?.targetID === alternateTargetID ? alternateTargetID : targetID
        if (responseTargetID === alternateTargetID) {
          await new Promise((resolve) => setTimeout(resolve, 1_200))
        }
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
              summary: captureSummary(responseTargetID),
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
            captureSummary(responseTargetID),
            "manifest-backed tablet capture passed",
            "manifest-backed mobile capture passed",
          ],
        })
      }
      if (path === `/task/${taskID}/browser-preview/live/snapshot` && req.method === "POST") {
        liveSnapshotBodies.push(await req.json())
        return new Response(pngBytes, {
          headers: { "content-type": "image/png" },
        })
      }
      if (path === `/task/${taskID}/browser-preview/live/input` && req.method === "POST") {
        liveInputBodies.push(await req.json())
        return new Response(pngBytes, {
          headers: { "content-type": "image/png" },
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
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_right_panel_collapsed", "false")
        localStorage.setItem("oc_workspace_task", "tsk_browserpreview_e2e")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceTaskId: "tsk_browserpreview_e2e",
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
        errors.push(`pageerror: ${error.stack || error.message}`)
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
          document.querySelector<HTMLElement>(".task-row-main[data-task-id='tsk_browserpreview_e2e']")?.dataset.taskId ===
          "tsk_browserpreview_e2e",
        "browser preview task row rendered",
        () => ({ errors, requestLog }),
      )
      await page.$eval(
        '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
        (node) => (node as HTMLButtonElement).click(),
      )
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
        "task activity visible before preview selection",
        () => ({ errors, requestLog }),
      )
      await page.$eval(`.task-row-main[data-task-id="${taskID}"]`, (node) => (node as HTMLButtonElement).click())
      await page.$eval(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]',
        (node) => (node as HTMLButtonElement).click(),
      )
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true",
        "browser workbench active",
        () => ({ errors, requestLog }),
      )
      await waitForPageText(page, previewTarget(), "preview target text")
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
      assert.deepEqual(selectedTargets, [{ targetID: alternateTargetID }])
      assert.ok(
        captureBodies.some((body) => JSON.stringify(body) === JSON.stringify({ targetID, viewportIDs: ["desktop", "tablet", "mobile"] })),
        "capture route should use the primary task browser preview target ID",
      )
      assert.ok(
        captureBodies.some(
          (body) => JSON.stringify(body) === JSON.stringify({ targetID: alternateTargetID, viewportIDs: ["desktop", "tablet", "mobile"] }),
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
      await browser.close().catch(() => undefined)
      await server.close()
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
    } as const
    const viewports = [
      { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 900 },
      { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
      { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
    ]
    const task = {
      id: taskID,
      directory: projectRoot,
      status: "running",
      sessionID: "ses_preview_persisted_viewport",
      request: "Verify persisted preview evidence",
      title: "Verify persisted preview evidence",
      time: { created: now - 10_000, updated: now - 1_000 },
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
        mobile: evidenceByID.art_previewevidence_mobile_persisted.id,
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
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      if (path === "/preview-target")
        return new Response("<main>Persisted viewport preview target is live</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/global/projects/discover") return send(projectDiscovery(projectRoot))
      if (path === "/project/current/worktrees") return send([])
      if (path === "/mission") return send([])
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === "/global/tasks" || path === "/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
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
          view: { rootID: "root", cards: {}, order: [] },
          agentView: { rootID: "root", cards: {}, order: [] },
          history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
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
        return send({ status: "failed", projectRoot, target: targetResponse(), viewports, captures: {}, evidenceIDs: {}, diagnostics: [] })
      }
      if (path === `/task/${taskID}/browser-preview/live/snapshot` && req.method === "POST") {
        return new Response(pngBytes, { headers: { "content-type": "image/png" } })
      }
      const evidenceMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)$`))
      if (evidenceMatch) {
        const evidence = evidenceByID[evidenceMatch[1] as keyof typeof evidenceByID]
        return evidence ? send(evidence) : send({ message: "missing" }, { status: 404 })
      }
      const captureMatch = path.match(new RegExp(`^/task/${taskID}/browser-preview/evidence/([^/]+)/capture\\.png$`))
      if (captureMatch) return new Response(pngBytes, { headers: { "content-type": "image/png" } })
      return send({})
    })
    serverOrigin = server.origin

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
        localStorage.setItem("oc_server_url", serverUrl)
        localStorage.setItem("oc_right_panel_collapsed", "false")
        localStorage.setItem("oc_workspace_task", "tsk_browserpreview_persisted_viewport")
        localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
        const settings = {
          serverUrl,
          autoServer: false,
          locale: "en-US",
          directory: "D:/overlay/workspace/app",
          directoryMode: "custom",
          workspaceTaskId: "tsk_browserpreview_persisted_viewport",
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
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack || error.message}`))
      page.on("response", (response) => {
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
      await page.$eval(
        '#solidLeftActivityToolbar [data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
        (node) => (node as HTMLButtonElement).click(),
      )
      await waitForPageState(
        page,
        () => document.querySelector<HTMLElement>("#leftPanelTasks")?.dataset.active === "true",
        "task activity visible before persisted preview selection",
        () => ({ errors, requestLog }),
      )
      await page.$eval(`.task-row-main[data-task-id="${taskID}"]`, (node) => (node as HTMLButtonElement).click())
      await page.$eval(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]',
        (node) => (node as HTMLButtonElement).click(),
      )
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
      let text = await page.evaluate(() => document.querySelector(".browser-preview-evidence-status")?.textContent || "")
      assert.match(text, /persisted desktop evidence passed/)
      assert.doesNotMatch(text, /persisted mobile evidence passed/)

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
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
