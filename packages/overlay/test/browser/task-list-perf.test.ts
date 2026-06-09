import assert from "node:assert/strict"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const TASK_COUNT = 300
const PAGE_SIZE = 10
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

function missionForTask(item: any): any {
  return {
    missionID: item.task.id.replace(/^task-/, "mission-"),
    sessionID: item.task.sessionID,
    title: item.task.title,
    directory: item.task.directory,
    created: item.task.time.created,
    updated: item.task.time.updated,
    tasks: [],
    taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  }
}

function pageByCursor<T>(
  items: T[],
  limit: number,
  cursorUpdated: number | null,
  cursorID: string | null,
  read: (item: T) => { id: string; updated: number },
): T[] {
  const sorted = [...items].sort((a, b) => {
    const left = read(a)
    const right = read(b)
    return right.updated - left.updated || right.id.localeCompare(left.id)
  })
  const filtered =
    cursorUpdated === null || !cursorID
      ? sorted
      : sorted.filter((item) => {
          const value = read(item)
          return value.updated < cursorUpdated || (value.updated === cursorUpdated && value.id < cursorID)
        })
  return filtered.slice(0, limit)
}

test(`overlay task surfaces stay responsive with ${TASK_COUNT} queued tasks`, { timeout: 120_000 }, async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => taskItem(index))
  const missions = tasks.map(missionForTask)
  const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "perf-test" })
    if (path === "/log") return send({})
    if (path === "/log/tail") return send({ lines: [] })
    if (path === "/global/tasks" || path === "/tasks") {
      const limit = Number(url.searchParams.get("limit") || tasks.length)
      const cursorUpdated = url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : null
      const cursorID = url.searchParams.get("cursorTaskID")
      return send({
        tasks: pageByCursor(tasks, limit, cursorUpdated, cursorID, (item) => ({
          id: item.task.id,
          updated: item.task.time.updated,
        })),
      })
    }
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/path") return send({ directory: "D:/perf/workspace", exists: true, git: true })
    if (path === "/project/current/worktrees") return send({ worktrees: [] })
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
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({ config: {} })
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: TASK_COUNT, completed: 0, failed: 0 })
    if (path === "/mission") {
      const search = (url.searchParams.get("search") || "").trim().toLowerCase()
      const source = search
        ? missions.filter((mission) =>
            [mission.title, mission.missionID, mission.sessionID, mission.directory]
              .join(" ")
              .toLowerCase()
              .includes(search),
          )
        : missions
      const limit = Number(url.searchParams.get("limit") || source.length)
      const cursorUpdated = url.searchParams.has("cursorUpdated") ? Number(url.searchParams.get("cursorUpdated")) : null
      const cursorID = url.searchParams.get("cursorSessionID")
      return send(
        pageByCursor(source, limit, cursorUpdated, cursorID, (mission) => ({
          id: mission.sessionID,
          updated: mission.updated,
        })),
      )
    }
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
    if (path === "/file") return send([])
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/operator-model-context".length))
      const sessionID = tasksByID.get(taskID)?.task.sessionID || `session-${taskID}`
      return send({
        taskID,
        sessionID,
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      })
    }
    if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
      const taskID = decodeURIComponent(path.slice("/task/".length, -"/browser-preview".length))
      return send({
        taskID,
        kind: "missing",
        status: "missing",
        projectRoot: "D:/perf/workspace",
        viewports: [],
        diagnostics: [],
        candidates: [],
        source: "none",
      })
    }
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
    if (/^\/session\/[^/]+\/conversation$/.test(path)) {
      return send({
        transcript: [],
        timeline: [],
        events: [],
        view: { sessions: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
        messageWatermark: 0,
        lastSequence: 0,
      })
    }
    if (/^\/session\/[^/]+\/events$/.test(path)) {
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
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
    const app = server.origin
    await page.evaluateOnNewDocument((origin) => {
      localStorage.setItem("oc_server_url", origin)
      localStorage.setItem("oc_auto_server", "true")
      localStorage.setItem("oc_directory", "D:/perf/workspace")
      localStorage.setItem("oc_theme", "light")
    }, app)
    await page.goto(`${app}/ui/index.html`, { waitUntil: "load" })
    await page.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")

    await page.evaluate(async (count) => {
      const start = performance.now()
      while (document.querySelectorAll(".task-row-main[data-task-id]").length < 5) {
        if (performance.now() - start > 10_000) {
          const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
          const text = document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 500)
          throw new Error(`compact task rows did not render; rows=${rows}; body=${text}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      while (document.querySelector(".project-group-count")?.textContent?.trim() !== String(count)) {
        if (performance.now() - start > 10_000) throw new Error("task project count did not render")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
    }, PAGE_SIZE)

    const panelRowsMs = await page.evaluate(async (count) => {
      const expand = document.querySelector<HTMLButtonElement>(".project-group-show-more button")
      if (!expand) throw new Error("missing task group show-more button")
      const start = performance.now()
      expand.click()
      while (document.querySelectorAll(".task-row-main[data-task-id]").length < count) {
        if (performance.now() - start > 10_000) {
          const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
          throw new Error(`expanded task rows did not render; rows=${rows}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const loadMore = document.querySelector<HTMLButtonElement>('[data-ui="task-list-load-more"]')
      if (!loadMore) throw new Error("missing task list load-more button")
      loadMore.click()
      while (document.querySelectorAll(".task-row-main[data-task-id]").length < count * 2) {
        if (performance.now() - start > 10_000) {
          const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
          throw new Error(`paginated task rows did not render; rows=${rows}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      return performance.now() - start
    }, PAGE_SIZE)

    const hiddenMissionRows = await page.evaluate(
      () => document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length,
    )
    assert.equal(hiddenMissionRows, 0)

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

    await page.evaluate(async () => {
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-row-main[data-task-id]"))
      const firstID = rows.at(0)?.dataset.taskId
      const lastID = rows.at(-1)?.dataset.taskId
      if (!firstID || !lastID || firstID === lastID) throw new Error("missing task rows for scoped composer draft test")
      const composer = () => document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
      const row = (id: string) => document.querySelector<HTMLButtonElement>(`.task-row-main[data-task-id="${id}"]`)
      const waitCurrent = async (id: string) => {
        const start = performance.now()
        while (row(id)?.getAttribute("aria-current") !== "page") {
          if (performance.now() - start > 10_000) throw new Error(`task ${id} was not selected`)
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      }
      const setDraft = (value: string) => {
        const input = composer()
        if (!input) throw new Error("missing panel composer input")
        input.value = value
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
      }
      const expectDraft = async (value: string) => {
        const start = performance.now()
        while (composer()?.value !== value) {
          if (performance.now() - start > 10_000) {
            throw new Error(`panel composer draft mismatch; expected=${value}; actual=${composer()?.value}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      }

      setDraft("draft bound to last task")
      row(firstID)?.click()
      await waitCurrent(firstID)
      setDraft("draft bound to first task")
      row(lastID)?.click()
      await waitCurrent(lastID)
      await expectDraft("draft bound to last task")
      row(firstID)?.click()
      await waitCurrent(firstID)
      await expectDraft("draft bound to first task")
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
      while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length < count) {
        if (performance.now() - start > 10_000) throw new Error("Mission rows did not render")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const firstMission = document.querySelector<HTMLButtonElement>('.mission-ledger [data-ui="mission-row"]')
      if (!firstMission) throw new Error("missing first Mission row")
      firstMission.click()
      return performance.now() - start
    }, PAGE_SIZE)

    await page.evaluate(async () => {
      const waitForMissionConversationInput = async () => {
        const start = performance.now()
        while (!document.querySelector<HTMLTextAreaElement>("#missionConversationChatTextarea")) {
          if (performance.now() - start > 10_000) throw new Error("Mission session composer did not open")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return document.querySelector<HTMLTextAreaElement>("#missionConversationChatTextarea")!
      }
      const missionRows = Array.from(document.querySelectorAll<HTMLElement>('.mission-ledger [data-ui="mission-row"]'))
      const firstSessionID = missionRows.at(0)?.dataset.sessionId
      const secondSessionID = missionRows.at(1)?.dataset.sessionId
      if (!firstSessionID || !secondSessionID) throw new Error("missing Mission rows for scoped composer draft test")
      const missionRow = (sessionID: string) =>
        document.querySelector<HTMLElement>(`.mission-ledger [data-ui="mission-row"][data-session-id="${sessionID}"]`)
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const waitMissionSelected = async (sessionID: string) => {
        const start = performance.now()
        while (missionRow(sessionID)?.dataset.active !== "true") {
          if (performance.now() - start > 10_000) throw new Error(`Mission session ${sessionID} was not selected`)
          await sleep(16)
        }
      }
      const clickMissionAndWait = async (sessionID: string) => {
        const start = performance.now()
        while (missionRow(sessionID)?.dataset.active !== "true") {
          missionRow(sessionID)?.click()
          if (performance.now() - start > 10_000)
            throw new Error(`Mission session ${sessionID} did not accept selection`)
          await sleep(100)
        }
      }
      const setMissionDraft = async (value: string) => {
        const input = await waitForMissionConversationInput()
        input.value = value
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
      }
      const expectMissionDraft = async (value: string) => {
        const start = performance.now()
        while (document.querySelector<HTMLTextAreaElement>("#missionConversationChatTextarea")?.value !== value) {
          if (performance.now() - start > 10_000) {
            const actual = document.querySelector<HTMLTextAreaElement>("#missionConversationChatTextarea")?.value
            throw new Error(`Mission session composer draft mismatch; expected=${value}; actual=${actual}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      }

      await waitForMissionConversationInput()
      await waitMissionSelected(firstSessionID)
      await setMissionDraft("draft bound to first mission session")
      await clickMissionAndWait(secondSessionID)
      await setMissionDraft("draft bound to second mission session")
      await clickMissionAndWait(firstSessionID)
      await expectMissionDraft("draft bound to first mission session")

      const selectStart = performance.now()
      while (!document.querySelector('[data-ui="mission-new"]')) {
        if (performance.now() - selectStart > 10_000)
          throw new Error("Mission selection did not expose new requirement button")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const newRequirement = document.querySelector<HTMLButtonElement>('[data-ui="mission-new"]')
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

      const backToPanel = document.querySelector<HTMLButtonElement>('[data-ui="mission-back-panel"]')
      if (!backToPanel) throw new Error("missing Mission back-to-panel button")
      backToPanel.click()
      while (document.body.getAttribute("data-page-mode") !== "panel") {
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const hiddenRows = document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length
      if (hiddenRows !== 0) throw new Error(`hidden Mission ledger still rendered ${hiddenRows} rows`)

      const mission = document.querySelector<HTMLButtonElement>("#btnMission")
      if (!mission) throw new Error("missing Mission button")
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
      while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length !== 1) {
        if (performance.now() - start > 10_000) throw new Error("Mission search did not filter")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      return performance.now() - start
    })

    const metrics = typeof (page as any).metrics === "function" ? await (page as any).metrics() : null
    console.log(
      `[perf] ${TASK_COUNT} tasks: panelRows=${panelRowsMs.toFixed(1)}ms ` +
        `selectLast=${selectLastMs.toFixed(1)}ms missionRows=${missionRowsMs.toFixed(1)}ms ` +
        `missionSearch=${missionSearchMs.toFixed(1)}ms heap=${
          metrics ? `${Math.round(metrics.JSHeapUsedSize / 1024 / 1024)}MB` : "unavailable"
        }`,
    )

    assert.ok(panelRowsMs < PERF_LIMITS.panelRowsMs, `panelRows=${panelRowsMs}`)
    assert.ok(selectLastMs < PERF_LIMITS.selectLastMs, `selectLast=${selectLastMs}`)
    assert.ok(missionRowsMs < PERF_LIMITS.missionRowsMs, `missionRows=${missionRowsMs}`)
    assert.ok(missionSearchMs < PERF_LIMITS.missionSearchMs, `missionSearch=${missionSearchMs}`)
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(failedRequests, [])
    assert.deepEqual(badResponses, [])
  } finally {
    await page.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
