import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

const src = new URL("../src/", import.meta.url)
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

async function browser() {
  const list = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay render behavior test")
}

function serve() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }))
    },
  })
}

test("overlay initializes cwd in a fresh temp directory when no custom cwd is saved", async () => {
  const exe = await browser()
  const seen: { path: string; directory: string | null }[] = []
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      if (!path.startsWith("/i18n/") && !path.endsWith(".svg") && !path.endsWith(".css") && !path.endsWith(".js") && !path.endsWith(".json") && path !== "/") {
        seen.push({
          path,
          directory: url.searchParams.get("directory"),
        })
      }
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") {
        const directory = url.searchParams.get("directory") || ""
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: directory,
          directory,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 })))
    },
  })
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value) => {
      const state = {
        settings: {
          serverUrl: value,
          autoServer: false,
        },
        temp: [] as string[],
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return state.settings
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_create_temp_dir") {
              const next = `D:/overlay/temp-auto-${state.temp.length + 1}`
              state.temp.push(next)
              return next
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
    await tab.waitForFunction(() => {
      try {
        const state = window.eval("state")
        return state.directory === "D:/overlay/temp-auto-1" && state.path?.directory === "D:/overlay/temp-auto-1"
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const test = (window as typeof window & { __overlayTest: { settings: Record<string, unknown> } }).__overlayTest
      return {
        directory: state.directory,
        directoryMode: state.directoryMode,
        savedDirectory: test.settings.directory,
        savedDirectoryMode: test.settings.directoryMode,
      }
    })

    expect(result.directory).toBe("D:/overlay/temp-auto-1")
    expect(result.directoryMode).toBe("temp")
    expect(result.savedDirectory).toBeUndefined()
    expect(result.savedDirectoryMode).toBe("temp")
    expect(seen.some((item) => item.path === "/tasks" && item.directory === "D:/overlay/temp-auto-1")).toBe(true)
    expect(seen.some((item) => item.path === "/path" && item.directory === "D:/overlay/temp-auto-1")).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("overlay shows unattended mode enabled by default", async () => {
  const exe = await browser()
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") {
        const directory = url.searchParams.get("directory") || ""
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: directory,
          directory,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }))
    },
  })
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value) => {
      const state = {
        settings: {
          serverUrl: value,
          autoServer: false,
        },
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return state.settings
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            if (command === "overlay_create_temp_dir") return "D:/overlay/default-unattended"
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const saved = (window as typeof window & { __overlayTest: { settings: Record<string, unknown> } }).__overlayTest.settings
      return {
        unattended: state.unattended,
        checked: document.querySelector("#chkUnattended") instanceof HTMLInputElement
          ? (document.querySelector("#chkUnattended") as HTMLInputElement).checked
          : false,
        savedUnattended: saved.unattended,
      }
    })

    expect(result.unattended).toBe(true)
    expect(result.checked).toBe(true)
    expect(result.savedUnattended).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("cwd uses state.directory as the only active source and keeps actions on the right", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderMeta") === "function"
          && typeof window.eval("activeDirectory") === "function"
          && typeof window.eval("clearProjectScopeData") === "function"
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderMeta = window.eval("renderMeta")
      const activeDirectory = window.eval("activeDirectory")
      const clearProjectScopeData = window.eval("clearProjectScopeData")

      state.directory = "D:/overlay/current"
      state.path = { directory: "D:/overlay/stale" }
      renderMeta()
      const filled = {
        active: activeDirectory(),
        lastChild: document.querySelector(".task-dir-shell")?.lastElementChild?.className || "",
      }

      state.directory = ""
      renderMeta()
      const empty = {
        active: activeDirectory(),
        lastChild: document.querySelector(".task-dir-shell")?.lastElementChild?.className || "",
      }

      state.memoryFiles = [{ id: "mem-1", title: "note", scope: "global", source: "test", timeUpdated: 1 }]
      state.memorySearchMode = true
      state.preferences = [{ id: "pref-1", key: "tone", value: "brief", scope: "cwd", source: "test" }]
      state.path = { directory: "D:/overlay/stale" }
      state.vcs = { branch: "main" }
      state.tasks = [{ task: { id: "task-1" } }]
      clearProjectScopeData()

      return {
        filled,
        empty,
        cleared: {
          path: state.path,
          vcs: state.vcs,
          tasks: state.tasks.length,
          memory: state.memoryFiles.length,
          search: state.memorySearchMode,
          preferences: state.preferences.length,
        },
      }
    })

    expect(result.filled.active).toBe("D:/overlay/current")
    expect(result.filled.lastChild).toContain("task-dir-actions")
    expect(result.empty.active).toBe("")
    expect(result.empty.lastChild).toContain("task-dir-actions")
    expect(result.cleared.path).toBeNull()
    expect(result.cleared.vcs).toBeNull()
    expect(result.cleared.tasks).toBe(0)
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("planner turn refreshes when synthetic board content changes", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const before = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          status: "running",
          request: "Review overlay render behavior.",
          time: { created: 1, updated: 5 },
        },
        spec: {
          content: "Spec before",
          time: { created: 2 },
        },
        plan: {
          version: 1,
          summary: "Plan before",
          time: { created: 3 },
          metadata: {},
        },
        lanes: [
          {
            id: "goals",
            cards: [
              {
                id: "goal-1",
                title: "Goal before",
                detail: "Keep synthetic turns current.",
                status: "pending",
                metadata: {},
              },
            ],
          },
        ],
        interactions: [],
        evaluation: {
          verdict: "pending",
          summary: "Evaluation before",
          time: { created: 4 },
          checks: [],
        },
      }
      state.messages = [
        {
          parts: [{ type: "text", text: "Assistant note" }],
          info: { role: "assistant", time: { created: 6 } },
        },
      ]
      state._renderedGroupKey = ""
      renderConversation()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(before).toContain("Plan before")

    const after = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")

      state.board = {
        ...state.board,
        plan: {
          ...state.board.plan,
          summary: "Plan after",
        },
      }
      renderConversation()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(after).toContain("Plan after")
    expect(after).not.toContain("Plan before")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("main right-rail sections do not clip long panel content", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderSpec") === "function"
          && typeof window.eval("renderPlan") === "function"
          && typeof window.eval("renderGoals") === "function"
          && typeof window.eval("renderEvaluation") === "function"
          && typeof window.eval("renderChanges") === "function"
          && typeof window.eval("renderOverview") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const renderSpec = window.eval("renderSpec")
      const renderPlan = window.eval("renderPlan")
      const renderGoals = window.eval("renderGoals")
      const renderCriteria = window.eval("renderCriteria")
      const renderEvaluation = window.eval("renderEvaluation")
      const renderChanges = window.eval("renderChanges")
      const renderOverview = window.eval("renderOverview")
      const state = window.eval("state")

      for (const id of ["specSection", "planSection", "goalsSection", "criteriaSection", "changesSection", "overviewSection"]) {
        const section = document.querySelector(`#${id}`)
        if (!(section instanceof HTMLDetailsElement)) throw new Error(`Missing section: ${id}`)
        section.open = true
      }

      renderSpec({
        content: Array.from({ length: 24 }, (_, i) => `Spec line ${i + 1}: ` + "detail ".repeat(8)).join("\n\n"),
        time: { created: 1 },
      })
      renderPlan({
        version: 3,
        summary: Array.from({ length: 18 }, (_, i) => `Plan step ${i + 1}: ` + "detail ".repeat(8)).join("\n\n"),
        time: { created: 2 },
      })
      renderGoals(
        Array.from({ length: 12 }, (_, i) => ({
          id: `goal-${i + 1}`,
          title: `Goal ${i + 1}`,
          detail: "Goal detail ".repeat(10),
          status: i % 2 === 0 ? "passed" : "pending",
          metadata: {},
        })),
      )

      const task = {
        status: "running",
        metadata: {
          checks: {
            spec_check: { enabled: true },
          },
        },
      }
      const evaluation = {
        verdict: "rejected",
        summary: "Long evaluation summary",
        time: { created: 1 },
        checks: Array.from({ length: 18 }, (_, i) => ({
          name: `custom_check_${i + 1}`,
          label: `Custom Check ${i + 1}`,
          family: i > 8 ? "review" : "custom",
          status: i % 3 === 0 ? "failed" : "passed",
          evidence: `Evidence ${i + 1}: ` + "detail ".repeat(20),
        })),
      }

      renderCriteria(task, evaluation)
      renderEvaluation(evaluation, null)

      state.changes = Array.from({ length: 14 }, (_, i) => ({
        file: `src/file-${i + 1}.ts`,
        before: "before",
        after: "after",
        additions: i + 1,
        deletions: i,
        status: i % 3 === 0 ? "added" : i % 3 === 1 ? "modified" : "deleted",
      }))
      renderChanges()

      renderOverview(
        {
          headline: "Overview headline",
          summary: Array.from({ length: 16 }, (_, i) => `Overview item ${i + 1}: ` + "detail ".repeat(8)).join("\n\n"),
          nextStep: {
            title: "Next step",
            detail: "Execute the next step with enough detail to overflow the old inner cap.",
          },
          controls: {},
        },
        task,
      )

      const panels = ["specBody", "planBody", "goalsBody", "criteriaBody", "changesBody", "overviewBody"]
        .map((id) => {
          const body = document.querySelector(`#${id}`)
          if (!(body instanceof HTMLElement)) throw new Error(`Missing body: ${id}`)
          return {
            id,
            maxHeight: getComputedStyle(body).maxHeight,
            overflow: getComputedStyle(body).overflowY,
            clipped: body.scrollHeight > body.clientHeight + 1,
            scrollHeight: body.scrollHeight,
          }
        })

      return { panels }
    })

    expect(result.panels.every((item) => item.maxHeight === "none")).toBe(true)
    expect(result.panels.every((item) => item.overflow === "visible")).toBe(true)
    expect(result.panels.some((item) => item.scrollHeight > 260)).toBe(true)
    expect(result.panels.every((item) => item.clipped === false)).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("main right-rail leaf content uses the unified 9px font size", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderOverview") === "function"
          && typeof window.eval("renderSpec") === "function"
          && typeof window.eval("renderPlan") === "function"
          && typeof window.eval("renderGoals") === "function"
          && typeof window.eval("renderCriteria") === "function"
          && typeof window.eval("renderEvaluation") === "function"
          && typeof window.eval("renderChanges") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const renderOverview = window.eval("renderOverview")
      const renderSpec = window.eval("renderSpec")
      const renderPlan = window.eval("renderPlan")
      const renderGoals = window.eval("renderGoals")
      const renderCriteria = window.eval("renderCriteria")
      const renderEvaluation = window.eval("renderEvaluation")
      const renderChanges = window.eval("renderChanges")
      const state = window.eval("state")

      for (const id of ["overviewSection", "specSection", "planSection", "goalsSection", "criteriaSection", "changesSection"]) {
        const section = document.querySelector(`#${id}`)
        if (!(section instanceof HTMLDetailsElement)) throw new Error(`Missing section: ${id}`)
        section.open = true
      }

      renderOverview(
        {
          headline: "### Compact overview heading",
          summary: "Keep the overview summary on the unified leaf scale.",
          nextStep: {
            title: "Next step",
            detail: "Do not let inline sizing break the right rail hierarchy.",
          },
          currentFailure: {
            title: "Failure summary",
            summary: "A large inline markdown block should stay compact here too.",
          },
          controls: {},
        },
        {
          status: "running",
        },
      )

      renderSpec({
        content: "Spec copy should use the same compact reading size.",
        time: { created: 1 },
      })

      renderPlan({
        version: 3,
        summary: "Plan content should not jump above the right-rail text scale.",
        time: { created: 1 },
      })

      renderGoals([
        {
          id: "goal-1",
          title: "Tighten the visual system",
          detail: "Unify fonts, tones, and spacing.",
          status: "passed",
          metadata: { priority: "blocking" },
        },
      ])

      renderCriteria(
        {
          status: "running",
          metadata: {
            checks: {
              spec_check: { enabled: true },
            },
          },
        },
        {
          verdict: "approved",
          checks: [
            {
              name: "spec_check",
              label: "Spec check",
              family: "acceptance",
              status: "passed",
            },
            {
              name: "custom_review",
              label: "Custom review",
              family: "review",
              status: "failed",
              evidence: "Leaf font should stay fixed at 9px.",
            },
          ],
        },
      )

      renderEvaluation(
        {
          verdict: "approved",
          summary: "Evaluation summary text should stay visually compact.",
          checks: [
            {
              name: "custom_review",
              label: "Custom review",
              family: "review",
              status: "failed",
              evidence: "Leaf font should stay fixed at 9px.",
            },
          ],
        },
        {
          status: "candidate",
          summary: "Delivery summary should stay on the same reading scale.",
          result: {
            changedFiles: ["src/panel/right-rail-leaf.ts"],
          },
        },
      )

      state.changes = [
        {
          file: "src/panel/right-rail-leaf.ts",
          before: "const size = 12\n",
          after: "const size = 9\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ]
      renderChanges()

      const pick = (selector: string) => {
        const node = document.querySelector(selector)
        if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
        return getComputedStyle(node).fontSize
      }

      return {
        overviewSummary: pick("#overviewBody .overview-summary"),
        overviewNextStep: pick("#overviewBody .overview-next-step"),
        overviewFailureTitle: pick("#overviewBody .interaction-title"),
        specSummary: pick("#specBody .plan-summary"),
        planSummary: pick("#planBody .plan-summary"),
        goalDesc: pick("#goalsBody .goal-desc"),
        goalCriteria: pick("#goalsBody .goal-criteria"),
        changePath: pick("#changesBody .change-path"),
        changeSubline: pick("#changesBody .change-subline"),
        criteriaName: pick("#criteriaBody .criteria-name"),
        criteriaDesc: pick("#criteriaBody .criteria-desc"),
        criteriaResult: pick("#criteriaBody .criteria-result"),
        evalErrorName: pick("#criteriaBody .eval-error-name"),
        deliveryTitle: pick("#evalBody .delivery-title"),
        deliverySummary: pick("#evalBody .delivery-summary"),
        deliveryFiles: pick("#evalBody .delivery-files"),
      }
    })

    expect(Object.values(result)).toEqual([
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
      "9px",
    ])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("sidebar typography keeps headers and primary actions above caption size", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const pick = (selector: string) => {
        const node = document.querySelector(selector)
        if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
        return Number.parseFloat(getComputedStyle(node).fontSize)
      }

      return {
        title: pick(".sidebar-title"),
        subtitle: pick("#sidebarSubtitle"),
        primary: pick("#btnCreateTask"),
      }
    })

    expect(result.title).toBeGreaterThan(result.subtitle)
    expect(result.title).toBeGreaterThanOrEqual(13)
    expect(result.subtitle).toBeGreaterThanOrEqual(10)
    expect(result.primary).toBeGreaterThanOrEqual(10)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("overlay chrome keeps opacity, header, version, and capsule controls aligned with visual fx disabled", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderGoals") === "function"
          && typeof window.eval("renderVersions") === "function"
          && typeof window.eval("sanitizeOpacity") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const renderGoals = window.eval("renderGoals")
      const renderVersions = window.eval("renderVersions")
      const sanitizeOpacity = window.eval("sanitizeOpacity")
      const setTitlebarMenu = window.eval("setTitlebarMenu")

      renderVersions("1.2.3")
      renderGoals([
        {
          id: "goal-1",
          title: "Keep header stable",
          detail: "Do not let the button change parent height",
          status: "pending",
        },
      ])

      const pick = (selector: string) => {
        const node = document.querySelector(selector)
        if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
        return node
      }
      const sidebarFooter = document.querySelector(".sidebar-footer")

      const size = (selector: string) => pick(selector).getBoundingClientRect()
      const techAtlas = document.querySelector(".tech-atlas")
      if (!(techAtlas instanceof HTMLElement)) throw new Error("Missing tech atlas")
      const techCanvas = document.querySelector("#techAtlasCanvas")
      if (!(techCanvas instanceof HTMLCanvasElement)) throw new Error("Missing tech atlas canvas")
      const titlebarHeight = size(".titlebar").height
      setTitlebarMenu(true)
      const menu = pick("#titlebarMenu")
      const sectionsBox = size(".sections")
      const configAreaBox = size("#configArea")

      return {
        opacityMin: Number((pick("#opacityRange") as HTMLInputElement).min),
        sanitizedOpacity: sanitizeOpacity(0.3),
        chatVersionText: pick("#chatVersion").textContent?.trim() || "",
        chatVersionDisplay: getComputedStyle(pick("#chatVersion")).display,
        goalToolbarCount: document.querySelectorAll("#goalsBody .section-actions").length,
        goalsHeadHeight: size("#goalsSection > .section-head").height,
        planHeadHeight: size("#planSection > .section-head").height,
        sidebarHeaderHeight: size(".sidebar-header").height,
        chatHeaderHeight: size(".chat-header").height,
        sectionsHeaderHeight: size(".sections-header").height,
        sectionsGap: Number.parseFloat(getComputedStyle(pick(".sections-stack")).rowGap),
        engineRadius: Number.parseFloat(getComputedStyle(pick("#engineBar")).borderRadius),
        channelRadius: Number.parseFloat(getComputedStyle(pick("#brandVersion .brand-channel-group")).borderRadius),
        techAtlasDisplay: getComputedStyle(techAtlas).display,
        techCanvasWidth: techCanvas.width,
        techCanvasHeight: techCanvas.height,
        techSweepAnimation: getComputedStyle(pick(".tech-sweep")).animationName,
        titlebarHeight,
        titlebarHeightWithMenu: size(".titlebar").height,
        titlebarMenuPosition: getComputedStyle(menu).position,
        configBottomGap: sectionsBox.bottom - configAreaBox.bottom,
        sidebarFooterDisplay: sidebarFooter instanceof HTMLElement ? getComputedStyle(sidebarFooter).display : "none",
        llmSummaryHeight: size("#llmSection").height,
        configToggleHeight: size("#btnConfigToggle").height,
      }
    })

    expect(result.opacityMin).toBe(50)
    expect(result.sanitizedOpacity).toBe(0.5)
    expect(result.chatVersionText.length).toBeGreaterThan(0)
    expect(result.chatVersionDisplay).not.toBe("none")
    expect(result.goalToolbarCount).toBe(0)
    expect(Math.abs(result.goalsHeadHeight - result.planHeadHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.sidebarHeaderHeight - result.chatHeaderHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(result.sectionsHeaderHeight - result.chatHeaderHeight)).toBeLessThanOrEqual(1)
    expect(result.chatHeaderHeight).toBeGreaterThanOrEqual(34)
    expect(result.chatHeaderHeight).toBeLessThanOrEqual(38)
    expect(result.sectionsGap).toBeLessThanOrEqual(6)
    expect(result.engineRadius).toBeGreaterThanOrEqual(100)
    expect(result.channelRadius).toBeGreaterThanOrEqual(100)
    expect(result.techAtlasDisplay).toBe("none")
    expect(result.techCanvasWidth).toBe(0)
    expect(result.techCanvasHeight).toBe(0)
    expect(Math.abs(result.titlebarHeightWithMenu - result.titlebarHeight)).toBeLessThanOrEqual(1)
    expect(result.titlebarMenuPosition).toBe("absolute")
    expect(result.configBottomGap).toBeLessThanOrEqual(12)
    expect(result.sidebarFooterDisplay).toBe("none")
    expect(Math.abs(result.llmSummaryHeight - result.configToggleHeight)).toBeLessThanOrEqual(1)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("right-rail child content stays contained inside parent blocks", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderOverview") === "function"
          && typeof window.eval("renderEvaluation") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const renderOverview = window.eval("renderOverview")
      const renderEvaluation = window.eval("renderEvaluation")

      for (const id of ["overviewSection", "criteriaSection"]) {
        const section = document.querySelector(`#${id}`)
        if (!(section instanceof HTMLDetailsElement)) throw new Error(`Missing section: ${id}`)
        section.open = true
      }

      renderOverview(
        {
          headline: "### Containment",
          summary: `${"very-long-overview-token-".repeat(80)}\n${"wrap ".repeat(120)}`,
          nextStep: {
            title: "Do not expand",
            detail: `${"nested-detail-token-".repeat(70)}\n${"line ".repeat(160)}`,
          },
          currentFailure: {
            title: "Overflowing failure",
            summary: `${"failure-token-".repeat(70)}\n${"line ".repeat(150)}`,
          },
          controls: {},
        },
        {
          status: "running",
        },
      )

      renderEvaluation(
        {
          verdict: "approved",
          summary: `${"evaluation-summary-token-".repeat(70)}\n${"line ".repeat(160)}`,
          checks: [
            {
              name: "custom_review",
              label: "Custom review",
              family: "review",
              status: "failed",
              evidence: `${"evidence-token-".repeat(70)}\n${"line ".repeat(160)}`,
            },
          ],
        },
        {
          status: "candidate",
          summary: `${"delivery-summary-token-".repeat(70)}\n${"line ".repeat(160)}`,
          result: {
            changedFiles: ["src/very/long/path/file.ts"],
          },
        },
      )

      const measure = (parentSelector: string, childSelector: string) => {
        const parent = document.querySelector(parentSelector)
        const child = document.querySelector(childSelector)
        if (!(parent instanceof HTMLElement)) throw new Error(`Missing parent: ${parentSelector}`)
        if (!(child instanceof HTMLElement)) throw new Error(`Missing child: ${childSelector}`)
        return {
          parentWidth: parent.getBoundingClientRect().width,
          childWidth: child.getBoundingClientRect().width,
          clientHeight: child.clientHeight,
          scrollHeight: child.scrollHeight,
          overflowY: getComputedStyle(child).overflowY,
        }
      }

      return {
        overviewSummary: measure("#overviewBody", "#overviewBody .overview-summary"),
        nextStep: measure("#overviewBody", "#overviewBody .overview-next-step"),
        failure: measure("#overviewBody", "#overviewBody .interaction-body"),
        evalDetail: measure("#criteriaBody", "#criteriaBody .eval-error-detail"),
        delivery: measure("#evalBody", "#evalBody .delivery-summary"),
      }
    })

    for (const item of Object.values(result)) {
      expect(item.childWidth).toBeLessThanOrEqual(item.parentWidth + 1)
      expect(item.overflowY === "auto" || item.overflowY === "scroll").toBe(true)
    }
    expect(result.overviewSummary.scrollHeight).toBeGreaterThan(result.overviewSummary.clientHeight)
    expect(result.failure.scrollHeight).toBeGreaterThan(result.failure.clientHeight)
    expect(result.delivery.scrollHeight).toBeGreaterThan(result.delivery.clientHeight)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task update events refresh board and task list without forcing transcript reload", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }

      window.__overlayTest = {
        board: 0,
        conversation: 0,
        tasks: 0,
      }
      window.eval("scheduleBoard = () => { window.__overlayTest.board += 1 }")
      window.eval("scheduleConversation = () => { window.__overlayTest.conversation += 1 }")
      window.eval("scheduleTasks = () => { window.__overlayTest.tasks += 1 }")
      window.eval("handleEventStreamEvent")({
        type: "orchestrator.task.updated",
        properties: {
          taskID: "task-1",
        },
      })
    })

    await tab.waitForFunction(() => {
      try {
        const value = window.__overlayTest
        return value.board === 1 && value.conversation === 0 && value.tasks === 1
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => window.__overlayTest)
    expect(result).toEqual({
      board: 1,
      conversation: 0,
      tasks: 1,
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("event-driven board refresh requests a synced snapshot", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("scheduleBoard") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.directory = "D:/overlay/current"
      state.connected = true
      state.board = null
      state.boardEtag = ""
      window.__overlayTest = {
        sync: [],
      }
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        if (url.pathname === "/task/task-1/board") {
          window.__overlayTest.sync.push(url.searchParams.get("sync") || "")
          return new Response(JSON.stringify({
            task: { id: "task-1", status: "running", time: {} },
            interactions: [],
          }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              etag: "\"board-1\"",
            },
          })
        }
        return new Response("not found", { status: 404 })
      }
      window.eval("scheduleBoard")(0)
    })

    await tab.waitForFunction(() => {
      try {
        return Array.isArray(window.__overlayTest?.sync) && window.__overlayTest.sync.length === 1
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => window.__overlayTest)
    expect(result.sync).toEqual(["1"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task SSE resumes from the latest board sequence", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadBoard") === "function"
          && typeof window.eval("startSSE") === "function"
          && typeof window.eval("stopSSE") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.directory = "D:/overlay/current"
      state.connected = true
      state.board = null
      state.boardEtag = ""
      state.taskSequence = 0
      state.snapshotVersion = ""
      window.__overlayTest = {
        urls: [],
      }
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        window.__overlayTest.urls.push(url.pathname + url.search)
        if (url.pathname === "/task/task-1/board") {
          return new Response(JSON.stringify({
            snapshotVersion: "board-7",
            lastSequence: 7,
            task: { id: "task-1", status: "running", time: {} },
            interactions: [],
          }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              etag: "\"board-7\"",
            },
          })
        }
        if (url.pathname === "/task/task-1/events") {
          return new Response(new ReadableStream({
            start() {},
          }), {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          })
        }
        return new Response("not found", { status: 404 })
      }
      await window.eval("loadBoard")({ sync: true })
      window.eval("startSSE")("task-1")
      await new Promise((resolve) => setTimeout(resolve, 50))
      window.eval("stopSSE")()
      return {
        urls: window.__overlayTest.urls,
        taskSequence: state.taskSequence,
        snapshotVersion: state.snapshotVersion,
      }
    })

    expect(result.urls.some((item: string) => item.startsWith("/task/task-1/board?sync=1"))).toBe(true)
    expect(result.urls.some((item: string) => item.startsWith("/task/task-1/events?after=7"))).toBe(true)
    expect(result.taskSequence).toBe(7)
    expect(result.snapshotVersion).toBe("board-7")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("duplicate task event sequences are ignored", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.taskSequence = 4
      window.__overlayTest = {
        board: 0,
        conversation: 0,
        tasks: 0,
      }
      window.eval("scheduleBoard = () => { window.__overlayTest.board += 1 }")
      window.eval("scheduleConversation = () => { window.__overlayTest.conversation += 1 }")
      window.eval("scheduleTasks = () => { window.__overlayTest.tasks += 1 }")
      window.eval("handleEventStreamEvent")({
        type: "orchestrator.task.updated",
        sequence: 4,
        properties: {
          taskID: "task-1",
        },
      })
      return {
        taskSequence: state.taskSequence,
        counts: window.__overlayTest,
      }
    })

    expect(result.taskSequence).toBe(4)
    expect(result.counts).toEqual({
      board: 0,
      conversation: 0,
      tasks: 0,
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task event sequence gaps trigger SSE replay reconnect without transcript reload", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.taskSequence = 4
      window.__overlayTest = {
        board: 0,
        conversation: 0,
        tasks: 0,
        reconnects: [],
      }
      window.eval("scheduleBoard = () => { window.__overlayTest.board += 1 }")
      window.eval("scheduleConversation = () => { window.__overlayTest.conversation += 1 }")
      window.eval("scheduleTasks = () => { window.__overlayTest.tasks += 1 }")
      window.eval("startSSE = (taskID) => { window.__overlayTest.reconnects.push(taskID) }")
      window.eval("handleEventStreamEvent")({
        type: "orchestrator.task.updated",
        sequence: 7,
        properties: {
          taskID: "task-1",
        },
      })
      await Promise.resolve()
      return {
        taskSequence: state.taskSequence,
        counts: window.__overlayTest,
      }
    })

    expect(result.taskSequence).toBe(4)
    expect(result.counts).toEqual({
      board: 1,
      conversation: 0,
      reconnects: ["task-1"],
      tasks: 1,
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("board refresh failures back off instead of immediately reloading", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadBoard") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.directory = "D:/overlay/current"
      state.connected = true
      state.board = null
      state.boardEtag = ""
      window.__overlayTest = {
        calls: 0,
      }
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        if (url.pathname === "/task/task-1/board") {
          window.__overlayTest.calls += 1
          throw new Error("boom")
        }
        return new Response("not found", { status: 404 })
      }
      await window.eval("loadBoard")({ sync: true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (state.boardRetryTimer) clearTimeout(state.boardRetryTimer)
      state.boardRetryTimer = null
      return {
        calls: window.__overlayTest.calls,
        retryCount: state.boardRetryCount,
        syncPending: state.boardSyncPending,
      }
    })

    expect(result.calls).toBe(1)
    expect(result.retryCount).toBe(1)
    expect(result.syncPending).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("stopPolling tears down the live task SSE channel", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("stopPolling") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      window.__overlayTest = {
        aborts: 0,
      }
      state.sseConnected = true
      state.sse = {
        abort() {
          window.__overlayTest.aborts += 1
        },
      }
      state.pollTimer = setInterval(() => undefined, 1000)
      state.conversationTimer = setInterval(() => undefined, 1000)
      state.boardRetryTimer = setTimeout(() => undefined, 1000)
      window.eval("stopPolling")()
      return {
        aborts: window.__overlayTest.aborts,
        sseConnected: state.sseConnected,
        pollTimer: state.pollTimer,
        conversationTimer: state.conversationTimer,
        boardRetryTimer: state.boardRetryTimer,
      }
    })

    expect(result.aborts).toBe(1)
    expect(result.sseConnected).toBe(false)
    expect(result.pollTimer).toBeNull()
    expect(result.conversationTimer).toBeNull()
    expect(result.boardRetryTimer).toBeNull()
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("panel stream failure does not retry with a second panel message request", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("panelMessage") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.connected = true
      state.selectedTaskID = ""
      state.directory = "D:/overlay/current"
      const calls = []
      const root = window
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)
        if (url.pathname === "/panel/message/stream") {
          return new Response("boom", { status: 500, statusText: "Internal Server Error" })
        }
        if (url.pathname === "/panel/message") {
          return new Response(JSON.stringify({ kind: "created", task_id: "task-dup", message: "dup" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }

      try {
        await window.eval("panelMessage")("Create a new task")
        return { calls, error: "" }
      } catch (error) {
        return { calls, error: String(error) }
      }
    })

    expect(result.calls).toEqual(["POST /panel/message/stream"])
    expect(result.error).toContain("Panel stream failed")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task workspace abort falls back to the task session when no run id exists", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("chatAbortTarget") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-task",
          activeRunID: "",
        },
      }
      state.executorRunID = ""
      return window.eval("chatAbortTarget")()
    })

    expect(result).toEqual({
      kind: "session",
      sessionID: "session-task",
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("restoreInitialWorkspace reopens the stored task without reviving session workspace", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("restoreInitialWorkspace") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.connected = true
      state.directory = "D:/overlay/current"
      state.savedDirectory = "D:/overlay/current"
      state.workspaceTaskID = "task-1"
      state.workspaceSessionID = "session-stale"
      state.workspaceDirectory = "D:/overlay/current"
      state.tasks = [{
        task: {
          id: "task-1",
          sessionID: "session-task",
          directory: "D:/overlay/current",
        },
      }]
      window.eval("loadBoard = async () => { state.board = { task: { id: 'task-1', sessionID: 'session-task', status: 'running', time: {} }, lanes: [], interactions: [] } }")
      window.eval("loadConversation = async () => {}")
      window.eval("loadMeta = async () => {}")
      window.eval("persistOverlaySettings = async () => {}")
      await window.eval("restoreInitialWorkspace")()
      return {
        selectedTaskID: state.selectedTaskID,
        workspace: document.body.dataset.workspace || "",
        sessionID: window.eval("currentSessionID")(),
      }
    })

    expect(result).toEqual({
      selectedTaskID: "task-1",
      workspace: "task",
      sessionID: "session-task",
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("restoreInitialWorkspace does not auto-open the first session without an explicit saved target", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("restoreInitialWorkspace") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.connected = true
      state.directory = "D:/overlay/current"
      state.savedDirectory = "D:/overlay/current"
      state.workspaceTaskID = ""
      state.workspaceDirectory = ""
      state.selectedTaskID = ""
      state.tasks = []
      const restored = await window.eval("restoreInitialWorkspace")()
      return {
        restored,
        selectedTaskID: state.selectedTaskID,
      }
    })

    expect(result).toEqual({
      restored: false,
      selectedTaskID: "",
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("restoreInitialWorkspace ignores saved execution workspace directories", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("restoreInitialWorkspace") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.connected = true
      state.directory = "D:/overlay/project"
      state.savedDirectory = "D:/overlay/project"
      state.workspaceTaskID = "task-1"
      state.workspaceDirectory = "C:/Users/hengu/.local/share/opencorvus/goal-workspace/project/task-1/run-1"
      state.selectedTaskID = ""
      state.tasks = [{
        task: {
          id: "task-1",
          sessionID: "session-task",
          directory: "D:/overlay/project",
        },
      }]
      window.eval("loadBoard = async () => { state.board = { task: { id: 'task-1', sessionID: 'session-task', status: 'running', time: {} }, lanes: [], interactions: [] } }")
      window.eval("loadConversation = async () => {}")
      window.eval("loadMeta = async () => {}")
      window.eval("loadMemory = async () => {}")
      window.eval("persistOverlaySettings = async () => {}")

      const restored = await window.eval("restoreInitialWorkspace")()

      return {
        restored,
        directory: state.directory,
        selectedTaskID: state.selectedTaskID,
      }
    })

    expect(result).toEqual({
      restored: true,
      directory: "D:/overlay/project",
      selectedTaskID: "task-1",
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("persistOverlaySettings preserves a stored workspace target before task restore runs", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("persistOverlaySettings") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.directory = "D:/overlay/project"
      state.savedDirectory = "D:/overlay/project"
      state.selectedTaskID = ""
      state.workspaceTaskID = "task-1"
      state.workspaceDirectory = "D:/overlay/project"
      await window.eval("persistOverlaySettings")()
      return {
        workspaceTaskID: state.workspaceTaskID,
        workspaceDirectory: state.workspaceDirectory,
        storedTask: localStorage.getItem("oc_workspace_task") || "",
        storedDirectory: localStorage.getItem("oc_workspace_directory") || "",
      }
    })

    expect(result).toEqual({
      workspaceTaskID: "task-1",
      workspaceDirectory: "D:/overlay/project",
      storedTask: "task-1",
      storedDirectory: "D:/overlay/project",
    })
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task-scoped panel requests do not grant session mutation by default", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("panelRequestBody") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }
      return window.eval("panelRequestBody")("Create a new session")
    })

    expect(result.allow_create).toBe(true)
    expect(result.allow_session_mutation).toBe(false)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("panel chat requests include a generated request_id", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("panelMessage") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.connected = true
      state.selectedTaskID = ""
      state.serverUrl = window.location.origin
      let requestID = ""
      window.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        if (url.pathname === "/panel/message/stream") {
          const body = JSON.parse(String(init.body || "{}"))
          requestID = body.request_id || ""
          return new Response(`data: ${JSON.stringify({ type: "done", result: { kind: "panel_response", message: "ok" } })}\n\n`, {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }
      await window.eval("panelMessage")("Create a task")
      return requestID
    })

    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(10)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("opening a managed session throws in task-only overlay", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("openManagedSession") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      try {
        await window.eval("openManagedSession")("session-task", { id: "session-task" })
        return ""
      } catch (error) {
        return String(error)
      }
    })

    expect(result).toContain("Overlay no longer supports session workspaces")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("active runs re-fetch executor events after the refresh window", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadExecutorEvents") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.serverUrl = window.location.origin
      state.board = {
        task: {
          id: "task-1",
          activeRunID: "run-1",
          status: "running",
        },
      }
      let calls = 0
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        if (url.pathname === "/run/run-1/executor-events") {
          calls += 1
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }
      await window.eval("loadExecutorEvents")("run-1")
      await window.eval("loadExecutorEvents")("run-1")
      state.executorEventsFetchedAt = Date.now() - 4000
      await window.eval("loadExecutorEvents")("run-1")
      return calls
    })

    expect(result).toBe(2)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("executor store keeps hidden events even when they are not rendered", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.executorEvents = []
      state.executorRunID = "run-1"
      window.eval("appendExecutorEvent")({
        id: "evt-hidden",
        runID: "run-1",
        kind: "status",
        summary: "running",
        time: { created: 1 },
      })
      window.eval("appendExecutorEvent")({
        id: "evt-visible",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: read_file",
        payload: { name: "read_file" },
        time: { created: 2 },
      })
      return {
        stored: state.executorEvents.map((item) => item.id),
        visible: window.eval("buildExecutorMessages")().map((item) => item.info.id),
      }
    })

    expect(result.stored).toEqual(["evt-hidden", "evt-visible"])
    expect(result.visible).toEqual(["evt-visible"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("mergeMessages de-duplicates synthetic board messages by stable ids", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("syntheticTextMessage") === "function" && typeof window.eval("mergeMessages") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const left = window.eval("syntheticTextMessage")("system", 10, "same")
      const right = window.eval("syntheticTextMessage")("system", 10, "same")
      return window.eval("mergeMessages")([left], [right]).length
    })

    expect(result).toBe(1)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("health check stays online when tasks endpoint fails", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("checkConnection") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const root = window
      const calls = []
      root.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        calls.push(url.pathname)
        if (url.pathname === "/global/health") {
          return new Response(JSON.stringify({ version: "1.2.3" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname === "/tasks" || url.pathname === "/global/tasks") {
          return new Response("boom", { status: 500 })
        }
        return new Response("not found", { status: 404 })
      }
      state.connected = false
      const ok = await window.eval("checkConnection")()
      return {
        ok,
        connected: state.connected,
        calls,
      }
    })

    expect(result.ok).toBe(true)
    expect(result.connected).toBe(true)
    expect(result.calls).toEqual(["/global/health"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("live planner agent marks the plan section active", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const phase = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")

      state.board = null
      state.messages = [
        {
          info: {
            role: "assistant",
            agent: "planner",
            time: { created: 10 },
          },
          parts: [
            {
              type: "text",
              text: "Planning in progress",
            },
          ],
        },
      ]
      state._renderedGroupKey = ""
      renderConversation()
      return document.querySelector("#planSection")?.dataset.phaseState || ""
    })

    expect(phase).toBe("active")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("message deltas reload conversation when task session is not yet derivable", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const handleEventStreamEvent = window.eval("handleEventStreamEvent")
      const root = window
      const calls = []
      const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)
        if (url.pathname === "/task/task-1/transcript" && method === "GET") return json([])
        if (url.pathname === "/control/timeline" && method === "GET" && url.searchParams.get("taskID") === "task-1") return json([])
        return new Response("not found", { status: 404 })
      }

      state.selectedTaskID = "task-1"
      state.serverUrl = root.location.origin
      state.board = null
      state.tasks = [{ task: { id: "task-1", sessionID: "" } }]
      state.messages = []
      state.conversationLoading = null
      state.conversationQueued = false

      handleEventStreamEvent({
        type: "message.updated",
        payload: {
          info: {
            id: "msg-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: 10 },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      return calls
    })

    expect(result).toContain("GET /task/task-1/transcript")
    expect(result).toContain("GET /control/timeline")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task SSE payloads refresh the transcript live", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleEventStreamEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")
      const handleEventStreamEvent = window.eval("handleEventStreamEvent")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }
      state.messages = []
      state._renderedGroupKey = ""
      renderConversation()

      handleEventStreamEvent({
        type: "message.updated",
        payload: {
          info: {
            id: "msg-task-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: 10 },
          },
        },
      })
      handleEventStreamEvent({
        type: "message.part.updated",
        payload: {
          part: {
            id: "part-task-1",
            sessionID: "session-1",
            messageID: "msg-task-1",
            type: "text",
            text: "Publ",
          },
        },
      })
      handleEventStreamEvent({
        type: "message.part.delta",
        payload: {
          sessionID: "session-1",
          messageID: "msg-task-1",
          partID: "part-task-1",
          field: "text",
          delta: "ishing",
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 220))

      return {
        messages: state.messages.map((item) => ({
          id: item.info?.id || "",
          role: item.info?.role || "",
          text: (item.parts || []).map((part) => part.text || "").join(""),
        })),
        count: document.querySelector("#chatCount")?.textContent || "",
      }
    })

    expect(result.messages).toContainEqual({
      id: "msg-task-1",
      role: "assistant",
      text: "Publishing",
    })
    expect(result.count).not.toBe("")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation streams agent stage output before falling back to board snapshots", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendAgentEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")
      const appendAgentEvent = window.eval("appendAgentEvent")

      state.selectedTaskID = "task-1"
      state.messages = []
      state.agentEvents = []
      state.board = {
        task: {
          id: "task-1",
          status: "planning",
          request: "Create a personal homepage",
          time: { created: 1, updated: 5 },
        },
        plan: {
          summary: "Persisted board plan",
          time: { created: 3 },
          metadata: {},
        },
        interactions: [],
      }

      appendAgentEvent({
        type: "agent.updated",
        event_id: "evt-1",
        timestamp: 11,
        summary: "Build",
        payload: {
          stage: "planner",
          kind: "message_delta",
          id: "planner-live",
          text: "Build",
        },
      })
      appendAgentEvent({
        type: "agent.updated",
        event_id: "evt-2",
        timestamp: 12,
        summary: " homepage",
        payload: {
          stage: "planner",
          kind: "message_delta",
          id: "planner-live",
          text: " homepage",
        },
      })

      renderConversation()
      const partial = state.agentEvents[0]?._liveText || state.agentEvents[0]?.text || state.agentEvents[0]?.summary || ""
      await new Promise((resolve) => setTimeout(resolve, 220))
      const live = state.agentEvents[0]?._liveText || state.agentEvents[0]?.text || state.agentEvents[0]?.summary || ""

      state.board = {
        ...state.board,
        task: {
          ...state.board.task,
          status: "running",
        },
      }
      renderConversation()
      const settled = [...document.querySelectorAll('.turn[data-role="planner"] .msg-body')]
        .map((node) => node.textContent || "")
        .join("\n")

      return { partial, live, settled }
    })

    expect(result.partial.length).toBeGreaterThan(0)
    expect(result.partial.length).toBeLessThan(result.live.length)
    expect(result.live).toContain("Build homepage")
    expect(result.live).not.toContain("Persisted board plan")
    expect(result.settled).toContain("Persisted board plan")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation renders live agent tool calls as structured tool cards", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendAgentEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")
      const appendAgentEvent = window.eval("appendAgentEvent")

      state.selectedTaskID = "task-1"
      state.messages = []
      state.agentEvents = []
      state.board = {
        task: {
          id: "task-1",
          status: "planning",
          request: "Create a personal homepage",
          time: { created: 1, updated: 5 },
        },
        plan: null,
        interactions: [],
      }

      appendAgentEvent({
        timestamp: 11,
        summary: "Planner agent -> read_file",
        payload: {
          stage: "planner",
          kind: "tool_call",
          id: "planner-tool-live",
          toolName: "read_file",
        },
      })
      appendAgentEvent({
        timestamp: 12,
        summary: "{\"path\":\"src/app.js\"}",
        payload: {
          stage: "planner",
          kind: "tool_delta",
          id: "planner-tool-live",
          toolName: "read_file",
          text: "{\"path\":\"src/app.js\"}",
        },
      })

      renderConversation()
      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        toolNames: [...document.querySelectorAll('.turn[data-role="task_tool"] .tool-name')].map((node) => node.textContent || ""),
        toolDetails: [...document.querySelectorAll('.turn[data-role="task_tool"] .tool-detail')].map((node) => node.textContent || ""),
        textBodies: [...document.querySelectorAll('.turn[data-role="task_tool"] .msg-text')].map((node) => node.textContent || ""),
      }
    })

    expect(result.toolNames).toContain("read_file")
    expect(result.toolDetails.some((item) => item.includes("src/app.js"))).toBe(true)
    expect(result.textBodies).toHaveLength(0)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation merges control timeline with task transcript", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const loadConversation = window.eval("loadConversation")
      const root = window
      const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()

        if (url.pathname === "/control/timeline" && method === "GET" && url.searchParams.get("taskID") === "task-1") {
          return json([
            {
              info: {
                id: "ctl-1",
                role: "user",
                taskID: "task-1",
                time: { created: 1, updated: 1 },
              },
              parts: [
                { type: "text", text: "Create a task." },
                {
                  type: "tool",
                  callID: "call-ctl-1",
                  tool: "panel",
                  state: {
                    status: "completed",
                    input: { action: "create_task" },
                    output: "{\"message\":\"Task accepted\"}",
                    title: "Task accepted",
                    metadata: {},
                    time: { start: 1, end: 2 },
                  },
                },
              ],
            },
          ])
        }
        if (url.pathname === "/task/task-1/transcript" && method === "GET") {
          return json([
            {
              info: {
                id: "msg-1",
                role: "assistant",
                sessionID: "session-1",
                time: { created: 2 },
              },
              parts: [{ type: "text", text: "Working on it." }],
            },
          ])
        }
        return new Response("not found", { status: 404 })
      }

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }
      state.messages = []
      state.conversationLoading = null
      state.conversationQueued = false
      state._renderedGroupKey = ""

      await loadConversation()

      return state.messages.map((item) => ({
        id: item.info?.id || "",
        types: (item.parts || []).map((part) => part.type || ""),
        text: (item.parts || []).flatMap((part) => typeof part.text === "string" ? [part.text] : []).join(""),
      }))
    })

    expect(result).toEqual([
      { id: "ctl-1", types: ["text", "tool"], text: "Create a task." },
      { id: "msg-1", types: ["text"], text: "Working on it." },
    ])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation does not duplicate the original user request", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")
      const request = "Create a task."

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          request,
          time: { created: 10, updated: 10 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = [
        {
          info: {
            id: "ctl-1",
            role: "user",
            taskID: "task-1",
            time: { created: 11, updated: 11 },
          },
          parts: [{ type: "text", text: request }],
        },
      ]
      state._renderedGroupKey = ""
      renderConversation()

      return [...document.querySelectorAll('.turn[data-role="user"] .msg-body')].map((item) => item.textContent || "")
    })

    expect(result).toEqual(["Create a task."])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task chat includes historical executor progress events", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadBoard") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const loadBoard = window.eval("loadBoard")
      const loadConversation = window.eval("loadConversation")
      const root = window
      const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()

        if (url.pathname === "/task/task-1/board" && method === "GET") {
          return json({
            task: {
              id: "task-1",
              title: "Expose process",
              request: "Expose the coding process.",
              status: "running",
              sessionID: "session-1",
              activeRunID: "run-1",
              time: { created: 1, updated: 2, started: 2 },
            },
            overview: null,
            plan: null,
            evaluation: null,
            delivery: null,
            acceptedDelivery: null,
            interactions: [],
            spec: null,
          })
        }
        if (url.pathname === "/run/run-1/executor-events" && method === "GET") {
          return json([
            {
              id: "exe-1",
              executorSessionID: "exs-1",
              taskID: "task-1",
              runID: "run-1",
              sequence: 1,
              kind: "tool_call",
              summary: "Tool call: read_file",
              payload: { name: "read_file" },
              time: { created: 3, updated: 3, observed: 3 },
            },
          ])
        }
        if (url.pathname === "/task/task-1/transcript" && method === "GET") {
          return json([])
        }
        return new Response("not found", { status: 404 })
      }

      state.selectedTaskID = "task-1"
      state.board = null
      state.messages = []
      state.executorEvents = []
      state.executorRunID = ""
      state.boardLoading = null
      state.conversationLoading = null
      state.conversationQueued = false
      state._renderedGroupKey = ""

      await loadBoard()
      await loadConversation()

      return {
        body: document.querySelector('.turn[data-role="task_tool"] .msg-body')?.textContent || "",
        roles: [...document.querySelectorAll(".turn")].map((node) => node.getAttribute("data-role") || ""),
      }
    })

    expect(result.roles).toContain("task_tool")
    expect(result.body).toContain("Tool call: read_file")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE run progress appends visible process messages", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Expose process",
          request: "Expose the coding process.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-1",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: read_file",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          type: "tool.call",
          summary: "Tool call: read_file",
          sourceID: "tool-1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "running",
          payload: { id: "tool-1", name: "read_file" },
        },
        timestamp: 4,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        count: state.executorEvents.length,
        cards: [...document.querySelectorAll(".executor-process-card")].map((node) => ({
          title: node.querySelector(".executor-process-title")?.textContent || "",
          progress: node.querySelector(".executor-process-progress")?.textContent || "",
        })),
      }
    })

    expect(result.count).toBe(1)
    expect(result.cards).toContainEqual(expect.objectContaining({
      title: "read_file",
      progress: expect.stringMatching(/Tool call: read_file|Running|执行中|运行中/),
    }))
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task chat renders ungrouped executor tool calls as tool cards", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Expose process",
          request: "Expose the coding process.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-ungrouped",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: apply_patch",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          name: "apply_patch",
          input: "{\"path\":\"src/overlay.js\"}",
        },
        timestamp: 4,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        toolNames: [...document.querySelectorAll('.turn[data-role="task_tool"] .tool-name')].map((node) => node.textContent || ""),
        toolDetails: [...document.querySelectorAll('.turn[data-role="task_tool"] .tool-detail')].map((node) => node.textContent || ""),
        textBodies: [...document.querySelectorAll('.turn[data-role="task_tool"] .msg-text')].map((node) => node.textContent || ""),
      }
    })

    expect(result.toolNames).toContain("apply_patch")
    expect(result.toolDetails.some((item) => item.includes("src/overlay.js"))).toBe(true)
    expect(result.textBodies).toHaveLength(0)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task chat renders readable shell tool results", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadBoard") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const loadBoard = window.eval("loadBoard")
      const loadConversation = window.eval("loadConversation")
      const root = window
      const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()

        if (url.pathname === "/task/task-1/board" && method === "GET") {
          return json({
            task: {
              id: "task-1",
              title: "Expose process",
              request: "Expose the coding process.",
              status: "running",
              sessionID: "session-1",
              activeRunID: "run-1",
              time: { created: 1, updated: 2, started: 2 },
            },
            overview: null,
            plan: null,
            evaluation: null,
            delivery: null,
            acceptedDelivery: null,
            interactions: [],
            spec: null,
          })
        }
        if (url.pathname === "/run/run-1/executor-events" && method === "GET") {
          return json([
            {
              id: "exe-1",
              executorSessionID: "exs-1",
              taskID: "task-1",
              runID: "run-1",
              sequence: 1,
              kind: "tool_call",
              summary: "Shell command: shell_command",
              payload: {
                id: "call-1",
                tool_kind: "shell",
                name: "shell_command",
                input: {
                  command: ["bun", "test", "render-behavior.test.ts", "--timeout", "20000"],
                },
              },
              time: { created: 3, updated: 3, observed: 3 },
            },
            {
              id: "exe-2",
              executorSessionID: "exs-1",
              taskID: "task-1",
              runID: "run-1",
              sequence: 2,
              kind: "tool_result",
              summary: "Shell command completed",
              payload: {
                id: "call-1",
                tool_kind: "shell",
                output: {
                  stdout: "1 pass\n0 fail",
                  exit: 0,
                },
              },
              time: { created: 4, updated: 4, observed: 4 },
            },
          ])
        }
        if (url.pathname === "/task/task-1/transcript" && method === "GET") {
          return json([])
        }
        return new Response("not found", { status: 404 })
      }

      state.selectedTaskID = "task-1"
      state.board = null
      state.messages = []
      state.executorEvents = []
      state.executorRunID = ""
      state.boardLoading = null
      state.conversationLoading = null
      state.conversationQueued = false
      state._renderedGroupKey = ""

      await loadBoard()
      await loadConversation()

      return {
        bodies: [...document.querySelectorAll('.turn[data-role="task_tool"] .msg-body')].map((node) => node.textContent || ""),
      }
    })

    expect(result.bodies.some((body) => body.includes("bun test render-behavior.test.ts --timeout 20000"))).toBe(true)
    expect(result.bodies.some((body) =>
      body.includes("bun test render-behavior.test.ts --timeout 20000") &&
      body.includes("1 pass") &&
      body.includes("0 fail"),
    )).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE command progress renders real command lines", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Expose process",
          request: "Expose the coding process.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-2",
        runID: "run-1",
        kind: "command",
        summary: "Command started",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          type: "command.started",
          summary: "Command started",
          sourceID: "cmd-1",
          sourceKind: "command",
          command: ["git", "status", "--short"],
          status: "running",
        },
        timestamp: 5,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        count: state.executorEvents.length,
        title: document.querySelector(".executor-process-title")?.textContent || "",
        status: document.querySelector(".executor-process-card")?.getAttribute("data-status") || "",
        progress: document.querySelector(".executor-process-progress")?.textContent || "",
      }
    })

    expect(result.count).toBe(1)
    expect(result.status).toBe("running")
    expect(result.title).toContain("git status --short")
    expect(result.progress).toContain("Command started")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE renders parallel executor process cards with independent output", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Expose process",
          request: "Expose the coding process.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-p1",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: read_file",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          sourceID: "tool_1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "running",
          payload: { id: "tool_1", name: "read_file" },
        },
        timestamp: 5,
      })
      appendExecutorEvent({
        id: "evt-o1",
        runID: "run-1",
        kind: "message_delta",
        summary: "alpha",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          text: "alpha",
          sourceID: "tool_1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "running",
        },
        timestamp: 6,
      })
      appendExecutorEvent({
        id: "evt-p2",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: rg",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          sourceID: "tool_2",
          sourceKind: "tool",
          sourceLabel: "rg",
          status: "running",
          payload: { id: "tool_2", name: "rg", input: "{\"pattern\":\"TODO\"}" },
        },
        timestamp: 7,
      })
      appendExecutorEvent({
        id: "evt-o2",
        runID: "run-1",
        kind: "message_delta",
        summary: "beta",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          text: "beta",
          sourceID: "tool_2",
          sourceKind: "tool",
          sourceLabel: "rg",
          status: "running",
        },
        timestamp: 8,
      })
      appendExecutorEvent({
        id: "evt-r1",
        runID: "run-1",
        kind: "tool_result",
        summary: "Tool result: tool_1",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          sourceID: "tool_1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "completed",
          payload: { id: "tool_1", output: "alpha done" },
        },
        timestamp: 9,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return [...document.querySelectorAll(".executor-process-card")].map((node) => ({
        status: node.getAttribute("data-status") || "",
        title: node.querySelector(".executor-process-title")?.textContent || "",
        progress: node.querySelector(".executor-process-progress")?.textContent || "",
        output: node.querySelector(".executor-process-output")?.textContent || "",
      }))
    })

    expect(result).toHaveLength(2)
    expect(result).toContainEqual(expect.objectContaining({
      status: "completed",
      title: "read_file",
      progress: expect.stringMatching(/Completed|已完成/),
      output: expect.stringContaining("alpha"),
    }))
    expect(result).toContainEqual(expect.objectContaining({
      status: "running",
      title: "rg",
      progress: expect.stringMatching(/Running|执行中|运行中/),
      output: expect.stringContaining("beta"),
    }))
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE keeps colliding source ids separate across parallel goal runs", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Expose parallel process scopes",
          request: "Expose the coding process.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-g1-start",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: catalog_writer",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-1",
          executorSessionID: "executor-1",
          sourceID: "tool_shared",
          sourceKind: "tool",
          sourceLabel: "catalog_writer",
          status: "running",
          payload: { id: "tool_shared", name: "catalog_writer" },
        },
        timestamp: 5,
      })
      appendExecutorEvent({
        id: "evt-g1-out",
        runID: "run-1",
        kind: "message_delta",
        summary: "catalog alpha",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-1",
          executorSessionID: "executor-1",
          text: "catalog alpha",
          sourceID: "tool_shared",
          sourceKind: "tool",
          sourceLabel: "catalog_writer",
          status: "running",
        },
        timestamp: 6,
      })
      appendExecutorEvent({
        id: "evt-g2-start",
        runID: "run-1",
        kind: "tool_call",
        summary: "Tool call: cart_writer",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-2",
          executorSessionID: "executor-2",
          sourceID: "tool_shared",
          sourceKind: "tool",
          sourceLabel: "cart_writer",
          status: "running",
          payload: { id: "tool_shared", name: "cart_writer" },
        },
        timestamp: 7,
      })
      appendExecutorEvent({
        id: "evt-g2-out",
        runID: "run-1",
        kind: "message_delta",
        summary: "cart beta",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-2",
          executorSessionID: "executor-2",
          text: "cart beta",
          sourceID: "tool_shared",
          sourceKind: "tool",
          sourceLabel: "cart_writer",
          status: "running",
        },
        timestamp: 8,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return [...document.querySelectorAll(".executor-process-card")].map((node) => ({
        title: node.querySelector(".executor-process-title")?.textContent || "",
        output: node.querySelector(".executor-process-output")?.textContent || "",
      }))
    })

    expect(result).toHaveLength(2)
    expect(result).toContainEqual(expect.objectContaining({
      title: "catalog_writer",
      output: expect.stringContaining("catalog alpha"),
    }))
    expect(result).toContainEqual(expect.objectContaining({
      title: "cart_writer",
      output: expect.stringContaining("cart beta"),
    }))
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE streams executor reasoning as visible assistant reasoning", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Show reasoning",
          request: "Show reasoning output.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-reason-1",
        runID: "run-1",
        kind: "reasoning_delta",
        summary: "Inspecting the first goal. ",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-1",
          executorSessionID: "executor-1",
        },
        timestamp: 5,
      })

      const partial = state.executorEvents[0]?._liveText || state.executorEvents[0]?.summary || ""

      appendExecutorEvent({
        id: "evt-reason-2",
        runID: "run-1",
        kind: "reasoning_delta",
        summary: "Drafting the file changes.",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          goalRunID: "goal-run-1",
          executorSessionID: "executor-1",
        },
        timestamp: 6,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        partial,
        live: state.executorEvents[0]?._liveText || state.executorEvents[0]?.summary || "",
      }
    })

    expect(result.partial.length).toBeGreaterThan(0)
    expect(result.partial.length).toBeLessThan(result.live.length)
    expect(result.live).toContain("Inspecting the first goal.")
    expect(result.live).toContain("Drafting the file changes.")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("assistant reasoning renders above message and auto-hides without hiding the message", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.evaluateOnNewDocument(() => {
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: {
          reasoningAutoCloseMs: 80,
        },
      })
    })
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" &&
          typeof window.eval("touchReasoningPart") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")
      const touchReasoningPart = window.eval("touchReasoningPart")
      const message = {
        info: {
          id: "assistant-1",
          role: "assistant",
          time: { created: 1 },
        },
        parts: [
          {
            id: "assistant-text",
            type: "text",
            text: "Final answer stays visible.",
            messageID: "assistant-1",
            sessionID: "",
          },
          {
            id: "assistant-reasoning",
            type: "reasoning",
            text: "Think through the request first.",
            messageID: "assistant-1",
            sessionID: "",
          },
        ],
      }

      state.selectedTaskID = ""
      state.messages = [message]
      state._renderedGroupKey = ""
      touchReasoningPart(message.parts[1])
      renderConversation()

      await new Promise((resolve) => setTimeout(resolve, 20))
      const body = document.querySelector('.turn[data-role="assistant"] .msg-body')
      const earlyOrder = [...(body?.children || [])].map((node) => node.className)
      const earlyReasoning = body?.querySelector('.msg-reasoning .reasoning-text')?.textContent || ""
      const earlyMessage = body?.querySelector('.msg-text')?.textContent || ""

      await new Promise((resolve) => setTimeout(resolve, 140))
      const lateBody = document.querySelector('.turn[data-role="assistant"] .msg-body')
      return {
        earlyOrder,
        earlyReasoning,
        earlyMessage,
        lateReasoningVisible: !!lateBody?.querySelector('.msg-reasoning'),
        lateMessage: lateBody?.querySelector('.msg-text')?.textContent || "",
      }
    })

    expect(result.earlyOrder[0]).toContain("msg-reasoning")
    expect(result.earlyOrder[1]).toContain("msg-text")
    expect(result.earlyReasoning).toContain("Think through the request first.")
    expect(result.earlyMessage).toContain("Final answer stays visible.")
    expect(result.lateReasoningVisible).toBe(false)
    expect(result.lateMessage).toContain("Final answer stays visible.")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE merges repeated executor text updates for the same event id", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Merge live text",
          request: "Keep one live assistant message.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-live-1",
        runID: "run-1",
        kind: "message_delta",
        summary: "Build ",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          text: "Build ",
        },
        timestamp: 5,
      })

      const partial = state.executorEvents[0]?._liveText || state.executorEvents[0]?.summary || ""

      appendExecutorEvent({
        id: "evt-live-1",
        runID: "run-1",
        kind: "message_delta",
        summary: "homepage",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          text: "homepage",
        },
        timestamp: 6,
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        count: state.executorEvents.length,
        partial,
        live: state.executorEvents[0]?._liveText || state.executorEvents[0]?._targetText || state.executorEvents[0]?.summary || "",
      }
    })

    expect(result.count).toBe(1)
    expect(result.partial.length).toBeGreaterThan(0)
    expect(result.partial.length).toBeLessThan(result.live.length)
    expect(result.live).toContain("Build homepage")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("parallel executor cards keep DOM identity when an earlier goal inserts ahead of an existing card", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("appendExecutorEvent") === "function" &&
          typeof window.eval("renderConversation") === "function" &&
          !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const appendExecutorEvent = window.eval("appendExecutorEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Parallel executor identity",
          request: "Keep executor DOM stable during parallel inserts.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      appendExecutorEvent({
        id: "evt-late",
        runID: "run-1",
        kind: "tool_call",
        summary: "Late process",
        payload: {
          id: "tool-late",
          name: "Late process",
          status: "running",
        },
        sourceID: "tool-late",
        sourceKind: "tool",
        sourceLabel: "Late process",
        sourceStatus: "running",
        goalRunID: "goal-run-late",
        executorSessionID: "",
        time: { created: 20 },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      const turnsBefore = [...document.querySelectorAll('.turn[data-role="executor"]')]
      const lateTurnBefore = turnsBefore.find((node) =>
        node.querySelector(".executor-process-title")?.textContent?.includes("Late process"),
      ) as HTMLElement | undefined
      if (!lateTurnBefore) throw new Error("Late executor turn not found before insert")
      lateTurnBefore.dataset.marker = "keep-late"

      appendExecutorEvent({
        id: "evt-early",
        runID: "run-1",
        kind: "tool_call",
        summary: "Early process",
        payload: {
          id: "tool-early",
          name: "Early process",
          status: "running",
        },
        sourceID: "tool-early",
        sourceKind: "tool",
        sourceLabel: "Early process",
        sourceStatus: "running",
        goalRunID: "goal-run-early",
        executorSessionID: "",
        time: { created: 10 },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      const turnsAfter = [...document.querySelectorAll('.turn[data-role="executor"]')] as HTMLElement[]
      const describe = (node: HTMLElement) => ({
        goal: node.querySelector(".msg-role")?.textContent?.trim() || "",
        title: node.querySelector(".executor-process-title")?.textContent?.trim() || "",
        marker: node.dataset.marker || "",
      })
      const lateTurnAfter = turnsAfter.find((node) =>
        node.querySelector(".executor-process-title")?.textContent?.includes("Late process"),
      )
      const earlyTurnAfter = turnsAfter.find((node) =>
        node.querySelector(".executor-process-title")?.textContent?.includes("Early process"),
      )

      return {
        turns: turnsAfter.map(describe),
        lateNodePreserved: lateTurnAfter === lateTurnBefore,
        earlyNodeReusedLate: earlyTurnAfter === lateTurnBefore,
        lateMarker: lateTurnAfter?.dataset.marker || "",
        earlyMarker: earlyTurnAfter?.dataset.marker || "",
      }
    })

    expect(result.turns).toHaveLength(2)
    expect(result.turns.map((item) => item.title)).toEqual(["Early process", "Late process"])
    expect(result.lateNodePreserved).toBe(true)
    expect(result.earlyNodeReusedLate).toBe(false)
    expect(result.lateMarker).toBe("keep-late")
    expect(result.earlyMarker).toBe("")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("task SSE drops non-text executor payloads instead of rendering object garbage", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("handleSSEEvent") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const handleSSEEvent = window.eval("handleSSEEvent")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          title: "Ignore object payloads",
          request: "Ignore object payloads.",
          status: "running",
          sessionID: "session-1",
          activeRunID: "run-1",
          time: { created: 1, updated: 2, started: 2 },
        },
        overview: null,
        plan: null,
        evaluation: null,
        delivery: null,
        acceptedDelivery: null,
        interactions: [],
        spec: null,
      }
      state.messages = []
      state.executorEvents = []
      state.executorRunID = "run-1"
      state._renderedGroupKey = ""
      renderConversation()

      handleSSEEvent({
        event_id: "evt-tool-1",
        task_id: "task-1",
        run_id: "run-1",
        type: "run.progress",
        timestamp: 4,
        summary: "Tool call: read_file",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          type: "tool.call",
          summary: "Tool call: read_file",
          sourceID: "tool-1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "running",
        },
      })

      handleSSEEvent({
        event_id: "evt-tool-obj",
        task_id: "task-1",
        run_id: "run-1",
        type: "run.output",
        timestamp: 5,
        summary: "[object Object]",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          type: "text_delta",
          text: { bad: true },
          sourceID: "tool-1",
          sourceKind: "tool",
          sourceLabel: "read_file",
          status: "running",
        },
      })

      handleSSEEvent({
        event_id: "evt-assistant-obj",
        task_id: "task-1",
        run_id: "run-1",
        type: "run.output",
        timestamp: 6,
        summary: "[object Object]",
        payload: {
          taskID: "task-1",
          runID: "run-1",
          type: "text_delta",
          text: { bad: true },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 220))
      return {
        body: document.querySelector("#chatScroll")?.textContent || "",
        processOutput: document.querySelector(".executor-process-output")?.textContent || "",
        assistantTurns: [...document.querySelectorAll('.turn[data-role="assistant"] .msg-body')].map((node) => node.textContent || ""),
      }
    })

    expect(result.body).not.toContain("[object Object]")
    expect(result.processOutput).toBe("")
    expect(result.assistantTurns.every((item) => !item.includes("[object Object]"))).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })

