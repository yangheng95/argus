#!/usr/bin/env bun

// ── Crash Diagnostics ──
// Capture the exact reason and call stack when the process exits unexpectedly.
// Use os.tmpdir() for cross-platform compatibility (avoids /tmp failure on Windows).
const DIAG_LOG = require("node:path").join(require("node:os").tmpdir(), "benchmark-crash-diag.log")
function diagWrite(msg: string) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  try { require("node:fs").appendFileSync(DIAG_LOG, line) } catch {}
  process.stderr.write(line)
}
diagWrite(`benchmark PID=${process.pid} started`)
diagWrite(`diag_log=${DIAG_LOG}`)

// Emergency partial report path — set once reportFile is known, used in exit handler.
// Captures in-flight state when process is killed (OOM, SIGKILL, exit 127, etc.)
// before the normal finally block can run.
let _emergencyReportPath = ""
let _emergencyWritten = false

process.on("exit", (code) => {
  diagWrite(`process.exit event — code=${code}`)
  diagWrite(`stack:\n${new Error("exit-trace").stack}`)
  // Write emergency partial report if the task was running but never completed normally.
  if (_emergencyReportPath && !_emergencyWritten) {
    try {
      require("node:fs").writeFileSync(
        _emergencyReportPath,
        JSON.stringify({
          generated_at: new Date().toISOString(),
          type: "emergency_exit",
          exit_code: code,
          taskID,
          elapsed_ms: Date.now() - marks.startedAt,
          marks,
          last_progress_signature: lastProgressSignature,
          events_captured: events.length,
          last_event_at: lastEventAt,
          last_activity_at: lastActivityLogAt,
        }, null, 2),
      )
    } catch {}
  }
})
process.on("SIGTERM", () => {
  diagWrite(`SIGTERM received PID=${process.pid}`)
  diagWrite(`stack:\n${new Error("sigterm-trace").stack}`)
})
process.on("SIGINT", () => {
  diagWrite(`SIGINT received PID=${process.pid}`)
})
process.on("SIGHUP", () => {
  diagWrite(`SIGHUP received PID=${process.pid}`)
})
process.on("uncaughtException", (err) => {
  diagWrite(`uncaughtException: ${err.message}\n${err.stack}`)
})
process.on("unhandledRejection", (reason) => {
  diagWrite(`unhandledRejection: ${reason instanceof Error ? reason.message + "\n" + reason.stack : String(reason)}`)
})

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import puppeteer, { type Page } from "puppeteer-core"
import { parseSSE } from "../../src/util/sse"
// Inlined from the now-deleted util/activity-timeout (orphan cleanup commit
// a0402f173). Benchmark is the only remaining caller — keeping it local here
// avoids resurrecting a whole module for two uses (rule 26) and avoids a
// shim that would violate rule 22 (dual source).
function inactivityAgeMs(now: number, ...values: Array<number | null | undefined>): number {
  let latest = 0
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > latest) latest = v
  }
  if (latest < 1) return Number.POSITIVE_INFINITY
  return Math.max(0, now - latest)
}
import { auditWorkspace, deriveRunMetrics, evaluateQualityGates, moduleBlocksFromRequest } from "./quality-gates"

// Accept either `--name=value` or `--name value`. The old version quietly
// returned undefined for the space form, which masked typos and mis-quoted
// paths in benchmark invocations — by the time the task ran with a wrong
// default you had no idea a flag was dropped. Any unrecognised top-level
// --flag is surfaced as a hard error at startup (see validateFlags below).
function flag(name: string) {
  const eq = process.argv.find((item) => item.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

// Authoritative list of every CLI flag the benchmark recognises. Anything
// else on the command line is a typo or a dropped/quoted value (e.g.
// `--reference-images "C:/path with space.png"` getting split). We refuse
// to start in that case rather than silently using defaults.
const KNOWN_FLAGS = new Set<string>([
  "--alive-stall-timeout-ms",
  "--completion-hard-timeout-ms",
  "--delivery-verify-cmd",
  "--executor",
  "--max-executor-groups",
  "--max-fix-runs",
  "--max-runs",
  "--planner-max-steps",
  "--planner-timeout-ms",
  "--planning-stall-timeout-ms",
  "--planning-timeout-ms",
  "--project-dir",
  "--reference-images",
  "--report",
  "--request-attachment",
  "--request-file",
  "--request-timeout-ms",
  "--resume-home-dir",
  "--resume-message",
  "--resume-task-id",
  "--spec-max-steps",
  "--spec-timeout-ms",
  "--stall-timeout-ms",
  "--standby-timeout-ms",
  "--task-create-timeout-ms",
  "--task-resume-timeout-ms",
  "--title",
  "--tool-timeout-ms",
  "--figma-url",
  // boolean (no value) switches
  "--no-keep",
  "--skip-local-verify",
  "--no-browser",
])

function validateFlags(): void {
  // process.argv layout: [bun, scriptPath, ...userArgs]
  const userArgs = process.argv.slice(2)
  const unknown: string[] = []
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i]
    if (!arg.startsWith("--")) continue
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg
    if (KNOWN_FLAGS.has(key)) {
      // Skip the value slot for `--name value` form so we don't mistake the
      // value for an unknown flag if it happens to start with "--".
      if (!arg.includes("=") && i + 1 < userArgs.length && !userArgs[i + 1].startsWith("--")) {
        i += 1
      }
      continue
    }
    unknown.push(arg)
  }
  if (unknown.length > 0) {
    const known = [...KNOWN_FLAGS].sort().join("\n  ")
    process.stderr.write(
      `[overlay-benchmark] unknown flag(s): ${unknown.join(" ")}\n` +
      `Known flags:\n  ${known}\n` +
      `Hint: use either --name=value or --name value; quote paths that contain spaces.\n`,
    )
    process.exit(2)
  }
}
validateFlags()

// Two independent stall tiers; whichever fires first aborts the benchmark.
// Neither tier resets on raw text deltas — only on signals that prove the
// task moved (tool call, status change, workflow step transition). This
// keeps the watchdog honest when a model loops in "talking but not acting".
//
// Per-agent guards (decompose 5min progress / 10min absolute, architect 3min,
// design-analyst 5min) fire first on real stalls; this monitor is the backstop
// that catches whatever escapes — so its caps must be tight enough that an
// escaped stall is noticed within a few minutes of the agent guard firing.
//
// --stall-timeout-ms: progress-stall budget after the task enters execution
// (status outside queued/active). Each sub-agent should be making real tool
// calls in this phase — anything longer than 8 min is almost certainly a hang.
const stallTimeoutMs = Number(flag("--stall-timeout-ms")) || 8 * 60 * 1000
// --planning-stall-timeout-ms: stall budget while task status is queued/active.
// Decompose can legitimately take ~5min progress / 10min absolute; pad slightly.
const planningStallTimeoutMs = Number(flag("--planning-stall-timeout-ms")) || 12 * 60 * 1000
// Tier 1 alive stall: the SSE stream is producing nothing at all (not even
// token deltas). This is a connection-level hang, separate from the progress
// stall above. Short by design — if the LLM is truly working we'll see deltas.
const aliveStallTimeoutMs = Number(flag("--alive-stall-timeout-ms")) || 2 * 60 * 1000
const requestTimeoutMs = Number(flag("--request-timeout-ms")) || 30_000
// Legacy: spec/planner timeouts from the old fixed-pipeline architecture.
// Kept for backward compatibility — config may still read these env vars.
const specTimeoutMs = Number(flag("--spec-timeout-ms")) || 24 * 60 * 60 * 1000
const plannerTimeoutMs = Number(flag("--planner-timeout-ms")) || 24 * 60 * 60 * 1000
const toolTimeoutMs = Number(flag("--tool-timeout-ms")) || 10 * 60 * 1000
const standbyTimeoutMs = Number(flag("--standby-timeout-ms")) || 24 * 60 * 60 * 1000
const completionHardTimeoutMs = Number(flag("--completion-hard-timeout-ms")) || 0
// --timeout-ms accepted for backwards compat but no longer drives other timeouts
// Legacy: spec/planner max steps from the old fixed-pipeline architecture.
const specMaxSteps = Number(flag("--spec-max-steps")) || 80
const plannerMaxSteps = Number(flag("--planner-max-steps")) || 96
const maxRuns = Number(flag("--max-runs")) || 20
const maxFixRuns = Number(flag("--max-fix-runs")) || 8
const report = flag("--report")
const keep = !process.argv.includes("--no-keep")
// Resume mode: re-attach to an existing task rather than creating a new one.
// --resume-task-id  : ID of the task to resume (e.g. tsk_xxx)
// --resume-home-dir : opencorvus home directory from the original run (contains the database)
// --resume-message  : user message injected to wake up the failed task
const resumeTaskID = flag("--resume-task-id")
const resumeHomeDir = flag("--resume-home-dir")
const resumeMessage = flag("--resume-message") || "请继续完成项目，修复所有失败的goals并重试，直到全部通过。"
const headless = false
const executor = (flag("--executor") || "opencode") as
  | "opencode"
  | "codex"
  | "claude-code"
const requestFile = flag("--request-file")
const requestAttachment = flag("--request-attachment")
const rawReferenceImages = flag("--reference-images")?.split(",").map(s => s.trim()).filter(Boolean) ?? []
if (requestFile && requestAttachment) {
  process.stderr.write("[overlay-benchmark] cannot pass both --request-file and --request-attachment\n")
  process.exit(2)
}
const figmaUrl = flag("--figma-url")?.trim() || undefined
const deliveryVerifyCmd = flag("--delivery-verify-cmd")
const skipLocalVerify = process.argv.includes("--skip-local-verify")
// `--no-browser` bypasses the puppeteer-driven overlay UI and drives the
// benchmark entirely through HTTP API polling. The downstream code already
// guards every puppeteer call with `if (page)` — this flag activates those
// branches. Useful when the overlay UI is under refactor (07-panel-reactivity.md)
// and we only want to exercise the opencorvus server pipeline end-to-end.
const noBrowser = process.argv.includes("--no-browser")
// Only set task-level budget when explicitly provided via CLI flag.
// Otherwise leave undefined so the task inherits the config-level default (opencorvus.jsonc).
const maxExecutorGroups = flag("--max-executor-groups") ? Number(flag("--max-executor-groups")) : undefined

