#!/usr/bin/env bun
/**
 * Mission visual loop — captures Mission surface screenshots across the
 * canonical states the operator sees in production. Built for the double-
 * loop iteration (product-design review + visual-testing review), so each
 * round can re-run the script and feed fresh screenshots to the visual
 * reviewer agent.
 *
 * The script is deliberately self-contained:
 *   • starts the overlay's vite dev server on :5173 (no Tauri shell);
 *   • launches a real Chrome/Edge via puppeteer (rule 25 — NEVER headless
 *     for overlay visual capture);
 *   • intercepts every server-bound HTTP request and returns deterministic
 *     mock payloads, so we don't need the opencorvus sidecar running;
 *   • drives the overlay through the Mission page-mode transitions and
 *     captures one PNG per surface state under
 *     `tmp/mission-visual-loop/<state>.png`.
 *
 * Usage:
 *   bun run packages/overlay/test/mission-visual-loop.ts [out_dir]
 *
 * Exit code: 0 on full success, non-zero on any captured failure.
 * The script writes a `summary.json` next to the PNGs describing each
 * state's pass/fail status + the absolute path captured.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer-core"
import { findBrowserExecutable } from "../../opencorvus/src/browser/runtime"

const OUT_DIR_ARG = process.argv[2]
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? path.join(tmpdir(), "mission-visual-loop"))
const VITE_PORT = 5173
const VIEWPORT_WIDE = { width: 1440, height: 900 }
const VIEWPORT_NARROW = { width: 900, height: 720 }

// ── Fixture data the mock server returns ─────────────────────────────
//
// Kept in one place so a reviewer can audit the entire reproducible
// state without spelunking through individual route handlers.

const FIXTURE_DIR = "/Users/operator/projects/orion-platform"

const STATS_OK = {
  generatedAt: Date.now(),
  project: { id: "orion", name: "Orion Platform", worktree: FIXTURE_DIR, directory: FIXTURE_DIR },
  tasks: {
    total: 7,
    status: { active: 1, queued: 2, waiting: 1, failed: 1, completed: 2 },
    summary: null,
    recent: [
      { id: "task_active_payment", title: "Refactor checkout payment service", status: "active", priority: "high", directory: FIXTURE_DIR, updated: Date.now() - 30_000 },
      { id: "task_queue_locale", title: "Wire i18n for invoice templates", status: "queued", priority: "normal", directory: FIXTURE_DIR, updated: Date.now() - 120_000 },
      { id: "task_queue_perf", title: "Investigate panel render latency on cold boot", status: "queued", priority: "normal", directory: FIXTURE_DIR, updated: Date.now() - 200_000 },
      { id: "task_waiting_oauth", title: "Slack OAuth: pending operator confirmation", status: "waiting", priority: "critical", directory: FIXTURE_DIR, updated: Date.now() - 240_000 },
      { id: "task_failed_migration", title: "Drizzle migration to embedded SQLite", status: "failed", priority: "high", directory: FIXTURE_DIR, updated: Date.now() - 360_000 },
      { id: "task_completed_design", title: "Design tokens — flat redesign step 9", status: "completed", priority: "normal", directory: FIXTURE_DIR, updated: Date.now() - 600_000 },
      { id: "task_completed_docs", title: "Docs: orchestrator gating", status: "completed", priority: "low", directory: FIXTURE_DIR, updated: Date.now() - 720_000 },
    ],
  },
  capabilities: { total: 14, queries: 8, mutations: 6 },
  channelRuntime: { running: true, status: "running", channels: ["slack", "discord", "github"], detail: "Tunnel healthy — 3 channels bound" },
}

const STATS_ERROR_MESSAGE = "DirectoryRequiredError: gateway/stats requires ?directory= query param"

const CHANNELS_OK = [
  { id: "slack", name: "Slack", summary: "Routed channel #orion-ops bound to operator org", status: "configured", runtime_status: "running" },
  { id: "discord", name: "Discord", summary: "Guild orion-platform — bot user OrionGate", status: "configured", runtime_status: "running" },
  { id: "github", name: "GitHub Issues", summary: "Repo orion-eng/orion — webhook secret missing", status: "partial", runtime_status: "running", runtime_detail: "Webhook secret unset; inbound dispatch disabled" },
  { id: "telegram", name: "Telegram", summary: "Not yet configured", status: "missing", runtime_status: "stopped" },
]

const CHANNEL_RUNTIME_OK = {
  status: "running",
  detail: "Channel supervisor healthy — last heartbeat 4s ago",
  channels: ["slack", "discord", "github"],
  logs: [],
  running: true,
}

const TASK_BINDINGS_FIXTURE = [
  { id: "bind_slack_orion_ops", task_id: "task_active_payment", platform: "slack", channel: "#orion-ops", thread: "1716321023.0001" },
  { id: "bind_discord_orion_dev", task_id: "task_active_payment", platform: "discord", channel: "general", thread: "thread-001" },
]

const GLOBAL_TASKS = STATS_OK.tasks.recent.map((row) => ({
  task: {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    directory: row.directory,
    executor: row.id === "task_active_payment" ? "codex" : row.id === "task_completed_docs" ? "claude-code" : undefined,
    time: { created: (row.updated ?? Date.now()) - 1_800_000, updated: row.updated ?? Date.now() },
    queue: row.status === "queued" ? { order: row.id === "task_queue_locale" ? 1 : 2 } : undefined,
  },
  overview: { headline: row.id === "task_active_payment" ? "Checkout payments refactor — chasing PCI scope cut" : "" },
  interactions: row.status === "waiting"
    ? [{ id: `${row.id}_int_1`, type: "approval", status: "pending", prompt: "Confirm rotating Slack signing secret before next deploy" }]
    : [],
}))

const DECOMPOSE_FIXTURE = {
  proposal_id: "prop_visual_demo",
  requirement: "Tighten the gateway empty states and align decomposition copy with the design language guide.",
  summary: "Three tactical tasks: prune redundant copy on the composer, surface design-token violations as inline warnings, and add a focus-trap on the proposal review modal.",
  tasks: [
    {
      id: "cand_copy_alignment",
      title: "Audit gateway composer + proposal copy for tone parity",
      description: "Walk every visible string in the composer and proposal flows. Cross-check against zh-CN.json and en-US.json for tone parity, replace ambiguous verbs, and run the panel-revision bump if any visible label changes.",
      acceptance: [
        "All composer / proposal labels match the operator-tone glossary in docs/product/zh-CN/index.md",
        "panel_revision bumped via script/bump-panel-revision.ts",
        "Snapshot test packages/overlay/test/gateway-component.test.ts updated with new copy assertions",
      ],
      priority: "normal",
      executor: "claude-code",
      recommended_queue: false,
      dependencies: [],
      risks: ["Translation drift if zh-CN and en-US diverge mid-flight"],
    },
    {
      id: "cand_token_audit",
      title: "Surface design-token violations on gateway surfaces",
      description: "Add a build-time lint that lists hex / rgba / bare-px / bare-duration literals in styles/surfaces/gateway*.css and fails CI with line-precise hints.",
      acceptance: [
        "New script packages/overlay/script/check-design-tokens.ts wired into typecheck",
        "Coverage test for gateway.css extends flat-redesign-color-literal-coverage",
        "Documentation in docs/product/zh-CN/concepts/architecture.md gains the lint pointer",
      ],
      priority: "high",
      executor: "codex",
      recommended_queue: true,
      dependencies: [],
      risks: ["Lint may flag legacy values that need cascade fixes first"],
    },
    {
      id: "cand_proposal_focus",
      title: "Add focus trap and Esc-to-close to GatewayProposalReview",
      description: "The proposal review currently floats inside the workbench column without a focus trap; tab cycles out into the ledger column and Esc does nothing.",
      acceptance: [
        "Tab cycle stays inside .gateway-proposal until the operator chooses Discard or Create",
        "Esc closes the proposal via onDiscard (after a confirm if any candidate is included)",
        "New gateway-proposal-component.test.ts covers both paths",
      ],
      priority: "normal",
      executor: "claude-code",
      recommended_queue: false,
      dependencies: ["cand_copy_alignment"],
      risks: ["Focus trap must not steal focus when the composer collapses to empty state"],
    },
  ],
}

const SETTINGS_FIXTURE = {
  directory: FIXTURE_DIR,
  serverUrl: `http://127.0.0.1:7878`,
  pageMode: "panel",
  theme: "dark",
  locale: "zh-CN",
}

const SESSION_FIXTURE = { username: "operator", authenticated: true }

// ── Helpers ──────────────────────────────────────────────────────────

async function ensureOutDir(): Promise<string> {
  await mkdir(OUT_DIR, { recursive: true })
  return OUT_DIR
}

async function isPortBound(port: number): Promise<boolean> {
  // Vite on Windows defaults to binding ::1 (IPv6 localhost) only —
  // a fetch against the bare IPv4 literal returns ECONNREFUSED even
  // though netstat shows the port LISTENING. Try the hostname and
  // both literals so we don't mis-report vite as down.
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    try {
      const res = await fetch(`http://${host}:${port}/`)
      if (res.ok || res.status < 500) return true
    } catch {}
  }
  return false
}

async function applyMocks(page: Page): Promise<void> {
  // Page-level "force this route to error" toggle. The reviewer agent can
  // flip this from inside page.evaluate() so error states sit on a real
  // failed fetch, not a hand-rolled fake DOM. Read inside the interceptor
  // so the latest value wins across refresh clicks.
  await page.evaluateOnNewDocument(() => {
    ;(window as unknown as { __statsForceError?: string }).__statsForceError = undefined
  })
  await page.setRequestInterception(true)
  page.on("request", async (req: HTTPRequest) => {
    const url = req.url()
    // Only intercept opencorvus server calls. The previous regex also
    // matched any vite-served URL whose path contained "mission" /
    // "channel" / etc. (e.g. /src/services/mission.ts) and responded
    // with JSON, which Chrome rejected with "Expected a JS module …"
    // and bricked overlay init. Pin interception to the opencorvus
    // sidecar port so vite source assets always pass through.
    if (!/:7878\//.test(url)) {
      return req.continue()
    }
    const method = req.method().toUpperCase()
    // Vite serves the overlay at :5173 but the overlay's apiJson hits
    // :7878 directly, so every mocked response must wear the CORS
    // headers Chrome demands from a cross-origin fetch. We also have
    // to honour OPTIONS preflight before any real method lands.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    if (method === "OPTIONS") {
      return void req.respond({ status: 204, headers: corsHeaders })
    }
    const ok = (body: unknown) =>
      req.respond({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify(body),
      })
    const fail = (status: number, message: string) =>
      req.respond({
        status,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({ error: message }),
      })
    const eventStream = () =>
      req.respond({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-cache",
        },
        body: "event: connected\ndata: {}\n\n",
      })

    if (/\/global\/health/.test(url) && method === "GET") {
      // Connection probe — overlay's connection.ts:149 expects
      // `{ paths: { database, data, home } }`. Anything else and
      // checkConnection() returns false, which keeps the Workspace-
      // Required modal pinned on top and the Mission invisible behind it.
      return void ok({
        ok: true,
        paths: {
          database: "/tmp/mission-loop/global.db",
          data: "/tmp/mission-loop/data",
          home: "/tmp/mission-loop",
        },
      })
    }
    if (/\/skill\/installed/.test(url) && method === "GET") return void ok([])
    if (/\/skill\/market/.test(url) && method === "GET") return void ok([])
    if (/\/mcp\b/.test(url) && method === "GET") return void ok({})
    if (/\/task\/events/.test(url) && method === "GET") return void eventStream()
    if (/\/global\/tasks/.test(url) && method === "GET") return void ok({ tasks: GLOBAL_TASKS, summary: null })
    if (/\/gateway\/stats/.test(url) && method === "GET") {
      const force = await page.evaluate(() => (window as unknown as { __statsForceError?: string }).__statsForceError)
      if (force) return void fail(500, force)
      return void ok(STATS_OK)
    }
    if (/\/gateway\/capabilities/.test(url) && method === "GET") return void ok({ surface: "gateway", actions: [] })
    if (/\/mission(?:\?|$)/.test(url) && method === "GET") {
      return void ok([
        {
          missionID: "mission_visual_demo",
          sessionID: "session_mission_visual",
          title: "Mission Control",
          directory: "/workspace/mission-demo",
          created: Date.now() - 3_600_000,
          updated: Date.now() - 120_000,
        },
        {
          missionID: "mission_visual_audit",
          sessionID: "session_mission_audit",
          title: "Audit Mission",
          directory: "/workspace/mission-audit",
          created: Date.now() - 7_200_000,
          updated: Date.now() - 240_000,
        },
      ])
    }
    // The Mission launcher POSTs /mission/wake (was the gateway decompose
    // route). It returns the new/resumed mission + session ids.
    if (/\/mission\/wake/.test(url) && method === "POST") return void ok({ missionID: "mission_visual_demo", sessionID: "session_mission_visual", created: true })
    if (/\/session\/session_mission_visual\/conversation/.test(url) && method === "GET") {
      return void ok({
        board: { kind: "session", sessionID: "session_mission_visual", status: "active", title: "Mission Control", directory: "/workspace/mission-demo" },
        transcript: [
          {
            info: {
              id: "msg_mission_visual_history",
              sessionID: "session_mission_visual",
              role: "assistant",
              agent: "mission",
              resolvedRole: "mission",
              channel: "mission",
              time: { created: Date.now() - 90_000 },
            },
            parts: [
              {
                id: "part_mission_visual_history",
                messageID: "msg_mission_visual_history",
                sessionID: "session_mission_visual",
                type: "text",
                text: "Mission history loaded from the selected record.",
              },
            ],
          },
        ],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: ["session_mission_visual"], sessions: [{ sessionID: "session_mission_visual", kind: "mission" }] },
        agentView: { topLevelSessionIDs: ["session_mission_visual"], sessions: [{ sessionID: "session_mission_visual", kind: "mission" }] },
        history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 0 },
      })
    }
    if (/\/session\/session_mission_visual\/events/.test(url) && method === "GET") return void eventStream()
    if (/\/channel\/runtime$/.test(url) && method === "GET") return void ok(CHANNEL_RUNTIME_OK)
    if (/\/channel\/runtime\/restart/.test(url) && method === "POST") return void ok(CHANNEL_RUNTIME_OK)
    if (/\/channel\b/.test(url) && method === "GET") return void ok(CHANNELS_OK)
    if (/\/task\/[^/]+\/bindings/.test(url) && method === "GET") return void ok(TASK_BINDINGS_FIXTURE)
    // Board detail for the selected task — without this the loadBoard
    // call in store/board.ts:273 hits the default empty 200 and leaves
    // boardStore.board null, which kept the workbench stuck on its
    // empty placeholder even after selectTask fired (round-2 P0-1).
    if (/\/task\/[^/]+\/board/.test(url) && method === "GET") {
      const taskID = decodeURIComponent(url.match(/\/task\/([^/]+)\/board/)?.[1] ?? "")
      const item = GLOBAL_TASKS.find((row) => row.task.id === taskID)
      const summary = item?.task.id === "task_active_payment"
        ? "Refactor focuses on token-level checkout flow. Currently auditing PCI footprint of the legacy adapter."
        : ""
      return void ok({
        task: item?.task ?? null,
        overview: { headline: summary },
        goalWorkflows: item?.task.id === "task_active_payment"
          ? [
              { id: "goal_audit", title: "Audit PCI scope of checkout adapter", status: "completed" },
              { id: "goal_extract", title: "Extract tokenised payment service", status: "running" },
              { id: "goal_replay", title: "Replay PCI-bound transactions in staging", status: "pending" },
            ]
          : [],
        interactions: item?.interactions ?? [],
        lastSequence: 1,
      })
    }
    if (/\/config\/locale/.test(url)) return void ok({ locale: "zh-CN" })
    if (/\/config\/settings/.test(url) && method === "GET") return void ok(SETTINGS_FIXTURE)
    if (/\/session\/me/.test(url)) return void ok(SESSION_FIXTURE)
    // Default: empty 200 — keep the overlay from oscillating retries while
    // visual capture is in progress.
    return void ok({})
  })
}

async function bootstrapOverlay(page: Page): Promise<void> {
  // Surface anything that lands in the page console while we wait for
  // overlay init — without this, a syntax error or thrown import in
  // main.tsx silently turns into "setPageMode never appears" with no
  // hint of why.
  page.on("console", (msg) => {
    const type = msg.type()
    if (type === "error" || type === "warning") {
      console.error(`[overlay/${type}] ${msg.text()}`)
    }
  })
  page.on("pageerror", (err) => {
    console.error(`[overlay/pageerror] ${err.stack || err.message}`)
  })
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown"
    console.error(`[overlay/requestfailed] ${req.method()} ${req.url()} — ${failure}`)
  })
  await page.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  // Wait until main.tsx finishes its async init — that is when both the
  // `applyDirectory` / `setPageMode` window globals exist and the page-mode
  // createEffect is wired. Setting body[data-page-mode] before that effect
  // is established would be overwritten the moment the signal fires, which
  // is exactly the bug round-2 hit (screenshot 01 showed the Panel chrome
  // even though we'd flipped the attribute).
  // Wait for the window-side helpers main.tsx publishes from
  // installGlobalBridges(). We deliberately do NOT wait on
  // __overlayInitSettled — overlay init blocks on workspace / config
  // round-trips that are happy to hang under our mocked transport
  // (capabilities, session, etc.). setPageMode / applyDirectory are
  // installed at module load, well before init's network work, so they
  // are the right "ready" signal for headed visual capture.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      setPageMode?: (mode: "panel" | "mission") => void
      applyDirectory?: unknown
    }
    return typeof w.setPageMode === "function" && typeof w.applyDirectory === "function"
  }, { timeout: 20_000 })
  // Apply the fixture directory + switch into Mission mode via the
  // app-store helpers the overlay deliberately exposes on `window`
  // for headed automation.
  await page.evaluate((directory: string) => {
    const w = window as unknown as {
      applyDirectory: (dir: string, opts: { save: boolean; temp: boolean; restoreWorkspace: boolean }) => void
      setPageMode: (mode: "panel" | "mission") => void
    }
    w.applyDirectory(directory, { save: false, temp: true, restoreWorkspace: false })
    w.setPageMode("mission")
  }, FIXTURE_DIR)
  // One frame for the page-mode createEffect to write body[data-page-mode]
  // and for Mission's createResource bindings (gateway/stats infra endpoint,
  // channel, bindings) to fire their mocked requests.
  await page.waitForFunction(() => document.body.getAttribute("data-page-mode") === "mission", { timeout: 5_000 })
  await new Promise((r) => setTimeout(r, 800))
}

async function snap(page: Page, state: string, viewport = VIEWPORT_WIDE): Promise<string> {
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  // Let the next layout pass complete after the viewport flip.
  await new Promise((r) => setTimeout(r, 250))
  const fileName = `${state}.png`
  const filePath = path.join(OUT_DIR, fileName)
  await page.screenshot({ path: filePath as `${string}.png`, fullPage: false })
  return filePath
}

type StateResult = { state: string; ok: boolean; path?: string; error?: string }

async function captureStates(page: Page): Promise<StateResult[]> {
  const results: StateResult[] = []

  async function step(state: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
      const filePath = await snap(page, state)
      results.push({ state, ok: true, path: filePath })
    } catch (err) {
      results.push({ state, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await step("01-empty-default-wide", async () => {
    await page.evaluate(() => {
      document.body.setAttribute("data-page-mode", "mission")
    })
    await new Promise((r) => setTimeout(r, 400))
  })

  await step("02-ledger-loaded", async () => {
    await page.waitForSelector('[data-ui="mission-project-group"]', { timeout: 5_000 })
    await page.waitForSelector('[data-ui="mission-row"]', { timeout: 5_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-ui="mission-project-group"]').length >= 2,
      { timeout: 5_000 },
    )
    await page.evaluate(() => {
      const headings = [...document.querySelectorAll<HTMLButtonElement>('[data-ui="mission-project-group"] .project-group-heading')]
      if (headings.length < 2) throw new Error("expected at least two mission project group headings")
      headings[0].click()
    })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-ui="mission-row"]').length === 1,
      { timeout: 5_000 },
    )
    await page.evaluate(() => {
      const heading = document.querySelector<HTMLButtonElement>('[data-ui="mission-project-group"] .project-group-heading')
      if (!heading) throw new Error("mission project group heading missing after collapse")
      heading.click()
    })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-ui="mission-row"]').length === 2,
      { timeout: 5_000 },
    )
    await new Promise((r) => setTimeout(r, 300))
  })

  await step("03-selected-mission", async () => {
    const row = await page.$('[data-ui="mission-row"]')
    if (!row) throw new Error("mission row missing")
    await row.click()
    await page.waitForSelector('[data-ui="mission-conversation"]', { timeout: 5_000 })
    await page.waitForFunction(
      () => document.body.textContent?.includes("Mission history loaded from the selected record."),
      { timeout: 5_000 },
    )
    await new Promise((r) => setTimeout(r, 500))
  })

  await step("04-composer-open", async () => {
    const composeBtn = await page.$('[data-ui="mission-new-requirement"]')
    if (composeBtn) await composeBtn.click()
    await new Promise((r) => setTimeout(r, 350))
  })

  await step("05-launcher-filled", async () => {
    // The decompose-then-review proposal flow was replaced by the Mission
    // launcher (gateway-mission-split-2026-05-28.md §3): a single textarea
    // that POSTs /mission/wake. Capture the filled launcher rather than a
    // proposal preview, which no longer exists.
    await page.evaluate((requirement: string) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-ui="mission-composer-input"]')
      if (input) {
        input.value = requirement
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }, DECOMPOSE_FIXTURE.requirement)
    await new Promise((r) => setTimeout(r, 400))
  })

  // Narrow-breakpoint capture — flip viewport, dismiss the launcher so the
  // ledger is the front surface, then snap. Keeps the helper signature
  // consistent (state + side effects only).
  try {
    const discard = await page.$('[data-ui="mission-composer-discard"]')
    if (discard) await discard.click()
    await new Promise((r) => setTimeout(r, 300))
    const narrowPath = await snap(page, "06-narrow-breakpoint", VIEWPORT_NARROW)
    results.push({ state: "06-narrow-breakpoint", ok: true, path: narrowPath })
  } catch (err) {
    results.push({ state: "06-narrow-breakpoint", ok: false, error: err instanceof Error ? err.message : String(err) })
  }
  await page.setViewport({ ...VIEWPORT_WIDE, deviceScaleFactor: 1 })

  await step("07-error-stats-banner", async () => {
    // The error-state shot is captured by toggling stats to an error
    // response via window.__statsForceError, which the route interceptor
    // (closure-captured below) honours when set. After refresh, the
    // page-level error banner replaces the count chips.
    await page.evaluate((message: string) => {
      ;(window as unknown as { __statsForceError?: string }).__statsForceError = message
    }, STATS_ERROR_MESSAGE)
    const refresh = await page.$('[data-ui="mission-refresh"]')
    if (refresh) await refresh.click()
    await new Promise((r) => setTimeout(r, 700))
  })

  return results
}

async function run(): Promise<void> {
  await ensureOutDir()
  const summaryPath = path.join(OUT_DIR, "summary.json")

  console.log(`[mission-visual-loop] outDir=${OUT_DIR}`)
  // The loop now REQUIRES an externally-managed vite dev (port :5173).
  // Spawning vite from inside a Bun child proved unreliable on Windows
  // (Bun → node → vite tree did not always surface readiness on stdout,
  // and the 60s timeout fired even when vite eventually came up). Keep
  // vite alive in a separate long-running shell — the loop just connects.
  // Fail fast and tell the operator how to fix it if the port is not bound.
  if (!(await isPortBound(VITE_PORT))) {
    throw new Error(
      `mission-visual-loop: vite dev is not listening on :${VITE_PORT}. ` +
      `Start it in a separate shell with ` +
      `\`bun run --cwd packages/overlay dev:vite\` and re-run this script.`,
    )
  }
  console.log(`[mission-visual-loop] connecting to external vite on :${VITE_PORT}`)
  let browser: Browser | undefined
  const cleanup = async () => {
    try { await browser?.close() } catch {}
    // Vite is operator-managed — never kill it from inside the loop.
  }
  process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)) })
  process.on("SIGTERM", () => { void cleanup().then(() => process.exit(143)) })

  try {
    console.log(`[mission-visual-loop] launching chrome`)
    const executablePath = await findBrowserExecutable()
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    })
    const page = await browser.newPage()
    await page.setViewport({ ...VIEWPORT_WIDE, deviceScaleFactor: 1 })
    await applyMocks(page)
    await bootstrapOverlay(page)
    const results = await captureStates(page)
    const summary = {
      generatedAt: new Date().toISOString(),
      outDir: OUT_DIR,
      viewports: { wide: VIEWPORT_WIDE, narrow: VIEWPORT_NARROW },
      results,
    }
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8")
    const failed = results.filter((r) => !r.ok)
    console.log(`[mission-visual-loop] captured ${results.length - failed.length}/${results.length} states`)
    if (failed.length > 0) {
      console.error(`[mission-visual-loop] failed states:`, failed)
      process.exitCode = 1
    }
  } catch (err) {
    console.error(`[mission-visual-loop] fatal:`, err)
    process.exitCode = 2
  } finally {
    await cleanup()
  }
}

await run()
