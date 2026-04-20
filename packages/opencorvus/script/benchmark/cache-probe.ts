#!/usr/bin/env bun
/**
 * Cache-efficiency probe — reads trace.jsonl from any completed
 * overlay-web-benchmark run (or any task trace) and localizes *where* the
 * prompt cache is collapsing.
 *
 * Background: cache_read averages ~4.5k tokens against an ~150k full-hit
 * baseline for the design-analyst agent on the DashScope path. The outbound
 * pipeline never places `cache_control` markers for openai-compatible
 * providers (see packages/opencorvus/src/provider/transform.ts:171-181), so
 * caching falls back to whatever implicit prefix matching the upstream does.
 *
 * This script does NOT run a new task — it analyzes artifacts a benchmark
 * already produced. Run the benchmark once (overlay-web-benchmark.ts) with
 * the usual flags, then point this probe at its project directory.
 *
 * ── Usage ──
 *   bun run script/benchmark/cache-probe.ts --trace-file <path>
 *   bun run script/benchmark/cache-probe.ts --project-dir <path> --task-id <id>
 *   bun run script/benchmark/cache-probe.ts --project-dir <path> --latest
 *
 * ── Output ──
 *   stdout: per-agent + per-call cache efficiency tables, anomalies
 *   <trace-file>.cache-probe.json : machine-readable report
 *   <trace-file>.cache-probe.md   : markdown summary
 *
 * ── How to read the verdict ──
 *   • "hit_ratio" <5% across every call of an agent → that agent never gets
 *     a cache_control marker (confirmed H2: openai-compatible path is gated
 *     out of applyCaching).
 *   • hit_ratio high on round 1-2 then collapses → H5: tail breakpoint moves
 *     each turn, middle history drifts.
 *   • hit_ratio collapses right after a specific tool (e.g. webfetch) → the
 *     tool result body is non-deterministic across turns (litellm `skipped N
 *     chars`, base64 data with timestamps, etc.).
 *   • hit_ratio stable then drops once → a retry/replan re-created a stateful
 *     collector (H1 counter reset).
 */

import fs from "node:fs/promises"
import path from "node:path"

// ────────── CLI ──────────

function flag(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1]
  }
  return undefined
}

const traceFileFlag = flag("--trace-file")
const projectDirFlag = flag("--project-dir")
const taskIDFlag = flag("--task-id")
const useLatest = process.argv.includes("--latest")
const agentFilter = flag("--agent")
const csvFlag = process.argv.includes("--csv")
const quietFlag = process.argv.includes("--quiet")

// ────────── resolve trace file ──────────

async function resolveTraceFile(): Promise<string> {
  if (traceFileFlag) return path.resolve(traceFileFlag)

  if (!projectDirFlag) {
    throw new Error(
      "need --trace-file <path>  OR  --project-dir <path> with one of (--task-id <id> | --latest)",
    )
  }
  const taskRoot = path.resolve(projectDirFlag, ".opencorvus", "task")
  const exists = await fs.stat(taskRoot).catch(() => null)
  if (!exists) throw new Error(`no task traces under ${taskRoot}`)

  if (taskIDFlag) {
    return path.join(taskRoot, taskIDFlag, "trace.jsonl")
  }
  if (useLatest) {
    const entries = await fs.readdir(taskRoot, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())
    const stats = await Promise.all(
      dirs.map(async (d) => {
        const f = path.join(taskRoot, d.name, "trace.jsonl")
        const s = await fs.stat(f).catch(() => null)
        return s ? { file: f, mtime: s.mtimeMs, taskID: d.name } : null
      }),
    )
    const sorted = stats.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.mtime - a.mtime)
    if (!sorted.length) throw new Error(`no trace.jsonl under ${taskRoot}`)
    if (!quietFlag) console.log(`[cache-probe] --latest → ${sorted[0].taskID}`)
    return sorted[0].file
  }
  throw new Error("need either --task-id or --latest when using --project-dir")
}