test("hidden control parts do not relabel user turns as system", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = ""
      state.messages = [
        {
          info: {
            id: "msg-user-1",
            role: "user",
            sessionID: "session-1",
            time: { created: 1 },
          },
          parts: [
            { type: "text", text: "Visible user text" },
            {
              type: "text",
              text: "{\"surface\":\"panel\"}",
              kind: "control",
              source: "system",
              audience: {
                model: true,
                ui: false,
                acp: false,
              },
            },
          ],
        },
      ]
      state._renderedGroupKey = ""

      renderConversation()

      return {
        roles: [...document.querySelectorAll(".turn")].map((node) => node.getAttribute("data-role") || ""),
        body: document.querySelector(".turn .msg-body")?.textContent || "",
      }
    })

    expect(result.roles).toEqual(["user"])
    expect(result.body).toContain("Visible user text")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("child session prompts render as planner turns instead of impersonating the user", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderConversation = window.eval("renderConversation")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-root",
          status: "planning",
          request: "创建一个个人主页",
          time: { created: 1, updated: 3 },
        },
        interactions: [],
      }
      state.messages = [
        {
          info: {
            id: "msg-user-root",
            role: "user",
            sessionID: "session-root",
            time: { created: 1 },
          },
          parts: [{ type: "text", text: "创建一个个人主页" }],
        },
        {
          info: {
            id: "msg-user-child",
            role: "user",
            agent: "planner",
            sessionID: "session-child",
            time: { created: 2 },
          },
          parts: [{ type: "text", text: "拆解需求并生成执行计划。" }],
        },
      ]
      state._renderedGroupKey = ""

      renderConversation()

      return [...document.querySelectorAll(".turn")].map((node) => ({
        role: (node as HTMLElement).dataset.role || "",
        text: (node.querySelector(".msg-body")?.textContent || "").trim(),
      }))
    })

    expect(result[0]?.role).toBe("user")
    expect(result[0]?.text).toContain("创建一个个人主页")
    expect(result[1]?.role).toBe("planner")
    expect(result[1]?.text).toContain("拆解需求并生成执行计划")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("selected task panel requests keep task context instead of binding the task session", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("panelRequestBody") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const panelRequestBody = window.eval("panelRequestBody")

      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }

      return panelRequestBody("Continue implementation")
    })

    expect(result.taskID).toBe("task-1")
    expect(result.sessionID).toBeUndefined()
    expect(result.metadata.selectedTaskID).toBe("task-1")
    expect(result.metadata.selectedSessionID).toBeUndefined()
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("panel request body keeps session mutation disabled in empty and task workspaces", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("panelRequestBody") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const panelRequestBody = window.eval("panelRequestBody")
      return {
        help: panelRequestBody("What can you do?"),
        task: panelRequestBody("Fix the login race condition"),
        session: panelRequestBody("Create a new session"),
        sessionZh: panelRequestBody("创建一个新会话"),
      }
    })

    expect(result.help.allow_create).toBe(true)
    expect(result.help.allow_session_mutation).toBe(false)
    expect(result.task.allow_create).toBe(true)
    expect(result.task.allow_session_mutation).toBe(false)
    expect(result.session.allow_create).toBe(true)
    expect(result.session.allow_session_mutation).toBe(false)
    expect(result.sessionZh.allow_create).toBe(true)
    expect(result.sessionZh.allow_session_mutation).toBe(false)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("creating a managed session throws in task-only overlay", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("createManagedSession") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      try {
        await window.eval("createManagedSession")()
        return ""
      } catch (error) {
        return String(error)
      }
    })

    expect(result).toContain("Overlay no longer supports session workspaces")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("chat stop falls back to task cancel when no run or session exists", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderWorkspaceState") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const stopChatRequest = window.eval("stopChatRequest")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/task/task-1/cancel" && method === "POST") {
          return json(true)
        }
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "",
          activeRunID: "",
        },
      }
      state.executorRunID = ""
      state.chatRequest = {
        controller: new AbortController(),
        aborted: false,
        stopping: false,
        workspaceEpoch: state.workspaceEpoch,
        target: null,
      }
      const ok = await stopChatRequest()
      return {
        ok,
        aborted: state.chatRequest?.aborted ?? true,
        calls,
      }
    })

    expect(result.ok).toBe(true)
    expect(result.aborted).toBe(true)
    expect(result.calls).toContain("POST /task/task-1/cancel")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("applyPanelResult keeps the new task alive while auto-selecting it", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("applyPanelResult") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const applyPanelResult = window.eval("applyPanelResult")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/tasks" && method === "GET") {
          return json({
            tasks: [
              {
                task: {
                  id: "task-1",
                  title: "创建一个个人主页",
                  status: "completed",
                  directory: "D:\\repo",
                  sessionID: "",
                  time: {
                    created: 1,
                    updated: 2,
                  },
                },
                overview: {
                  headline: "创建一个个人主页",
                },
                updated_at: 2,
              },
            ],
          })
        }
        if (url.pathname === "/task/task-1/board" && method === "GET") {
          return json({
            task: {
              id: "task-1",
              status: "completed",
              sessionID: "",
              activeRunID: "",
              time: {
                created: 1,
                updated: 2,
              },
            },
            overview: {
              headline: "创建一个个人主页",
            },
            plan: null,
            evaluation: null,
            delivery: null,
            interactions: [],
            spec: null,
          })
        }
        if (url.pathname === "/task/task-1/transcript" && method === "GET") {
          return json([])
        }
        if (url.pathname === "/control/timeline" && method === "GET") {
          return json([])
        }
        if (url.pathname === "/path" && method === "GET") {
          return json({ directory: "D:\\repo" })
        }
        if (url.pathname === "/vcs" && method === "GET") {
          return json({
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
        }
        if (url.pathname === "/panel/knowledge/memory" && method === "GET") {
          return json([])
        }
        if (url.pathname === "/task/task-1/cancel" && method === "POST") {
          return json(true)
        }
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.selectedTaskID = ""
      state.tasks = []
      state.board = null
      state.directory = "D:\\repo"
      state.chatRequest = {
        controller: new AbortController(),
        aborted: false,
        stopping: false,
        workspaceEpoch: state.workspaceEpoch,
        target: null,
      }

      await applyPanelResult({ task_id: "task-1" })

      return {
        aborted: state.chatRequest?.aborted ?? false,
        selectedTaskID: state.selectedTaskID,
        calls,
      }
    })

    expect(result.selectedTaskID).toBe("task-1")
    expect(result.aborted).toBe(false)
    expect(result.calls).not.toContain("POST /task/task-1/cancel")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("applyPanelResult keeps pending messages visible until task history is available", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("applyPanelResult") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const applyPanelResult = window.eval("applyPanelResult")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/tasks" && method === "GET") return json({ tasks: [] })
        if (url.pathname === "/task/task-1/board" && method === "GET") {
          return json({
            task: {
              id: "task-1",
              status: "completed",
              sessionID: "",
              activeRunID: "",
              time: {
                created: 1,
                updated: 2,
              },
            },
            overview: {
              headline: "创建一个个人主页",
            },
            plan: null,
            evaluation: null,
            delivery: null,
            interactions: [],
            spec: null,
          })
        }
        if (url.pathname === "/task/task-1/transcript" && method === "GET") return json([])
        if (url.pathname === "/control/timeline" && method === "GET") return json([])
        if (url.pathname === "/path" && method === "GET") return json({ directory: "D:\\repo" })
        if (url.pathname === "/vcs" && method === "GET") {
          return json({
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
        }
        if (url.pathname === "/panel/knowledge/memory" && method === "GET") return json([])
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.selectedTaskID = ""
      state.tasks = []
      state.board = null
      state.directory = "D:\\repo"
      state.messages = [
        { parts: [{ type: "text", text: "创建一个个人主页" }], info: { role: "user", time: { created: 1 } } },
        { parts: [{ type: "text", text: "✅ 任务已创建成功！" }], info: { role: "assistant", time: { created: 2 } } },
      ]

      await applyPanelResult({ task_id: "task-1", message: "✅ 任务已创建成功！", _request: "创建一个个人主页" })

      return {
        selectedTaskID: state.selectedTaskID,
        taskCount: state.tasks.length,
        firstTaskID: state.tasks[0]?.task?.id || "",
        messages: state.messages.map((item) => item.parts?.[0]?.text || ""),
      }
    })

    expect(result.selectedTaskID).toBe("task-1")
    expect(result.taskCount).toBe(1)
    expect(result.firstTaskID).toBe("task-1")
    expect(result.messages).toEqual(["创建一个个人主页", "✅ 任务已创建成功！"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task rows expose delete and call the delete route", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderTaskList") === "function" && typeof window.eval("deleteTask") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const renderTaskList = window.eval("renderTaskList")
      const deleteTask = window.eval("deleteTask")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        })

      root.__overlayCalls = calls
      window.eval("nativeConfirm = async () => true")
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        if (url.pathname === "/task/task-1" && method === "DELETE") return json(true)
        if (url.pathname === "/tasks" && method === "GET") return json({ tasks: [] })
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.selectedTaskID = ""
      state.tasks = [
        {
          task: {
            id: "task-1",
            title: "创建一个个人主页",
            status: "completed",
            directory: "D:\\repo",
            sessionID: "",
            time: {
              created: 1,
              updated: 2,
            },
          },
          overview: {
            headline: "创建一个个人主页",
          },
          updated_at: 2,
          pending_interactions: 0,
        },
      ]
      renderTaskList()
      const hasDelete = !!document.querySelector('[data-task-delete="task-1"]')
      const deleted = await deleteTask("task-1")
      return {
        hasDelete,
        deleted,
        calls,
      }
    })

    expect(result.hasDelete).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.calls).toContain("DELETE /task/task-1")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("renderMeta exposes the active execution workspace when it differs from the project directory", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderMeta") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderMeta = window.eval("renderMeta")
      state.directory = "D:\\repo"
      state.vcs = {
        branch: "dev",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      }
      state.board = {
        goalRuns: [
          {
            id: "goal-run-1",
            status: "running",
            workspaceDir: "C:\\Users\\hengu\\.local\\share\\opencorvus\\goal-workspace\\task-1\\personal-website",
            time: {
              updated: 2,
            },
          },
        ],
      }
      renderMeta()

      const node = document.querySelector("#taskWorkspaceDir") as HTMLElement | null
      return {
        hidden: node?.hidden ?? true,
        text: node?.textContent || "",
        title: node?.title || "",
      }
    })

    expect(result.hidden).toBe(false)
    expect(result.text).toContain("personal-website")
    expect(result.title).toContain("goal-workspace")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("empty workspace keeps chat enabled for task creation", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderWorkspaceState") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderWorkspaceState = window.eval("renderWorkspaceState")
      const renderTaskList = window.eval("renderTaskList")
      const renderClear = window.eval("renderClear")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)

        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.globalView = false
      state.selectedTaskID = ""
      state.tasks = []
      state.messages = []
      state.board = null
      renderWorkspaceState()
      renderTaskList()
      renderClear()
    })

    const result = await tab.evaluate(() => ({
      calls: window.__overlayCalls || [],
      placeholder: (document.querySelector("#chatTextarea") as HTMLTextAreaElement)?.placeholder || "",
      disabledPlaceholder: window.eval("t")("chat.placeholder_disabled"),
      textareaDisabled: (document.querySelector("#chatTextarea") as HTMLTextAreaElement)?.disabled ?? false,
      sendDisabled: (document.querySelector("#chatSend") as HTMLButtonElement)?.disabled ?? false,
      workspace: document.body.dataset.workspace || "",
    }))

    expect(["empty", "offline"]).toContain(result.workspace)
    expect(result.textareaDisabled).toBe(false)
    expect(result.sendDisabled).toBe(true)
    expect(result.placeholder).not.toBe(result.disabledPlaceholder)
    expect(result.calls).toHaveLength(0)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("executor width only remeasures on scale-driven renders", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function" && typeof window.eval("renderScale") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const counts = await tab.evaluate(() => {
      const renderExecutor = window.eval("renderExecutor")
      const renderScale = window.eval("renderScale")
      const buttons = [...document.querySelectorAll("[data-executor]")]
      let calls = 0
      const orig = buttons.map((button) => button.getBoundingClientRect.bind(button))

      buttons.forEach((button, index) => {
        button.getBoundingClientRect = () => {
          calls += 1
          return orig[index]()
        }
      })

      renderExecutor({ measure: true })
      const first = calls
      renderExecutor()
      const second = calls
      renderScale()
      return { first, second, third: calls }
    })

    expect(counts.first).toBeGreaterThan(0)
    expect(counts.second).toBe(counts.first)
    expect(counts.third).toBeGreaterThan(counts.second)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("external executors show manual install and auth tooltip when unavailable", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const titles = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderExecutor = window.eval("renderExecutor")

      state.locale = "en-US"
      state.executors = [
        { id: "codex", label: "Codex", detail: "Disconnected", selectable: false, discovered: false },
        { id: "claude-code", label: "Claude Code", detail: "Disconnected", selectable: false, discovered: false },
        { id: "opencode", label: "OpenCorvus", detail: "Bundled", selectable: true, discovered: true },
      ]

      renderExecutor({ measure: true })

      return {
        codex: document.querySelector('[data-executor="codex"]')?.getAttribute("title") || "",
        claude: document.querySelector('[data-executor="claude-code"]')?.getAttribute("title") || "",
        opencode: document.querySelector('[data-executor="opencode"]')?.getAttribute("title") || "",
      }
    })

    expect(titles.codex).toContain("Requires manual install and auth before use")
    expect(titles.claude).toContain("Requires manual install and auth before use")
    expect(titles.opencode).not.toContain("Requires manual install and auth before use")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("openai auth action opens a method picker instead of failing silently", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderProviderStatus") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderProviderStatus = window.eval("renderProviderStatus")

      state.locale = "en-US"
      state.providerCatalog = {
        all: [{ id: "openai", name: "OpenAI", env: [], models: { "gpt-4.1": {} } }],
        connected: [],
        default: { openai: "gpt-4.1" },
      }
      state.providerAuth = {
        openai: [
          { type: "oauth", label: "ChatGPT Pro/Plus (browser)" },
          { type: "oauth", label: "ChatGPT Pro/Plus (headless)" },
          { type: "api", label: "Manually enter API Key" },
        ],
      }
      document.querySelector("#llmProvider").innerHTML = `<option value="openai">OpenAI</option>`
      document.querySelector("#llmProvider").value = "openai"
      renderProviderStatus("openai", {})
    })

    await tab.waitForFunction(() => !document.querySelector("#btnLlmAuthAction")?.classList.contains("hidden"))
    await tab.evaluate(() => document.querySelector("#btnLlmAuthAction")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await tab.waitForFunction(() => (document.querySelector("#appDialog") instanceof HTMLDialogElement) && document.querySelector("#appDialog").open === true)

    const result = await tab.evaluate(() => ({
      title: document.querySelector("#appDialogTitle")?.textContent || "",
      selectLabel: document.querySelector("#appDialogSelectLabel")?.textContent || "",
      options: [...document.querySelectorAll("#appDialogSelect option")].map((item) => item.textContent || ""),
    }))

    expect(result.title).toContain("OpenAI")
    expect(result.selectLabel).not.toBe("")
    expect(result.options).toHaveLength(3)
    expect(result.options.some((item) => item.includes("Manually enter API Key"))).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace mode follows unified selection helpers", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("enterTaskWorkspace") === "function"
          && typeof window.eval("enterSessionWorkspace") === "function"
          && typeof window.eval("enterEmptyWorkspace") === "function"
          && typeof window.eval("renderWorkspaceState") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const modes = await tab.evaluate(() => {
      const state = window.eval("state")
      const enterTaskWorkspace = window.eval("enterTaskWorkspace")
      const enterSessionWorkspace = window.eval("enterSessionWorkspace")
      const enterEmptyWorkspace = window.eval("enterEmptyWorkspace")
      const renderWorkspaceState = window.eval("renderWorkspaceState")

      state.connected = true
      enterEmptyWorkspace()
      const empty = document.body.dataset.workspace || ""

      enterTaskWorkspace("task-1")
      const task = document.body.dataset.workspace || ""

      let sessionError = ""
      try {
        enterSessionWorkspace("session-2")
      } catch (error) {
        sessionError = String(error)
      }

      state.connected = false
      renderWorkspaceState()
      const offline = document.body.dataset.workspace || ""

      return { empty, task, sessionError, offline }
    })

    expect(modes.empty).toBe("empty")
    expect(modes.task).toBe("task")
    expect(modes.sessionError).toContain("Overlay no longer supports session workspaces")
    expect(modes.offline).toBe("offline")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace directory restores the baseline directory after task overrides", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("activeDirectory") === "function"
          && typeof window.eval("restoreWorkspaceDirectory") === "function"
          && typeof window.eval("enterTaskWorkspace") === "function"
          && typeof window.eval("enterEmptyWorkspace") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

      const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const activeDirectory = window.eval("activeDirectory")
      const restoreWorkspaceDirectory = window.eval("restoreWorkspaceDirectory")
      const enterTaskWorkspace = window.eval("enterTaskWorkspace")
      const enterEmptyWorkspace = window.eval("enterEmptyWorkspace")

      state.savedDirectory = "D:/overlay/manual"
      state.tempDirectory = "D:/overlay/temp"
      state.directory = "D:/overlay/manual"
      restoreWorkspaceDirectory()
      const manual = activeDirectory()

      enterTaskWorkspace("task-1", { directory: "D:/overlay/task" })
      const task = {
        active: activeDirectory(),
        stored: state.directory,
        saved: state.savedDirectory,
        temp: state.tempDirectory,
      }

      state.path = { directory: "D:/overlay/fallback" }
      enterEmptyWorkspace({ globalView: false })
      return {
        manual,
        task,
        restored: activeDirectory(),
        stored: state.directory,
      }
    })

    expect(result.manual).toBe("D:/overlay/manual")
    expect(result.task.active).toBe("D:/overlay/task")
    expect(result.task.stored).toBe("D:/overlay/task")
    expect(result.task.saved).toBe("D:/overlay/manual")
    expect(result.task.temp).toBe("D:/overlay/temp")
    expect(result.restored).toBe("D:/overlay/manual")
    expect(result.stored).toBe("D:/overlay/manual")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("api requests always use the control directory instead of hidden path fallbacks", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("apiUrl") === "function"
          && typeof window.eval("setWorkspaceDirectory") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const state = window.eval("state")
      const apiUrl = window.eval("apiUrl")
      const setWorkspaceDirectory = window.eval("setWorkspaceDirectory")

      state.directory = "D:/overlay/control"
      state.path = { directory: "D:/overlay/hidden" }
      const before = apiUrl("path")

      setWorkspaceDirectory("D:/overlay/next", "task")
      const after = apiUrl("path")

      return {
        before,
        after,
        stored: state.directory,
      }
    })

    expect(result.before).toContain("directory=D%3A%2Foverlay%2Fcontrol")
    expect(result.before).not.toContain("hidden")
    expect(result.after).toContain("directory=D%3A%2Foverlay%2Fnext")
    expect(result.after).not.toContain("hidden")
    expect(result.stored).toBe("D:/overlay/next")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task changes ignore session diff failures and use board diffs only", async () => {
  const exe = await browser()
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/path") {
        const directory = url.searchParams.get("directory") || ""
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: directory,
          directory,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 })))
    },
  })
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value) => {
      let settings = {
        serverUrl: value,
        autoServer: false,
      }
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") return settings
            if (command === "overlay_settings_save") {
              settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadChanges") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
        candidateDelivery: {
          result: {
            diffs: [
              {
                file: "src/app.js",
                before: "const value = 1\n",
                after: "const value = 2\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        },
      }
      await window.eval("loadChanges")()
      return {
        changes: state.changes,
        text: document.querySelector("#changesBody")?.textContent || "",
      }
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]?.file).toBe("src/app.js")
    expect(result.text).toContain("src/app.js")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation reads the task transcript endpoint", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
      }
      state.serverUrl = window.location.origin
      const calls = []
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        calls.push(url.pathname + (url.search ? url.search : ""))
        if (url.pathname === "/task/task-1/transcript") {
          return new Response(JSON.stringify([
            { info: { id: "m1", role: "assistant", time: { created: 1 } }, parts: [{ id: "p1", type: "text", text: "from session" }] },
          ]), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }
      await window.eval("loadConversation")()
      return {
        calls,
        session: state.messages.map((item) => item.info.id),
      }
    })

    expect(result.calls).toEqual(["/task/task-1/transcript", "/control/timeline?taskID=task-1"])
    expect(result.session).toEqual(["m1"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task conversation keeps the original user request ahead of synthetic spec turns", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadConversation") === "function" && typeof window.eval("renderConversation") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
          request: "创建一个个人主页",
          time: { created: 200, updated: 220 },
        },
        spec: {
          content: "Spec after create",
          time: { created: 201 },
        },
        interactions: [],
      }
      state.serverUrl = window.location.origin
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        if (url.pathname === "/task/task-1/transcript") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname === "/control/timeline") {
          return new Response(JSON.stringify([
            { info: { id: "u1", role: "user", time: { created: 100 } }, parts: [{ id: "p1", type: "text", text: "创建一个个人主页" }] },
            { info: { id: "a1", role: "assistant", time: { created: 300 } }, parts: [{ id: "p2", type: "text", text: "任务已创建" }] },
          ]), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }

      await window.eval("loadConversation")()
      window.eval("renderConversation")()

      return [...document.querySelectorAll(".turn")].map((node) => ({
        role: (node as HTMLElement).dataset.role || "",
        text: (node.querySelector(".msg-body")?.textContent || "").trim(),
      }))
    })

    expect(result[0]?.role).toBe("user")
    expect(result[0]?.text).toContain("创建一个个人主页")
    expect(result[1]?.role).toBe("spec")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("budget section renders task limits and saves edits through the budget route", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderBudget") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    await tab.evaluate(() => {
      const state = window.eval("state")
      const renderBudget = window.eval("renderBudget")
      const root = window as typeof window & { __budgetCalls?: Array<{ budget?: Record<string, unknown> | null }> }

      state.connected = true
      state.selectedTaskID = "task-1"
      state.serverUrl = window.location.origin
      state.board = {
        task: {
          id: "task-1",
          title: "Budget task",
          budget: {
            maxRuns: 2,
            maxReplans: 1,
            maxEvaluations: 3,
          },
          time: { created: 1, updated: 2 },
        },
      }
      root.__budgetCalls = []
      window.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        if (url.pathname === "/task/task-1/budget" && method === "PATCH") {
          const body = JSON.parse(String(init.body || "{}"))
          root.__budgetCalls?.push(body)
          return new Response(JSON.stringify({
            id: "task-1",
            budget: body.budget,
            time: { created: 1, updated: 3 },
          }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }
      window.eval(`loadBoard = async () => {
        state.board = {
          task: {
            id: "task-1",
            title: "Budget task",
            budget: {
              maxRuns: 4,
              maxReplans: 0,
              maxEvaluations: 5,
            },
            time: { created: 1, updated: 3 },
          },
        }
        state.budgetDirty = false
        renderBudget(state.board.task)
      }`)
      renderBudget(state.board.task)
      const section = document.querySelector("#budgetSection")
      if (section instanceof HTMLDetailsElement) section.open = true
    })

    const result = await tab.evaluate(async () => {
      const root = window as typeof window & { __budgetCalls?: Array<{ budget?: Record<string, unknown> | null }> }
      const setValue = (selector: string, value: string) => {
        const node = document.querySelector(selector)
        if (!(node instanceof HTMLInputElement)) throw new Error(`Missing budget input: ${selector}`)
        node.value = value
        node.dispatchEvent(new Event("input", { bubbles: true }))
      }
      setValue("#budgetMaxRuns", "4")
      setValue("#budgetMaxReplans", "0")
      setValue("#budgetMaxEvaluations", "5")
      const save = document.querySelector("#btnBudgetSave")
      if (!(save instanceof HTMLButtonElement)) throw new Error("Missing budget save button")
      if (save.disabled) throw new Error("Budget save button did not enable")
      save.click()
      const start = Date.now()
      while ((root.__budgetCalls?.length || 0) < 1 && Date.now() - start < 4_000) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      while ((document.querySelector("#budgetMaxRuns") as HTMLInputElement | null)?.value !== "4" && Date.now() - start < 4_000) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return {
        calls: root.__budgetCalls,
        maxRuns: (document.querySelector("#budgetMaxRuns") as HTMLInputElement | null)?.value || "",
        maxReplans: (document.querySelector("#budgetMaxReplans") as HTMLInputElement | null)?.value || "",
        maxEvaluations: (document.querySelector("#budgetMaxEvaluations") as HTMLInputElement | null)?.value || "",
        saveDisabled: (document.querySelector("#btnBudgetSave") as HTMLButtonElement | null)?.disabled ?? true,
      }
    })

    expect(result.calls).toEqual([{
      budget: {
        maxRuns: 4,
        maxReplans: 0,
        maxEvaluations: 5,
      },
    }])
    expect(result.maxRuns).toBe("4")
    expect(result.maxReplans).toBe("0")
    expect(result.maxEvaluations).toBe("5")
    expect(result.saveDisabled).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("task changes prefer board delivery diffs over session diff fetches", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadChanges") === "function" && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      state.selectedTaskID = "task-1"
      state.board = {
        task: {
          id: "task-1",
          sessionID: "session-1",
        },
        delivery: {
          result: {
            diffs: [
              {
                file: "src/app.js",
                before: "a",
                after: "b",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        },
      }
      state.serverUrl = window.location.origin
      const calls = []
      window.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, window.location.origin)
        calls.push(url.pathname)
        return new Response("not found", { status: 404 })
      }
      await window.eval("loadChanges")()
      return {
        calls,
        files: state.changes.map((item) => item.file),
      }
    })

    expect(result.calls).toEqual([])
    expect(result.files).toEqual(["src/app.js"])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace bootstrap resolves the control directory before scoped loads run", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("ensureWorkspaceDirectory") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const ensureWorkspaceDirectory = window.eval("ensureWorkspaceDirectory")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []

      root.__overlayCalls = calls
      root.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        calls.push(url.pathname + (url.search ? url.search : ""))

        if (url.pathname === "/path") {
          return new Response(JSON.stringify({ directory: "D:/overlay/bootstrap", worktree: "", home: "", state: "", config: "" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname === "/vcs") {
          return new Response(JSON.stringify({ branch: "", clean: false, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }

      state.directory = ""
      state.path = null
      await ensureWorkspaceDirectory()

      return {
        directory: state.directory,
        calls,
      }
    })

    expect(result.directory).toBe("D:/overlay/bootstrap")
    expect(result.calls[0]).toBe("/path")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("workspace restore ignores saved session snapshots without a saved task", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("restoreInitialWorkspace") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const restoreInitialWorkspace = window.eval("restoreInitialWorkspace")
      localStorage.setItem("oc_workspace_session", "session-9")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls: string[] = []
      root.__overlayCalls = calls
      root.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        calls.push(url.pathname + (url.search ? url.search : ""))
        return new Response("not found", { status: 404 })
      }

      state.connected = true
      state.directory = "D:/overlay/current"
      state.savedDirectory = "D:/overlay/current"
      state.workspaceTaskID = ""
      state.workspaceDirectory = "D:/overlay/current"
      state.connected = true
      state.selectedTaskID = ""
      state.tasks = [
        {
          task: {
            id: "task-1",
            sessionID: "session-1",
            directory: "D:/overlay/current",
          },
        },
      ]

      const restored = await restoreInitialWorkspace()

      return {
        restored,
        workspace: document.body.dataset.workspace || "",
        selectedTaskID: state.selectedTaskID,
        legacySession: localStorage.getItem("oc_workspace_session") || "",
        calls,
      }
    })

    expect(result.restored).toBe(false)
    expect(["empty", "offline"]).toContain(result.workspace)
    expect(result.selectedTaskID).toBe("")
    expect(result.legacySession).toBe("session-9")
    expect(result.calls).toEqual([])
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("loadMeta hydrates the control directory from the current project path", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("loadMeta") === "function"
          && typeof window.eval("activeDirectory") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(async () => {
      const state = window.eval("state")
      const loadMeta = window.eval("loadMeta")
      const root = window

      root.fetch = async (input) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)

        if (url.pathname === "/path") {
          return new Response(JSON.stringify({ directory: "D:/overlay/new-project", worktree: "", home: "", state: "", config: "" }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname === "/vcs") {
          return new Response(JSON.stringify({ branch: "", clean: false, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        return new Response("not found", { status: 404 })
      }

      state.directory = ""
      state.path = null
      state.vcs = null

      await loadMeta()

      return {
        directory: state.directory,
        title: document.querySelector("#taskDir")?.getAttribute("title") || "",
        empty: document.querySelector("#taskDir")?.getAttribute("data-empty") || "",
        current: document.querySelector(".task-dir-node[data-current='true']")?.textContent || "",
      }
    })

    expect(result.directory).toBe("D:/overlay/new-project")
    expect(result.title).toBe("D:/overlay/new-project")
    expect(result.empty).toBe("false")
    expect(result.current).toBe("new-project")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("pending interactions render through extracted helpers without blocking the workspace", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderInteractions") === "function"
          && typeof window.eval("dismissInteractionModal") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const view = await tab.evaluate(() => {
      const renderInteractions = window.eval("renderInteractions")
      const dismissInteractionModal = window.eval("dismissInteractionModal")

      renderInteractions([
        {
          id: "interaction-1",
          status: "pending",
          type: "permission",
          title: "Workspace access",
          body: "Need permission to proceed.",
        },
      ])

      const overlay = document.querySelector(".interaction-modal-overlay")
      const modal = document.querySelector(".interaction-modal")
      const modalId = document.getElementById("interaction-modal")?.getAttribute("data-interaction-id") || ""
      const inline = document.querySelectorAll("#goalsBody .interaction-alert").length
      const overlayPointer = overlay ? getComputedStyle(overlay).pointerEvents : ""
      const modalPointer = modal ? getComputedStyle(modal).pointerEvents : ""

      dismissInteractionModal()

      return {
        inline,
        modalId,
        overlayPointer,
        modalPointer,
        dismissed: !document.getElementById("interaction-modal"),
      }
    })

    expect(view.inline).toBe(1)
    expect(view.modalId).toBe("interaction-1")
    expect(view.overlayPointer).toBe("none")
    expect(view.modalPointer).toBe("auto")
    expect(view.dismissed).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("auto question does not invent a fallback answer when choices are missing", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderInteractions") === "function"
          && !!window.eval("state").i18nReady
      } catch {
        return false
      }
    })

    const view = await tab.evaluate(async () => {
      const renderInteractions = window.eval("renderInteractions")
      const state = window.eval("state")
      const root = window as Window & { __overlayCalls?: string[] }
      const calls = []

      root.__overlayCalls = calls
      root.fetch = async (input, init = {}) => {
        const raw = typeof input === "string" ? input : input.url
        const url = new URL(raw, root.location.origin)
        const method = (init?.method || (typeof input === "string" ? "" : input.method) || "GET").toUpperCase()
        calls.push(`${method} ${url.pathname}`)
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        })
      }

      state.autoQuestion = true
      await new Promise((resolve) => setTimeout(resolve, 0))
      calls.length = 0
      renderInteractions([
        {
          id: "interaction-q1",
          status: "pending",
          type: "question",
          title: "Need clarification",
          body: "Pick one option.",
          payload: {
            questions: [],
          },
        },
      ])

      await new Promise((resolve) => setTimeout(resolve, 50))

      return {
        interactionCalls: calls.filter((item) => item.includes("/interaction/")),
        modalId: document.getElementById("interaction-modal")?.getAttribute("data-interaction-id") || "",
        inline: document.querySelectorAll("#goalsBody .interaction-alert").length,
      }
    })

    expect(view.interactionCalls).toEqual([])
    expect(view.modalId).toBe("interaction-q1")
    expect(view.inline).toBe(1)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("overlay recovers a created task even when the panel stream never finishes", async () => {
  const exe = await browser()
  const dir = "D:/overlay/task-recovery"
  let requestID = ""
  let taskReadyAt = 0
  const taskID = "tsk_recovered"
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const taskRow = () => ({
    task: {
      id: taskID,
      projectID: "project-1",
      requestID,
      source: "panel",
      title: "创建一个电商网站",
      request: "创建一个电商网站",
      status: "queued",
      priority: "normal",
      time: {
        created: taskReadyAt,
        updated: taskReadyAt,
      },
    },
    overview: {
      headline: "创建一个电商网站",
    },
    updated_at: taskReadyAt,
    pending_interactions: 0,
  })
  const board = () => ({
    task: {
      id: taskID,
      projectID: "project-1",
      requestID,
      source: "panel",
      title: "创建一个电商网站",
      request: "创建一个电商网站",
      status: "queued",
      priority: "normal",
      time: {
        created: taskReadyAt,
        updated: taskReadyAt,
      },
    },
    goals: [],
    specItems: [],
    planNodes: [],
    goalRuns: [],
    milestones: [],
    interactions: [],
    artifacts: [],
    snapshots: [],
    overview: {
      headline: "创建一个电商网站",
      summary: "Task accepted",
      nextStep: {
        kind: "observe",
        title: "等待执行",
      },
      controls: {
        canRetry: false,
        canReplan: false,
        canCancel: true,
      },
    },
    brief: {
      content: "",
      updated_at: taskReadyAt,
    },
  })
  const timeline = () => [
    {
      info: {
        id: "msg-user",
        role: "user",
        surface: "panel",
        taskID,
        time: {
          created: taskReadyAt,
          updated: taskReadyAt,
        },
      },
      parts: [{ id: "msg-user-text", type: "text", text: "创建一个电商网站" }],
    },
    {
      info: {
        id: "msg-assistant",
        role: "assistant",
        surface: "panel",
        taskID,
        time: {
          created: taskReadyAt + 1,
          updated: taskReadyAt + 1,
        },
      },
      parts: [{ id: "msg-assistant-text", type: "text", text: `任务已创建：${taskID}` }],
    },
  ]
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      const ready = !!requestID && Date.now() >= taskReadyAt
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: ready ? [taskRow()] : [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/task/tsk_recovered/board") return send(board())
      if (path === "/task/tsk_recovered/transcript") return send([])
      if (path === "/control/timeline") {
        const task = url.searchParams.get("taskID") || ""
        return send(task === taskID && ready ? timeline() : [])
      }
      if (path === "/path") {
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: dir,
          directory: dir,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)
      if (path === "/panel/message/stream" && req.method === "POST") {
        const body = await req.json() as { request_id?: string }
        requestID = body.request_id || ""
        taskReadyAt = Date.now() + 250
        const encoder = new TextEncoder()
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_delta", delta: "正在处理请求" })}\n\n`))
            setTimeout(() => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool", tool: "panel" })}\n\n`))
              } catch {}
            }, 20)
          },
        }), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 })))
    },
  })
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value, directory) => {
      const state = {
        settings: {
          serverUrl: value,
          autoServer: false,
        },
        directory,
        chatTimeoutMs: 120,
        taskRecoveryTimeoutMs: 4_000,
        taskRecoveryPollMs: 50,
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") {
              return {
                ...state.settings,
                directory,
                directoryMode: "custom",
              }
            }
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl, dir)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
    await tab.waitForFunction((directory) => {
      try {
        const state = window.eval("state")
        return state.directory === directory
      } catch {
        return false
      }
    }, {}, dir)

    await tab.$eval("#chatTextarea", (node, value) => {
      const input = node as HTMLTextAreaElement
      input.value = String(value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }, "创建一个电商网站")
    await tab.click("#chatSend")

    await tab.waitForFunction((id) => {
      try {
        const state = window.eval("state")
        const messages = Array.isArray(state.messages) ? state.messages : []
        const text = messages
          .flatMap((item: { parts?: Array<{ text?: string; type?: string }> }) => Array.isArray(item?.parts) ? item.parts : [])
          .map((part: { text?: string; type?: string }) => part?.type === "text" ? part.text || "" : "")
          .join("\n")
        return state.selectedTaskID === id
          && !state.chatRequest
          && Array.isArray(state.tasks)
          && state.tasks.some((item: { task?: { id?: string } }) => item?.task?.id === id)
          && text.includes(`任务已创建：${id}`)
          && !text.includes("已中断")
      } catch {
        return false
      }
    }, { timeout: 8_000 }, taskID)

    const view = await tab.evaluate(() => {
      const state = window.eval("state")
      const messages = Array.isArray(state.messages)
        ? state.messages
            .flatMap((item: { parts?: Array<{ text?: string; type?: string }> }) => Array.isArray(item?.parts) ? item.parts : [])
            .map((part: { text?: string; type?: string }) => part?.type === "text" ? part.text || "" : "")
            .filter(Boolean)
        : []
      return {
        selectedTaskID: state.selectedTaskID,
        taskIDs: Array.isArray(state.tasks) ? state.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "") : [],
        busy: !!state.chatRequest,
        messages,
      }
    })

    expect(view.selectedTaskID).toBe(taskID)
    expect(view.taskIDs).toContain(taskID)
    expect(view.busy).toBe(false)
    expect(view.messages.some((item) => item.includes(`任务已创建：${taskID}`))).toBe(true)
    expect(view.messages.some((item) => item.includes("已中断"))).toBe(false)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("empty-start chat shows a pending task row and streams reasoning before the task is ready", async () => {
  const exe = await browser()
  const dir = "D:/overlay/pending-task"
  let requestID = ""
  let taskReadyAt = 0
  const taskID = "tsk_pending_reasoning"
  const reasoning = "先确认需求，再创建任务并准备计划。"
  const send = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    })
  const taskRow = () => ({
    task: {
      id: taskID,
      projectID: "project-1",
      requestID,
      source: "panel",
      title: "创建一个电商网站",
      request: "创建一个电商网站",
      status: "queued",
      priority: "normal",
      time: {
        created: taskReadyAt,
        updated: taskReadyAt,
      },
    },
    overview: {
      headline: "创建一个电商网站",
    },
    updated_at: taskReadyAt,
    pending_interactions: 0,
  })
  const board = () => ({
    task: {
      id: taskID,
      projectID: "project-1",
      requestID,
      source: "panel",
      title: "创建一个电商网站",
      request: "创建一个电商网站",
      status: "queued",
      priority: "normal",
      time: {
        created: taskReadyAt,
        updated: taskReadyAt,
      },
    },
    goals: [],
    specItems: [],
    planNodes: [],
    goalRuns: [],
    milestones: [],
    interactions: [],
    artifacts: [],
    snapshots: [],
    overview: {
      headline: "创建一个电商网站",
      summary: "Task accepted",
      nextStep: {
        kind: "observe",
        title: "等待执行",
      },
      controls: {
        canRetry: false,
        canReplan: false,
        canCancel: true,
      },
    },
    brief: {
      content: "",
      updated_at: taskReadyAt,
    },
  })
  const timeline = () => [
    {
      info: {
        id: "msg-user",
        role: "user",
        surface: "panel",
        taskID,
        time: {
          created: taskReadyAt,
          updated: taskReadyAt,
        },
      },
      parts: [{ id: "msg-user-text", type: "text", text: "创建一个电商网站" }],
    },
    {
      info: {
        id: "msg-assistant",
        role: "assistant",
        surface: "panel",
        taskID,
        time: {
          created: taskReadyAt + 1,
          updated: taskReadyAt + 1,
        },
      },
      parts: [{ id: "msg-assistant-text", type: "text", text: `任务已创建：${taskID}` }],
    },
  ]
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname.replace(/\/+$/, "") || "/"
      const ready = !!requestID && Date.now() >= taskReadyAt
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks") return send({ tasks: ready ? [taskRow()] : [] })
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/task/tsk_pending_reasoning/board") return send(board())
      if (path === "/task/tsk_pending_reasoning/transcript") return send([])
      if (path === "/control/timeline") {
        const task = url.searchParams.get("taskID") || ""
        return send(task === taskID && ready ? timeline() : [])
      }
      if (path === "/path") {
        return send({
          home: "C:/Users/test",
          state: "C:/Users/test/.opencorvus/state",
          config: "C:/Users/test/.opencorvus/config",
          worktree: dir,
          directory: dir,
        })
      }
      if (path === "/vcs") {
        return send({
          branch: "",
          clean: false,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/config") return send({})
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send(true)
      if (path === "/panel/message/stream" && req.method === "POST") {
        const body = await req.json() as { request_id?: string }
        requestID = body.request_id || ""
        taskReadyAt = Date.now() + 320
        const encoder = new TextEncoder()
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool", tool: "panel" })}\n\n`))
            setTimeout(() => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "reasoning_delta", delta: "先确认需求，" })}\n\n`))
              } catch {}
            }, 30)
            setTimeout(() => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "reasoning_delta", delta: "再创建任务并准备计划。" })}\n\n`))
              } catch {}
            }, 140)
            setTimeout(() => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", result: { kind: "created", task_id: taskID, message: `任务已创建：${taskID}` } })}\n\n`))
                controller.close()
              } catch {}
            }, 260)
          },
        }), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }

      const name = path === "/" ? "index.html" : path.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => (ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 })))
    },
  })
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    const serverUrl = `http://127.0.0.1:${server.port}`
    await tab.evaluateOnNewDocument((value, directory) => {
      const state = {
        settings: {
          serverUrl: value,
          autoServer: false,
        },
        directory,
        chatTimeoutMs: 5_000,
        taskRecoveryTimeoutMs: 5_000,
        taskRecoveryPollMs: 50,
      }
      Object.defineProperty(window, "__overlayTest", {
        configurable: true,
        value: state,
      })
      window.__TAURI__ = {
        core: {
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command === "overlay_settings_load") {
              return {
                ...state.settings,
                directory,
                directoryMode: "custom",
              }
            }
            if (command === "overlay_settings_save") {
              state.settings = { ...((args.settings as Record<string, unknown>) || {}) }
              return true
            }
            return null
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined,
              minimize: async () => undefined,
              startDragging: async () => undefined,
              setAlwaysOnTop: async () => undefined,
              isAlwaysOnTop: async () => false,
              isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            }
          },
        },
      }
    }, serverUrl, dir)

    await tab.goto(serverUrl, { waitUntil: "load" })
    await tab.waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online")
    await tab.$eval("#chatTextarea", (node, value) => {
      const input = node as HTMLTextAreaElement
      input.value = String(value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }, "创建一个电商网站")
    await tab.click("#chatSend")

    await new Promise((resolve) => setTimeout(resolve, 90))
    const early = await tab.evaluate(() => {
      const state = window.eval("state")
      return {
        pendingTasks: Array.isArray(state.pendingTasks) ? state.pendingTasks.length : 0,
        taskList: document.querySelector("#taskListPanel")?.textContent || "",
        reasoning: document.querySelector('.turn[data-role="assistant"] .reasoning-text')?.textContent || "",
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 160))
    const mid = await tab.evaluate(() => ({
      reasoning: document.querySelector('.turn[data-role="assistant"] .reasoning-text')?.textContent || "",
    }))

    await tab.waitForFunction((id) => {
      try {
        return window.eval("state").selectedTaskID === id
      } catch {
        return false
      }
    }, { timeout: 5_000 }, taskID)

    const final = await tab.evaluate(() => {
      const state = window.eval("state")
      return {
        pendingTasks: Array.isArray(state.pendingTasks) ? state.pendingTasks.length : 0,
        selectedTaskID: state.selectedTaskID || "",
        taskList: document.querySelector("#taskListPanel")?.textContent || "",
      }
    })

    expect(early.pendingTasks).toBe(1)
    expect(early.taskList).toContain("创建一个电商网站")
    expect(early.reasoning.length).toBeGreaterThan(0)
    expect(mid.reasoning).toContain(reasoning)
    expect(early.reasoning.length).toBeLessThan(mid.reasoning.length)
    expect(final.pendingTasks).toBe(0)
    expect(final.selectedTaskID).toBe(taskID)
    expect(final.taskList).toContain("创建一个电商网站")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })
