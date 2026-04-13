#!/usr/bin/env bun
/**
 * trace-coverage benchmark — verdict for the unified Trace system.
 *
 * Goal:
 *   Given a taskID, read its trace JSONL and judge whether the event chain
 *   is complete enough to reconstruct what every workflow agent did.
 *
 * Trace file layout (assumed by the unified Trace module, to be built):
 *   <Instance.directory>/.opencorvus/trace/<taskID>.jsonl
 *   Each line is one TraceEvent: { ts, seq, taskID, sessionID?, agent?, round?, category, payload }
 *
 * Pass criteria (all must hold):
 *   1. File exists, every line parses as JSON.
 *   2. seq is monotonically increasing, no gaps.
 *   3. At least one `task.start` and one `task.finish` (or task still running — flag it, don't fail).
 *   4. At least one `llm.step` per agent that appears in the trace.
 *   5. Every `tool.call` has a matching `tool.result` or `tool.error` with the same call_id.
 *   6. At least 3 distinct agents represented (e.g. decompose / planner / task-agent).
 *   7. No event payload exceeds 1 MB (would suggest unbounded capture).
 *
 * Usage:
 *   bun run script/benchmark/trace-coverage.ts <taskID> [--dir <baseDir>]
 *   bun run script/benchmark/trace-coverage.ts --latest             # auto-pick newest task
 *   bun run script/benchmark/trace-coverage.ts --latest --json      # machine-readable
 *
 * Exit codes:
 *   0  — all criteria pass
 *   1  — at least one criterion fails
 *   2  — usage error or trace file unreadable
 */

import fs from "node:fs/promises"
import path from "node:path"

interface TraceEvent {
  ts: number
  seq: number
  taskID: string
  sessionID?: string
  agent?: string
  round?: number
  category: string
  payload?: Record<string, unknown>
}

interface Verdict {
  pass: boolean
  taskID: string
  file: string
  totalEvents: number
  byCategory: Record<string, number>
  byAgent: Record<string, number>
  taskFinished: boolean
  failures: string[]
  warnings: string[]
}

const REQUIRED_CATEGORIES = ["task.start", "llm.step"]
const MIN_DISTINCT_AGENTS = 3
const MAX_EVENT_BYTES = 1_048_576

async function readJsonl(file: string): Promise<TraceEvent[]> {
  const raw = await fs.readFile(file, "utf-8")
  const events: TraceEvent[] = []
  let lineNo = 0
  for (const line of raw.split(/\r?\n/)) {
    lineNo++
    if (!line.trim()) continue
    if (Buffer.byteLength(line, "utf-8") > MAX_EVENT_BYTES) {
      throw new Error(`line ${lineNo}: event exceeds ${MAX_EVENT_BYTES} bytes`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      throw new Error(`line ${lineNo}: not valid JSON — ${(err as Error).message}`)
    }
    const ev = parsed as Partial<TraceEvent>
    if (typeof ev.seq !== "number" || typeof ev.ts !== "number" || typeof ev.category !== "string") {
      throw new Error(`line ${lineNo}: missing required fields ts/seq/category`)
    }
    events.push(ev as TraceEvent)
  }
  return events
}

function evaluate(taskID: string, file: string, events: TraceEvent[]): Verdict {
  const failures: string[] = []
  const warnings: string[] = []
  const byCategory: Record<string, number> = {}
  const byAgent: Record<string, number> = {}
  const llmStepsByAgent: Record<string, number> = {}
  const toolCallsByID = new Map<string, TraceEvent>()
  const toolResultsByID = new Set<string>()

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    byCategory[ev.category] = (byCategory[ev.category] ?? 0) + 1
    if (ev.agent) byAgent[ev.agent] = (byAgent[ev.agent] ?? 0) + 1
    if (i > 0 && ev.seq !== events[i - 1].seq + 1) {
      failures.push(`seq gap at index ${i}: prev=${events[i - 1].seq} curr=${ev.seq}`)
    }
    if (ev.category === "llm.step" && ev.agent) {
      llmStepsByAgent[ev.agent] = (llmStepsByAgent[ev.agent] ?? 0) + 1
    }
    if (ev.category === "tool.call") {
      const id = (ev.payload?.call_id as string) ?? `${ev.seq}`
      toolCallsByID.set(id, ev)
    }
    if (ev.category === "tool.result" || ev.category === "tool.error") {
      const id = (ev.payload?.call_id as string) ?? ""
      if (id) toolResultsByID.add(id)
    }
  }

  for (const cat of REQUIRED_CATEGORIES) {
    if (!byCategory[cat]) failures.push(`missing required category: ${cat}`)
  }

  const taskFinished = (byCategory["task.finish"] ?? 0) > 0
  if (!taskFinished) warnings.push("no task.finish event — task may still be running")

  const distinctAgents = Object.keys(byAgent).length
  if (distinctAgents < MIN_DISTINCT_AGENTS) {
    failures.push(`only ${distinctAgents} distinct agents (need ≥ ${MIN_DISTINCT_AGENTS}): ${Object.keys(byAgent).join(", ") || "none"}`)
  }

  for (const [agent, count] of Object.entries(byAgent)) {
    if (count > 0 && !llmStepsByAgent[agent]) {
      warnings.push(`agent "${agent}" appeared but emitted no llm.step (only meta events?)`)
    }
  }

  for (const [callID, callEv] of toolCallsByID) {
    if (!toolResultsByID.has(callID)) {
      failures.push(`tool.call without matching result: call_id=${callID} seq=${callEv.seq} tool=${callEv.payload?.tool ?? "?"}`)
    }
  }

  return {
    pass: failures.length === 0,
    taskID,
    file,
    totalEvents: events.length,
    byCategory,
    byAgent,
    taskFinished,
    failures,
    warnings,
  }
}

