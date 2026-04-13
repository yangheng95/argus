#!/usr/bin/env bun

/**
 * Overlay-entry E2E — reproduce exactly what the overlay input box does when
 * the user hits Enter. Unlike gateway-benchmark.ts (which starts an isolated
 * in-process server), this script targets an *already-running* server so we
 * can reproduce failures that depend on the user's real HOME / CONFIG / DB
 * state (e.g. cfg.model not set → Gateway falls through to deepseek → 402).
 *
 * Request shape mirrors packages/overlay/src/services/{api,gateway}.ts:
 *   URL    : <server>/gateway/message?directory=<encodeURIComponent(directory)>
 *   Method : POST
 *   Body   : { text, userID: "overlay" }
 *   Auth   : optional Basic (matches overlay's apiHeaders when password set)
 *
 * Verification is structural via HTTP only (no in-process DB access):
 *   1. GET /tasks  → baseline IDs
 *   2. POST /gateway/message  → reply { sessionID, text, toolCalls }
 *   3. GET /tasks → exactly one new ID with expected title + kind="workflow"
 *   4. GET /task/:id  → status present
 *   5. POST /task/:id/cancel → cleanup
 *   6. Poll GET /task/:id until status=cancelled (no-activity stall)
 *
 * Any HTTP non-2xx anywhere throws with the raw response body attached so the
 * root cause (e.g. provider 402, model not found) is preserved in the report.
 * No retry, no fallback — surface the failure.
 *
 * Flags:
 *   --server=<URL>         target server origin      (default http://127.0.0.1:7878)
 *   --directory=<PATH>     project directory to bind (default: omit → server cwd)
 *   --password=<STR>       basic-auth password       (default from OPENCORVUS_SERVER_PASSWORD env)
 *   --username=<STR>       basic-auth username       (default "opencorvus")
 *   --userID=<STR>         gateway userID            (default "overlay" — same as UI)
 *   --text=<STR>           message to send           (default a structured "create workflow task" prompt)
 *   --title=<STR>          expected task title       (default "gw-overlay-e2e")
 *   --turn-timeout-ms=N    /gateway/message deadline (default 180000)
 *   --cancel-stall-ms=N    max idle while polling    (default 120000)
 *   --skip-cancel          leave the task running (don't cancel)
 *   --report=<PATH>        JSON report path
 */

function flag(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1]
  }
  return undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

const SERVER = (flag("--server") ?? "http://127.0.0.1:7878").replace(/\/+$/, "")
const DIRECTORY = flag("--directory")?.trim() || ""
const PASSWORD = flag("--password") ?? process.env.OPENCORVUS_SERVER_PASSWORD ?? ""
const USERNAME = flag("--username") ?? process.env.OPENCORVUS_SERVER_USERNAME ?? "opencorvus"
const USER_ID = flag("--userID") ?? "overlay"
const TITLE = flag("--title") ?? "gw-overlay-e2e"
const TEXT =
  flag("--text") ??
  `Please enqueue a workflow task. Set title to "${TITLE}" and request to "Overlay-entry E2E probe. Do not execute real work — this task will be cancelled immediately.". Use priority low. Do not invoke any other tools.`
const TURN_TIMEOUT_MS = Number(flag("--turn-timeout-ms") ?? 180_000)
const CANCEL_STALL_MS = Number(flag("--cancel-stall-ms") ?? 120_000)
const CANCEL_POLL_MS = Number(flag("--cancel-poll-ms") ?? 1_000)
const SKIP_CANCEL = hasFlag("--skip-cancel")
const REPORT_PATH =
  flag("--report") ?? `${process.cwd().replace(/\\$/, "")}/gateway-overlay-entry-report-${Date.now()}.json`

if (!Number.isFinite(TURN_TIMEOUT_MS) || TURN_TIMEOUT_MS <= 0) throw new Error("invalid --turn-timeout-ms")
if (!Number.isFinite(CANCEL_STALL_MS) || CANCEL_STALL_MS <= 0) throw new Error("invalid --cancel-stall-ms")

// ── HTTP helpers ───────────────────────────────────────────────────────────

function authHeader(): Record<string, string> {
  if (!PASSWORD) return {}
  const token = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")
  return { Authorization: `Basic ${token}` }
}

function buildUrl(pathname: string, extra?: Record<string, string>): string {
  const url = new URL(pathname, SERVER + "/")
  if (DIRECTORY) url.searchParams.set("directory", DIRECTORY)
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v)
  return url.toString()
}

class HttpError extends Error {
  constructor(
    public status: number,
    public urlStr: string,
    public bodyText: string,
    public bodyJson: unknown,
  ) {
    super(`HTTP ${status} ${urlStr}\n${bodyText.slice(0, 2000)}`)
  }
}

async function req(method: string, pathname: string, bodyJson?: unknown): Promise<unknown> {
  const url = buildUrl(pathname)
  const init: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      ...authHeader(),
      ...(bodyJson === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  }
  const res = await fetch(url, init)
  const bodyText = await res.text()
  let parsed: unknown = null
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null
  } catch {
    parsed = null
  }
  if (!res.ok) throw new HttpError(res.status, url, bodyText, parsed)
  return parsed
}

type StepResult = {
  name: string
  passed: boolean
  durationMs: number
  details: Record<string, unknown>
  error?: { message: string; httpStatus?: number; body?: unknown; url?: string; stack?: string }
}

const steps: StepResult[] = []
const overallStart = Date.now()
let newTaskID = ""
let sessionID = ""
let exitCode = 1

