import { expect, test } from "bun:test"

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

test("planner turn refreshes when synthetic board content changes", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderSession") === "function"
      } catch {
        return false
      }
    })

    const before = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.selectedTaskID = "task-1"
      state.chatSessionID = ""
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
      state.session = [
        {
          parts: [{ type: "text", text: "Assistant note" }],
          info: { role: "assistant", time: { created: 6 } },
        },
      ]
      state._renderedGroupKey = ""
      renderSession()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(before).toContain("Plan before")

    const after = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.board = {
        ...state.board,
        plan: {
          ...state.board.plan,
          summary: "Plan after",
        },
      }
      renderSession()
      return document.querySelector('.turn[data-role="planner"] .msg-body')?.textContent || ""
    })

    expect(after).toContain("Plan after")
    expect(after).not.toContain("Plan before")
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("live planner agent marks the plan section active", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderSession") === "function"
      } catch {
        return false
      }
    })

    const phase = await tab.evaluate(() => {
      const state = window.eval("state")
      const renderSession = window.eval("renderSession")

      state.board = null
      state.session = [
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
      renderSession()
      return document.querySelector("#planSection")?.dataset.phaseState || ""
    })

    expect(phase).toBe("active")
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("executor width only remeasures on scale-driven renders", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function" && typeof window.eval("renderScale") === "function"
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
})

test("external executors show manual install and auth tooltip when unavailable", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderExecutor") === "function"
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
})

test("workspace mode follows unified selection helpers", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("enterTaskWorkspace") === "function"
          && typeof window.eval("enterSessionWorkspace") === "function"
          && typeof window.eval("enterEmptyWorkspace") === "function"
          && typeof window.eval("renderWorkspaceState") === "function"
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
      enterEmptyWorkspace({ globalView: false })
      const empty = document.body.dataset.workspace || ""

      enterTaskWorkspace("task-1")
      const task = document.body.dataset.workspace || ""

      enterTaskWorkspace("task-1", {
        sessionID: "session-1",
        managedSession: { id: "session-1" },
      })
      const taskSession = document.body.dataset.workspace || ""

      enterSessionWorkspace("session-2", {
        managedSession: { id: "session-2" },
      })
      const session = document.body.dataset.workspace || ""

      state.globalView = true
      renderWorkspaceState()
      const global = document.body.dataset.workspace || ""

      state.connected = false
      renderWorkspaceState()
      const offline = document.body.dataset.workspace || ""

      return { empty, task, taskSession, session, global, offline }
    })

    expect(modes.empty).toBe("empty")
    expect(modes.task).toBe("task")
    expect(modes.taskSession).toBe("task-session")
    expect(modes.session).toBe("session")
    expect(modes.global).toBe("global")
    expect(modes.offline).toBe("offline")
  } finally {
    await page.close()
    server.stop(true)
  }
})

test("pending interactions render through extracted helpers without blocking the workspace", async () => {
  const exe = await browser()
  const server = serve()
  const page = await puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: ["--no-sandbox"],
  })

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderInteractions") === "function"
          && typeof window.eval("dismissInteractionModal") === "function"
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
})
