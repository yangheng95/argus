#!/usr/bin/env bun
/**
 * Gateway visual loop — captures Gateway surface screenshots across the
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
 *   • drives the overlay through the Gateway page-mode transitions and
 *     captures one PNG per surface state under
 *     `tmp/gateway-visual-loop/<state>.png`.
 *
 * Usage:
 *   bun run packages/overlay/test/gateway-visual-loop.ts [out_dir]
 *
 * Exit code: 0 on full success, non-zero on any captured failure.
 * The script writes a `summary.json` next to the PNGs describing each
 * state's pass/fail status + the absolute path captured.
 */

import { spawn, type Subprocess } from "bun"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer-core"
import { findBrowserExecutable } from "../../opencorvus/src/delivery/checks/visual"

const OVERLAY_ROOT = path.resolve(__dirname, "..")
const OUT_DIR_ARG = process.argv[2]
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? path.join(tmpdir(), "gateway-visual-loop"))
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

async function waitForVite(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${VITE_PORT}/`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`gateway-visual-loop: vite dev did not respond on :${VITE_PORT} within ${timeoutMs}ms`)
}

async function startVite(): Promise<Subprocess> {
  // Spawn vite as a detached subprocess so we own the PID; we still tree-kill
  // it explicitly during cleanup because Bun.spawn.kill() on Windows only
  // hits the immediate child (bun wrapper), not the vite/node grandchild.
  const proc = spawn({
    cmd: ["bun", "run", "--cwd", OVERLAY_ROOT, "dev:vite"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  return proc
}

function treeKill(pid: number): void {
  // Windows: taskkill -F -T tears down the whole process tree, which is the
  // only reliable way to stop vite when bun wraps it (bun → node → vite).
  // Other platforms: SIGKILL via process.kill — bun's subprocess.kill()
  // already propagates to the group in POSIX.
  if (!pid) return
  if (process.platform === "win32") {
    try {
      spawn({ cmd: ["taskkill", "/F", "/T", "/PID", String(pid)], stdout: "ignore", stderr: "ignore" })
    } catch {}
    return
  }
  try { process.kill(-pid, "SIGKILL") } catch {}
  try { process.kill(pid, "SIGKILL") } catch {}
}

async function isPortBound(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function killPort(port: number): Promise<void> {
  // Defensive: even with treeKill, the previous run can leave a vite
  // listener bound if Bun crashed before cleanup. Read netstat and kill
  // anything still attached to the port so the next run is not blocked.
  if (process.platform !== "win32") return
  try {
    const proc = spawn({ cmd: ["netstat", "-ano"], stdout: "pipe" })
    const text = await new Response(proc.stdout).text()
    const pids = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue
      const cols = line.trim().split(/\s+/)
      const pid = cols[cols.length - 1]
      if (/^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try { spawn({ cmd: ["taskkill", "/F", "/T", "/PID", pid], stdout: "ignore", stderr: "ignore" }) } catch {}
    }
  } catch {}
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
    // Only intercept opencorvus server calls — vite assets pass through.
    if (!/:(7878)|\/(gateway|task|channel|global|config|workspace|session)\b/.test(url)) {
      return req.continue()
    }
    const method = req.method().toUpperCase()
    const ok = (body: unknown) =>
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    const fail = (status: number, message: string) =>
      req.respond({ status, contentType: "application/json", body: JSON.stringify({ error: message }) })

    if (/\/gateway\/stats/.test(url) && method === "GET") {
      const force = await page.evaluate(() => (window as unknown as { __statsForceError?: string }).__statsForceError)
      if (force) return void fail(500, force)
      return void ok(STATS_OK)
    }
    if (/\/gateway\/capabilities/.test(url) && method === "GET") return void ok({ surface: "gateway", actions: [] })
    if (/\/gateway\/task\/decompose/.test(url) && method === "POST") return void ok(DECOMPOSE_FIXTURE)
    if (/\/channel\/runtime$/.test(url) && method === "GET") return void ok(CHANNEL_RUNTIME_OK)
    if (/\/channel\/runtime\/restart/.test(url) && method === "POST") return void ok(CHANNEL_RUNTIME_OK)
    if (/\/channel\b/.test(url) && method === "GET") return void ok(CHANNELS_OK)
    if (/\/task\/[^/]+\/bindings/.test(url) && method === "GET") return void ok(TASK_BINDINGS_FIXTURE)
    if (/\/global\/tasks/.test(url) && method === "GET") return void ok({ tasks: GLOBAL_TASKS, summary: null })
    if (/\/config\/locale/.test(url)) return void ok({ locale: "zh-CN" })
    if (/\/config\/settings/.test(url) && method === "GET") return void ok(SETTINGS_FIXTURE)
    if (/\/session\/me/.test(url)) return void ok(SESSION_FIXTURE)
    // Default: empty 200 — keep the overlay from oscillating retries while
    // visual capture is in progress.
    return void ok({})
  })
}

async function bootstrapOverlay(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  // Give SolidJS enough time to settle its first render + theme cascade.
  await page.waitForSelector("body", { timeout: 10_000 })
  await page.waitForFunction(() => {
    return !!document.body && document.body.getAttribute("data-theme") !== null
  }, { timeout: 10_000 }).catch(() => undefined)
  // Apply the fixture directory + switch into Gateway mode via the
  // app-store helpers the overlay deliberately exposes on `window` for
  // headed automation (matches the existing benchmark scripts).
  await page.evaluate((directory: string) => {
    const w = window as unknown as {
      applyDirectory?: (dir: string, opts: { save: boolean; temp: boolean; restoreWorkspace: boolean }) => void
      setPageMode?: (mode: "panel" | "gateway") => void
    }
    try {
      w.applyDirectory?.(directory, { save: false, temp: true, restoreWorkspace: false })
    } catch {}
    try {
      w.setPageMode?.("gateway")
    } catch {}
    // The setPageMode helper may not be on window — fall back to a
    // store-side toggle through the body data attribute. The Gateway
    // CSS keys on `body[data-page-mode="gateway"]`, so flipping that
    // attribute force-flips the visible surface even if the helper is
    // unavailable.
    document.body.setAttribute("data-page-mode", "gateway")
  }, FIXTURE_DIR)
  await new Promise((r) => setTimeout(r, 600))
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
      document.body.setAttribute("data-page-mode", "gateway")
    })
    await new Promise((r) => setTimeout(r, 400))
  })

  await step("02-ledger-loaded", async () => {
    // Trigger loadTasks via window helper if available.
    await page.evaluate(() => {
      const w = window as unknown as { loadTasks?: () => Promise<void> | void }
      try { void w.loadTasks?.() } catch {}
    })
    await new Promise((r) => setTimeout(r, 800))
  })

  await step("03-selected-active-task", async () => {
    await page.evaluate(() => {
      const w = window as unknown as { selectTask?: (id: string) => Promise<void> | void }
      try { void w.selectTask?.("task_active_payment") } catch {}
    })
    await new Promise((r) => setTimeout(r, 700))
  })

  await step("04-composer-open", async () => {
    const composeBtn = await page.$('[data-ui="gateway-new-requirement"]')
    if (composeBtn) await composeBtn.click()
    await new Promise((r) => setTimeout(r, 350))
  })

  await step("05-proposal-preview", async () => {
    await page.evaluate((requirement: string) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-ui="gateway-composer-input"]')
      if (input) {
        input.value = requirement
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }, DECOMPOSE_FIXTURE.requirement)
    const submit = await page.$('[data-ui="gateway-composer-submit"]')
    if (submit) await submit.click()
    // Composer awaits the mock decompose — give it room to render.
    await new Promise((r) => setTimeout(r, 900))
  })

  // Narrow-breakpoint capture — flip viewport, dismiss proposal so the
  // ledger is the front surface, then snap. Keeps the helper signature
  // consistent (state + side effects only).
  try {
    const discard = await page.$('[data-ui="gateway-proposal-discard"]')
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
    const refresh = await page.$('[data-ui="gateway-refresh"]')
    if (refresh) await refresh.click()
    await new Promise((r) => setTimeout(r, 700))
  })

  return results
}

async function run(): Promise<void> {
  await ensureOutDir()
  const summaryPath = path.join(OUT_DIR, "summary.json")

  console.log(`[gateway-visual-loop] outDir=${OUT_DIR}`)
  // Detect an externally-managed vite dev (e.g. a long-running background
  // shell started by the operator before this loop). Re-using that
  // instance keeps subsequent rounds cheap (no 30s startup tax) and
  // avoids fighting Windows for port :5173 ownership. If nothing is on
  // the port we own the vite lifecycle ourselves.
  const externalVite = await isPortBound(VITE_PORT)
  let vite: Subprocess | undefined
  if (externalVite) {
    console.log(`[gateway-visual-loop] reusing external vite on :${VITE_PORT}`)
  } else {
    console.log(`[gateway-visual-loop] starting vite dev on :${VITE_PORT}`)
    vite = await startVite()
  }
  let browser: Browser | undefined
  const cleanup = async () => {
    try { await browser?.close() } catch {}
    if (vite) {
      treeKill(vite.pid ?? 0)
      // Final sweep in case the wrapper bun PID does not match what
      // taskkill found via the tree — drains anything still bound to
      // :5173 so the next loop iteration can start vite cleanly. Skip
      // when an external vite owns the port: it's the operator's
      // process, not ours.
      await killPort(VITE_PORT)
    }
  }
  process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)) })
  process.on("SIGTERM", () => { void cleanup().then(() => process.exit(143)) })

  try {
    await waitForVite()
    console.log(`[gateway-visual-loop] vite ready — launching chrome`)
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
    console.log(`[gateway-visual-loop] captured ${results.length - failed.length}/${results.length} states`)
    if (failed.length > 0) {
      console.error(`[gateway-visual-loop] failed states:`, failed)
      process.exitCode = 1
    }
  } catch (err) {
    console.error(`[gateway-visual-loop] fatal:`, err)
    process.exitCode = 2
  } finally {
    await cleanup()
  }
}

await run()
