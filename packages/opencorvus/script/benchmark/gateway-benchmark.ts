#!/usr/bin/env bun

/**
 * Gateway E2E benchmark — exercises /gateway/message through a real LLM
 * dispatcher and verifies the user-facing capabilities:
 *
 *   1. enqueue  — LLM calls `enqueue_task`; a matching task appears in the
 *                 project's orchestrator store with kind="workflow". The
 *                 task-agent itself decides internally whether to run the
 *                 pipeline or route through its build tool.
 *   2. list     — LLM calls `list_tasks`; the previously enqueued task ID is
 *                 present in the tool's structured result.
 *   3. get      — LLM calls `get_task` against the enqueued ID.
 *   4. cancel   — LLM calls `cancel_task`; GET /task/:id transitions to
 *                 status="cancelled".
 *
 * Verification is *structural*: we inspect the gateway session's message
 * parts to confirm which tool the LLM invoked. No keyword / text matching on
 * free-form assistant replies.
 *
 * Timeouts are activity-based:
 *   --turn-timeout-ms    (default 180000)  per-/gateway/message request deadline
 *   --cancel-stall-ms    (default 120000)  max time with no status change while
 *                                          polling for "cancelled"
 *
 * Failure policy: any step that fails throws and the script exits non-zero.
 * No fallback, no retry — surface the root cause.
 */

import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function flag(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

const TURN_TIMEOUT_MS = Number(flag("--turn-timeout-ms") ?? 180_000)
const CANCEL_STALL_MS = Number(flag("--cancel-stall-ms") ?? 120_000)
const CANCEL_POLL_MS = Number(flag("--cancel-poll-ms") ?? 1_000)
const REPORT_PATH = flag("--report") ?? path.join(process.cwd(), `gateway-benchmark-report-${Date.now()}.json`)

if (!Number.isFinite(TURN_TIMEOUT_MS) || TURN_TIMEOUT_MS <= 0) throw new Error("invalid --turn-timeout-ms")
if (!Number.isFinite(CANCEL_STALL_MS) || CANCEL_STALL_MS <= 0) throw new Error("invalid --cancel-stall-ms")

// ── Isolated HOME / CONFIG ─────────────────────────────────────────────────
const home = await fs.mkdtemp(path.join(os.tmpdir(), "gw-bench-home-"))
const configDir = path.join(home, "config")
const dataDir = path.join(home, "data")
await fs.mkdir(configDir, { recursive: true })
await fs.mkdir(dataDir, { recursive: true })
process.env.OPENCORVUS_HOME = home
process.env.OPENCORVUS_CONFIG_DIR = configDir
process.env.OPENCORVUS_DATA_DIR = dataDir
// Avoid user-level plugin installation (which can hang on `npm install`).
process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS = "1"

// ── Imports that read env must come AFTER env is set ───────────────────────
const { loadBenchmarkEnv, prepareLocalProviders, resolveBenchmarkModel, ensureBenchmarkModel } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: true })
const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Server } = await import("../../src/server/server")
const { ensureGatewaySession } = await import("../../src/gateway/session")
const { channelKey } = await import("../../src/session/channel-key")
const { Session } = await import("../../src/session")
const { listProjectTasks } = await import("../../src/orchestrator/store")
const { Question } = await import("../../src/question")
const { Bus } = await import("../../src/bus")

await loadBenchmarkEnv(import.meta.dir)
await prepareLocalProviders()
const model = await resolveBenchmarkModel(import.meta.dir)
process.env.OPENCORVUS_BENCHMARK_MODEL = model

// Pin the agent-layer default model. Gateway.handleMessage calls
// Provider.defaultModel(), which reads cfg.model first. Without this, the
// agent resolves to whichever provider happens to sort first (e.g. deepseek)
// — bypassing our benchmark choice and hitting an unfunded provider.
{
  const cfgPath = path.join(configDir, "opencorvus.json")
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await Bun.file(cfgPath).text())
  } catch {}
  await Bun.write(cfgPath, JSON.stringify({ ...existing, model }, null, 2))
}

await ensureBenchmarkModel(import.meta.dir, model)

