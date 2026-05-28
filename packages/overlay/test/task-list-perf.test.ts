import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

const TASK_COUNT = 300
const LARGE_TEXT = "large task payload ".repeat(120)
const PERF_LIMITS = {
  panelRowsMs: 2500,
  selectLastMs: 1200,
  missionRowsMs: 1500,
  missionSearchMs: 600,
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function taskItem(index: number): any {
  const now = 1_776_000_000_000
  const created = now + index
  const id = `task-perf-${String(index).padStart(3, "0")}`
  return {
    updated_at: created + 10,
    pending_interactions: 0,
    overview: {
      headline: `Performance task ${index}`,
      summary: "Synthetic task used to measure 100+ task list rendering.",
    },
    task: {
      id,
      requestID: `req-perf-${String(index).padStart(3, "0")}`,
      title: `Performance task ${index}`,
      request: `${LARGE_TEXT}${index}`,
      directory: "D:/perf/workspace",
      status: "queued",
      metadata: {
        notes: `${LARGE_TEXT}${index}`,
      },
      queue: { order: index, revision: "rev-perf" },
      sessionID: `session-perf-${index}`,
      time: {
        created,
        updated: created + 10,
      },
    },
  }
}

function boardForTask(item: any): any {
  return {
    task: item.task,
    overview: item.overview,
    goalWorkflows: [],
    interactions: [],
    lastSequence: 1,
    snapshotVersion: `snapshot-${item.task.id}`,
  }
}

test(
  `overlay task surfaces stay responsive with ${TASK_COUNT} queued tasks`,
  async () => {
    const tasks = Array.from({ length: TASK_COUNT }, (_, index) => taskItem(index))
    const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
    const server = Bun.serve({
      idleTimeout: 255,
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        const path = route(url)
        if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
        if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
        const staticResponse = await overlayStaticResponse(path)
        if (staticResponse) return staticResponse
        if (path === "/global/health") return send({ version: "perf-test" })
        if (path === "/global/tasks" || path === "/tasks") return send({ tasks })
        if (path === "/executor") return send([])
        if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
        if (path === "/path") return send({ directory: "D:/perf/workspace", exists: true, git: true })
        if (path === "/vcs") return send({ branch: "main", dirty: false })
        if (path === "/provider") return send({ all: [], connected: [], default: {} })
        if (path === "/provider/auth") return send({})
        if (path === "/config/providers") return send({ providers: [], default: {} })
        if (path === "/config") {
          return send({
            server: {},
            provider: {},
            channel: {},
            mcp: {},
            model: "",
            directory: "D:/perf/workspace",
          })
        }
        if (path === "/config/prompt") return send({})
        if (path === "/channel") return send([])
        if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
        if (path === "/gateway/stats") return send({ active: 0, queued: TASK_COUNT, completed: 0, failed: 0 })
        if (path === "/task/events") {
          return new Response(new ReadableStream(), {
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          })
        }
        if (path === "/skill/installed" || path === "/skill") return send([])
        if (path === "/skill/directories") return send([])
        if (path === "/skill/market") return send({ items: [] })
        if (path === "/mcp") return send({})
        if (path === "/agent") return send([])
        const boardMatch = /^\/task\/([^/]+)\/board$/.exec(path)
        if (boardMatch) {
          const item = tasksByID.get(decodeURIComponent(boardMatch[1]))
          return item ? send(boardForTask(item)) : send({ error: "not found" }, 404)
        }
        if (/^\/task\/[^/]+\/conversation$/.test(path)) {
          const id = decodeURIComponent(path.split("/")[2] || "")
          const item = tasksByID.get(id)
          return send({
            board: item ? boardForTask(item) : boardForTask(tasks[0]),
            transcript: [],
            timeline: [],
            events: [],
            view: { sessions: [] },
            eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
            lastSequence: 0,
          })
        }
        if (/^\/task\/[^/]+\/bindings$/.test(path)) return send([])
        if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
        if (/^\/task\/[^/]+\/events$/.test(path)) {
          return new Response(new ReadableStream(), {
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          })
        }
        return send({ error: `unhandled ${path}` }, 404)
      },
    })

    const browser = await launchBrowser()
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const badResponses: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
        consoleErrors.push(msg.text())
      }
    })
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message)
    })
    page.on("requestfailed", (request) => {
      if (/\/task\/[^/]+\/events(?:\?.*)?$/.test(request.url())) return
      if (
        /\/task\/[^/]+\/conversation(?:\?.*)?$/.test(request.url()) &&
        request.failure()?.errorText === "net::ERR_ABORTED"
      ) {
        return
      }
      failedRequests.push(request.url())
    })
    page.on("response", (response) => {
      if (response.status() < 400) return
      badResponses.push(`${response.status()} ${response.url()}`)
    })

    try {
      const app = `http://127.0.0.1:${server.port}`
      await page.evaluateOnNewDocument((origin) => {
        localStorage.setItem("oc_server_url", origin)
        localStorage.setItem("oc_auto_server", "true")
        localStorage.setItem("oc_directory", "D:/perf/workspace")
        localStorage.setItem("oc_theme", "light")
      }, app)
      await page.goto(`${app}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")

      const panelRowsMs = await page.evaluate(async (count) => {
        const start = performance.now()
        while (document.querySelectorAll(".task-row-main[data-task-id]").length < count) {
          if (performance.now() - start > 10_000) {
            const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
            const text = document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 500)
            throw new Error(`task rows did not render; rows=${rows}; body=${text}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return performance.now() - start
      }, TASK_COUNT)

      const hiddenMissionRows = await page.evaluate(() => document.querySelectorAll(".mission-ledger .task-row-main[data-task-id]").length)
      expect(hiddenMissionRows).toBe(0)

      const selectLastMs = await page.evaluate(async () => {
        const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-row-main[data-task-id]"))
        const last = rows.at(-1)
        if (!last) throw new Error("missing last task row")
        const start = performance.now()
        last.click()
        while (last.getAttribute("aria-current") !== "page") {
          if (performance.now() - start > 10_000) throw new Error("last task was not selected")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return performance.now() - start
      })

      const missionRowsMs = await page.evaluate(async (count) => {
        const mission = document.querySelector<HTMLButtonElement>("#btnMission")
        if (!mission) throw new Error("missing Mission button")
        const start = performance.now()
        mission.click()
        while (document.body.getAttribute("data-page-mode") !== "mission") {
          if (performance.now() - start > 10_000) throw new Error("Mission page did not open")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        while (document.querySelectorAll(".mission-ledger .task-row-main[data-task-id]").length < count) {
          if (performance.now() - start > 10_000) throw new Error("Mission rows did not render")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return performance.now() - start
      }, TASK_COUNT)

      await page.evaluate(async () => {
        const newRequirement = document.querySelector<HTMLButtonElement>('[data-ui="mission-new-requirement"]')
        if (!newRequirement) throw new Error("missing Mission new requirement button")
        newRequirement.click()
        const input = await new Promise<HTMLTextAreaElement>((resolve, reject) => {
          const start = performance.now()
          const tick = () => {
            const found = document.querySelector<HTMLTextAreaElement>('[data-ui="mission-composer-input"]')
            if (found) return resolve(found)
            if (performance.now() - start > 10_000) return reject(new Error("Mission composer did not open"))
            setTimeout(tick, 16)
          }
          tick()
        })
        input.value = "preserve composer draft"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.value }))

        // The in-page "Back to Panel" affordance was removed — the Mission
        // page-mode toggle now lives entirely in the titlebar #btnMission
        // button (Mission.tsx comment, gateway-mission-split-2026-05-28.md §3).
        // Clicking it from Mission mode flips back to panel.
        const mission = document.querySelector<HTMLButtonElement>("#btnMission")
        if (!mission) throw new Error("missing Mission button")
        mission.click()
        while (document.body.getAttribute("data-page-mode") !== "panel") {
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        const hiddenRows = document.querySelectorAll(".mission-ledger .task-row-main[data-task-id]").length
        if (hiddenRows !== 0) throw new Error(`hidden Mission ledger still rendered ${hiddenRows} rows`)

        mission.click()
        while (document.body.getAttribute("data-page-mode") !== "mission") {
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        const restored = document.querySelector<HTMLTextAreaElement>('[data-ui="mission-composer-input"]')
        if (!restored) throw new Error("Mission composer unmounted across panel round trip")
        if (restored.value !== "preserve composer draft") {
          throw new Error(`Mission composer draft was not preserved: ${restored.value}`)
        }
        document.querySelector<HTMLButtonElement>('[data-ui="mission-composer-discard"]')?.click()
      })

      const missionSearchMs = await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-ui="mission-search"]')
        if (!input) throw new Error("missing Mission search input")
        const start = performance.now()
        input.value = "task 149"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "task 149" }))
        while (document.querySelectorAll(".mission-ledger .task-row-main[data-task-id]").length !== 1) {
          if (performance.now() - start > 10_000) throw new Error("Mission search did not filter")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return performance.now() - start
      })

      const metrics = await page.metrics()
      console.log(
        `[perf] ${TASK_COUNT} tasks: panelRows=${panelRowsMs.toFixed(1)}ms ` +
          `selectLast=${selectLastMs.toFixed(1)}ms gatewayRows=${gatewayRowsMs.toFixed(1)}ms ` +
          `gatewaySearch=${gatewaySearchMs.toFixed(1)}ms heap=${Math.round(metrics.JSHeapUsedSize / 1024 / 1024)}MB`,
      )

      expect(panelRowsMs).toBeLessThan(PERF_LIMITS.panelRowsMs)
      expect(selectLastMs).toBeLessThan(PERF_LIMITS.selectLastMs)
      expect(gatewayRowsMs).toBeLessThan(PERF_LIMITS.gatewayRowsMs)
      expect(gatewaySearchMs).toBeLessThan(PERF_LIMITS.gatewaySearchMs)
      expect(consoleErrors).toEqual([])
      expect(failedRequests).toEqual([])
      expect(badResponses).toEqual([])
    } finally {
      await page.close().catch(() => undefined)
      await browser.close().catch(() => undefined)
      server.stop(true)
    }
  },
  120_000,
)