const DEFAULT_TASK_TITLE = "Overlay Web Benchmark — Baidu Homepage Clone"
const DEFAULT_BAIDU_REFERENCE = path.join(import.meta.dir, "assets", "baidu.png")
// When the caller runs with no custom request/attachment/reference, the default
// Baidu-clone task drives the visual-diff gate using the committed fixture.
const referenceImages = rawReferenceImages.length > 0
  ? rawReferenceImages
  : (!requestFile && !requestAttachment ? [DEFAULT_BAIDU_REFERENCE] : [])
const DEFAULT_TASK_REQUEST = `
Reproduce the Baidu homepage (https://www.baidu.com/) as a pixel-faithful static web clone, delivered as a single \`index.html\` rendered at viewport 1440 × 900. The reference screenshot is attached at references/baidu.png.

## Scope (phase-shaped, not module-shaped)

The deliverable is a single \`index.html\` plus its \`images/\` folder — one primary artifact with one global acceptance surface. Do NOT split hero / nav / footer / search / quick-link regions into separate parallel goals that all keep re-opening the same page shell; that pattern fights this task. Decompose by execution phase instead.

A sensible phase structure (architect may adjust based on exploration):

1. **Reference capture** — extract the live reference into \`mirror/\` using the mirror toolchain (\`webpage_extract\` → \`webpage_compile\` → \`webpage_analyze\`) and commit the artifacts (\`reference.png\`, \`extracted-page.json\`, \`page-ir.xml\`, \`scaffold.json\`, \`design-tokens.ts\`, \`images/\`). Do NOT hand-write colour hex codes, text strings, or section structure when these can be harvested deterministically.

2. **Page shell build-out** — write the consolidated static \`index.html\` in one goal, consuming the mirror artifacts from phase 1 as the authoritative source of structure, text, and tokens. This is the main implementation goal; it should concentrate the markup + styles in one file rather than exposing an internal cross-goal DAG.

3. **Visual fidelity verification** — verification-kind goal. Runs \`webpage_render\` on \`index.html\` at 1440 × 900, then \`webpage_evaluate\` against \`mirror/reference.png\`, and iterates via \`webpage_text_diff\` until SSIM mean ≥ 0.85 and worst-5% window ≥ 0.55.

If exploration reveals a genuine orthogonal subsystem that can ship without re-opening \`index.html\`, architect may split that into its own goal — but the default is phase-serial, single-worktree, single growing artifact.

## Technical rules (apply to every implementation goal)

- **Static HTML only.** NO JavaScript frameworks, NO React/Vue/Babel/JSX, NO client-side rendering. Every visible text node must appear as raw HTML so a non-executing reader sees the content.
- **One external dependency allowed**: Tailwind CDN (https://cdn.tailwindcss.com). Tailwind utility classes plus an inline \`<style>\` block. Nothing else — no other CDNs, no local bundling, no build step.
- **Do not fetch https://www.baidu.com/ at runtime.** The clone must be fully static.
- **Exact text.** Preserve the Chinese strings visible on the reference: top nav "新闻 hao123 地图 贴吧 视频 图片 网盘 更多", submit button "百度一下", footer strings, etc.
- **Exact palette.** Baidu blue #4E6EF2 for the search button and link hovers; white background; 1 px #C8C8C8 search-box border.
- **Viewport.** Target 1440 × 900. The final composed page must look correct at that exact viewport.

## Acceptance (gate)

- Only one deliverable file: \`index.html\` at the project root. The implementation goals may produce intermediate artefacts (component snippets, tokens stylesheet) during their own iteration, but the layout-shell goal is responsible for emitting the single consolidated \`index.html\`.
- Visual-diff gate: SSIM ≥ 0.85 (mean) and ≥ 0.55 (worst-5% window) against references/baidu.png. Runs automatically at delivery.
`.trim()
let TASK_REQUEST = requestFile ? (await Bun.file(path.resolve(requestFile)).text()).trim() : DEFAULT_TASK_REQUEST
// Build base64 attachments from reference images (sent as multimodal vision content)
const TASK_ATTACHMENTS: Array<{ mime: string; data: string; filename: string }> = []

// --request-attachment: upload the file as a real task attachment instead of
// inlining its text into request. Exercises the read-tool attachment-URL path
// so sub-agents (planner, architect, executor) can re-read the source via
// AttachmentStore. The request itself just points the agent at the attachment.
if (requestAttachment) {
  const src = path.resolve(requestAttachment)
  const bytes = await Bun.file(src).arrayBuffer()
  const ext = path.extname(src).toLowerCase().replace(".", "") || "txt"
  const filename = path.basename(src)
  const mime =
    ext === "txt" || ext === "md" || ext === "log" ? "text/plain" :
    ext === "json" ? "application/json" :
    ext === "pdf"  ? "application/pdf"  :
    ext === "html" || ext === "htm" ? "text/html" :
    ext === "csv" ? "text/csv" :
    "application/octet-stream"
  TASK_ATTACHMENTS.push({
    mime,
    data: Buffer.from(bytes).toString("base64"),
    filename,
  })
  console.log(`[overlay-benchmark] request-attachment ${filename} ${mime} ${Math.round(bytes.byteLength / 1024)}KB`)
  TASK_REQUEST =
    `The full task brief is attached as the file "${filename}" (${mime}, ${Math.round(bytes.byteLength / 1024)} KB). ` +
    `It contains the complete requirements, scope, and acceptance criteria — treat it as the authoritative source of truth. ` +
    `Run the standard pipeline (requirements → architect → planner → executor → delivery); the attachment is ` +
    `forwarded automatically to each sub-agent and they will read it via their \`read\` tool when needed.`
}
if (referenceImages.length > 0) {
  for (const img of referenceImages) {
    const src = path.resolve(img)
    try {
      const bytes = await Bun.file(src).arrayBuffer()
      const ext = path.extname(src).toLowerCase().replace(".", "")
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : `image/${ext}`
      TASK_ATTACHMENTS.push({
        mime,
        data: Buffer.from(bytes).toString("base64"),
        filename: path.basename(src),
      })
      console.log(`[overlay-benchmark] attachment ${path.basename(src)} ${mime} ${Math.round(bytes.byteLength / 1024)}KB`)
    } catch (e) {
      console.warn(`[overlay-benchmark] failed to read reference image ${src}: ${e}`)
    }
  }
  // Also note image filenames in the text so agents have context even without vision
  const refLines = referenceImages.map(img => `- ${path.basename(img)}`).join("\n")
  TASK_REQUEST += `\n\n## Reference Images\nThe following reference images are attached as visual input. They show the target UI style:\n${refLines}`
}
const TASK_TITLE = flag("--title")?.trim()
  || (requestFile ? path.parse(requestFile).name : undefined)
  || (requestAttachment ? path.parse(requestAttachment).name : undefined)
  || DEFAULT_TASK_TITLE
// DELIVERY_VERIFY_CMD is assigned after temp.dir is initialized (see below).
// Auto-registration rules when no explicit --delivery-verify-cmd is supplied:
//   1. reference-images provided (default: the bundled Baidu fixture) → visual-diff SSIM gate
//   2. external --request-file with no reference images → no auto-verify
// Fig2code SSIM thresholds (mean 0.85, worst-5% 0.55) come from visual-diff defaults.
let DELIVERY_VERIFY_CMD = ""
// Legacy: TASK_GOALS used the old { description, criteria, priority } format
// to hint the Goal Agent. In the new agent-driven architecture, the Decompose
// Agent infers goals entirely from the request text — no hints needed.

const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."

const FINAL = new Set(["completed", "failed", "cancelled"])
const STREAM_PLACEHOLDERS = new Set(["", "...", "â€¦â€¦", "æ€è€ƒä¸­", "Thinking"])
const DIAG_TYPES = new Set([
  "orchestrator.agent.updated",
  "orchestrator.run.created",
  "orchestrator.run.updated",
  "orchestrator.task.created",
  "orchestrator.task.updated",
  // Legacy spec/plan events — kept for backward compatibility with older traces
  "orchestrator.spec.created",
  "orchestrator.spec.updated",
  "orchestrator.plan.created",
  "orchestrator.plan.activated",
  "orchestrator.interaction.requested",
  "orchestrator.interaction.resolved",
  // Executor events flow through Message — tool calls and text arrive
  // as message.part.updated instead of run.progress/run.output.
  "orchestrator.message.part.updated",
  "orchestrator.message.updated",
  // Per-goal heartbeat from event bridge (bypasses Session→Bus→Bridge chain)
  "orchestrator.goal.progress",
  "orchestrator.goal.passed",
  "orchestrator.goal.failed",
  // Task Agent tool invocations in the new agent-driven architecture
  "orchestrator.goal.created",
  "orchestrator.goal.updated",
])
const PLANNING_VISIBLE_TIMEOUT_MS = Number(flag("--planning-timeout-ms")) || 2 * 60 * 1000
const TASK_CREATE_TIMEOUT_MS = Number(flag("--task-create-timeout-ms")) || 5 * 60 * 1000
const TASK_RESUME_TIMEOUT_MS = Number(flag("--task-resume-timeout-ms")) || 10 * 60 * 1000
const projectDir = flag("--project-dir")
const temp = {
  dir: "",
  home: "",
  config: "",
}

temp.home = resumeHomeDir
  ? path.resolve(resumeHomeDir)
  : await fs.mkdtemp(path.join(os.tmpdir(), "mirrorcode-overlay-benchmark-home-"))
if (resumeTaskID && !projectDir) throw new Error("--resume-task-id requires --project-dir")
temp.dir = projectDir ? path.resolve(projectDir) : await fs.mkdtemp(path.join(os.tmpdir(), "mirrorcode-overlay-benchmark-project-"))
temp.config = path.join(temp.home, "config-override")
process.env.OPENCORVUS_HOME = temp.home
// Copy request file into the project directory so the Task Agent can reference it
if (requestFile) {
  const dest = path.join(temp.dir, path.basename(requestFile))
  await fs.copyFile(path.resolve(requestFile), dest).catch(() => undefined)
}
// Copy reference images into the project directory under references/
if (referenceImages.length > 0) {
  const refDir = path.join(temp.dir, "references")
  await fs.mkdir(refDir, { recursive: true })
  for (const img of referenceImages) {
    const src = path.resolve(img)
    const dest = path.join(refDir, path.basename(src))
    await fs.copyFile(src, dest).catch((e) => console.warn(`[overlay-benchmark] failed to copy reference image ${src}: ${e}`))
  }
}
// Copy real auth.json into temp home so OAuth providers (e.g. github-copilot) work in isolated home
{
  const appData = process.env.APPDATA || process.env.LOCALAPPDATA
  const realDataDir = process.platform === "win32" && appData
    ? path.join(appData, "opencorvus")
    : path.join(os.homedir(), ".local", "share", "opencorvus")
  const realAuth = path.join(realDataDir, "auth.json")
  const tempDataDir = path.join(temp.home, "data")
  await fs.mkdir(tempDataDir, { recursive: true })
  await fs.copyFile(realAuth, path.join(tempDataDir, "auth.json")).catch(() => undefined)
}
const { ensureBenchmarkModel, loadBenchmarkEnv, prepareLocalProviders, resolveBenchmarkModel } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: true })
const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Server } = await import("../../src/server/server")
const { resetDatabase } = await import("../../test/fixture/db")