// ────────── parse trace.jsonl ──────────

interface TraceLine {
  ts: number
  seq: number
  taskID: string
  sessionID?: string
  agent?: string
  round?: number
  category: string
  payload?: any
}

async function readTrace(file: string): Promise<TraceLine[]> {
  const raw = await fs.readFile(file, "utf8")
  const lines: TraceLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      lines.push(JSON.parse(line))
    } catch {
      // skip partial writes
    }
  }
  return lines
}

// ────────── aggregate ──────────

interface StepUsage {
  input: number       // total input tokens reported (may include cached, vendor-dependent)
  output: number
  reasoning: number
  cached: number      // cachedInputTokens — the "read from cache" figure
  call_id: string
  round: number
  agent: string
  session: string
  finish_reason: string
  tool_call_count: number
  tool_result_count: number
  prev_tool_results?: string[]   // names of tool results from prior step (same call_id)
  ts: number
}

function extractUsage(u: any): { input: number; output: number; reasoning: number; cached: number } {
  if (!u || typeof u !== "object") return { input: 0, output: 0, reasoning: 0, cached: 0 }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  return {
    input: n(u.inputTokens ?? u.input_tokens ?? u.input),
    output: n(u.outputTokens ?? u.output_tokens ?? u.output),
    reasoning: n(u.reasoningTokens ?? u.reasoning_tokens ?? u.reasoning),
    // AI SDK v2 surfaces cache reads as `cachedInputTokens`. Anthropic raw
    // returns `cache_read_input_tokens`; some adapters emit `cachedTokens`.
    cached: n(u.cachedInputTokens ?? u.cached_input_tokens ?? u.cachedTokens ?? u.cache_read_input_tokens),
  }
}

interface OutboundCapture {
  ts: number
  agent: string
  session: string
  call_id: string
  round: number
  body: unknown
}

interface RequestCapture {
  ts: number
  agent: string
  session: string
  call_id: string
  request: unknown
}

function aggregate(lines: TraceLine[]): {
  steps: StepUsage[]
  outbound: OutboundCapture[]
  requests: RequestCapture[]
  toolCalls: Array<{ ts: number; agent: string; session: string; call_id: string; tool: string; round?: number }>
  toolResults: Array<{ ts: number; agent: string; session: string; call_id: string; tool: string; round?: number }>
} {
  const steps: StepUsage[] = []
  const outbound: OutboundCapture[] = []
  const requests: RequestCapture[] = []
  const toolCalls: any[] = []
  const toolResults: any[] = []

  for (const e of lines) {
    if (e.category === "llm.step") {
      const u = extractUsage(e.payload?.usage)
      steps.push({
        ...u,
        call_id: String(e.payload?.call_id ?? ""),
        round: typeof e.round === "number" ? e.round : 0,
        agent: e.agent ?? "",
        session: e.sessionID ?? "",
        finish_reason: String(e.payload?.finish_reason ?? ""),
        tool_call_count: Number(e.payload?.tool_call_count ?? 0),
        tool_result_count: Number(e.payload?.tool_result_count ?? 0),
        ts: e.ts,
      })
    } else if (e.category === "llm.outbound") {
      outbound.push({
        ts: e.ts,
        agent: e.agent ?? "",
        session: e.sessionID ?? "",
        call_id: String(e.payload?.call_id ?? ""),
        round: typeof e.round === "number" ? e.round : 0,
        body: e.payload?.body,
      })
    } else if (e.category === "llm.request") {
      requests.push({
        ts: e.ts,
        agent: e.agent ?? "",
        session: e.sessionID ?? "",
        call_id: String(e.payload?.call_id ?? ""),
        request: e.payload?.request,
      })
    } else if (e.category === "tool.call") {
      toolCalls.push({ ts: e.ts, agent: e.agent ?? "", session: e.sessionID ?? "", call_id: String(e.payload?.llm_call_id ?? ""), tool: String(e.payload?.tool ?? ""), round: e.round })
    } else if (e.category === "tool.result" || e.category === "tool.error") {
      toolResults.push({ ts: e.ts, agent: e.agent ?? "", session: e.sessionID ?? "", call_id: String(e.payload?.llm_call_id ?? ""), tool: String(e.payload?.tool ?? ""), round: e.round })
    }
  }
  return { steps, outbound, requests, toolCalls, toolResults }
}