// ── Project dir (fresh git repo) ───────────────────────────────────────────
const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-bench-proj-"))
await $`git init -q`.cwd(projectDir)
await $`git commit -q --allow-empty -m init`.cwd(projectDir)

await Instance.provide({
  directory: projectDir,
  init: InstanceBootstrap,
  fn: async () => {
    await ExecutorBootstrap.autoRegister(true)
  },
})

// ── Server (in-process) ────────────────────────────────────────────────────
const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
console.log(`[gateway-benchmark] server=${server.url} model=${model} project=${projectDir}`)

const USER_ID = `gw-bench-${Math.random().toString(36).slice(2, 10)}`
const CHANNEL_KEY = channelKey({ local: true, userID: USER_ID })

async function api(pathname: string, init?: RequestInit): Promise<Response> {
  const url = new URL(pathname, server.url)
  url.searchParams.set("directory", projectDir)
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} ${url.pathname}: ${body.slice(0, 800)}`)
  }
  return res
}

type GatewayReply = { sessionID: string; text: string; toolCalls: number }

async function chat(text: string): Promise<GatewayReply> {
  const res = await api("/gateway/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, userID: USER_ID }),
  })
  return (await res.json()) as GatewayReply
}

async function getTask(taskID: string): Promise<any> {
  const res = await api(`/task/${taskID}`)
  return await res.json()
}

type ToolCall = { tool: string; state: string; input: unknown; output: unknown }

/**
 * Inspect the most recent assistant message in the gateway session and return
 * the tool-calls it emitted. This is the structural source-of-truth for
 * "which tool did the LLM pick", independent of any free-form text.
 */
async function collectToolCalls(sessionID: string): Promise<ToolCall[]> {
  return Instance.provide({
    directory: projectDir,
    fn: async () => {
      const msgs = await Session.messages({ sessionID, limit: 200 })
      const calls: ToolCall[] = []
      for (const m of msgs) {
        if (m.info.role !== "assistant") continue
        for (const part of m.parts) {
          if (part.type !== "tool") continue
          calls.push({
            tool: (part as any).tool,
            state: (part as any).state?.status ?? "unknown",
            input: (part as any).state?.input ?? null,
            output: (part as any).state?.output ?? null,
          })
        }
      }
      return calls
    },
  })
}

/**
 * Run a gateway turn and return the tool-calls emitted *during that turn*,
 * by diffing against the cumulative tool-call list from before the turn.
 * This gives us a deterministic per-turn view without relying on message
 * boundaries (which can shift across AI-SDK steps).
 */
async function chatAndGetTurnCalls(text: string): Promise<{ reply: GatewayReply; calls: ToolCall[] }> {
  const before = await collectToolCalls(sessionID)
  const reply = await chat(text)
  const after = await collectToolCalls(reply.sessionID)
  const calls = after.slice(before.length)
  return { reply, calls }
}

type StepResult = {
  name: string
  passed: boolean
  durationMs: number
  details: Record<string, unknown>
  error?: string
}

const steps: StepResult[] = []
const overallStart = Date.now()
let taskID = ""
let sessionID = ""
let exitCode = 1

async function runStep(name: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
  const t = Date.now()
  try {
    const details = await fn()
    steps.push({ name, passed: true, durationMs: Date.now() - t, details })
    console.log(`[gateway-benchmark] ✓ ${name} (${Date.now() - t}ms)`)
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
    steps.push({ name, passed: false, durationMs: Date.now() - t, details: {}, error: msg })
    console.error(`[gateway-benchmark] ✗ ${name} (${Date.now() - t}ms): ${msg}`)
    throw err
  }
}

// Pre-resolve the gateway session so we can read its parts after each turn
// without racing the first request's session-creation.
await Instance.provide({
  directory: projectDir,
  fn: async () => {
    const s = await ensureGatewaySession({ channelKey: CHANNEL_KEY, defaultCwd: projectDir })
    sessionID = s.id
  },
})

try {
  // ── Step 1: enqueue a workflow task via natural language ────────────────
  await runStep("enqueue", async () => {
    const preIDs = new Set(
      await Instance.provide({
        directory: projectDir,
        fn: async () => listProjectTasks(Instance.project.id, 200).map((r) => r.id),
      }),
    )

    const { reply, calls } = await chatAndGetTurnCalls(
      "Please enqueue a task on this project. " +
        'Set title to "gw-e2e-probe" and request to ' +
        '"Gateway end-to-end benchmark probe. Do not start real work; this task will be cancelled immediately.". ' +
        "Use priority high. Do not invoke any other tools.",
    )
    const enqueue = calls.find((c) => c.tool === "enqueue_task")
    if (!enqueue) {
      throw new Error(
        `expected enqueue_task call, got [${calls.map((c) => c.tool).join(", ")}]`,
      )
    }
    if (enqueue.state !== "completed") {
      throw new Error(`enqueue_task state=${enqueue.state}, output=${JSON.stringify(enqueue.output)}`)
    }

    const afterIDs = await Instance.provide({
      directory: projectDir,
      fn: async () => listProjectTasks(Instance.project.id, 200).map((r) => r.id),
    })
    const newIDs = afterIDs.filter((id) => !preIDs.has(id))
    if (newIDs.length !== 1) {
      throw new Error(`expected exactly 1 new task, found ${newIDs.length}: ${JSON.stringify(newIDs)}`)
    }
    taskID = newIDs[0]

    const row = await getTask(taskID)
    if (row.kind !== "workflow") throw new Error(`expected kind=workflow, got ${row.kind}`)
    if (row.priority !== "high") {
      throw new Error(`expected priority=high on persisted task row, got ${row.priority}`)
    }

    return {
      taskID,
      kind: row.kind,
      priority: row.priority,
      toolCalls: reply.toolCalls,
      tools: calls.map((c) => c.tool),
    }
  })

  // ── Step 2: list tasks ───────────────────────────────────────────────────
  await runStep("list", async () => {
    const { reply, calls } = await chatAndGetTurnCalls(
      "List the 10 most recent tasks for the current project. Call list_tasks exactly once.",
    )
    const list = calls.find((c) => c.tool === "list_tasks")
    if (!list) {
      throw new Error(`expected list_tasks call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    if (list.state !== "completed") {
      throw new Error(`list_tasks state=${list.state}`)
    }
    // Tool outputs are JSON-stringified in ToolStateCompleted.output.
    const parsed = typeof list.output === "string" ? JSON.parse(list.output) : list.output
    const rows = Array.isArray(parsed) ? parsed : []
    const hit = rows.find((r: any) => r?.id === taskID)
    if (!hit) {
      throw new Error(
        `list_tasks output did not contain ${taskID}. Rows: ${JSON.stringify(rows).slice(0, 800)}`,
      )
    }
    return { toolCalls: reply.toolCalls, tools: calls.map((c) => c.tool), rowCount: rows.length }
  })

  // ── Step 2b: list_tasks with status filter ──────────────────────────────
  await runStep("list-filtered", async () => {
    const { reply, calls } = await chatAndGetTurnCalls(
      'List only the queued tasks for the current project. Call list_tasks exactly once with status="queued". ' +
        "Do not invoke any other tools.",
    )
    const list = calls.find((c) => c.tool === "list_tasks")
    if (!list) {
      throw new Error(`expected list_tasks call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    if (list.state !== "completed") throw new Error(`list_tasks state=${list.state}`)
    const input = list.input as { status?: string } | null
    if (input?.status !== "queued") {
      throw new Error(`list_tasks was invoked with status=${input?.status}, expected queued`)
    }
    const parsed = typeof list.output === "string" ? JSON.parse(list.output) : list.output
    const rows = Array.isArray(parsed) ? parsed : []
    for (const r of rows) {
      if (r?.status !== "queued") {
        throw new Error(`list_tasks(status=queued) returned row with status=${r?.status}`)
      }
    }
    const hit = rows.find((r: any) => r?.id === taskID)
    if (!hit) {
      throw new Error(
        `queued list did not contain ${taskID}. Rows: ${JSON.stringify(rows).slice(0, 400)}`,
      )
    }
    return { toolCalls: reply.toolCalls, rowCount: rows.length }
  })

  // ── Step 3: get task details ────────────────────────────────────────────
  await runStep("get", async () => {
    const { reply, calls } = await chatAndGetTurnCalls(
      `Fetch the full details of task ${taskID}. Call get_task exactly once with that taskID.`,
    )
    const get = calls.find((c) => c.tool === "get_task")
    if (!get) {
      throw new Error(`expected get_task call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    if (get.state !== "completed") throw new Error(`get_task state=${get.state}`)
    const input = get.input as { taskID?: string } | null
    if (input?.taskID !== taskID) {
      throw new Error(`get_task was invoked with taskID=${input?.taskID}, expected ${taskID}`)
    }
    return { toolCalls: reply.toolCalls, tools: calls.map((c) => c.tool) }
  })

  // ── Step 4b: forward_to_task on the queued workflow task ────────────────
  // A `/plan …` prefix short-circuits WorkbenchService.ingestTaskMessage to
  // its plan-hint fast-path so this step does not require a real LLM
  // classification round-trip. Task is still queued (no cancel yet), so
  // continueTaskMessage returns cleanly without starting a task loop.
  await runStep("forward-to-task", async () => {
    const hint = "use extreme caution during execution"
    const { reply, calls } = await chatAndGetTurnCalls(
      `Forward this exact message verbatim to task ${taskID}: "/plan ${hint}". ` +
        "Call forward_to_task exactly once with that taskID and that text. Do not invoke any other tools.",
    )
    const fwd = calls.find((c) => c.tool === "forward_to_task")
    if (!fwd) {
      throw new Error(`expected forward_to_task call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    if (fwd.state !== "completed") {
      throw new Error(`forward_to_task state=${fwd.state}, output=${JSON.stringify(fwd.output)}`)
    }
    const input = fwd.input as { taskID?: string; text?: string } | null
    if (input?.taskID !== taskID) {
      throw new Error(`forward_to_task taskID=${input?.taskID}, expected ${taskID}`)
    }
    return { toolCalls: reply.toolCalls, textLen: input?.text?.length ?? 0 }
  })

  // ── Step 4c: forward_clarification unblocks a pending Question.ask ──────
  // Stage a pending question on the gateway sessionID inside the project
  // Instance, capture the generated questionID via Bus.subscribe, then
  // instruct the gateway to reply via forward_clarification. The nested
  // chatAndGetTurnCalls re-enters the same Instance; reply() resolves the
  // original askPromise through shared Instance-scoped state.
  await runStep("forward-clarification", async () => {
    return Instance.provide({
      directory: projectDir,
      fn: async () => {
        let capturedID: string | undefined
        let resolveAsked!: (id: string) => void
        const asked = new Promise<string>((res) => {
          resolveAsked = res
        })
        const unsub = Bus.subscribe(Question.Event.Asked, (ev) => {
          if (capturedID) return
          capturedID = ev.properties.id
          resolveAsked(capturedID)
        })

        try {
          // Fire-and-hold: Question.ask stays pending until reply() is called
          // from the gateway's forward_clarification tool invocation below.
          const askPromise = Question.ask({
            sessionID,
            questions: [
              {
                question: "Pick an option for the E2E probe",
                header: "e2e-probe",
                options: [
                  { label: "Option A", description: "first choice" },
                  { label: "Option B", description: "second choice" },
                ],
              },
            ],
            timeoutMs: 300_000,
          })
          askPromise.catch(() => undefined)

          const qid = await Promise.race([
            asked,
            new Promise<string>((_, rej) =>
              setTimeout(
                () => rej(new Error("Question.Event.Asked not seen within 5000ms")),
                5_000,
              ),
            ),
          ])

          const { reply, calls } = await chatAndGetTurnCalls(
            `A clarification question with id ${qid} is pending on this gateway session. ` +
              `Reply to it with answers [["Option A"]]. Call forward_clarification exactly once ` +
              `with questionID="${qid}" and answers=[["Option A"]]. Do not invoke any other tools.`,
          )
          const fc = calls.find((c) => c.tool === "forward_clarification")
          if (!fc) {
            throw new Error(
              `expected forward_clarification call, got [${calls.map((c) => c.tool).join(", ")}]`,
            )
          }
          if (fc.state !== "completed") throw new Error(`forward_clarification state=${fc.state}`)
          const input = fc.input as { questionID?: string; answers?: unknown } | null
          if (input?.questionID !== qid) {
            throw new Error(`forward_clarification questionID=${input?.questionID}, expected ${qid}`)
          }
          const answers = await Promise.race([
            askPromise,
            new Promise<string[][]>((_, rej) =>
              setTimeout(
                () => rej(new Error("Question.ask did not resolve within 10000ms after reply")),
                10_000,
              ),
            ),
          ])
          if (!Array.isArray(answers) || !Array.isArray(answers[0]) || answers[0][0] !== "Option A") {
            throw new Error(`Question.ask resolved with unexpected answers: ${JSON.stringify(answers)}`)
          }
          return { toolCalls: reply.toolCalls, questionID: qid, answers }
        } finally {
          unsub()
        }
      },
    })
  })

  // ── Step 5: cancel task ─────────────────────────────────────────────────
  await runStep("cancel", async () => {
    const { reply, calls } = await chatAndGetTurnCalls(
      `Cancel task ${taskID} immediately. Call cancel_task exactly once with that taskID.`,
    )
    const cancel = calls.find((c) => c.tool === "cancel_task")
    if (!cancel) {
      throw new Error(`expected cancel_task call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    if (cancel.state !== "completed") throw new Error(`cancel_task state=${cancel.state}`)
    const input = cancel.input as { taskID?: string } | null
    if (input?.taskID !== taskID) {
      throw new Error(`cancel_task was invoked with taskID=${input?.taskID}, expected ${taskID}`)
    }

    // Poll GET /task/:id until status=cancelled, using no-activity timeout
    // (bail only if the status field has not changed for CANCEL_STALL_MS).
    let lastStatus: string | undefined
    let lastChangeAt = Date.now()
    while (true) {
      const row = await getTask(taskID)
      if (row.status !== lastStatus) {
        lastStatus = row.status
        lastChangeAt = Date.now()
      }
      if (row.status === "cancelled") {
        return { toolCalls: reply.toolCalls, finalStatus: row.status }
      }
      if (row.status === "completed" || row.status === "failed") {
        throw new Error(`task reached terminal status ${row.status} instead of cancelled`)
      }
      const idleMs = Date.now() - lastChangeAt
      if (idleMs >= CANCEL_STALL_MS) {
        throw new Error(
          `task status has not changed for ${idleMs}ms (last=${lastStatus}); stall budget ${CANCEL_STALL_MS}ms exceeded`,
        )
      }
      await Bun.sleep(CANCEL_POLL_MS)
    }
  })

  // ── Step 7: cancel unknown task ID surfaces an error (no silent fallback)
  await runStep("cancel-unknown", async () => {
    const unknownID = "tsk_does_not_exist_e2e_probe"
    const { reply, calls } = await chatAndGetTurnCalls(
      `Attempt to cancel task ${unknownID}. Call cancel_task exactly once with that taskID — ` +
        "do not invoke any other tools. If the call fails, surface the failure; do not retry.",
    )
    const cancel = calls.find((c) => c.tool === "cancel_task")
    if (!cancel) {
      throw new Error(`expected cancel_task call, got [${calls.map((c) => c.tool).join(", ")}]`)
    }
    // Structural: the tool MUST end in state=error. If it's "completed" we've
    // regressed — the orchestrator would have silently accepted an unknown ID.
    if (cancel.state !== "error") {
      throw new Error(
        `cancel_task on unknown ID should have errored, got state=${cancel.state}. ` +
          "This indicates a silent fallback in OrchestratorService.cancelTask.",
      )
    }
    return { state: cancel.state, toolCalls: reply.toolCalls }
  })

  // ── switch_cwd on an unregistered path surfaces an error ────────────────
  // Placed BEFORE the success path because a failed switch_cwd must not
  // mutate session cwd — this gives us a clean baseline for the final step.
  await runStep("switch-cwd-error", async () => {
    const bogusCwd = path.join(
      os.tmpdir(),
      `gw-bench-nonexistent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { reply, calls } = await chatAndGetTurnCalls(
      `Change the default working directory for this session to ${JSON.stringify(bogusCwd)}. ` +
        "Call switch_cwd exactly once. Do not invoke any other tools.",
    )
    const sw = calls.find((c) => c.tool === "switch_cwd")
    if (!sw) throw new Error(`expected switch_cwd call, got [${calls.map((c) => c.tool).join(", ")}]`)
    if (sw.state !== "error") {
      throw new Error(
        `switch_cwd on unregistered path should have errored, got state=${sw.state}. ` +
          "This indicates switch_cwd silently accepted an unresolvable directory.",
      )
    }
    const input = sw.input as { cwd?: string } | null
    if (input?.cwd !== bogusCwd) {
      throw new Error(`switch_cwd was invoked with cwd=${input?.cwd}, expected ${bogusCwd}`)
    }
    return { state: sw.state, toolCalls: reply.toolCalls }
  })

  // ── Final step: switch_cwd persists to gateway session metadata ─────────
  // Placed last so we don't have to restore session cwd afterwards (any
  // direct write-back would pollute message parts and break a later turn).
  await runStep("switch-cwd", async () => {
    const altDir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-bench-alt-"))
    await $`git init -q`.cwd(altDir)
    await $`git commit -q --allow-empty -m init`.cwd(altDir)
    await Instance.provide({
      directory: altDir,
      init: InstanceBootstrap,
      fn: async () => undefined,
    })
    const { reply, calls } = await chatAndGetTurnCalls(
      `Change the default working directory for this session to ${JSON.stringify(altDir)}. ` +
        "Call switch_cwd exactly once. Do not invoke any other tools.",
    )
    const sw = calls.find((c) => c.tool === "switch_cwd")
    if (!sw) throw new Error(`expected switch_cwd call, got [${calls.map((c) => c.tool).join(", ")}]`)
    if (sw.state !== "completed") throw new Error(`switch_cwd state=${sw.state}`)
    const input = sw.input as { cwd?: string } | null
    if (input?.cwd !== altDir) throw new Error(`switch_cwd cwd=${input?.cwd}, expected ${altDir}`)
    const persisted = await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const { readCwd } = await import("../../src/gateway/cwd-state")
        const s = await Session.get(sessionID)
        return readCwd(s)
      },
    })
    if (persisted !== altDir) {
      throw new Error(`session cwd not persisted: readCwd=${persisted}, expected=${altDir}`)
    }
    return { newCwd: altDir, toolCalls: reply.toolCalls }
  })

  // ── HTTP input validation — empty text and missing userID both 400 ─────
  // Does not exercise the LLM; purely checks the route's zod validator so
  // a regression there would be caught without burning tokens. Uses raw
  // fetch because api() throws on non-2xx.
  await runStep("http-400", async () => {
    const results: Record<string, { status: number }> = {}
    for (const [label, body] of [
      ["empty-text", { text: "", userID: USER_ID }],
      ["missing-userID", { text: "probe" } as Record<string, unknown>],
    ] as const) {
      const url = new URL("/gateway/message", server.url)
      url.searchParams.set("directory", projectDir)
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      })
      // Drain so the connection does not linger.
      await res.text().catch(() => "")
      if (res.status !== 400) {
        throw new Error(`${label}: expected HTTP 400, got ${res.status}`)
      }
      results[label] = { status: res.status }
    }
    return results
  })

  exitCode = 0
} catch {
  // Step-level errors are already logged; the report writes details below.
  exitCode = 1
} finally {
  const report = {
    ok: exitCode === 0,
    model,
    startedAt: overallStart,
    finishedAt: Date.now(),
    durationMs: Date.now() - overallStart,
    server: server.url.toString(),
    projectDir,
    userID: USER_ID,
    sessionID,
    taskID,
    steps,
  }
  await Bun.write(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`[gateway-benchmark] report -> ${REPORT_PATH}`)
  console.log(JSON.stringify(report, null, 2))

  await server.stop(true)
  await Instance.disposeAll().catch(() => undefined)
}

process.exit(exitCode)