// Start the HTTP server before anything calls Instance.provide.
// resolveBenchmarkModel / ensureBenchmarkModel / InstanceBootstrap all go
// through Plugin.state, whose initializer reads Server.url(). If the server
// hasn't called listen() yet, Server.url() throws and the provider init
// silently half-completes (missing plugin hooks).
const server = Server.listen({ port: 0, hostname: "127.0.0.1" })

await loadBenchmarkEnv(import.meta.dir)
process.env.OPENCORVUS_CONFIG_DIR = temp.config
await prepareLocalProviders()
const model = await resolveBenchmarkModel(import.meta.dir, {
  allowOpenAICodex: executor === "codex",
})
process.env.OPENCORVUS_BENCHMARK_MODEL = model
await ensureBenchmarkModel(import.meta.dir, model)

process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"
process.env.OPENCORVUS_GOAL_RUN_TIMEOUT_MS = String(standbyTimeoutMs)
// Legacy env vars from old fixed-pipeline architecture — kept for backward
// compatibility as config may still read them during transition.
process.env.OPENCORVUS_SPEC_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_TIMEOUT_MS = String(plannerTimeoutMs)
process.env.OPENCORVUS_SPEC_AGENT_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_AGENT_TIMEOUT_MS = String(plannerTimeoutMs)
process.env.OPENCORVUS_TOOL_TIMEOUT_MS = String(toolTimeoutMs)
process.env.OPENCORVUS_STANDBY_TIMEOUT_MS = String(standbyTimeoutMs)
// Legacy env vars from old fixed-pipeline architecture
process.env.OPENCORVUS_SPEC_AGENT_MAX_STEPS = String(specMaxSteps)
process.env.OPENCORVUS_PLANNER_AGENT_MAX_STEPS = String(plannerMaxSteps)
// Complex replication tasks legitimately need >3 delivery iterations to converge.
// Schema allows up to 10. 6 balances convergence room against total wall time.
process.env.OPENCORVUS_MAX_DELIVERY_ITERATIONS = "6"

console.log(
  `[overlay-benchmark] config model=${model} executor=${executor} groups=${maxExecutorGroups ?? "config-default"} alive-stall=${aliveStallTimeoutMs / 1000}s progress-stall=${stallTimeoutMs / 1000}s planning-progress-stall=${planningStallTimeoutMs / 1000}s tool=${toolTimeoutMs / 1000}s standby=${standbyTimeoutMs === 86400000 ? "∞" : standbyTimeoutMs / 1000 + "s"} request=${requestTimeoutMs / 1000}s hard=${completionHardTimeoutMs > 0 ? completionHardTimeoutMs / 1000 + "s" : "none"}`,
)

// Force-remove SQLite WAL/SHM before reset — prevents previous benchmark's
// uncommitted data from being recovered into the fresh database.
const dbPath = path.join(os.homedir(), ".local", "share", "opencorvus", "opencorvus.db")
await fs.rm(`${dbPath}-wal`, { force: true }).catch(() => {})
await fs.rm(`${dbPath}-shm`, { force: true }).catch(() => {})

if (resumeTaskID) {
  // Resume mode: keep existing database and project state intact.
  // Only ensure the config-override directory exists (server bootstrap needs it).
  await fs.mkdir(temp.config, { recursive: true })
} else {
  await resetDatabase()
  if (!projectDir) {
    await scaffoldProject(temp.dir, model)
  } else {
    // Strip project-level opencorvus state to prevent old task IDs from bleeding into new runs
    await fs.rm(path.join(temp.dir, "opencorvus.json"), { force: true })
    await fs.rm(path.join(temp.dir, ".opencorvus"), { recursive: true, force: true })
    await fs.mkdir(temp.config, { recursive: true })
  }
}
// Re-inject local provider configs after scaffoldProject (which overwrites config-override)
await prepareLocalProviders()

await Instance.provide({
  directory: temp.dir,
  init: InstanceBootstrap,
  fn: async () => {
    await ExecutorBootstrap.autoRegister(true)
  },
})
const browser = noBrowser ? null : await launchBrowser()
let page = browser ? await browser.newPage() : null
if (page) await page.setViewport({ width: 1600, height: 1200 })
// Forward overlay browser console + pageerror events to benchmark stdout.
// Without this the overlay's own `console.error(...)` (including the
// `[sse] dispatch error for event X` introduced to surface tree-writer
// throws that were previously silently swallowed) is invisible to the
// benchmark driver, making every UI-side regression appear as a generic
// `Overlay did not render streamed task output within 120000ms` timeout.
if (page) {
  page.on("console", (msg) => {
    const type = msg.type()
    // Only forward warning+ to avoid log noise from info/debug.
    if (type === "log" || type === "info" || type === "debug") return
    process.stderr.write(`[overlay-console:${type}] ${msg.text()}\n`)
  })
  page.on("pageerror", (err) => {
    process.stderr.write(`[overlay-pageerror] ${err.message}\n${err.stack ?? ""}\n`)
  })
}

const marks = {
  startedAt: Date.now(),
  onlineAt: 0,
  submittedAt: 0,
  planningAt: 0,
  streamingAt: 0,
  createdAt: 0,
  selectedAt: 0,
  boardAt: 0,
  resumedAt: 0,
  completedAt: 0,
}
let taskID = ""
const reportFile = report ? path.resolve(report) : path.join(process.cwd(), `overlay-web-benchmark-report-${Date.now()}.json`)

// Now that temp.dir and reportFile are known, resolve DELIVERY_VERIFY_CMD.
{
  const visualDiffScript = path.join(import.meta.dir, "visual-diff.ts")
  // The verify command is executed through `cmd /c <string>` on Windows, where
  // double-quoted paths get treated as literal characters by `bun.exe`'s argv
  // parser unless the surrounding shell collapses them — and it doesn't,
  // reliably. We only quote a path when it actually contains a space or a
  // shell-significant character; otherwise we hand bare paths to bun.exe.
  // All paths involved here (script dir, project worktree under %TEMP%, the
  // reference image, the output dir) are validated below to ensure they have
  // no spaces; if they ever do, we fall back to single-quoting (works on
  // bash, which we use on macOS/Linux) and document the failure mode.
  const SHELL_SAFE = /^[A-Za-z0-9_.:/\\-]+$/
  const safe = (s: string): string => {
    if (SHELL_SAFE.test(s)) return s
    if (process.platform === "win32") {
      // cmd /c can't escape inner double quotes safely. We can only
      // round-trip paths that lack whitespace and metacharacters; bail loudly
      // rather than emit a command that will silently mangle.
      throw new Error(
        `[overlay-benchmark] cannot safely embed path in cmd /c command line: ${s}\n` +
        `Move the file to a path without spaces or shell metacharacters.`,
      )
    }
    return `'${s.replace(/'/g, "'\\''")}'`
  }
  const buildVisualDiffCmd = (ref: string) => {
    const visualOut = path.join(path.dirname(reportFile), path.basename(reportFile, ".json") + ".visual-diff-out")
    return `bun run ${safe(visualDiffScript)} --rendered-dir=${safe(temp.dir)} --reference=${safe(path.resolve(ref))} --out=${safe(visualOut)}`
  }
  DELIVERY_VERIFY_CMD = skipLocalVerify
    ? ""
    : (deliveryVerifyCmd?.trim()
      || (referenceImages.length > 0 ? buildVisualDiffCmd(referenceImages[0]) : ""))
  if (DELIVERY_VERIFY_CMD) {
    console.log(`[overlay-benchmark] delivery_verify_cmd=${DELIVERY_VERIFY_CMD}`)
  }
}
_emergencyReportPath = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".emergency.json"
  : `${reportFile}.emergency.json`
const eventFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.json"
  : `${reportFile}.events.json`
const eventLogFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.ndjson"
  : `${reportFile}.events.ndjson`
const events: Array<Record<string, unknown>> = []
let flushed = Promise.resolve()
let lastEventAt = Date.now()
let lastProgressAt = Date.now()
// Progress-event clock: advanced only by chunks that prove the task is
// actually moving (tool_call/tool_result/status + orchestrator.task.updated,
// goal.progress, run.updated) — NOT by raw delta traffic. Without this tier
// a model stuck in a tool-call retry loop would keep both the event and the
// progress clock "alive" (both reset by every delta) and never stall.
let lastProgressEventAt = Date.now()
let lastProgressSignature = ""
let lastLogAt = Date.now()
let lastActivityLogAt = Date.now()
let lastHeartbeatAt = 0
let lastActivityLine = ""
// Terminal signal — resolved by onEvent when orchestrator.task.updated carries
// a FINAL status (completed/failed/cancelled). waitForFinal races its 2s sleep
// against this promise so the poll loop exits immediately on failure instead of
// waiting for the next 2s poll tick — and sets terminalReached=true so stall
// checks are suppressed while the progress endpoint catches up.
let terminalSignalResolver: (() => void) | null = null
let terminalReached = false
let planning: any = null
let streaming: any = null
let board: any = null
let progress: any = null
let finalBoard: any = null
let transcript: any = null
let timeline: any = null
let runs: any = null

function logLine(value: string) {
  lastLogAt = Date.now()
  console.log(value)
}

function activityLine(value: string) {
  lastActivityLogAt = Date.now()
  lastLogAt = lastActivityLogAt
  console.log(value)
}

function errorLine(value: string) {
  lastLogAt = Date.now()
  console.error(value)
}