// ────────── prefix-drift analysis ──────────
//
// For each call's consecutive rounds, compute where the outbound body prefix
// diverges from the prior round's serialized body. A healthy tool-loop
// extends the history — turn N+1 is byte-identical to turn N for all of turn
// N's length, plus new trailing messages. Any earlier divergence is a prefix
// drift that defeats implicit prefix caching.

interface PrefixDrift {
  agent: string
  call_id: string
  from_round: number
  to_round: number
  /** prefix length (bytes) of the N-th round's serialized body */
  prev_len: number
  /** byte index where N+1 starts to differ from N */
  divergence_at: number
  /** % of prev body that matched before divergence */
  prefix_match_ratio: number
  /** ±80 bytes of context around the divergence, prev vs. next */
  before: string
  after: string
}

function serialiseBody(body: unknown): string {
  if (body === null || body === undefined) return ""
  if (typeof body === "string") return body
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return i
  return a.length === b.length ? -1 : n
}

function computeDrift(outbound: OutboundCapture[]): PrefixDrift[] {
  const byCall = new Map<string, OutboundCapture[]>()
  for (const o of outbound) {
    if (!o.call_id) continue
    if (!byCall.has(o.call_id)) byCall.set(o.call_id, [])
    byCall.get(o.call_id)!.push(o)
  }
  const drifts: PrefixDrift[] = []
  for (const [call_id, xs] of byCall) {
    xs.sort((a, b) => a.round - b.round || a.ts - b.ts)
    for (let i = 1; i < xs.length; i++) {
      const prev = serialiseBody(xs[i - 1].body)
      const cur = serialiseBody(xs[i].body)
      if (prev.length === 0 || cur.length === 0) continue
      const at = firstDiff(prev, cur)
      if (at === -1 || at >= prev.length) continue // cur extends prev cleanly — healthy
      // Tolerate trivial JSON-serialization drift at the boundary: a round
      // whose body is `{...messages:[..]}` extended by the next round shifts
      // the closing `]}` a few bytes. If the entire tail of prev from the
      // divergence point is made of JSON structural chars + whitespace, this
      // is a terminator shift, not a semantic content drift.
      if (/^[\]\}"\s,]+$/.test(prev.slice(at))) continue
      const ctx = 80
      drifts.push({
        agent: xs[i].agent,
        call_id,
        from_round: xs[i - 1].round,
        to_round: xs[i].round,
        prev_len: prev.length,
        divergence_at: at,
        prefix_match_ratio: at / prev.length,
        before: prev.slice(Math.max(0, at - ctx), Math.min(prev.length, at + ctx)),
        after: cur.slice(Math.max(0, at - ctx), Math.min(cur.length, at + ctx)),
      })
    }
  }
  return drifts
}

// ────────── analysis ──────────

interface AgentSummary {
  agent: string
  step_count: number
  call_count: number
  total_input: number
  total_cached: number
  total_output: number
  hit_ratio: number          // total_cached / total_input (ignoring 0/0)
  zero_hit_steps: number      // steps where cached == 0 despite input > 0
  mean_hit_ratio: number      // per-step mean
}

