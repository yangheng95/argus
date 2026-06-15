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
            latestEvidenceID: evidenceID,
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
          document.querySelector<HTMLElement>(".global-task-row[data-active='true'] .task-row-main")?.dataset.taskId ===
          "tsk_browserpreview_e2e",
        "restored browser preview task selection",
        () => ({ errors, requestLog }),
      )
      await waitForPageState(
        page,
        () =>
          document.querySelector<HTMLElement>("#centerWorkbenchBrowser")?.dataset.active === "true" &&
          !!document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]'),
        "browser workbench active",
        () => ({ errors, requestLog }),
      )
      await page.waitForSelector('[data-ui="browser-preview-live-screenshot"]')
      await waitForPageState(
        page,
        () => {
          const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "loaded interactive browser preview screenshot",
        () => ({ errors, requestLog }),
      )
      await waitForPageText(page, previewTarget(), "preview target text")
      await page.click('[data-ui="browser-preview-live-screenshot"]', { position: { x: 5, y: 5 } })
      await page.hover('[data-ui="browser-preview-live"]')
      await page.evaluate(() => {
        const image = document.querySelector<HTMLElement>('[data-ui="browser-preview-live-screenshot"]')
        const rect = image?.getBoundingClientRect()
        image?.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: rect ? rect.left + 5 : 5,
            clientY: rect ? rect.top + 5 : 5,
            deltaX: 0,
            deltaY: 180,
          }),
        )
      })
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
      await waitForPageText(page, "alternate target desktop capture passed", "alternate target evidence summary")
      for (
        let i = 0;
        i < 100 && !liveSnapshotBodies.some((body) => JSON.stringify(body).includes(alternateTargetID));
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        liveSnapshotBodies.some((body) => JSON.stringify(body).includes(alternateTargetID)),
        `interactive browser preview reloaded after selecting an alternate target\n${JSON.stringify(
          { errors, requestLog, liveSnapshotBodies },
          null,
          2,
        )}`,
      )

      await waitForPageState(
        page,
        () => {
          const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
          return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
        },
        "reloaded alternate interactive browser preview screenshot",
        () => ({ errors, requestLog }),
      )
      for (let i = 0; i < 100 && liveInputBodies.length < 2; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        liveInputBodies.length >= 2,
        `interactive browser preview input routed to backend\n${JSON.stringify({ errors, requestLog }, null, 2)}`,
      )

      const preview = await page.evaluate(() => {
        const live = document.querySelector<HTMLElement>('[data-ui="browser-preview-live"]')
        const img = document.querySelector<HTMLImageElement>('[data-ui="browser-preview-live-screenshot"]')
        return {
          status: live?.dataset.status || "",
          text: document.body.textContent || "",
          imageLoaded: !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
        }
      })
      assert.equal(preview.status, "ready")
      assert.equal(preview.imageLoaded, true)
      assert.match(preview.text, /alternate target desktop capture passed/)
      assert.doesNotMatch(preview.text, /primary target desktop capture passed/)
      assert.match(preview.text, new RegExp(alternatePreviewTarget().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.deepEqual(selectedTargets, [{ targetID: alternateTargetID }])
      assert.deepEqual(JSON.parse(JSON.stringify(captureBodies[0])), {
        targetID,
        viewportIDs: ["desktop", "tablet", "mobile"],
      })
      assert.deepEqual(JSON.parse(JSON.stringify(captureBodies[1])), {
        targetID: alternateTargetID,
        viewportIDs: ["desktop", "tablet", "mobile"],
      })
      assert.ok(
        liveSnapshotBodies.some((body) => JSON.stringify(body).includes(targetID)),
        "live snapshot should use the selected task browser preview target ID",
      )
      assert.ok(
        liveSnapshotBodies.some((body) => JSON.stringify(body).includes(alternateTargetID)),
        "live snapshot should reload after selecting an alternate target",
      )
      assert.deepEqual(liveInputBodies.map((body) => (body as any).input.kind).slice(0, 2), ["click", "wheel"])
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/capture`)),
        "capture route should be called through the task-scoped backend",
      )
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/live/snapshot`)),
        "live snapshot route should be called through the task-scoped backend",
      )
      assert.ok(
        requestLog.some((entry) => entry.startsWith(`POST /task/${taskID}/browser-preview/live/input`)),
        "live input route should be called through the task-scoped backend",
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