function formatEventLine(entry: {
  type: string
  kind: string
  stage: string
  status: string
  progressType: string
  summary: string
  text: string
  toolName: string
  goalRunID: string
}) {
  // message.part.updated / message.updated fire on every token chunk during
  // streaming — printing each one floods stdout and obscures real milestones.
  // Drop them entirely; the SSE counters + per-stage logs already capture
  // progress at a higher signal level. A tool call kicking off shows up via
  // the dedicated "tool=" path below.
  if (entry.type === "orchestrator.message.part.updated" || entry.type === "orchestrator.message.updated") {
    return ""
  }
  // Architect contracts: show category + spec excerpt for tool_result
  if (entry.stage === "architect" && entry.kind === "tool_result" && entry.toolName === "register_contract") {
    const content = entry.text || entry.summary
    return `[overlay-benchmark] architect contract registered: ${clipText(content, 300)}`
  }
  if (entry.stage === "architect" && entry.kind === "status") {
    return `[overlay-benchmark] architect ${clipText(entry.summary || entry.status, 120)}`
  }
  // Plan: show plan summary when plan is created or activated
  if (entry.type === "orchestrator.plan.created" || entry.type === "orchestrator.plan.activated") {
    const detail = entry.summary || entry.text
    return `[overlay-benchmark] event=${entry.type.replace("orchestrator.", "")}${detail ? ` detail=${clipText(detail, 240)}` : ""}`
  }
  const summary = entry.summary || entry.text
  const parts = [
    `[overlay-benchmark] event=${entry.type.replace("orchestrator.", "")}`,
    entry.stage ? `stage=${entry.stage}` : "",
    entry.status ? `status=${entry.status}` : "",
    entry.toolName ? `tool=${entry.toolName}` : "",
    entry.goalRunID ? `goalRun=${entry.goalRunID}` : "",
    summary ? `detail=${clipText(summary, 180)}` : "",
  ].filter(Boolean)
  return parts.join(" ")
}

function eventValue(payload: Record<string, unknown>, props: Record<string, unknown>, key: string) {
  const value = payload[key]
  if (typeof value === "string") return value
  const next = props[key]
  return typeof next === "string" ? next : ""
}

function normalizeEvent(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("type" in payload)) return
  const item = payload as Record<string, unknown>
  const rawType = String(item.type || "")
  if (!rawType) return
  const type = rawType.startsWith("orchestrator.") ? rawType : `orchestrator.${rawType}`
  if (!DIAG_TYPES.has(type)) return
  const props =
    item.properties && typeof item.properties === "object"
      ? item.properties as Record<string, unknown>
      : item.payload && typeof item.payload === "object"
        ? item.payload as Record<string, unknown>
        : {}
  return {
    type,
    payload: item,
    props,
  }
}

function topLevelText(item: Record<string, unknown>, key: string) {
  const value = item[key]
  return typeof value === "string" ? value : ""
}

const onEvent = ({ payload }: { payload: unknown }) => {
  // Any parsed SSE frame advances the alive-stall timer. "Alive" means bytes
  // are flowing from the server; whether we log/diagnose the event is a
  // separate concern handled below via DIAG_TYPES. Without this
  // unconditional reset, long-running backend steps that emit only
  // non-diag events (e.g. fidelity.review.started / .progress) would trip
  // the 120s alive cap even while the server is actively working and
  // streaming them over the wire.
  if (payload && typeof payload === "object") {
    lastEventAt = Date.now()
  }
  // LLM delta events (message.part.delta) are ephemeral and high-frequency.
  // They don't produce a log line, but they DO count as progress activity —
  // prevents false stall detection while a reasoning model is generating
  // tokens. (Alive-stall is already reset above; this block also advances
  // the progress-stall timer for part.*.)
  if (payload && typeof payload === "object" && "type" in payload) {
    const rawType = String((payload as any).type ?? "")
    if (rawType === "message.part.delta" || rawType.endsWith(".part.delta") ||
        rawType === "message.part.updated" || rawType.endsWith(".part.updated")) {
      lastActivityLogAt = Date.now()
      lastLogAt = Date.now()
      // message.part.updated carries tool calls — let it through to normalizeEvent
      // for logging, but message.part.delta is too high-frequency to log.
      if (rawType === "message.part.delta" || rawType.endsWith(".part.delta")) return
    }
  }
  const normalized = normalizeEvent(payload)
  if (!normalized) return
  lastEventAt = Date.now()
  const entry = {
    at: new Date().toISOString(),
    elapsed_ms: Date.now() - marks.startedAt,
    type: normalized.type,
    taskID: eventValue(normalized.payload, normalized.props, "taskID"),
    runID: eventValue(normalized.payload, normalized.props, "runID"),
    stage: eventValue(normalized.props, normalized.payload, "stage"),
    kind: eventValue(normalized.props, normalized.payload, "kind") || topLevelText(normalized.payload, "kind"),
    status: eventValue(normalized.props, normalized.payload, "status"),
    toolName: eventValue(normalized.props, normalized.payload, "toolName"),
    summary: clipText(eventValue(normalized.props, normalized.payload, "summary") || topLevelText(normalized.payload, "summary"), 600),
    text: clipText(eventValue(normalized.props, normalized.payload, "text"), 2000),
    progressType: eventValue(normalized.props, normalized.props, "type"),
    goalRunID: eventValue(normalized.payload, normalized.props, "goalRunID"),
  }
  events.push(entry)
  if (entry.type === "orchestrator.task.updated" && FINAL.has(entry.status)) {
    if (!terminalReached) {
      terminalReached = true
      activityLine(`[overlay-benchmark] terminal-signal status=${entry.status} — stall checks suppressed`)
    }
    const resolver = terminalSignalResolver
    terminalSignalResolver = null
    if (resolver) resolver()
  }
  const line = formatEventLine(entry)
  if (line && line !== lastActivityLine) {
    lastActivityLine = line
    activityLine(line)
  }
  // Ensure tool_call/tool_result events always refresh the activity timer
  // even when formatEventLine returns empty (e.g. during evaluation).
  // Prevents false stall detection while evaluator is actively investigating.
  if (!line && (entry.kind === "tool_call" || entry.kind === "tool_result" || entry.kind === "status")) {
    lastActivityLogAt = Date.now()
    lastLogAt = lastActivityLogAt
  }
  // Progress-event tier: advance only on signals that prove the task moved,
  // not on incremental text chunks. Keeps stall detection honest while
  // tolerating slow reasoning models.
  const isProgressKind = entry.kind === "tool_call" || entry.kind === "tool_result" || entry.kind === "status"
  const isProgressType =
    entry.type === "orchestrator.task.updated" ||
    entry.type === "orchestrator.run.updated" ||
    entry.type === "orchestrator.goal.progress" ||
    entry.type === "orchestrator.goal.passed" ||
    entry.type === "orchestrator.goal.failed" ||
    entry.type === "orchestrator.goal.created" ||
    entry.type === "orchestrator.goal.updated" ||
    entry.type === "orchestrator.plan.created" ||
    entry.type === "orchestrator.plan.activated" ||
    entry.type === "orchestrator.interaction.requested" ||
    entry.type === "orchestrator.interaction.resolved"
  if (isProgressKind || isProgressType) {
    lastProgressEventAt = Date.now()
  }
  flushed = flushed
    .then(() => fs.appendFile(eventLogFile, `${JSON.stringify(entry)}\n`))
    .catch(() => undefined)
}