async function runStep(name: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
  const t = Date.now()
  try {
    const details = await fn()
    steps.push({ name, passed: true, durationMs: Date.now() - t, details })
    console.log(`[overlay-entry-e2e] ✓ ${name} (${Date.now() - t}ms)`)
  } catch (err) {
    const entry: StepResult = { name, passed: false, durationMs: Date.now() - t, details: {} }
    if (err instanceof HttpError) {
      entry.error = { message: err.message, httpStatus: err.status, body: err.bodyJson ?? err.bodyText, url: err.urlStr }
    } else if (err instanceof Error) {
      entry.error = { message: err.message, stack: err.stack }
    } else {
      entry.error = { message: String(err) }
    }
    steps.push(entry)
    console.error(`[overlay-entry-e2e] ✗ ${name} (${Date.now() - t}ms)`)
    console.error(entry.error)
    throw err
  }
}

// ── Test body ──────────────────────────────────────────────────────────────

try {
  console.log(
    `[overlay-entry-e2e] server=${SERVER} directory=${DIRECTORY || "(server cwd)"} userID=${USER_ID} auth=${PASSWORD ? "on" : "off"}`,
  )

  let baselineIDs: Set<string> = new Set()
  await runStep("baseline-list", async () => {
    const tasks = (await req("GET", "/tasks")) as { tasks?: Array<{ id: string }> } | Array<{ id: string }>
    const rows = Array.isArray(tasks) ? tasks : (tasks?.tasks ?? [])
    baselineIDs = new Set(rows.map((r) => r.id))
    return { count: baselineIDs.size }
  })

  let reply: { sessionID: string; text: string; toolCalls: number } = { sessionID: "", text: "", toolCalls: 0 }
  await runStep("gateway-send", async () => {
    // Exact overlay payload: see packages/overlay/src/services/gateway.ts:30
    reply = (await req("POST", "/gateway/message", { text: TEXT, userID: USER_ID })) as typeof reply
    if (!reply?.sessionID) throw new Error(`response missing sessionID: ${JSON.stringify(reply)}`)
    sessionID = reply.sessionID
    return { sessionID: reply.sessionID, replyTextLen: reply.text?.length ?? 0, toolCalls: reply.toolCalls }
  })

  await runStep("task-created", async () => {
    const tasks = (await req("GET", "/tasks")) as { tasks?: Array<{ id: string; title: string; kind: string }> } | Array<{ id: string; title: string; kind: string }>
    const rows = Array.isArray(tasks) ? tasks : (tasks?.tasks ?? [])
    const newRows = rows.filter((r) => !baselineIDs.has(r.id))
    if (newRows.length === 0) {
      throw new Error(
        `no new task appeared after /gateway/message. ` +
          `toolCalls=${reply.toolCalls} replyText=${JSON.stringify(reply.text).slice(0, 400)}`,
      )
    }
    if (newRows.length > 1) {
      throw new Error(`expected exactly 1 new task, got ${newRows.length}: ${JSON.stringify(newRows)}`)
    }
    const row = newRows[0]
    if (row.kind !== "workflow") throw new Error(`expected kind=workflow, got ${row.kind}`)
    if (row.title !== TITLE) {
      // Not fatal — the LLM may paraphrase — but record for review.
      console.warn(`[overlay-entry-e2e] title drift: expected=${TITLE} actual=${row.title}`)
    }
    newTaskID = row.id
    return { taskID: row.id, title: row.title, kind: row.kind }
  })

  await runStep("task-details", async () => {
    const row = (await req("GET", `/task/${newTaskID}`)) as { id: string; status: string; kind: string }
    if (row.id !== newTaskID) throw new Error(`id mismatch: ${row.id} !== ${newTaskID}`)
    return { status: row.status, kind: row.kind }
  })

  if (!SKIP_CANCEL) {
    await runStep("cancel", async () => {
      await req("POST", `/task/${newTaskID}/cancel`)

      let lastStatus: string | undefined
      let lastChangeAt = Date.now()
      while (true) {
        const row = (await req("GET", `/task/${newTaskID}`)) as { status: string }
        if (row.status !== lastStatus) {
          lastStatus = row.status
          lastChangeAt = Date.now()
        }
        if (row.status === "cancelled") return { finalStatus: row.status }
        if (row.status === "completed" || row.status === "failed") {
          throw new Error(`task reached terminal ${row.status} instead of cancelled`)
        }
        const idleMs = Date.now() - lastChangeAt
        if (idleMs >= CANCEL_STALL_MS) {
          throw new Error(
            `task status has not changed for ${idleMs}ms (last=${lastStatus}); cancel-stall budget ${CANCEL_STALL_MS}ms exceeded`,
          )
        }
        await Bun.sleep(CANCEL_POLL_MS)
      }
    })
  }

  exitCode = 0
} catch {
  // Step-level errors are already recorded.
  exitCode = 1
}

// ── Report ─────────────────────────────────────────────────────────────────

const report = {
  ok: exitCode === 0,
  server: SERVER,
  directory: DIRECTORY || null,
  userID: USER_ID,
  startedAt: overallStart,
  finishedAt: Date.now(),
  durationMs: Date.now() - overallStart,
  sessionID,
  newTaskID,
  skipCancel: SKIP_CANCEL,
  steps,
}
await Bun.write(REPORT_PATH, JSON.stringify(report, null, 2))
console.log(`[overlay-entry-e2e] report -> ${REPORT_PATH}`)
console.log(JSON.stringify(report, null, 2))

process.exit(exitCode)
