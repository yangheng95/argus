/**
 * Headed benchmark: executor goal group visual verification.
 *
 * Launches a visible browser window showing the overlay with mock data
 * containing parallel executor sessions grouped by goal.
 *
 * Usage:
 *   cd packages/overlay && bun test/goal-group-benchmark.ts
 *
 * The browser stays open for visual inspection. Press Ctrl+C to exit.
 */

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href
)

const src = new URL("../src/", import.meta.url)
const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

// ── Mock data ──

const TASK_ID = "task-benchmark-001"
const ROOT_SESSION = "root-session-001"

const boardData = {
  task: {
    id: TASK_ID,
    request: "Implement user authentication and add API endpoints for the new dashboard",
    status: "running",
    sessionID: ROOT_SESSION,
    time: { created: Date.now() - 120_000 },
  },
  spec: {
    content: "## Requirements\n\n1. User authentication with JWT tokens\n2. REST API endpoints for dashboard data\n3. Role-based access control",
  },
  plan: {
    summary: "Three-phase implementation: auth module, API layer, access control",
    version: 1,
  },
  evaluation: null,
  delivery: null,
  acceptedDelivery: null,
  interactions: [],
  lanes: [
    {
      id: "run",
      title: "Run",
      cards: [{
        id: "run-1",
        kind: "run",
        title: "opencode / executing",
        status: "running",
        time: Date.now(),
      }],
    },
    {
      id: "delivery",
      title: "Delivery",
      cards: [],
    },
    {
      id: "goals",
      title: "Dynamic Goals",
      cards: [
        {
          id: "goal-auth",
          kind: "goal",
          title: "Implement JWT authentication module",
          detail: "Create auth middleware with login/logout/refresh token endpoints",
          status: "running",
          time: Date.now() - 60_000,
          metadata: { sessionID: "exec-session-auth" },
        },
        {
          id: "goal-api",
          kind: "goal",
          title: "Add REST API endpoints for dashboard",
          detail: "CRUD operations for dashboard widgets and user preferences",
          status: "running",
          time: Date.now() - 55_000,
          metadata: { sessionID: "exec-session-api" },
        },
        {
          id: "goal-rbac",
          kind: "goal",
          title: "Implement role-based access control",
          detail: "Admin/editor/viewer roles with permission checks on API routes",
          status: "pending",
          time: Date.now() - 50_000,
          metadata: { sessionID: "exec-session-rbac" },
        },
      ],
    },
    { id: "staging", title: "Staging", cards: [] },
    { id: "interactions", title: "Interactions", cards: [] },
    { id: "history", title: "History", cards: [] },
  ],
  overview: [],
  brief: { content: "", updated_at: Date.now() },
  snapshotVersion: "v1",
  lastSequence: 100,
}