const api = async (pathname: string, init?: RequestInit) => {
  const url = new URL(pathname, server.url)
  url.searchParams.set("directory", temp.dir)
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(url, {
    ...init,
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`)
  return res
}

function subscribeTaskEvents(taskID: string) {
  const stop = new AbortController()
  const signal = stop.signal
  const run = (async () => {
    while (!signal.aborted) {
      const url = new URL(`/task/${taskID}/events`, server.url)
      url.searchParams.set("directory", temp.dir)
      const res = await fetch(url, { signal }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        if (signal.aborted) return
        await Bun.sleep(1000)
        continue
      }
      await parseSSE(res.body, signal, (event) => onEvent({ payload: event })).catch(() => undefined)
      if (!signal.aborted) await Bun.sleep(250)
    }
  })()
  return {
    async stop() {
      stop.abort()
      await run.catch(() => undefined)
    },
  }
}

let eventStream = {
  stop: async () => undefined,
}

try {
  await Bun.write(eventLogFile, "")

  if (page) {
    await page.evaluateOnNewDocument((serverUrl, directory) => {
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", directory)
      localStorage.setItem("oc_directory_mode", "custom")
      localStorage.setItem("oc_workspace_directory", directory)
      localStorage.setItem("oc_unattended", "true")
      localStorage.setItem("oc_auto_permission", "true")
      localStorage.setItem("oc_auto_question", "true")
    }, server.url.origin, temp.dir)

    await page.goto(new URL("/ui/index.html", server.url).toString(), { waitUntil: "load" })
    await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: 60_000 })
  }
  marks.onlineAt = Date.now()
  if (page) {
    const overlay = await syncDirectory(page, temp.dir)
    logLine(`[overlay-benchmark] directory=${overlay.directory} saved=${overlay.savedDirectory}`)
  }
  marks.submittedAt = Date.now()

  if (resumeTaskID) {
    // ── Resume mode ──────────────────────────────────────────────────────────
    // Attach to an existing task without creating a new one.
    taskID = resumeTaskID
    eventStream = subscribeTaskEvents(taskID)

    // Navigate browser to the overlay and select the existing task
    if (page) {
      await page.evaluate(async (id) => {
        await window.eval("loadTasks")()
        await window.eval("selectTask")(id)
      }, taskID)
      await page.waitForFunction((id) => {
        try {
          return window.eval("state").selectedTaskID === id
        } catch {
          return false
        }
      }, { timeout: TASK_RESUME_TIMEOUT_MS }, taskID)
    }

    // Synthesize planning/streaming snapshots from current board state
    const currentProg = await api(`/task/${taskID}/progress`).then((r) => r.json()).catch(() => null)
    planning = {
      pendingCount: 0,
      taskList: currentProg?.task?.title ?? TASK_TITLE,
      reasoning: "",
      assistantText: "",
      taskIDs: [taskID],
      selectedTaskID: taskID,
    }
    marks.planningAt = Date.now()
    marks.createdAt = Date.now()
    marks.selectedAt = Date.now()

    if (page) {
      await page.waitForFunction(() => {
        try { return !!window.eval("state").board?.task?.id } catch { return false }
      }, { timeout: 60_000 })
    }
    marks.boardAt = Date.now()

    // Inject user message to wake up a failed/cancelled task, or to add guidance to a running one.
    logLine(`[overlay-benchmark] resume taskID=${taskID} injecting message: ${resumeMessage}`)
    await api(`/task/${taskID}/message`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text: resumeMessage, source: "user_message" }),
    }).catch((err) => logLine(`[overlay-benchmark] resume message inject failed: ${err}`))

    if (page) {
      streaming = await waitForStreamingVisible(page, PLANNING_VISIBLE_TIMEOUT_MS).catch(() => ({
        reasoning: "", assistantText: "", liveRole: "", liveText: "",
      }))
    } else {
      streaming = { reasoning: "", assistantText: "", liveRole: "", liveText: "" }
    }
    marks.streamingAt = Date.now()
    // ─────────────────────────────────────────────────────────────────────────
  } else {
    // ── Normal mode: create a new task ────────────────────────────────────────
    taskID = await api("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        title: TASK_TITLE,
        request: TASK_REQUEST,
        ...(TASK_ATTACHMENTS.length > 0 ? { attachments: TASK_ATTACHMENTS } : {}),
        executor,
        budget: {
          maxRuns,
          maxFixRuns,
          ...(maxExecutorGroups != null && maxExecutorGroups > 1 ? { maxExecutorGroups } : {}),
        },
        ...(DELIVERY_VERIFY_CMD || figmaUrl
          ? {
              metadata: {
                ...(DELIVERY_VERIFY_CMD ? { delivery_verify_cmd: DELIVERY_VERIFY_CMD } : {}),
                ...(figmaUrl ? { figma_url: figmaUrl } : {}),
              },
            }
          : {}),
      }),
    })
      .then((res) => res.json())
      .then((body) => String(body.task_id || ""))
    if (!taskID) throw new Error("Task creation did not return task_id")
    eventStream = subscribeTaskEvents(taskID)

    if (page) {
      planning = await waitForPlanningVisible(page, api, PLANNING_VISIBLE_TIMEOUT_MS)
    } else {
      const waitStart = Date.now()
      while (Date.now() - waitStart < TASK_CREATE_TIMEOUT_MS) {
        const prog = await api(`/task/${taskID}/progress`).then((r) => r.json()).catch(() => null)
        if (prog?.task?.status && prog.task.status !== "queued") {
          planning = { pendingCount: 0, taskList: [], reasoning: "", assistantText: "", taskIDs: [taskID], selectedTaskID: taskID }
          break
        }
        await Bun.sleep(1000)
      }
      if (!planning) planning = { pendingCount: 0, taskList: [], reasoning: "", assistantText: "", taskIDs: [taskID], selectedTaskID: taskID }
    }
    marks.planningAt = Date.now()

    if (page) {
      taskID = await waitForTaskCreated(page, api, TASK_CREATE_TIMEOUT_MS)
    }
    marks.createdAt = Date.now()
    await api(`/task/${taskID}/budget`, {
      method: "PATCH",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        budget: {
          maxRuns,
          maxFixRuns,
          ...(maxExecutorGroups != null && maxExecutorGroups > 1 ? { maxExecutorGroups } : {}),
        },
      }),
    }).catch(() => undefined)

    if (page) {
      await page.evaluate(async (id) => {
        const state = window.eval("state")
        if (state.selectedTaskID === id) return
        await window.eval("loadTasks")()
        await window.eval("selectTask")(id)
      }, taskID)
      await page.waitForFunction((id) => {
        try {
          return window.eval("state").selectedTaskID === id
        } catch {
          return false
        }
      }, { timeout: 120_000 }, taskID)
    }
    marks.selectedAt = Date.now()

    if (page) {
      await page.waitForFunction(() => {
        try {
          return !!window.eval("state").board?.task?.id
        } catch {
          return false
        }
      }, { timeout: 120_000 })
    }
    marks.boardAt = Date.now()
    if (page) {
      streaming = await waitForStreamingVisible(page, PLANNING_VISIBLE_TIMEOUT_MS)
    } else {
      streaming = { reasoning: "", assistantText: "", liveRole: "", liveText: "" }
    }
    marks.streamingAt = Date.now()
    // ─────────────────────────────────────────────────────────────────────────
  }
  if (page && browser) {
    page = await verifyResume(browser, page, server.url.origin, taskID, temp.dir, api)
  }
  marks.resumedAt = Date.now()
  board = await api(`/task/${taskID}/board?sync=1`).then((res) => res.json())

  progress = await waitForFinal(taskID, stallTimeoutMs, api, completionHardTimeoutMs)
  marks.completedAt = Date.now()
  finalBoard = taskID ? await api(`/task/${taskID}/board?sync=1`).then((res) => res.json()).catch(() => board) : board

  transcript = await api(`/task/${taskID}/transcript`).then((res) => res.json())
  timeline = await api(`/control/timeline?taskID=${encodeURIComponent(taskID)}`).then((res) => res.json())
  runs = await api(`/task/${taskID}/runs`).then((res) => res.json())

  const out = await buildBenchmarkReport()

  await flushed
  await Bun.write(eventFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    taskID,
    event_count: events.length,
    stage_summary: summarizeEvents(events, taskID),
    events,
  }, null, 2))
  await Bun.write(reportFile, JSON.stringify(out, null, 2))
  _emergencyWritten = true
  logLine(JSON.stringify(out, null, 2))
  logLine(`report: ${reportFile}`)
  logLine(`events: ${eventFile}`)
  logLine(`events_ndjson: ${eventLogFile}`)

  const pass = out.assertions.planning_visible.pass && out.assertions.streaming_visible.pass && out.assertions.materialized.pass && out.assertions.delivery.pass && out.failure_matrix.verdict === "accepted"
  if (!pass) {
    process.exit(1)
  }
} catch (error) {
  if (!marks.completedAt) marks.completedAt = Date.now()
  const out = await buildBenchmarkReport(error)
  await flushed
  await Bun.write(eventFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    taskID,
    error: String(error),
    event_count: events.length,
    stage_summary: summarizeEvents(events, taskID),
    events,
  }, null, 2))
  await Bun.write(reportFile, JSON.stringify(out, null, 2))
  _emergencyWritten = true
  errorLine(JSON.stringify(out, null, 2))
  errorLine(`report: ${reportFile}`)
  errorLine(`events: ${eventFile}`)
  errorLine(`events_ndjson: ${eventLogFile}`)
  process.exitCode = 1
} finally {
  await cleanup("events.stop", () => eventStream.stop())
  await flushed.catch(() => undefined)
  if (taskID) {
    await cleanup("task.cancel", () =>
      api(`/task/${taskID}/cancel`, {
        method: "POST",
      }).catch(() => undefined),
    )
  }
  if (page) await cleanup("page.close", () => page!.close().catch(() => undefined))
  if (browser) await cleanup("browser.close", () => browser!.close().catch(() => undefined), () => browser!.process()?.kill("SIGKILL"))
  await cleanup("server.stop", () => server.stop(true))
  await cleanup("instance.disposeAll", () => Instance.disposeAll().catch(() => undefined))
  // Kill any orphaned processes that executors left behind in the workspace
  // (e.g. test scripts with setInterval that never exit on their own).
  if (temp.dir) {
    await cleanup("orphan.kill", async () => {
      try {
        await Bun.spawn(["pkill", "-9", "-f", temp.dir], { stdout: "pipe", stderr: "pipe" }).exited
      } catch { /* best effort — pkill not available on all platforms */ }
    })
  }
  if (!keep && temp.dir) await cleanup("temp.dir", () => fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined))
  if (!keep && temp.home) await cleanup("temp.home", () => fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined))
  process.exit(process.exitCode ?? 0)
}

async function scaffoldProject(dir: string, model: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, "data"), { recursive: true })
  // .gitkeep ensures data/ is tracked by git and survives git clean / executor git ops.
  // Without this, executors that run git init or git clean can remove the directory,
  // causing db.ts to fail at runtime when it opens data/trading.db.
  await Bun.write(path.join(dir, "data", ".gitkeep"), "")
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
  await fs.mkdir(temp.config, { recursive: true })
  // Generate .gitignore only if one doesn't already exist
  const gitignorePath = path.join(dir, ".gitignore")
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, generateGitignore(model))
  }
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "overlay-web-benchmark",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "Preserve",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  )
  const providerID = model.split("/")[0] || "openai"
  const config = JSON.stringify(
    {
      $schema: "https://opencorvus.ai/config.json",
      model,
      experimental: {
        unattended: false,
      },
      lsp: {
        biome: {
          disabled: true,
        },
        eslint: {
          disabled: true,
        },
      },
      provider: {
        [providerID]: {
          options: {
            timeout: requestTimeoutMs,
          },
        },
      },
    },
    null,
    2,
  )
  await Bun.write(path.join(dir, "opencorvus.json"), config)
  await Bun.write(path.join(dir, ".opencorvus", "opencorvus.json"), config)
  await Bun.write(path.join(temp.config, "opencorvus.json"), config)
}

/** Generate a .gitignore appropriate for the project context (inferred from request + model). */
function generateGitignore(model: string): string {
  const sections: string[] = []

  // Core: always ignore these regardless of stack
  sections.push(`# Dependencies
node_modules/
.pnp.*
.yarn/

# Build outputs
dist/
build/
.output/
.next/
.nuxt/
.svelte-kit/
.astro/

# Environment & secrets
.env
.env.*
!.env.example

# Data & databases
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
data/*.db*

# IDE & OS
.vscode/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db

# TypeScript
*.tsbuildinfo
tsconfig.tsbuildinfo

# Test & coverage
coverage/
.nyc_output/

# Logs
*.log
logs/

# Caches
.cache/
.parcel-cache/
.turbo/
.vercel/

# Lock files (keep bun.lock, ignore others if present)
package-lock.json
yarn.lock
pnpm-lock.yaml

# Misc
*.tgz
*.tar.gz
`)

  return sections.join("\n")
}

async function runLocalVerify(cwd: string, cmd: string) {
  if (!cmd) {
    return {
      mode: "skipped",
      command: null,
      exitCode: 0,
      stdout: "",
      stderr: "",
    }
  }
  const shell = process.platform === "win32" ? ["cmd", "/c", cmd] : ["bash", "-lc", cmd]
  const proc = Bun.spawn(shell, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    mode: "command",
    command: cmd,
    exitCode: await proc.exited,
    stdout: (await new Response(proc.stdout).text()).trim(),
    stderr: (await new Response(proc.stderr).text()).trim(),
  }
}

async function buildBenchmarkReport(error?: unknown) {
  const reportError = error ? String(error) : undefined
  const completedAt = marks.completedAt || Date.now()
  const currentBoard = board ?? (taskID ? await tryApiJson(`/task/${taskID}/board?sync=1`) : null)
  const currentFinalBoard = finalBoard ?? (taskID
    ? await tryApiJson(`/task/${taskID}/board?sync=1`, currentBoard)
    : currentBoard)
  const currentTranscript = transcript ?? (taskID ? await tryApiJson(`/task/${taskID}/transcript`, []) : [])
  const currentTimeline = timeline ?? (taskID ? await tryApiJson(`/control/timeline?taskID=${encodeURIComponent(taskID)}`, []) : [])
  const currentRuns = runs ?? (taskID ? await tryApiJson(`/task/${taskID}/runs`, []) : [])
  const localVerify = await runLocalVerify(temp.dir, DELIVERY_VERIFY_CMD)
  const deliveryChangedFiles = progress?.delivery?.result?.changedFiles ?? currentFinalBoard?.delivery?.result?.changedFiles ?? []
  // Always run git fallback: delivery changedFiles may only contain internal .opencorvus/ files
  // while actual source files are in committed diffs (executor commits before delivery).
  const gitFallbackFiles = await gitChangedFiles(temp.dir)
  const changedFiles = dedupePaths([...deliveryChangedFiles, ...gitFallbackFiles])
  const moduleBlocks = resolveModuleBlocks(progress, currentFinalBoard ?? currentBoard, TASK_REQUEST)
  const artifactAudit = await auditWorkspace({
    rootDir: temp.dir,
    changedFiles,
    request: TASK_REQUEST,
    moduleBlocks,
  })
  const runMetrics = await deriveRunMetrics({
    rootDir: temp.dir,
    changedFiles,
    completedAt,
    events,
    evaluationChecks: progress?.evaluation?.checks ?? currentFinalBoard?.evaluation?.checks ?? [],
    moduleBlocks,
  })
  const qualityVerdict = applyBenchmarkErrorVerdict(evaluateQualityGates({
    artifactAudit,
    runMetrics,
    taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
    evaluationVerdict: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
    localVerifyExitCode: localVerify.exitCode,
  }), reportError)
  const screenshot = page ? await takeBenchmarkScreenshot(page) : null
  const currentOverlay = page ? await overlaySnapshot(page).catch((cause) => ({ error: String(cause) })) : { error: "no-browser mode" }

  return {
    generated_at: new Date().toISOString(),
    title: TASK_TITLE,
    request_file: requestFile ? path.resolve(requestFile) : null,
    executor,
    model,
    directory: temp.dir,
    server: server.url.toString(),
    taskID,
    error: reportError,
    stage_timeout_ms: {
      // Legacy spec/planner timeouts kept for backward compatibility
      spec: specTimeoutMs,
      planner: plannerTimeoutMs,
      tool: toolTimeoutMs,
      standby: standbyTimeoutMs,
      stall: stallTimeoutMs,
      request: requestTimeoutMs,
    },
    stage_max_steps: {
      // Legacy spec/planner max steps kept for backward compatibility
      spec: specMaxSteps,
      planner: plannerMaxSteps,
    },
    stall_timeout_ms: stallTimeoutMs,
    completion_hard_timeout_ms: completionHardTimeoutMs || null,
    request_timeout_ms: requestTimeoutMs,
    taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
    evaluation: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
    changedFiles,
    transcriptCount: Array.isArray(currentTranscript) ? currentTranscript.length : 0,
    timelineCount: Array.isArray(currentTimeline) ? currentTimeline.length : 0,
    runCount: Array.isArray(currentRuns) ? currentRuns.length : 0,
    planning: planning
      ? {
          pendingCount: planning.pendingCount,
          taskList: planning.taskList,
          reasoning: planning.reasoning,
          assistantText: planning.assistantText,
        }
      : null,
    streaming: streaming
      ? {
          reasoning: streaming.reasoning,
          assistantText: streaming.assistantText,
          liveRole: streaming.liveRole,
          liveText: streaming.liveText,
          reasoningVisible: meaningfulLiveText(streaming.reasoning),
          assistantVisible: meaningfulLiveText(streaming.assistantText),
          liveVisible: meaningfulLiveText(streaming.liveText),
        }
      : null,
    materialization: {
      boardTaskID: currentBoard?.task?.id || "",
      boardStatus: currentBoard?.task?.status || "",
      specVersion: currentBoard?.spec?.version ?? null,
      goalCount: Array.isArray(currentBoard?.goalWorkflows) ? currentBoard.goalWorkflows.length : 0,
      goalRunCount: Array.isArray(currentBoard?.goalRuns) ? currentBoard.goalRuns.length : 0,
      criteriaCount: (() => {
        const evalChecks = currentBoard?.evaluation?.checks
        return Array.isArray(evalChecks) ? evalChecks.length : 0
      })(),
    },
    architect: currentFinalBoard?.architect
      ? {
          summary: currentFinalBoard.architect.summary ?? null,
          contractCount: currentFinalBoard.architect.contractCount ?? null,
          categories: currentFinalBoard.architect.categories ?? null,
        }
      : null,
    plan: currentFinalBoard?.plan
      ? {
          id: currentFinalBoard.plan.id ?? null,
          version: currentFinalBoard.plan.version ?? null,
          status: currentFinalBoard.plan.status ?? null,
          summary: currentFinalBoard.plan.summary ?? null,
        }
      : null,
    screenshot,
    resume: {
      restored: marks.resumedAt > 0,
      selectedAt: elapsedOrNull(marks.resumedAt),
      // resume mode metadata
      resumeTaskID: resumeTaskID ?? null,
      resumeHomeDir: resumeHomeDir ?? null,
    },
    timings_ms: {
      online: elapsedOrNull(marks.onlineAt),
      submit: elapsedOrNull(marks.submittedAt),
      planning_visible: elapsedOrNull(marks.planningAt),
      streaming_visible: elapsedOrNull(marks.streamingAt),
      task_created: elapsedOrNull(marks.createdAt),
      task_selected: elapsedOrNull(marks.selectedAt),
      board_loaded: elapsedOrNull(marks.boardAt),
      resumed: elapsedOrNull(marks.resumedAt),
      completed: elapsedOrNull(completedAt),
      execution: marks.submittedAt ? completedAt - marks.submittedAt : null,
    },
    assertions: {
      planning_visible: {
        pass: !!planning && (planning.pendingCount > 0 || planning.taskIDs.length > 0 || !!planning.selectedTaskID),
        sample: planning,
      },
      streaming_visible: {
        pass: !!streaming && (
          meaningfulLiveText(streaming.reasoning) ||
          meaningfulLiveText(streaming.assistantText) ||
          meaningfulLiveText(streaming.liveText)
        ),
        sample: streaming,
      },
      materialized: {
        pass: !!taskID && (currentBoard?.task?.id || "") === taskID && marks.resumedAt > 0,
        sample: {
          taskID,
          boardTaskID: currentBoard?.task?.id || "",
          resumed: marks.resumedAt > 0,
        },
      },
      delivery: {
        pass: (progress?.task?.status || currentFinalBoard?.task?.status) === "completed" &&
            (progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict) === "accepted" &&
            localVerify.exitCode === 0 &&
            qualityVerdict.verdict === "accepted",
        sample: {
          taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
          verdict: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
          localExit: localVerify.exitCode,
          qualityVerdict: qualityVerdict.verdict,
        },
      },
    },
    local_verify: localVerify,
    artifact_audit: artifactAudit,
    run_metrics: runMetrics,
    failure_matrix: {
      verdict: qualityVerdict.verdict,
      primary_failure: qualityVerdict.primary_failure,
      failures: qualityVerdict.failures,
    },
    manual_review_summary: qualityVerdict.manual_review_summary,
    overlay: currentOverlay,
    diagnostics: {
      event_file: eventFile,
      event_count: events.length,
      stage_summary: summarizeEvents(events, taskID),
    },
  }
}

async function tryApiJson(pathname: string, fallback: unknown = null) {
  try {
    return await api(pathname).then((res) => res.json())
  } catch {
    return fallback
  }
}

function applyBenchmarkErrorVerdict(base: ReturnType<typeof evaluateQualityGates>, error?: string) {
  if (!error || !/(did not finish within|timed out|timeout|stall)/i.test(error)) return base
  if (base.failures.some((item) => item.category === "liveness")) {
    return {
      ...base,
      verdict: "blocked" as const,
      primary_failure: "liveness" as const,
      manual_review_summary: `liveness: Benchmark timed out before task completion | ${base.manual_review_summary}`,
    }
  }
  const failure = {
    category: "liveness" as const,
    message: "Benchmark timed out before task completion",
    evidence: error,
  }
  const failures = [failure, ...base.failures]
  return {
    verdict: "blocked" as const,
    primary_failure: "liveness" as const,
    failures,
    manual_review_summary: failures.map((item) => `${item.category}: ${item.message}`).join(" | "),
  }
}

async function takeBenchmarkScreenshot(page: Page) {
  const screenshot = path.join(process.cwd(), `overlay-web-benchmark-${Date.now()}.png`)
  try {
    await page.screenshot({ path: screenshot, fullPage: true })
    return screenshot
  } catch {
    return null
  }
}

function elapsedOrNull(at: number) {
  return at ? at - marks.startedAt : null
}

function dedupePaths(files: string[]) {
  return [...new Set(files.filter((item): item is string => typeof item === "string" && item.length > 0).map((item) => item.replace(/\\/g, "/")))]
}

/** Fallback: compute changed+untracked files directly from project git when delivery result is empty. */
async function gitChangedFiles(dir: string): Promise<string[]> {
  try {
    const run = (args: string[]) =>
      Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
        .stdout.text().then((t) => t.trim().split(/\r?\n/).filter(Boolean))
        .catch(() => [] as string[])
    // 1. Uncommitted changes (working tree vs HEAD)
    const [modified, untracked] = await Promise.all([
      run(["diff", "--name-only", "HEAD"]),
      run(["ls-files", "--others", "--exclude-standard"]),
    ])
    if (modified.length > 0 || untracked.length > 0) return [...modified, ...untracked]
    // 2. Committed changes: compare initial checkpoint to HEAD.
    //    The orchestrator creates a checkpoint commit, executor works, delivery commits.
    //    `git diff HEAD` is empty because everything is committed.
    const commits = await run(["log", "--oneline", "--reverse"])
    if (commits.length >= 2) {
      const firstHash = commits[0].split(" ")[0]
      return run(["diff", "--name-only", firstHash, "HEAD"])
    }
    // 3. Single commit: list all files in that commit (everything was added in one go)
    if (commits.length === 1) {
      return run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    }
    return []
  } catch {
    return []
  }
}

function resolveModuleBlocks(progress: any, board: any, request: string) {
  const specBlocks = progress?.spec?.metadata?.module_blocks ?? board?.spec?.metadata?.module_blocks
  if (Array.isArray(specBlocks) && specBlocks.length > 0) {
    return specBlocks
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "spec-block",
        owned_paths: Array.isArray(item.owned_paths) ? dedupePaths(item.owned_paths.filter((path): path is string => typeof path === "string")) : [],
      }))
      .filter((item) => item.owned_paths.length > 0)
  }
  const contractAllowed = progress?.plan?.metadata?.task_contract?.artifacts?.allowed ?? board?.plan?.metadata?.task_contract?.artifacts?.allowed
  if (Array.isArray(contractAllowed) && contractAllowed.length > 0) {
    return [{
      id: "task-contract",
      owned_paths: dedupePaths(contractAllowed.filter((item): item is string => typeof item === "string")),
    }]
  }
  return moduleBlocksFromRequest(request)
}