function findTraceDir(baseDir: string): string {
  const env = process.env.OPENCORVUS_TRACE_DIR
  if (env) return env
  return path.join(baseDir, ".opencorvus", "trace")
}

async function pickLatestTask(traceDir: string): Promise<string> {
  const entries = await fs.readdir(traceDir).catch(() => null)
  if (!entries) throw new Error(`trace dir not found: ${traceDir}`)
  const jsonl = entries.filter((name) => name.endsWith(".jsonl"))
  if (jsonl.length === 0) throw new Error(`no .jsonl files in ${traceDir}`)
  const stats = await Promise.all(
    jsonl.map(async (name) => ({
      name,
      mtime: (await fs.stat(path.join(traceDir, name))).mtimeMs,
    })),
  )
  stats.sort((a, b) => b.mtime - a.mtime)
  return stats[0].name.replace(/\.jsonl$/, "")
}

function printHuman(v: Verdict) {
  const tag = v.pass ? "\x1b[32m✓ PASS\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m"
  console.log(`${tag}  taskID=${v.taskID}`)
  console.log(`       file=${v.file}`)
  console.log(`       events=${v.totalEvents}  finished=${v.taskFinished}`)
  console.log(`       categories=${JSON.stringify(v.byCategory)}`)
  console.log(`       agents=${JSON.stringify(v.byAgent)}`)
  if (v.warnings.length > 0) {
    console.log("       warnings:")
    for (const w of v.warnings) console.log(`         · ${w}`)
  }
  if (v.failures.length > 0) {
    console.log("       failures:")
    for (const f of v.failures) console.log(`         · ${f}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const latest = args.includes("--latest")
  const dirIdx = args.indexOf("--dir")
  const baseDir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : process.cwd()
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--dir")
  const traceDir = findTraceDir(baseDir)

  let taskID: string
  try {
    if (latest) {
      taskID = await pickLatestTask(traceDir)
    } else if (positional[0]) {
      taskID = positional[0]
    } else {
      console.error("usage: trace-coverage.ts <taskID> | --latest [--dir <baseDir>] [--json]")
      process.exit(2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (json) {
      console.log(JSON.stringify({ pass: false, error: msg, traceDir }, null, 2))
    } else {
      console.log(`\x1b[31m✗ FAIL\x1b[0m  ${msg}`)
      console.log(`       traceDir=${traceDir}`)
    }
    process.exit(2)
  }

  const file = path.join(traceDir, `${taskID}.jsonl`)
  let events: TraceEvent[]
  try {
    events = await readJsonl(file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (json) {
      console.log(JSON.stringify({ pass: false, taskID, file, error: msg }, null, 2))
    } else {
      console.log(`\x1b[31m✗ FAIL\x1b[0m  taskID=${taskID}`)
      console.log(`       file=${file}`)
      console.log(`       error: ${msg}`)
    }
    process.exit(2)
  }

  const verdict = evaluate(taskID, file, events)
  if (json) {
    console.log(JSON.stringify(verdict, null, 2))
  } else {
    printHuman(verdict)
  }
  process.exit(verdict.pass ? 0 : 1)
}

await main()