// Transcript messages: mix of spec, planner, goal, and parallel executor messages
const transcriptMessages = [
  // Spec agent messages
  {
    info: {
      id: "spec-msg-1",
      role: "assistant",
      agent: "spec",
      sessionID: "spec-session-1",
      time: { created: Date.now() - 110_000 },
    },
    parts: [
      { id: "sp1", type: "text", text: "Let me analyze the codebase to understand the current authentication setup..." },
      { id: "sp2", type: "tool", tool: "search_code", state: { status: "completed", input: { query: "auth middleware" }, output: "Found 3 files", title: "search_code", metadata: {}, time: { start: Date.now() - 109_000, end: Date.now() - 108_500 } } },
    ],
  },
  {
    info: {
      id: "spec-msg-2",
      role: "assistant",
      agent: "spec",
      sessionID: "spec-session-1",
      time: { created: Date.now() - 108_000 },
    },
    parts: [
      { id: "sp3", type: "text", text: "Based on the analysis, here are the requirements:\n\n1. JWT-based authentication\n2. Dashboard API with CRUD\n3. Role-based access control" },
    ],
  },
  // Planner message
  {
    info: {
      id: "planner-msg-1",
      role: "assistant",
      agent: "planner",
      sessionID: "planner-session-1",
      time: { created: Date.now() - 100_000 },
    },
    parts: [
      { id: "pp1", type: "text", text: "Creating implementation plan with 3 parallel goals..." },
      { id: "pp2", type: "tool", tool: "create_plan", state: { status: "completed", input: {}, output: "Plan created with 3 goals", title: "create_plan", metadata: {}, time: { start: Date.now() - 99_000, end: Date.now() - 98_000 } } },
    ],
  },
  // Goal agent message
  {
    info: {
      id: "goal-msg-1",
      role: "assistant",
      agent: "goal",
      sessionID: "goal-session-1",
      time: { created: Date.now() - 95_000 },
    },
    parts: [
      { id: "gp1", type: "text", text: "Decomposed into 3 implementation goals for parallel execution" },
    ],
  },
  // ── Executor messages for Goal A (auth) ──
  {
    info: {
      id: "exec-auth-1",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 80_000 },
    },
    parts: [
      { id: "ea1", type: "text", text: "Starting JWT authentication implementation. Let me read the existing middleware..." },
      { id: "ea2", type: "tool", tool: "read_file", state: { status: "completed", input: { path: "src/middleware/auth.ts" }, output: "// Empty auth middleware\nexport function authMiddleware() { ... }", title: "read_file", metadata: {}, time: { start: Date.now() - 79_000, end: Date.now() - 78_500 } } },
    ],
  },
  {
    info: {
      id: "exec-auth-2",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 75_000 },
    },
    parts: [
      { id: "ea3", type: "text", text: "Writing JWT token generation and verification logic..." },
      { id: "ea4", type: "tool", tool: "write_file", state: { status: "completed", input: { path: "src/auth/jwt.ts" }, output: "File written: src/auth/jwt.ts (45 lines)", title: "write_file", metadata: {}, time: { start: Date.now() - 74_000, end: Date.now() - 73_000 } } },
    ],
  },
  {
    info: {
      id: "exec-auth-3",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 70_000 },
    },
    parts: [
      { id: "ea5", type: "text", text: "Implementing login and refresh token endpoints..." },
      { id: "ea6", type: "tool", tool: "write_file", state: { status: "completed", input: { path: "src/routes/auth.ts" }, output: "File written: src/routes/auth.ts (78 lines)", title: "write_file", metadata: {}, time: { start: Date.now() - 69_000, end: Date.now() - 68_000 } } },
    ],
  },
  {
    info: {
      id: "exec-auth-4",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 65_000 },
    },
    parts: [
      { id: "ea7", type: "text", text: "Writing tests for the auth module..." },
      { id: "ea8", type: "tool", tool: "run_tests", state: { status: "running", input: { file: "test/auth.test.ts" }, title: "run_tests", metadata: {}, time: { start: Date.now() - 64_000 } } },
    ],
  },
  // ── Executor messages for Goal B (API) ──
  {
    info: {
      id: "exec-api-1",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 78_000 },
    },
    parts: [
      { id: "eb1", type: "text", text: "Starting dashboard API implementation. Reading existing router setup..." },
      { id: "eb2", type: "tool", tool: "read_file", state: { status: "completed", input: { path: "src/routes/index.ts" }, output: "import { Router } from 'express';\nconst router = Router();\n...", title: "read_file", metadata: {}, time: { start: Date.now() - 77_000, end: Date.now() - 76_500 } } },
    ],
  },
  {
    info: {
      id: "exec-api-2",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 72_000 },
    },
    parts: [
      { id: "eb3", type: "text", text: "Creating CRUD endpoints for dashboard widgets..." },
      { id: "eb4", type: "tool", tool: "write_file", state: { status: "completed", input: { path: "src/routes/dashboard.ts" }, output: "File written: src/routes/dashboard.ts (120 lines)", title: "write_file", metadata: {}, time: { start: Date.now() - 71_000, end: Date.now() - 70_000 } } },
    ],
  },
  {
    info: {
      id: "exec-api-3",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 67_000 },
    },
    parts: [
      { id: "eb5", type: "text", text: "Adding user preferences API with validation..." },
      { id: "eb6", type: "tool", tool: "write_file", state: { status: "completed", input: { path: "src/routes/preferences.ts" }, output: "File written: src/routes/preferences.ts (65 lines)", title: "write_file", metadata: {}, time: { start: Date.now() - 66_000, end: Date.now() - 65_500 } } },
    ],
  },
  // ── Executor messages for Goal C (RBAC) — just started ──
  {
    info: {
      id: "exec-rbac-1",
      role: "assistant",
      agent: "opencode",
      sessionID: "exec-session-rbac",
      time: { created: Date.now() - 40_000 },
    },
    parts: [
      { id: "ec1", type: "text", text: "Reading the existing permission model to understand the role hierarchy..." },
      { id: "ec2", type: "tool", tool: "search_code", state: { status: "running", input: { query: "role permission" }, title: "search_code", metadata: {}, time: { start: Date.now() - 39_000 } } },
    ],
  },
]

// ── Mock server ──