async function launchBrowser() {
  const executablePath = await findBrowser()
  return puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir: mkdtempSync(path.join(os.tmpdir(), "pptr-overlay-web-benchmark-")),
    args: [
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--disable-extensions",
      // Without these, Windows under DPI scaling drops the window in the bottom-right corner.
      "--window-position=0,0",
      "--window-size=1600,1200",
    ],
  })
}

async function findBrowser() {
  const list = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay benchmark")
}

async function cleanup(
  label: string,
  run: () => Promise<unknown>,
  force?: () => void | Promise<void>,
  timeout = 10_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
  })
  try {
    await Promise.race([run(), wait])
  } catch (error) {
    errorLine(`[cleanup] ${label}: ${String(error)}`)
    await force?.()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForFinal(
  taskID: string,
  stallTimeoutMs: number,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
  completionHardTimeoutMs = 0,
) {
  const startedAt = Date.now()
  let lastStatus = ""
  // Scope stall clocks to this wait — stale timestamps from earlier phases
  // (planning, browser bootstrap) must not count against the execution stall
  // budget. terminalReached is reset in case of a resumed/subsequent call.
  const entryNow = Date.now()
  lastEventAt = entryNow
  lastProgressAt = entryNow
  lastProgressEventAt = entryNow
  lastProgressSignature = ""
  lastHeartbeatAt = 0
  terminalReached = false
  let terminalAt = 0
  const terminalPromise = new Promise<void>((resolve) => {
    terminalSignalResolver = () => {
      terminalAt = Date.now()
      resolve()
    }
  })
  // Hard cap on the gap between a terminal SSE signal and the /progress
  // endpoint reflecting the terminal status. The event is emitted from the
  // same DB transaction that writes the row, so divergence longer than this
  // indicates a real bug — fail loudly rather than loop forever.
  const TERMINAL_PROGRESS_GRACE_MS = 30_000
  try {
  while (true) {
    let progress: any
    try {
      progress = await api(`/task/${taskID}/progress`).then((res) => res.json())
    } catch (e) {
      // Bun-specific: AbortSignal fires during body read → empty body → SyntaxError instead of AbortError
      // Also handle transient network/abort errors to avoid crashing on single failed poll
      const isTransient = e instanceof SyntaxError
        || (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError"))
        || (e instanceof TypeError && typeof (e as any).message === "string" && /fetch|network|abort/i.test((e as any).message))
      if (isTransient) {
        logLine(`[overlay-benchmark] warn: progress poll error (${(e as any)?.name ?? "Error"}: ${(e as any)?.message}), retrying in 2s`)
        await Bun.sleep(2_000)
        continue
      }
      throw e
    }
    progress = await settle(progress, api)
    if (FINAL.has(progress.task.status)) return progress
    const signature = progressSignature(progress)
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature
      lastProgressAt = Date.now()
      lastProgressEventAt = Date.now()
      activityLine(`[overlay-benchmark] progress=${signature}`)
    }
    if (progress.task.status !== lastStatus) {
      lastStatus = progress.task.status
      activityLine(`[overlay-benchmark] status=${lastStatus}`)
    }
    const now = Date.now()
    // Tier 1 (alive): any SSE chunk — detects connection-level hangs.
    const aliveAgeMs = inactivityAgeMs(now, lastEventAt)
    // Tier 2 (progress): only semantic-progress events — detects "model is
    // emitting tokens but getting nowhere" loops.
    const progressAgeMs = inactivityAgeMs(now, lastProgressEventAt, lastProgressAt)
    // Use a separate (usually longer) progress-stall timeout while the Task
    // Agent is in early stages (queued/active). During "active" the Task
    // Agent may be invoking tools (decompose, plan_goal, etc.) where tool
    // events arrive intermittently.
    const taskStatus = progress?.task?.status || ""
    const pipelineStatuses = ["queued", "active"]
    const effectiveProgressMs = pipelineStatuses.includes(taskStatus) ? planningStallTimeoutMs : stallTimeoutMs
    if (now - lastHeartbeatAt >= 60_000) {
      lastHeartbeatAt = now
      const retryCount = progress?.run?.retryCount ?? progress?.activeRun?.retryCount ?? 0
      const maxFixRuns = (progress?.task as any)?.budget?.maxFixRuns ?? "?"
      logLine(
        `[overlay-benchmark] heartbeat status=${taskStatus} retry=${retryCount}/${maxFixRuns} alive_age_ms=${aliveAgeMs} progress_age_ms=${progressAgeMs} alive_cap_ms=${aliveStallTimeoutMs} progress_cap_ms=${effectiveProgressMs} last_progress=${lastProgressSignature || "none"}`,
      )
    }
    // Once the orchestrator has emitted a terminal task.updated event, the
    // task is definitionally done — suppress stall checks while the progress
    // endpoint catches up. Otherwise a slow progress poll after failure could
    // fire a spurious stall error even though the run is already over.
    if (!terminalReached) {
      if (aliveAgeMs >= aliveStallTimeoutMs) {
        throw new Error(
          `Task alive stall: no SSE activity for ${aliveAgeMs}ms (cap ${aliveStallTimeoutMs}ms, status: ${taskStatus}, last progress: ${lastProgressSignature || "none"})`,
        )
      }
      if (progressAgeMs >= effectiveProgressMs) {
        throw new Error(
          `Task progress stall: no semantic-progress event for ${progressAgeMs}ms (cap ${effectiveProgressMs}ms, status: ${taskStatus}, last progress: ${lastProgressSignature || "none"})`,
        )
      }
      if (completionHardTimeoutMs > 0 && (now - startedAt) >= completionHardTimeoutMs) {
        throw new Error(`Task exceeded optional hard completion timeout of ${completionHardTimeoutMs}ms`)
      }
    }
    // When terminal signal has fired, shorten the poll cadence so the final
    // progress snapshot is fetched promptly. Otherwise race sleep vs signal so
    // the loop exits immediately on task.updated terminal.
    if (terminalReached) {
      const sinceTerminal = Date.now() - terminalAt
      if (sinceTerminal >= TERMINAL_PROGRESS_GRACE_MS) {
        throw new Error(
          `Task terminal SSE fired but /progress still reports non-final for ${sinceTerminal}ms (cap ${TERMINAL_PROGRESS_GRACE_MS}ms, status: ${taskStatus})`,
        )
      }
      await Bun.sleep(250)
    } else {
      await Promise.race([Bun.sleep(2_000), terminalPromise])
    }
  }
  } finally {
    terminalSignalResolver = null
  }
}

function progressSignature(progress: any) {
  return JSON.stringify({
    task: progress?.task?.status || "",
    run: progress?.run?.status || progress?.activeRun?.status || "",
    phase: progress?.run?.phase || progress?.activeRun?.phase || "",
    retry_count: progress?.run?.retryCount ?? progress?.activeRun?.retryCount ?? 0,
    verdict: progress?.evaluation?.verdict || "",
    delivery: progress?.delivery?.status || "",
    goals: Array.isArray(progress?.goals)
      ? progress.goals.map((item: any) => `${item.id || "goal"}:${item.status || ""}`)
      : [],
    pending: Array.isArray(progress?.pendingInteractions)
      ? progress.pendingInteractions.map((item: any) => `${item.id || "interaction"}:${item.type || ""}:${item.status || ""}`)
      : [],
    // Pre-plan sessions (requirements / architect / fidelity / design-analyst)
    // surface here so the signature evolves while goals is still empty —
    // keeps progress_age_ms moving during the architect phase.
    sessions: Array.isArray(progress?.activeSessions)
      ? progress.activeSessions.map((item: any) => `${item.kind || "?"}:${item.sessionID || ""}`)
      : [],
  })
}

async function waitForPlanningVisible(
  page: Page,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
  timeoutMs: number,
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (overlay.pendingCount > 0 || overlay.selectedTaskID || overlay.taskIDs[0]) return overlay
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return { ...overlay, taskIDs: [taskID, ...overlay.taskIDs].filter(Boolean).slice(0, 5) }
    await Bun.sleep(250)
  }
  throw new Error(`Overlay did not expose planning state within ${timeoutMs}ms: ${JSON.stringify(await debugSnapshot(page, api))}`)
}

