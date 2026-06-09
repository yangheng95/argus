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

import { launchBrowser } from "./launch"

// Static assets: serve from dist-vite/ (built bundle) so the browser receives
// already-compiled JS/CSS instead of raw .tsx that no browser can parse.
// Run `bun run build:vite` in packages/overlay before launching this benchmark.
const src = new URL("../dist-vite/", import.meta.url)
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
    content:
      "## Requirements\n\n1. User authentication with JWT tokens\n2. REST API endpoints for dashboard data\n3. Role-based access control",
  },
  plan: {
    summary: "Three-phase implementation: auth module, API layer, access control",
    version: 1,
  },
  evaluation: null,
  acceptance: null,
  acceptedAcceptance: null,
  interactions: [],
  lanes: [
    {
      id: "run",
      title: "Run",
      cards: [
        {
          id: "run-1",
          kind: "run",
          title: "OpenCorvus / executing",
          status: "running",
          time: Date.now(),
        },
      ],
    },
    {
      id: "acceptance",
      title: "Acceptance",
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
  goalWorkflows: [
    {
      goalID: "goal-auth",
      goalTitle: "Implement JWT authentication module",
      goalStatus: "running",
      orderIndex: 0,
      priority: "blocking",
      steps: [{ stepID: "build", label: "Executor", status: "running" }],
    },
    {
      goalID: "goal-api",
      goalTitle: "Add REST API endpoints for dashboard",
      goalStatus: "running",
      orderIndex: 1,
      priority: "blocking",
      steps: [{ stepID: "build", label: "Executor", status: "running" }],
    },
    {
      goalID: "goal-rbac",
      goalTitle: "Implement role-based access control",
      goalStatus: "running",
      orderIndex: 2,
      priority: "blocking",
      steps: [{ stepID: "build", label: "Executor", status: "running" }],
    },
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
      {
        id: "sp1",
        type: "text",
        text: "Let me analyze the codebase to understand the current authentication setup...",
      },
      {
        id: "sp2",
        type: "tool",
        tool: "search_code",
        state: {
          status: "completed",
          input: { query: "auth middleware" },
          output: "Found 3 files",
          title: "search_code",
          metadata: {},
          time: { start: Date.now() - 109_000, end: Date.now() - 108_500 },
        },
      },
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
      {
        id: "sp3",
        type: "text",
        text: "Based on the analysis, here are the requirements:\n\n1. JWT-based authentication\n2. Dashboard API with CRUD\n3. Role-based access control",
      },
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
      {
        id: "pp2",
        type: "tool",
        tool: "create_plan",
        state: {
          status: "completed",
          input: {},
          output: "Plan created with 3 goals",
          title: "create_plan",
          metadata: {},
          time: { start: Date.now() - 99_000, end: Date.now() - 98_000 },
        },
      },
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
    parts: [{ id: "gp1", type: "text", text: "Decomposed into 3 implementation goals for parallel execution" }],
  },
  // ── Executor messages for Goal A (auth) ──
  {
    info: {
      id: "exec-auth-1",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 80_000 },
    },
    parts: [
      {
        id: "ea1",
        type: "text",
        text: "Starting JWT authentication implementation. Let me read the existing middleware...",
      },
      {
        id: "ea2",
        type: "tool",
        tool: "read_file",
        state: {
          status: "completed",
          input: { path: "src/middleware/auth.ts" },
          output: "// Empty auth middleware\nexport function authMiddleware() { ... }",
          title: "read_file",
          metadata: {},
          time: { start: Date.now() - 79_000, end: Date.now() - 78_500 },
        },
      },
    ],
  },
  {
    info: {
      id: "exec-auth-2",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 75_000 },
    },
    parts: [
      { id: "ea3", type: "text", text: "Writing JWT token generation and verification logic..." },
      {
        id: "ea4",
        type: "tool",
        tool: "write_file",
        state: {
          status: "completed",
          input: { path: "src/auth/jwt.ts" },
          output: "File written: src/auth/jwt.ts (45 lines)",
          title: "write_file",
          metadata: {},
          time: { start: Date.now() - 74_000, end: Date.now() - 73_000 },
        },
      },
    ],
  },
  {
    info: {
      id: "exec-auth-3",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 70_000 },
    },
    parts: [
      { id: "ea5", type: "text", text: "Implementing login and refresh token endpoints..." },
      {
        id: "ea6",
        type: "tool",
        tool: "write_file",
        state: {
          status: "completed",
          input: { path: "src/routes/auth.ts" },
          output: "File written: src/routes/auth.ts (78 lines)",
          title: "write_file",
          metadata: {},
          time: { start: Date.now() - 69_000, end: Date.now() - 68_000 },
        },
      },
    ],
  },
  {
    info: {
      id: "exec-auth-4",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-auth",
      time: { created: Date.now() - 65_000 },
    },
    parts: [
      { id: "ea7", type: "text", text: "Writing tests for the auth module..." },
      {
        id: "ea8",
        type: "tool",
        tool: "run_tests",
        state: {
          status: "running",
          input: { file: "test/auth.test.ts" },
          title: "run_tests",
          metadata: {},
          time: { start: Date.now() - 64_000 },
        },
      },
    ],
  },
  // ── Executor messages for Goal B (API) ──
  {
    info: {
      id: "exec-api-1",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 78_000 },
    },
    parts: [
      { id: "eb1", type: "text", text: "Starting dashboard API implementation. Reading existing router setup..." },
      {
        id: "eb2",
        type: "tool",
        tool: "read_file",
        state: {
          status: "completed",
          input: { path: "src/routes/index.ts" },
          output: "import { Router } from 'express';\nconst router = Router();\n...",
          title: "read_file",
          metadata: {},
          time: { start: Date.now() - 77_000, end: Date.now() - 76_500 },
        },
      },
    ],
  },
  {
    info: {
      id: "exec-api-2",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 72_000 },
    },
    parts: [
      { id: "eb3", type: "text", text: "Creating CRUD endpoints for dashboard widgets..." },
      {
        id: "eb4",
        type: "tool",
        tool: "write_file",
        state: {
          status: "completed",
          input: { path: "src/routes/dashboard.ts" },
          output: "File written: src/routes/dashboard.ts (120 lines)",
          title: "write_file",
          metadata: {},
          time: { start: Date.now() - 71_000, end: Date.now() - 70_000 },
        },
      },
    ],
  },
  {
    info: {
      id: "exec-api-3",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-api",
      time: { created: Date.now() - 67_000 },
    },
    parts: [
      { id: "eb5", type: "text", text: "Adding user preferences API with validation..." },
      {
        id: "eb6",
        type: "tool",
        tool: "write_file",
        state: {
          status: "completed",
          input: { path: "src/routes/preferences.ts" },
          output: "File written: src/routes/preferences.ts (65 lines)",
          title: "write_file",
          metadata: {},
          time: { start: Date.now() - 66_000, end: Date.now() - 65_500 },
        },
      },
    ],
  },
  // ── Executor messages for Goal C (RBAC) — just started ──
  {
    info: {
      id: "exec-rbac-1",
      role: "assistant",
      agent: "opencorvus",
      sessionID: "exec-session-rbac",
      time: { created: Date.now() - 40_000 },
    },
    parts: [
      { id: "ec1", type: "text", text: "Reading the existing permission model to understand the role hierarchy..." },
      {
        id: "ec2",
        type: "tool",
        tool: "search_code",
        state: {
          status: "running",
          input: { query: "role permission" },
          title: "search_code",
          metadata: {},
          time: { start: Date.now() - 39_000 },
        },
      },
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
        tasks: [
          {
            task: {
              id: TASK_ID,
              requestID: "req-1",
              request: boardData.task.request,
              status: boardData.task.status,
              time_created: boardData.task.time.created,
              time_updated: Date.now(),
            },
          },
        ],
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
          connection: "keep-alive",
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
    return file
      .exists()
      .then((ok: boolean) =>
        ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }),
      )
  },
})