function summarizeByAgent(steps: StepUsage[]): AgentSummary[] {
  const byAgent = new Map<string, StepUsage[]>()
  for (const s of steps) {
    const k = s.agent || "(unknown)"
    if (!byAgent.has(k)) byAgent.set(k, [])
    byAgent.get(k)!.push(s)
  }
  const out: AgentSummary[] = []
  for (const [agent, xs] of byAgent) {
    const total_input = xs.reduce((a, s) => a + s.input, 0)
    const total_cached = xs.reduce((a, s) => a + s.cached, 0)
    const total_output = xs.reduce((a, s) => a + s.output, 0)
    const calls = new Set(xs.map((s) => s.call_id)).size
    const zeroHits = xs.filter((s) => s.input > 0 && s.cached === 0).length
    const perStep = xs.filter((s) => s.input > 0).map((s) => s.cached / s.input)
    out.push({
      agent,
      step_count: xs.length,
      call_count: calls,
      total_input,
      total_cached,
      total_output,
      hit_ratio: total_input > 0 ? total_cached / total_input : 0,
      zero_hit_steps: zeroHits,
      mean_hit_ratio: perStep.length ? perStep.reduce((a, b) => a + b, 0) / perStep.length : 0,
    })
  }
  return out.sort((a, b) => b.total_input - a.total_input)
}

interface CallProgression {
  call_id: string
  agent: string
  rounds: Array<{ round: number; input: number; cached: number; hit_ratio: number; tool_call_count: number; tool_result_count: number }>
  first_cache_hit_round: number | null
  cache_collapse_round: number | null    // first round where hit_ratio drops below 0.2 after being ≥0.5
}

function summarizeByCall(steps: StepUsage[]): CallProgression[] {
  const byCall = new Map<string, StepUsage[]>()
  for (const s of steps) {
    if (!s.call_id) continue
    if (!byCall.has(s.call_id)) byCall.set(s.call_id, [])
    byCall.get(s.call_id)!.push(s)
  }
  const out: CallProgression[] = []
  for (const [call_id, xs] of byCall) {
    xs.sort((a, b) => a.round - b.round || a.ts - b.ts)
    const rounds = xs.map((s) => ({
      round: s.round,
      input: s.input,
      cached: s.cached,
      hit_ratio: s.input > 0 ? s.cached / s.input : 0,
      tool_call_count: s.tool_call_count,
      tool_result_count: s.tool_result_count,
    }))
    const firstHit = rounds.find((r) => r.cached > 0)
    let collapse: number | null = null
    for (let i = 1; i < rounds.length; i++) {
      const prev = rounds[i - 1]
      const cur = rounds[i]
      if (prev.hit_ratio >= 0.5 && cur.hit_ratio < 0.2) {
        collapse = cur.round
        break
      }
    }
    out.push({
      call_id,
      agent: xs[0].agent,
      rounds,
      first_cache_hit_round: firstHit ? firstHit.round : null,
      cache_collapse_round: collapse,
    })
  }
  return out
}

// ────────── rendering ──────────

function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return "--"
  return (x * 100).toFixed(1) + "%"
}

function fmtInt(x: number): string {
  return x.toLocaleString("en-US")
}

function renderAgentTable(rows: AgentSummary[]): string {
  const header = ["agent", "steps", "calls", "input", "cached", "hit%", "mean%", "zero_hit_steps"]
  const data = rows.map((r) => [
    agentFilter && r.agent !== agentFilter ? "" : r.agent,
    String(r.step_count),
    String(r.call_count),
    fmtInt(r.total_input),
    fmtInt(r.total_cached),
    fmtPct(r.hit_ratio),
    fmtPct(r.mean_hit_ratio),
    String(r.zero_hit_steps),
  ]).filter((row) => row[0])
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ")
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...data.map(line)].join("\n")
}