async function waitForStreamingVisible(page: Page, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (meaningfulLiveText(overlay.reasoning)) return overlay
    if (meaningfulLiveText(overlay.assistantText)) return overlay
    if (meaningfulLiveText(overlay.liveText)) return overlay
    await Bun.sleep(250)
  }
  throw new Error(`Overlay did not render streamed task output within ${timeoutMs}ms`)
}

async function waitForTaskCreated(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (overlay.selectedTaskID) return overlay.selectedTaskID
    if (overlay.taskIDs[0]) return overlay.taskIDs[0]
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return taskID
    await Bun.sleep(1_000)
  }
  throw new Error(`Overlay did not create a task within ${timeoutMs}ms: ${JSON.stringify(await debugSnapshot(page, api))}`)
}

async function verifyResume(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  current: Page,
  serverUrl: string,
  taskID: string,
  directory: string,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
) {
  const next = await browser.newPage()
  await next.setViewport({ width: 1600, height: 1200 })
  await next.evaluateOnNewDocument((origin, dir, id) => {
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    localStorage.setItem("oc_workspace_task", id)
    localStorage.setItem("oc_unattended", "true")
    localStorage.setItem("oc_auto_permission", "true")
    localStorage.setItem("oc_auto_question", "true")
  }, serverUrl, directory, taskID)
  await next.goto(new URL("/ui/index.html", serverUrl).toString(), { waitUntil: "load" })
  await next.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: 60_000 })
  await syncDirectory(next, directory)
  await waitForTaskCreated(next, api, TASK_RESUME_TIMEOUT_MS)
  await next.evaluate(async (id) => {
    const state = window.eval("state")
    if (state.selectedTaskID === id && state.board?.task?.id === id) return
    await window.eval("selectTask")(id)
  }, taskID)
  await next.waitForFunction((id, dir) => {
    try {
      const state = window.eval("state")
      return state.directory === dir && state.board?.task?.id === id && state.workspaceTaskID === id
    } catch {
      return false
    }
  }, { timeout: TASK_RESUME_TIMEOUT_MS }, taskID, directory)
  await next.evaluate(async () => {
    try {
      await window.eval("persistOverlaySettings")()
      if (!window.eval("state").board?.task?.id) await window.eval("loadBoard")()
      await window.eval("loadConversation")()
    } catch {
      return
    }
  })
  await current.close().catch(() => undefined)
  return next
}