const serverUrl = `http://127.0.0.1:${server.port}`
console.log(`\n  Mock server: ${serverUrl}`)

// ── Launch browser through the Node sidecar ──

// Set OVERLAY_BENCHMARK_SHOT=1 to run headless and dump screenshots to
// docs/cards-visual/, then exit. Useful for non-interactive verification.
const SHOT_MODE = process.env.OVERLAY_BENCHMARK_SHOT === "1"

const browser = await launchBrowser(["--no-sandbox", "--no-first-run", "--no-default-browser-check"])
const page = await browser.newPage()
await page.setViewportSize({ width: 900, height: 1200 })

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
await page
  .waitForFunction(() => document.querySelector("#connBadge")?.getAttribute("data-status") === "online", {
    timeout: 15_000,
  })
  .catch(() => {
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

// Give the overlay a moment to render the selected task's transcript.
await new Promise((r) => setTimeout(r, 1500))

if (SHOT_MODE) {
  const path = await import("node:path")
  const outDir = path.resolve(new URL("../../../docs/cards-visual/", import.meta.url).pathname.replace(/^\/+/, ""))
  await Bun.$`mkdir -p ${outDir}`.quiet().catch(() => {})

  const overview = path.join(outDir, "benchmark-overview.png")
  await page.screenshot({ path: overview as `${string}.png`, fullPage: true })
  console.log(`  shot → ${overview}`)

  // Expand and screenshot each top-level card (full content, not just header).
  // Plain element.screenshot() gives the bounding box at current scroll
  // position — for tall cards we resize the chat container to fit them.
  const cardCount = await page.$$eval(".card[data-depth='0']", (els) => els.length)
  console.log(`  found ${cardCount} top-level cards`)
  for (let i = 0; i < cardCount; i++) {
    const sel = `.card[data-depth='0']:nth-of-type(${i + 1})`
    // Click header if collapsed so child content renders.
    await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null
      if (el && !el.classList.contains("card--expanded")) {
        const head = el.querySelector(".card__head") as HTMLElement | null
        head?.click()
      }
      el?.scrollIntoView()
    }, sel)
    await new Promise((r) => setTimeout(r, 100))
    const handle = await page.$(sel)
    if (!handle) continue
    const out = path.join(outDir, `benchmark-card-${i + 1}.png`)
    await handle.screenshot({ path: out as `${string}.png` })
    console.log(`  shot → ${out}`)
  }

  // Scroll the chat container to top so all cards are visible from the start.
  await page.evaluate(() => {
    const c = document.querySelector("#chatScroll, .chat-scroll") as HTMLElement | null
    if (c) c.scrollTop = 0
  })
  await new Promise((r) => setTimeout(r, 200))

  // Whole conversation container as one tall image (full scrollHeight).
  const chat = await page.$("#chatScroll, .chat-scroll")
  if (chat) {
    const out = path.join(outDir, "benchmark-chat.png")
    await chat.screenshot({ path: out as `${string}.png` })
    console.log(`  shot → ${out}`)
  }

  // Diagnostic: also dump scroll vs visible heights to find the squeeze.
  const goalDiag = await page.$$eval(".card[data-kind='goal']", (els) =>
    els.map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const cs = getComputedStyle(el)
      const parent = (el as HTMLElement).parentElement!
      const pCS = getComputedStyle(parent)
      return {
        title: el.querySelector(".card__title")?.textContent?.trim(),
        clientH: (el as HTMLElement).clientHeight,
        scrollH: (el as HTMLElement).scrollHeight,
        offsetH: (el as HTMLElement).offsetHeight,
        rectH: Math.round(r.height),
        cssHeight: cs.height,
        cssMaxH: cs.maxHeight,
        parentDisplay: pCS.display,
        parentGridRows: pCS.gridTemplateRows,
        parentAlign: pCS.alignItems,
      }
    }),
  )
  console.log("\n  goal card diag:", JSON.stringify(goalDiag, null, 2))

  // Diagnostic: dump the card tree structure with rect dimensions.
  const tree = await page.$$eval(".card", (els) =>
    els.map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const cs = getComputedStyle(el)
      const body = el.querySelector(":scope > .card__body") as HTMLElement | null
      const bodyR = body?.getBoundingClientRect()
      const bodyCS = body ? getComputedStyle(body) : null
      return {
        depth: (el as HTMLElement).dataset.depth,
        kind: (el as HTMLElement).dataset.kind,
        stage: (el as HTMLElement).dataset.stage,
        status: (el as HTMLElement).dataset.status,
        title: el.querySelector(".card__title")?.textContent?.trim(),
        childCardCount: el.querySelectorAll(":scope > .card__body .card").length,
        expanded: el.classList.contains("card--expanded"),
        w: Math.round(r.width),
        h: Math.round(r.height),
        overflow: cs.overflow,
        bodyH: bodyR ? Math.round(bodyR.height) : "no-body",
        bodyOverflow: bodyCS?.overflow ?? "n/a",
        bodyMaxH: bodyCS?.maxHeight ?? "n/a",
      }
    }),
  )
  console.log("\n  card tree (depth/kind/stage/status/title/childCardCount):")
  for (const t of tree) {
    console.log(
      `    ${"  ".repeat(Number(t.depth))}d=${t.depth} ${t.kind}/${t.stage} [${t.status}] "${t.title}" ch=${t.childCardCount} ${t.w}x${t.h} exp=${t.expanded} bodyH=${t.bodyH} bodyOv=${t.bodyOverflow} bodyMaxH=${t.bodyMaxH}`,
    )
  }

  await browser.close()
  server.stop()
  process.exit(0)
}

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
