import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { testTaskOrderKey } from "../fixtures/timeline-order.ts"
import { installBrowserErrorCollector } from "./error-collector.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const TASK_COUNT = 300
const PAGE_SIZE = 10
const LARGE_TEXT = "large task payload ".repeat(120)
const PERF_LIMITS = {
  panelRowsMs: 2500,
  selectLastMs: 1200,
  missionRowsMs: 1500,
  missionSearchMs: 600,
  maxRafGapMs: 120,
  maxLongTaskMs: 160,
}

type InteractionPerf = {
  elapsedMs: number
  label?: string
  longTaskCount: number
  maxLongTaskMs: number
  maxRafGapMs: number
  steps?: InteractionPerf[]
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
  const updated = now + TASK_COUNT - index
  const id = `task-perf-${String(index).padStart(3, "0")}`
  return {
    updated_at: updated,
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
      priority: "normal",
      metadata: {
        notes: `${LARGE_TEXT}${index}`,
      },
      queue: { order: index, revision: "rev-perf" },
      sessionID: `session-perf-${index}`,
      orderKey: testTaskOrderKey(id, created),
      time: {
        created,
        updated,
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
    interruptible: false,
    tasks: [],
    taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  }
}

function assertInteractionPerf(metric: InteractionPerf, label: string) {
  assert.ok(metric.maxRafGapMs <= PERF_LIMITS.maxRafGapMs, `${label} maxRafGapMs=${metric.maxRafGapMs}`)
  assert.ok(metric.maxLongTaskMs <= PERF_LIMITS.maxLongTaskMs, `${label} maxLongTaskMs=${metric.maxLongTaskMs}`)
}

const EXPERT_SQUAD_CATALOG = generalExpertSquadCatalog()

function pageByCursor<T>(
  items: T[],
  limit: number,
  cursorValue: number | null,
  cursorID: string | null,
  read: (item: T) => { id: string; value: number },
): T[] {
  const sorted = [...items].sort((a, b) => {
    const left = read(a)
    const right = read(b)
    return right.value - left.value || right.id.localeCompare(left.id)
  })
  const filtered =
    cursorValue === null || !cursorID
      ? sorted
      : sorted.filter((item) => {
          const value = read(item)
          return value.value < cursorValue || (value.value === cursorValue && value.id < cursorID)
        })
  return filtered.slice(0, limit)
}

test(`overlay task surfaces stay responsive with ${TASK_COUNT} queued tasks`, { timeout: 120_000 }, async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => taskItem(index))
  let missions = tasks.map(missionForTask)
  const tasksByID = new Map(tasks.map((item) => [item.task.id, item]))
  let delayNextMissionLoadMore = false
  let releaseDelayedMissionLoadMore: (() => void) | undefined
  let delayedMissionLoadMoreObserved = false
  let delayedMissionLoadMore: Promise<void> = Promise.resolve()
  const armDelayedMissionLoadMore = () => {
    delayedMissionLoadMoreObserved = false
    delayedMissionLoadMore = new Promise<void>((resolve) => {
      releaseDelayedMissionLoadMore = resolve
    })
  }
  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "perf-test" })
    if (path === "/global/projects/discover") {
      return send({ root: "D:/perf", defaultDirectory: "D:/perf/workspace", projects: [] })
    }
    if (path === "/log") return send({})
    if (path === "/log/tail") return send({ path: "D:/overlay/logs/server.log", lines: [] })
    if (path === "/global/tasks") {
      const limit = Number(url.searchParams.get("limit") || tasks.length)
      const cursorCreated = url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : null
      const cursorID = url.searchParams.get("cursorTaskID")
      return send({
        tasks: pageByCursor(tasks, limit, cursorCreated, cursorID, (item) => ({
          id: item.task.id,
          value: item.task.time.created,
        })),
      })
    }
    if (path === "/skill/mounts") {
      return send({ scope: "project", skills: [], agents: [], matrix: [], project_mounts: { agents: {} }, unmounted_count: 0 })
    }
    if (path === "/executor") return send([])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/path") return send({ directory: "D:/perf/workspace", exists: true, git: true })
    if (path === "/project/current/worktrees") return send([])
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
    if (path === "/config/prompt" || path === "/expert-squad/catalog") return send(EXPERT_SQUAD_CATALOG)
    if (/^\/session\/[^/]+\/config$/.test(path)) return send({ config: {} })
    if (path === "/channel") return send([])
    if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
    if (path === "/gateway/stats") return send({ active: 0, queued: TASK_COUNT, completed: 0, failed: 0 })
    const missionDelete = path.match(/^\/mission\/([^/]+)$/)
    if (missionDelete && req.method === "DELETE") {
      const missionID = decodeURIComponent(missionDelete[1])
      missions = missions.filter((mission) => mission.missionID !== missionID)
      return send({ deleted: true })
    }
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
      if (delayNextMissionLoadMore && cursorUpdated !== null && !search) {
        delayedMissionLoadMoreObserved = true
        await delayedMissionLoadMore
      }
      return send(
        pageByCursor(source, limit, cursorUpdated, cursorID, (mission) => ({
          id: mission.sessionID,
          value: mission.updated,
        })),
      )
    }
    if (path === "/task/events") {
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/skill/directories")
      return send({
        global_config: "D:/task-list-perf/config",
        managed_skills: "D:/task-list-perf/config/skills-market",
        remote_cache: "D:/task-list-perf/cache",
      })
    if (path === "/skill/market") return send([])
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
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    }
    if (/^\/session\/[^/]+\/conversation$/.test(path)) {
      return send({
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        agentView: { topLevelSessionIDs: [], sessions: [], messages: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100, sinceTimestamp: null },
        history: { oldestTimestamp: null, oldestOrderKey: null, oldestMessageID: null, hasMore: false, limit: 160 },
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
  const errors = installBrowserErrorCollector(page, {
    allowRequestFailure(failure) {
      if (/^\/task\/[^/]+\/events(?:\?.*)?$/.test(failure.pathWithSearch)) {
        return failure.errorText === "net::ERR_ABORTED"
      }
      return (
        (/^\/task\/[^/]+\/conversation(?:\?.*)?$/.test(failure.pathWithSearch) ||
          /^\/session\/[^/]+\/conversation(?:\?.*)?$/.test(failure.pathWithSearch)) &&
        failure.errorText === "net::ERR_ABORTED"
      )
    },
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
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]', {
      visible: true,
    })
    await page.click('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')

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

    await page.evaluate(() => {
      ;(window as any).__taskListMeasureInteraction = async (
        label: string,
        action: () => Promise<void>,
      ): Promise<InteractionPerf> => {
        const rafGaps: number[] = []
        const longTasks: number[] = []
        let observer: PerformanceObserver | undefined
        let rafID = 0
        let sampling = true
        let previousFrame = performance.now()
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const tick = (time: number) => {
          if (!sampling) return
          rafGaps.push(time - previousFrame)
          previousFrame = time
          rafID = requestAnimationFrame(tick)
        }
        if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration)
          })
          observer.observe({ entryTypes: ["longtask"] })
        }
        rafID = requestAnimationFrame(tick)
        await frame()
        rafGaps.length = 0
        previousFrame = performance.now()
        const start = performance.now()
        await action()
        await frame()
        const elapsedMs = performance.now() - start
        sampling = false
        cancelAnimationFrame(rafID)
        observer?.disconnect()
        return {
          elapsedMs,
          longTaskCount: longTasks.length,
          maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
          maxRafGapMs: Math.max(0, ...rafGaps),
        }
      }
    })

    const panelRows = await page.evaluate(async (count) => {
      const expand = document.querySelector<HTMLButtonElement>(".project-group-show-more button")
      if (!expand) throw new Error("missing task group show-more button")
      const steps: InteractionPerf[] = []
      const measure = (window as any).__taskListMeasureInteraction as (
        label: string,
        action: () => Promise<void>,
      ) => Promise<InteractionPerf>
      const waitStart = performance.now()
      steps.push(
        await measure("task expand visible rows", async () => {
          const start = performance.now()
          expand.click()
          while (document.querySelectorAll(".task-row-main[data-task-id]").length < count) {
            if (performance.now() - start > 10_000) {
              const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
              throw new Error(`expanded task rows did not render; rows=${rows}`)
            }
            await new Promise((resolve) => setTimeout(resolve, 16))
          }
        }),
      )
      const loadMore = document.querySelector<HTMLButtonElement>('[data-ui="task-list-load-more"]')
      if (!loadMore) throw new Error("missing task list load-more button")
      steps.push(
        await measure("task load more rows", async () => {
          const start = performance.now()
          loadMore.click()
          while (document.querySelectorAll(".task-row-main[data-task-id]").length < count * 2) {
            if (performance.now() - start > 10_000) {
              const rows = document.querySelectorAll(".task-row-main[data-task-id]").length
              throw new Error(`paginated task rows did not render; rows=${rows}`)
            }
            await new Promise((resolve) => setTimeout(resolve, 16))
          }
        }),
      )
      const search = document.querySelector<HTMLInputElement>(".task-list-search-input")
      if (!search) throw new Error("missing task list search")
      steps.push(
        await measure("task search empty state", async () => {
          const start = performance.now()
          search.value = "task-perf-000"
          search.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: search.value }))
          while (!document.querySelector(".empty-hint")?.textContent?.includes("task-perf-000")) {
            if (performance.now() - start > 10_000) throw new Error("task search empty state did not render")
            await new Promise((resolve) => setTimeout(resolve, 16))
          }
          if (!document.querySelector<HTMLButtonElement>('[data-ui="task-list-load-more"]')) {
            throw new Error("search with pending pages hid the task list load-more button")
          }
        }),
      )
      steps.push(
        await measure("task clear search restore rows", async () => {
          const start = performance.now()
          search.value = ""
          search.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }))
          while (!document.querySelector('.task-row-main[data-task-id="task-perf-290"]')) {
            if (performance.now() - start > 10_000) throw new Error("task rows did not restore after clearing search")
            await new Promise((resolve) => setTimeout(resolve, 16))
          }
        }),
      )
      steps.push(
        await measure("task search single row", async () => {
          const start = performance.now()
          search.value = "task-perf-290"
          search.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: search.value }))
          while (document.querySelectorAll(".task-row-main[data-task-id]").length !== 1) {
            if (performance.now() - start > 10_000) throw new Error("single task search did not settle")
            await new Promise((resolve) => setTimeout(resolve, 16))
          }
        }),
      )
      const filtered = document.querySelector<HTMLElement>('.task-row-mini[data-task-row-id="task-perf-290"]')
      const filteredText = filtered?.textContent?.replace(/\s+/g, " ") ?? ""
      if (!filteredText.includes("Queued")) {
        throw new Error(`search lost the queued status badge; text=${filteredText}`)
      }
      if (/Queued #\d+/.test(filteredText)) {
        throw new Error(`search rendered an unproven global queue ordinal; text=${filteredText}`)
      }
      const badgeText = filtered?.querySelector<HTMLElement>(".task-row-badge-text")
      const badgeRect = badgeText?.getBoundingClientRect()
      const badgeStyle = badgeText ? getComputedStyle(badgeText) : null
      if (!badgeRect || badgeRect.width <= 24 || badgeStyle?.position === "absolute" || badgeStyle?.clip !== "auto") {
        throw new Error(
          `search preserved queue text without a visible badge; rect=${badgeRect?.width ?? 0}; position=${badgeStyle?.position}; clip=${badgeStyle?.clip}`,
        )
      }
      return {
        elapsedMs: performance.now() - waitStart,
        longTaskCount: steps.reduce((total, step) => total + step.longTaskCount, 0),
        maxLongTaskMs: Math.max(0, ...steps.map((step) => step.maxLongTaskMs)),
        maxRafGapMs: Math.max(0, ...steps.map((step) => step.maxRafGapMs)),
        steps,
      }
    }, PAGE_SIZE)
    const queueBadgeScreenshot = resolve(SCRATCH_ROOT, "task-list-search-preserves-global-queue-badge.png")
    mkdirSync(dirname(queueBadgeScreenshot), { recursive: true })
    await page.screenshot({ path: queueBadgeScreenshot, fullPage: false })
    await page.evaluate(() => {
      const search = document.querySelector<HTMLInputElement>(".task-list-search-input")
      if (!search) throw new Error("missing task list search")
      search.value = ""
      search.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }))
    })

    const visibleMissionRows = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('.mission-ledger [data-ui="mission-row"]')).filter(
          (node) => node.getClientRects().length > 0,
        ).length,
    )
    assert.equal(visibleMissionRows, 0)

    const selectLast = await page.evaluate(async () => {
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".task-row-main[data-task-id]"))
      const last = rows.at(-1)
      if (!last) throw new Error("missing last task row")
      return await (window as any).__taskListMeasureInteraction("select last task", async () => {
        const start = performance.now()
        last.click()
        while (last.getAttribute("aria-current") !== "page") {
          if (performance.now() - start > 10_000) throw new Error("last task was not selected")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      })
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

    const missionRows = await page.evaluate(async (count) => {
      const mission = document.querySelector<HTMLButtonElement>(
        '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
      )
      if (!mission) throw new Error("missing Mission activity button")
      return await (window as any).__taskListMeasureInteraction("mission rows", async () => {
        const start = performance.now()
        mission.click()
        while (document.querySelector<HTMLElement>("#leftPanelMissions")?.dataset.active !== "true") {
          if (performance.now() - start > 10_000) throw new Error("Mission activity did not open")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length < count) {
          if (performance.now() - start > 10_000) throw new Error("Mission rows did not render")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        const loadMore = document.querySelector<HTMLButtonElement>('[data-ui="mission-ledger-load-more"]')
        if (!loadMore) throw new Error("missing Mission load-more button")
        loadMore.click()
        while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length < count * 2) {
          if (performance.now() - start > 10_000) throw new Error("Mission paginated rows did not render")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        const firstMission = document.querySelector<HTMLButtonElement>(
          '.mission-ledger [data-ui="mission-row"] .mission-row-main',
        )
        if (!firstMission) throw new Error("missing first Mission row")
        firstMission.click()
      })
    }, PAGE_SIZE)

    await page.evaluate(async () => {
      const waitForSharedComposerInput = async () => {
        const start = performance.now()
        while (!document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")) {
          if (performance.now() - start > 10_000) throw new Error("shared session composer did not open")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
        return document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")!
      }
      const missionRows = Array.from(document.querySelectorAll<HTMLElement>('.mission-ledger [data-ui="mission-row"]'))
      const firstSessionID = missionRows.at(0)?.dataset.sessionId
      const secondSessionID = missionRows.at(1)?.dataset.sessionId
      if (!firstSessionID || !secondSessionID) throw new Error("missing Mission rows for scoped composer draft test")
      const missionRow = (sessionID: string) =>
        document.querySelector<HTMLElement>(`.mission-ledger [data-ui="mission-row"][data-session-id="${sessionID}"]`)
      const missionMain = (sessionID: string) =>
        document.querySelector<HTMLButtonElement>(
          `.mission-ledger [data-ui="mission-row"][data-session-id="${sessionID}"] .mission-row-main`,
        )
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
          missionMain(sessionID)?.click()
          if (performance.now() - start > 10_000)
            throw new Error(`Mission session ${sessionID} did not accept selection`)
          await sleep(100)
        }
      }
      const setMissionDraft = async (value: string) => {
        const input = await waitForSharedComposerInput()
        input.value = value
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
      }
      const expectMissionDraft = async (value: string) => {
        const start = performance.now()
        while (document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")?.value !== value) {
          if (performance.now() - start > 10_000) {
            const actual = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")?.value
            throw new Error(`Mission session composer draft mismatch; expected=${value}; actual=${actual}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      }

      await waitForSharedComposerInput()
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

      const tasks = document.querySelector<HTMLButtonElement>(
        '[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]',
      )
      if (!tasks) throw new Error("missing Tasks activity button")
      tasks.click()
      while (document.querySelector<HTMLElement>("#leftPanelMissions")?.dataset.active === "true") {
        await new Promise((resolve) => setTimeout(resolve, 16))
      }

      const mission = document.querySelector<HTMLButtonElement>(
        '[data-ui="side-activity-button"][data-side="left"][data-activity="mission"]',
      )
      if (!mission) throw new Error("missing Mission activity button")
      mission.click()
      while (document.querySelector<HTMLElement>("#leftPanelMissions")?.dataset.active !== "true") {
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const restoredLauncher = document.querySelector<HTMLButtonElement>('[data-ui="mission-new"]')
      if (!restoredLauncher) throw new Error("Mission activity did not restore new Mission control")
      restoredLauncher.click()
      const restored = document.querySelector<HTMLTextAreaElement>('[data-ui="mission-composer-input"]')
      if (!restored) throw new Error("Mission composer did not reopen in the shared panel")
      if (restored.value !== "preserve composer draft") {
        throw new Error(`Mission composer draft was not preserved: ${restored.value}`)
      }
    })

    const missionSearch = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-ui="mission-search"]')
      if (!input) throw new Error("missing Mission search input")
      return await (window as any).__taskListMeasureInteraction("mission search", async () => {
        const start = performance.now()
        input.value = "task 149"
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "task 149" }))
        while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length !== 1) {
          if (performance.now() - start > 10_000) throw new Error("Mission search did not filter")
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      })
    })

    armDelayedMissionLoadMore()
    delayNextMissionLoadMore = true
    await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-ui="mission-search"]')
      if (!input) throw new Error("missing Mission search input")
      input.value = ""
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }))
      const start = performance.now()
      while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length < 10) {
        if (performance.now() - start > 10_000) throw new Error("Mission rows did not restore before stale load-more race")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const loadMore = document.querySelector<HTMLButtonElement>('[data-ui="mission-ledger-load-more"]')
      if (!loadMore) throw new Error("missing Mission load-more button before stale race")
      loadMore.click()
    })
    for (let i = 0; i < 200 && !delayedMissionLoadMoreObserved; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(delayedMissionLoadMoreObserved, true, "Mission delayed load-more request was not observed")
    await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-ui="mission-search"]')
      if (!input) throw new Error("missing Mission search input")
      input.value = "task 149"
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "task 149" }))
      const start = performance.now()
      while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length !== 1) {
        if (performance.now() - start > 10_000) throw new Error("Mission search did not filter before stale response release")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
    })
    releaseDelayedMissionLoadMore?.()
    await new Promise((resolve) => setTimeout(resolve, 300))
    delayNextMissionLoadMore = false
    const staleMissionState = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length,
      text: document.querySelector<HTMLElement>(".mission-ledger")?.textContent?.replace(/\s+/g, " ") ?? "",
    }))
    assert.equal(staleMissionState.rowCount, 1, staleMissionState.text)
    assert.match(staleMissionState.text, /Performance task 149/)
    assert.doesNotMatch(staleMissionState.text, /Performance task 14(0|1|2|3|4|5|6|7|8)\b/)

    armDelayedMissionLoadMore()
    delayNextMissionLoadMore = true
    await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-ui="mission-search"]')
      if (!input) throw new Error("missing Mission search input")
      input.value = ""
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }))
      const start = performance.now()
      while (document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length < 10) {
        if (performance.now() - start > 10_000) throw new Error("Mission rows did not restore before delete race")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const loadMore = document.querySelector<HTMLButtonElement>('[data-ui="mission-ledger-load-more"]')
      if (!loadMore) throw new Error("missing Mission load-more button before delete race")
      loadMore.click()
    })
    for (let i = 0; i < 200 && !delayedMissionLoadMoreObserved; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(delayedMissionLoadMoreObserved, true, "Mission delayed same-source load-more request was not observed")
    await page.evaluate(async () => {
      const row = document.querySelector<HTMLElement>('[data-mission-id="mission-perf-005"]')
      if (!row) throw new Error("missing Mission row to delete")
      const button = row.querySelector<HTMLButtonElement>('[data-ui="task-row-delete"]')
      if (!button) throw new Error("missing Mission delete button")
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 40))
      button.click()
      const start = performance.now()
      while (document.querySelector('[data-mission-id="mission-perf-005"]')) {
        if (performance.now() - start > 10_000) throw new Error("deleted Mission row did not leave list")
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
    })
    releaseDelayedMissionLoadMore?.()
    await new Promise((resolve) => setTimeout(resolve, 300))
    delayNextMissionLoadMore = false
    const sameSourceDeleteRace = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('.mission-ledger [data-ui="mission-row"]').length,
      deletedVisible: !!document.querySelector('[data-mission-id="mission-perf-005"]'),
      replacementVisible: !!document.querySelector('[data-mission-id="mission-perf-010"]'),
      text: document.querySelector<HTMLElement>(".mission-ledger")?.textContent?.replace(/\s+/g, " ") ?? "",
    }))
    assert.equal(sameSourceDeleteRace.deletedVisible, false, sameSourceDeleteRace.text)
    assert.equal(sameSourceDeleteRace.replacementVisible, true, sameSourceDeleteRace.text)
    assert.equal(sameSourceDeleteRace.rowCount, 10, sameSourceDeleteRace.text)

    const metrics = typeof (page as any).metrics === "function" ? await (page as any).metrics() : null
    console.log(
      `[perf] ${TASK_COUNT} tasks: panelRows=${panelRows.elapsedMs.toFixed(1)}ms/${panelRows.maxRafGapMs.toFixed(1)}raf ` +
        `selectLast=${selectLast.elapsedMs.toFixed(1)}ms/${selectLast.maxRafGapMs.toFixed(1)}raf ` +
        `missionRows=${missionRows.elapsedMs.toFixed(1)}ms/${missionRows.maxRafGapMs.toFixed(1)}raf ` +
        `missionSearch=${missionSearch.elapsedMs.toFixed(1)}ms/${missionSearch.maxRafGapMs.toFixed(1)}raf heap=${
          metrics ? `${Math.round(metrics.JSHeapUsedSize / 1024 / 1024)}MB` : "unavailable"
        }`,
    )

    assert.ok(panelRows.elapsedMs < PERF_LIMITS.panelRowsMs, `panelRows=${panelRows.elapsedMs}`)
    assert.ok(selectLast.elapsedMs < PERF_LIMITS.selectLastMs, `selectLast=${selectLast.elapsedMs}`)
    assert.ok(missionRows.elapsedMs < PERF_LIMITS.missionRowsMs, `missionRows=${missionRows.elapsedMs}`)
    assert.ok(missionSearch.elapsedMs < PERF_LIMITS.missionSearchMs, `missionSearch=${missionSearch.elapsedMs}`)
    assertInteractionPerf(panelRows, "panelRows")
    assertInteractionPerf(selectLast, "selectLast")
    assertInteractionPerf(missionRows, "missionRows")
    assertInteractionPerf(missionSearch, "missionSearch")
    errors.assertNoUnexpectedErrors()
  } finally {
    releaseDelayedMissionLoadMore?.()
    await page.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    await server.close()
  }
})