function send(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

const server = Bun.serve({
  port: 0,
  idleTimeout: 255,
  fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, "") || "/"

    // API endpoints
    if (path === "/global/health") return send({ version: "benchmark" })
    if (path === "/tasks" || path === "/global/tasks") {
      return send({
        tasks: [{
          task: {
            id: TASK_ID,
            requestID: "req-1",
            request: boardData.task.request,
            status: boardData.task.status,
            time_created: boardData.task.time.created,
            time_updated: Date.now(),
          },
        }],
      })
    }
    if (path === `/task/${TASK_ID}/board`) {
      return send(boardData)
    }
    if (path === `/task/${TASK_ID}/transcript`) {
      return send(transcriptMessages)
    }
    if (path.startsWith("/control/timeline")) {
      return send([])
    }
    if (path.includes("/events")) {
      // SSE — periodic heartbeat to keep connection alive
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
          const timer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": heartbeat\n\n"))
            } catch {
              clearInterval(timer)
            }
          }, 5000)
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        },
      })
    }
    if (path === "/session") return send([])
    if (path === "/path") {
      return send({
        home: "C:/Users/benchmark",
        state: "C:/Users/benchmark/.opencorvus/state",
        config: "C:/Users/benchmark/.opencorvus/config",
        worktree: "C:/projects/demo",
        directory: "C:/projects/demo",
      })
    }
    if (path === "/vcs") {
      return send({
        branch: "feature/auth",
        clean: false,
        dirty: true,
        staged: 3,
        modified: 5,
        untracked: 2,
        conflicts: 0,
        ahead: 3,
        behind: 0,
      })
    }
    if (path === "/skill/installed" || path === "/skill") return send([])
    if (path === "/mcp") return send({})
    if (path === "/config") return send({})
    if (path === "/extensions") return send({})
    if (path === "/meta") return send({})
    if (path === "/preferences") return send({})
    if (path === "/workspace") return send({})
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/channel") return send([])
    if (path === "/executor") return send([])
    if (path === "/panel/knowledge/memory") return send([])
    if (path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send(true)

    // Static files
    const name = path === "/" ? "index.html" : path.slice(1)
    const file = Bun.file(new URL(name, src))
    const ext = name.slice(name.lastIndexOf("."))
    const type = types[ext] || "application/octet-stream"
    return file.exists().then((ok: boolean) =>
      ok
        ? new Response(file, { headers: { "content-type": type } })
        : new Response("not found", { status: 404 }),
    )
  },
})

const serverUrl = `http://127.0.0.1:${server.port}`
console.log(`\n  Mock server: ${serverUrl}`)

// ── Launch browser (headed) ──

const browsers = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
]

let exe = ""
for (const path of browsers) {
  if (await Bun.file(path).exists()) {
    exe = path
    break
  }
}
if (!exe) {
  console.error("No Chrome/Edge found")
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,
  defaultViewport: { width: 800, height: 900 },
  args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"],
})

const page = await browser.newPage()

// Inject Tauri mock
await page.evaluateOnNewDocument((url: string) => {
  const settings = {
    serverUrl: url,
    autoServer: false,
  }
  window.__TAURI__ = {
    core: {
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === "overlay_settings_load") return settings
        if (command === "overlay_settings_save") {
          Object.assign(settings, args.settings || {})
          return true
        }
        if (command === "overlay_create_temp_dir") return "C:/projects/demo"
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

await page.goto(serverUrl, { waitUntil: "load" })

console.log("  Browser opened. Waiting for overlay to connect...")

// Wait for connection
await page.waitForFunction(
  () => document.querySelector("#connBadge")?.getAttribute("data-status") === "online",
  { timeout: 15_000 },
).catch(() => {
  console.log("  (connection badge not found, continuing anyway)")
})

// Auto-select the task
await page.evaluate((taskID: string) => {
  // Wait a moment then select the task via the task list
  setTimeout(() => {
    const taskRow = document.querySelector(`.task-row-main`) as HTMLElement
    if (taskRow) taskRow.click()
  }, 500)
}, TASK_ID)

console.log(`  Task auto-selected. Overlay should show goal-grouped executor cards.`)
console.log(`\n  Visual verification checklist:`)
console.log(`    [ ] Spec cards (#1, #2) show spec analysis steps`)
console.log(`    [ ] Planner card shows plan creation`)
console.log(`    [ ] Goal card shows 3 decomposed goals`)
console.log(`    [ ] "Implement JWT authentication module" goal group with 4 executor steps`)
console.log(`    [ ] "Add REST API endpoints for dashboard" goal group with 3 executor steps`)
console.log(`    [ ] "Implement role-based access control" goal group with 1 executor step`)
console.log(`    [ ] Goal groups are collapsible (click header)`)
console.log(`    [ ] Internal executor cards are independently collapsible`)
console.log(`    [ ] Running goals default to expanded`)
console.log(`\n  Press Ctrl+C to close.\n`)

// Keep alive
await new Promise((resolve) => {
  process.on("SIGINT", resolve)
  process.on("SIGTERM", resolve)
  browser.on("disconnected", resolve)
})

await browser.close().catch(() => {})
server.stop()
process.exit(0)