async function settle(progress: any, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const pending = Array.isArray(progress?.pendingInteractions)
    ? progress.pendingInteractions.filter((item: { status: string }) => item.status === "pending")
    : []
  for (const item of pending) {
    if (item.type === "permission") {
      // ReplyInteractionInput.autoReply is non-optional per engine/model.ts;
      // omitting it was the silent cause of HTTP 400 on benchmark reply that
      // turned every clarification gate into an abort.
      await api(`/interaction/${item.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReply: true, reply: "always" }),
      })
      continue
    }
    // Question / other interactions: the server falls back to
    // `answersFromMessage(message)` when `answers` isn't provided. The
    // benchmark has no way to know the question set ahead of time, so we
    // ship AUTO_REPLY as the message and let the server split it evenly.
    await api(`/interaction/${item.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReply: true, message: AUTO_REPLY }),
    })
  }
  if (pending.length === 0) return progress
  return api(`/task/${progress.task.id}/progress`).then((res) => res.json())
}

async function syncDirectory(page: Page, directory: string) {
  return page.evaluate(async (dir) => {
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    await window.eval("applyDirectory")(dir, { save: true, temp: false, restoreWorkspace: false })
    await window.eval("loadTasks")()
    const state = window.eval("state")
    return {
      directory: state.directory,
      savedDirectory: state.savedDirectory,
      workspaceDirectory: state.workspaceDirectory,
    }
  }, directory)
}

async function overlaySnapshot(page: Page) {
  return page.evaluate(() => {
    try {
      const state = window.eval("state")
      // Overlay conversation cards are rendered as `<article class="card" data-kind=...
      // data-role=... data-stage=... data-depth="N">` via components/Card.tsx. Top-level
      // items live at data-depth="0". Text for assistant/agent/goal/tool streams lives
      // inside `.card__body` using `.msg-text` / `.reasoning-text` classes from CardParts
      // and ReasoningPart. User-message cards carry data-role="user" and are excluded.
      const visibleTurns = [...document.querySelectorAll<HTMLElement>('.card[data-depth="0"]')]
        .map((element) => {
          const role = element.dataset.role || element.dataset.kind || ""
          const body = element.querySelector(".card__body")
          const text = body?.querySelector(".msg-text")?.textContent?.trim()
            || body?.querySelector(".reasoning-text")?.textContent?.trim()
            || element.querySelector(".card__goal-desc")?.textContent?.trim()
            || body?.textContent?.trim().slice(0, 200)
            || element.querySelector(".card__title")?.textContent?.trim()
            || ""
          return { role, text }
        })
        .filter((item) => item.role && item.role !== "user" && item.text)
      const liveTurn = visibleTurns.at(-1) || { role: "", text: "" }
      const storage = {
        directory: localStorage.getItem("oc_directory") || "",
        directoryMode: localStorage.getItem("oc_directory_mode") || "",
        workspaceDirectory: localStorage.getItem("oc_workspace_directory") || "",
        workspaceTaskID: localStorage.getItem("oc_workspace_task") || "",
      }
      const firstText = (sel: string) =>
        document.querySelector(sel)?.textContent?.trim() || ""
      return {
        directory: state.directory || "",
        savedDirectory: state.savedDirectory || "",
        workspaceDirectory: state.workspaceDirectory || "",
        selectedTaskID: state.selectedTaskID || "",
        pendingCount: Array.isArray(state.pendingTasks) ? state.pendingTasks.length : 0,
        taskIDs: Array.isArray(state.tasks)
          ? state.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "").filter(Boolean).slice(0, 5)
          : [],
        taskList: document.querySelector("#taskListPanel")?.textContent?.trim() || "",
        reasoning: firstText('.card[data-role="assistant"] .reasoning-text')
          || firstText('.card[data-kind="agent"] .reasoning-text')
          || firstText('.card[data-kind="goal"] .reasoning-text')
          || firstText('.card[data-depth="0"] .reasoning-text'),
        assistantText: firstText('.card[data-role="assistant"] .msg-text')
          || firstText('.card[data-kind="agent"] .msg-text')
          || firstText('.card[data-kind="goal"] .msg-text')
          || firstText('.card[data-kind="tool"] .msg-text')
          || firstText('.card[data-depth="0"]:not([data-role="user"]) .card__body'),
        liveRole: liveTurn.role,
        liveText: liveTurn.text,
        visibleTurns: visibleTurns.slice(-5),
        storage,
      }
    } catch (error) {
      return {
        directory: "",
        savedDirectory: "",
        workspaceDirectory: "",
        selectedTaskID: "",
        pendingCount: 0,
        taskIDs: [],
        taskList: "",
        reasoning: "",
        assistantText: "",
        liveRole: "",
        liveText: "",
        visibleTurns: [],
        storage: {},
        error: String(error),
      }
    }
  })
}

function meaningfulLiveText(value: string) {
  const text = String(value || "").trim()
  if (!text) return false
  return !STREAM_PLACEHOLDERS.has(text)
}

function clipText(value: string, max: number) {
  if (!value) return ""
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

function summarizeEvents(events: Array<Record<string, unknown>>, taskID: string) {
  const filtered = events.filter((item) => !taskID || item.taskID === taskID)
  const agents = filtered.filter((item) => item.type === "orchestrator.agent.updated")
  const runEvents = filtered.filter((item) =>
    item.type === "orchestrator.message.part.updated" ||
    item.type === "orchestrator.message.updated"
  )
  const kinds = filtered.reduce<Record<string, number>>((map, item) => {
    const type = typeof item.type === "string" ? item.type : ""
    if (!type) return map
    map[type] = (map[type] ?? 0) + 1
    return map
  }, {})
  // Include both legacy stage names (spec, planner) and new agent names (task, decompose, eval, architect)
  const stages = ["spec", "planner", "evaluator", "task", "decompose", "eval", "architect"].flatMap((stage) => {
    const list = agents.filter((item) => item.stage === stage)
    if (list.length === 0) return []
    const toolCalls = list
      .filter((item) => item.kind === "tool_call")
      .reduce<Record<string, number>>((map, item) => {
        const name = typeof item.toolName === "string" ? item.toolName : ""
        if (!name) return map
        map[name] = (map[name] ?? 0) + 1
        return map
      }, {})
    const byKind = list.reduce<Record<string, number>>((map, item) => {
      const kind = typeof item.kind === "string" ? item.kind : ""
      if (!kind) return map
      map[kind] = (map[kind] ?? 0) + 1
      return map
    }, {})
    return [[stage, {
      event_count: list.length,
      first_event_ms: list[0]?.elapsed_ms ?? null,
      first_message_ms: list.find((item) => item.kind === "message_delta")?.elapsed_ms ?? null,
      first_tool_call_ms: list.find((item) => item.kind === "tool_call")?.elapsed_ms ?? null,
      first_tool_result_ms: list.find((item) => item.kind === "tool_result")?.elapsed_ms ?? null,
      submit_tool_ms: list.find((item) => item.kind === "tool_call" && (item.toolName === "submit_spec" || item.toolName === "submit_plan" || item.toolName === "submit_analysis"))?.elapsed_ms ?? null,
      error_ms: list.find((item) => item.kind === "error")?.elapsed_ms ?? null,
      last_event_ms: list.at(-1)?.elapsed_ms ?? null,
      kind_counts: byKind,
      tool_calls: toolCalls,
    }]]
  })
  const execution = runEvents.length === 0
    ? []
    : [["execution", {
        event_count: runEvents.length,
        first_event_ms: runEvents[0]?.elapsed_ms ?? null,
        first_progress_ms: runEvents.find((item) => item.type === "orchestrator.run.progress")?.elapsed_ms ?? null,
        first_output_ms: runEvents.find((item) => item.type === "orchestrator.run.output")?.elapsed_ms ?? null,
        last_event_ms: runEvents.at(-1)?.elapsed_ms ?? null,
        types: runEvents.reduce<Record<string, number>>((map, item) => {
          const type = typeof item.type === "string" ? item.type : ""
          if (!type) return map
          map[type] = (map[type] ?? 0) + 1
          return map
        }, {}),
        progress_types: runEvents.reduce<Record<string, number>>((map, item) => {
          const type = typeof item.progressType === "string" ? item.progressType : ""
          if (!type) return map
          map[type] = (map[type] ?? 0) + 1
          return map
        }, {}),
        goal_runs: [...new Set(runEvents.flatMap((item) => typeof item.goalRunID === "string" && item.goalRunID ? [item.goalRunID] : []))],
      }]]
  return {
    types: kinds,
    stages: Object.fromEntries([...stages, ...execution]),
  }
}

async function debugSnapshot(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const overlay = await overlaySnapshot(page).catch((error) => ({ error: String(error) }))
  const tasks = await api("/tasks")
    .then((res) => res.json())
    .then((data) =>
      Array.isArray(data?.tasks)
        ? data.tasks.map((item: { task?: { id?: string; status?: string } }) => ({
            id: item?.task?.id || "",
            status: item?.task?.status || "",
          }))
        : data,
    )
    .catch((error) => ({ error: String(error) }))
  return {
    overlay,
    tasks,
  }
}