function renderCallProgression(calls: CallProgression[], maxCalls = 8): string {
  const filtered = agentFilter ? calls.filter((c) => c.agent === agentFilter) : calls
  const show = filtered
    .filter((c) => c.rounds.length > 1)
    .sort((a, b) => b.rounds.reduce((s, r) => s + r.input, 0) - a.rounds.reduce((s, r) => s + r.input, 0))
    .slice(0, maxCalls)

  const blocks: string[] = []
  for (const c of show) {
    const title = `• ${c.agent} / ${c.call_id.slice(0, 12)} — ${c.rounds.length} rounds` +
      (c.cache_collapse_round != null ? ` ⚠ collapse at round ${c.cache_collapse_round}` : "") +
      (c.first_cache_hit_round == null ? " ⚠ no cache hit at all" : "")
    const header = ["round", "input", "cached", "hit%", "tools_in", "tools_out"]
    const data = c.rounds.map((r) => [
      String(r.round),
      fmtInt(r.input),
      fmtInt(r.cached),
      fmtPct(r.hit_ratio),
      String(r.tool_call_count),
      String(r.tool_result_count),
    ])
    const widths = header.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)))
    const line = (cells: string[]) => "   " + cells.map((c, i) => c.padEnd(widths[i])).join("  ")
    blocks.push([title, line(header), line(widths.map((w) => "-".repeat(w))), ...data.map(line)].join("\n"))
  }
  return blocks.join("\n\n")
}

function renderVerdict(rows: AgentSummary[], calls: CallProgression[]): string {
  const verdicts: string[] = []

  const flatline = rows.filter((r) => r.total_input > 2000 && r.hit_ratio < 0.05)
  if (flatline.length) {
    verdicts.push(
      `⚠ Agents with < 5% aggregate cache hit despite >2k input tokens:\n` +
      flatline.map((r) => `   - ${r.agent}: ${fmtInt(r.total_input)} input / ${fmtInt(r.total_cached)} cached (${fmtPct(r.hit_ratio)})`).join("\n") +
      `\n   → Consistent with H2: provider has no cache_control markers injected. See src/provider/transform.ts:171-181.`,
    )
  }

  const collapsing = calls.filter((c) => c.cache_collapse_round != null)
  if (collapsing.length) {
    verdicts.push(
      `⚠ ${collapsing.length} call(s) where cache hit ratio collapsed mid-loop:\n` +
      collapsing.slice(0, 5).map((c) => `   - ${c.agent} / ${c.call_id.slice(0, 12)} at round ${c.cache_collapse_round}`).join("\n") +
      `\n   → Consistent with H5: tail breakpoint moves between turns, or a tool result diverged byte-for-byte.`,
    )
  }

  const noHitEver = calls.filter((c) => c.first_cache_hit_round == null && c.rounds.length > 2)
  if (noHitEver.length) {
    verdicts.push(
      `⚠ ${noHitEver.length} multi-round call(s) that NEVER hit cache (rounds > 2):\n` +
      noHitEver.slice(0, 5).map((c) => `   - ${c.agent} / ${c.call_id.slice(0, 12)} (${c.rounds.length} rounds, ${fmtInt(c.rounds.reduce((s, r) => s + r.input, 0))} input tokens wasted)`).join("\n") +
      `\n   → Either the provider ignores/refuses cache_control for these requests, or the first round already diverged from any cached prefix.`,
    )
  }

  if (!verdicts.length) {
    verdicts.push("✓ No gross anomalies detected. Cache utilization looks healthy across agents.")
  }
  return verdicts.join("\n\n")
}

function renderCSV(steps: StepUsage[]): string {
  const header = ["ts", "agent", "session", "call_id", "round", "input", "cached", "output", "hit_ratio", "finish_reason", "tool_call_count", "tool_result_count"]
  const rows = steps.map((s) => [
    new Date(s.ts).toISOString(),
    s.agent, s.session, s.call_id, String(s.round),
    String(s.input), String(s.cached), String(s.output),
    s.input > 0 ? (s.cached / s.input).toFixed(4) : "0",
    s.finish_reason, String(s.tool_call_count), String(s.tool_result_count),
  ])
  return [header, ...rows].map((r) => r.join(",")).join("\n")
}

// ────────── main ──────────

async function main() {
  const traceFile = await resolveTraceFile()
  const stat = await fs.stat(traceFile).catch(() => null)
  if (!stat) throw new Error(`trace file not found: ${traceFile}`)

  const lines = await readTrace(traceFile)
  if (lines.length === 0) {
    console.error(`[cache-probe] trace is empty: ${traceFile}`)
    process.exit(2)
  }

  const { steps, outbound, requests } = aggregate(lines)
  if (steps.length === 0) {
    console.error(`[cache-probe] no llm.step events in trace (${lines.length} lines total)`)
    process.exit(3)
  }

  const agents = summarizeByAgent(steps)
  const calls = summarizeByCall(steps)
  const drifts = computeDrift(outbound)
  const verdict = renderVerdict(agents, calls)

  // Declare artifact paths up-front so stdout output can reference them.
  const reportJSON = traceFile + ".cache-probe.json"
  const reportMD = traceFile + ".cache-probe.md"

  if (!quietFlag) {
    console.log(`[cache-probe] trace: ${traceFile}`)
    console.log(`[cache-probe] ${lines.length} events, ${steps.length} llm.step, ${outbound.length} llm.outbound, ${requests.length} llm.request, ${new Set(steps.map((s) => s.call_id)).size} distinct LLM calls`)
    console.log("")
    console.log("── per-agent cache efficiency ──")
    console.log(renderAgentTable(agents))
    console.log("")
    console.log("── per-call round progression (top 8 by input size) ──")
    console.log(renderCallProgression(calls, 8))
    if (drifts.length) {
      console.log("")
      console.log(`── prefix drift between consecutive rounds (${drifts.length} events) ──`)
      for (const d of drifts.slice(0, 6)) {
        console.log(`  • ${d.agent} / ${d.call_id.slice(0, 12)} round ${d.from_round}→${d.to_round}: prefix match ${fmtPct(d.prefix_match_ratio)} (diverges at byte ${fmtInt(d.divergence_at)} of ${fmtInt(d.prev_len)})`)
        console.log(`      before: …${d.before.replace(/\s+/g, " ").slice(-120)}`)
        console.log(`      after : …${d.after.replace(/\s+/g, " ").slice(-120)}`)
      }
      if (drifts.length > 6) console.log(`  (+${drifts.length - 6} more; see ${reportJSON})`)
    }
    console.log("")
    console.log("── verdict ──")
    console.log(verdict)
  }

  // Write artifacts.
  await fs.writeFile(
    reportJSON,
    JSON.stringify({
      traceFile,
      generatedAt: new Date().toISOString(),
      agents,
      calls,
      drifts,
      verdict,
      stats: {
        events: lines.length,
        steps: steps.length,
        outbound: outbound.length,
        requests: requests.length,
      },
    }, null, 2),
  )
  const md = [
    `# Cache Probe Report`,
    ``,
    `- trace: \`${traceFile}\``,
    `- events: ${lines.length}`,
    `- llm steps: ${steps.length}`,
    `- distinct LLM calls: ${new Set(steps.map((s) => s.call_id)).size}`,
    ``,
    `## Per-agent cache efficiency`,
    ``,
    "```",
    renderAgentTable(agents),
    "```",
    ``,
    `## Per-call progression (top 8 by input)`,
    ``,
    "```",
    renderCallProgression(calls, 8),
    "```",
    ``,
    `## Verdict`,
    ``,
    verdict,
    ``,
  ].join("\n")
  await fs.writeFile(reportMD, md)

  if (csvFlag) {
    const csvFile = traceFile + ".cache-probe.csv"
    await fs.writeFile(csvFile, renderCSV(steps))
    if (!quietFlag) console.log(`\n[cache-probe] wrote ${csvFile}`)
  }
  if (!quietFlag) {
    console.log(`\n[cache-probe] wrote ${reportJSON}`)
    console.log(`[cache-probe] wrote ${reportMD}`)
  }
}

main().catch((err) => {
  console.error(`[cache-probe] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
