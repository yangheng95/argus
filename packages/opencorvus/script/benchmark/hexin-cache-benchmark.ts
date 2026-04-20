#!/usr/bin/env bun
/**
 * Hexin cache hit-ratio benchmark.
 *
 * Scope: touches nothing outside the hexin provider. Imports only
 * `HEXIN_GATEWAY_URL` / `HEXIN_BUILTIN_KEY` from
 * `../../src/provider/hexin-discovery.ts`.
 *
 * Purpose: decide which cache_control layout reliably hits Anthropic's
 * prefix cache through the hexin LiteLLM gateway. Sliding layouts have
 * been shown (by earlier runs) to embed the cache_control marker into the
 * hashed prefix, so moving the anchor between turns invalidates prior
 * cache entries. Only fixed-invariant placement satisfies the prefix
 * byte-identity requirement across turns.
 *
 * Usage:
 *   bun run script/benchmark/hexin-cache-benchmark.ts \
 *     --cc-layout fixed-invariant --iterations 8 --sleep-ms 300
 *
 *   bun run script/benchmark/hexin-cache-benchmark.ts \
 *     --replay /path/to/captured.json --iterations 10
 *
 * Flags (synthetic mode requires --cc-layout):
 *   --cc-layout <name>   where <name> ∈
 *     current-4slot     system[0] + system[last] + msgs[-2] + msgs[-1]
 *                        (the layout that ships in transform.ts today)
 *     single-sliding    system[0] + system[last] + msgs[-1]
 *                        (diagnostic — single moving anchor; NOT a fix
 *                         candidate because any sliding CC still violates
 *                         prefix invariance on the next turn)
 *     system-only       system[0] + system[last]
 *                        (upper bound of reliability, lower bound of cache
 *                         coverage — tail never cached)
 *     fixed-invariant   system[0] + system[last] + msgs[0]
 *                        (body-level fix candidate; msgs[0] is the first
 *                         user message and never moves in an append-only
 *                         tool loop, so it satisfies prefix invariance)
 *
 *   --replay <path>      replay a captured request body instead of
 *                        synthesizing one. LiteLLM log wrappers are
 *                        auto-unwrapped. Mutually exclusive with
 *                        --cc-layout (the captured body already has CC).
 *   --unique-tail        (replay only) append a per-iter nonce to the
 *                        last user message to defeat LiteLLM's own
 *                        request-level response cache.
 *   --iterations N       default 10
 *   --sleep-ms N         default 500
 *   --max-tokens N       cap body.max_tokens (default 32, keep cheap)
 *   --x-user KEY         override x-user (default: replay's own or
 *                        synthetic fingerprint)
 *   --endpoint URL       full /chat/completions URL; default = hexin
 *                        gateway derived from hexin-discovery
 *   --model NAME         synthetic-mode model; default claude-sonnet-4-6
 *   --no-litellm-cache   send cache-bypass hints to the LiteLLM layer
 *   --output-prefix PATH writes <prefix>.jsonl + <prefix>.md
 *
 * Per-iteration measurements:
 *   cache_read_input_tokens     (Anthropic — longer prefix = better)
 *   cache_creation_input_tokens (Anthropic — billed at 1.25×)
 *   input_tokens                (fresh input, billed at 1.0×)
 *   effective_input_billed      = input + 1.25×creation + 0.1×read
 *                                 (normalized to 1.0× rate so each layout
 *                                  can be compared head-to-head in $)
 *   latency_ms, http_status, route fingerprint
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"
import { HEXIN_GATEWAY_URL, HEXIN_BUILTIN_KEY } from "../../src/provider/hexin-discovery"

// ── CLI ───────────────────────────────────────────────────────────────
function flag(name: string, fallback?: string): string | undefined {
  const argv = process.argv
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  if (i !== -1 && i + 1 < argv.length && !argv[i + 1].startsWith("--")) return argv[i + 1]
  return fallback
}

const CC_LAYOUTS = ["current-4slot", "single-sliding", "system-only", "fixed-invariant"] as const
type CCLayout = typeof CC_LAYOUTS[number]

const replayPath = flag("--replay")
const ccLayoutRaw = flag("--cc-layout")
const syntheticModel = flag("--model", "claude-sonnet-4-6")!
const iterations = parseInt(flag("--iterations", "10")!, 10)
const sleepMs = parseInt(flag("--sleep-ms", "500")!, 10)
const maxTokensOverride = parseInt(flag("--max-tokens", "32")!, 10)
const outputPrefix = flag(
  "--output-prefix",
  resolve(replayPath ? replayPath + ".bench" : `hexin-bench-${ccLayoutRaw ?? "replay"}-${Date.now()}`),
)!
const endpointOverride = flag("--endpoint")
const xUserOverride = flag("--x-user")
const uniqueTail = process.argv.includes("--unique-tail")
const bypassLiteLlmCache = process.argv.includes("--no-litellm-cache")

// Validate mode selection.
if (replayPath && ccLayoutRaw) {
  console.error("conflict: --replay and --cc-layout are mutually exclusive")
  console.error("(replay reuses the captured body's own cache_control markers; cc-layout synthesizes a fresh body)")
  process.exit(2)
}
if (!replayPath && !ccLayoutRaw) {
  console.error("synthetic mode requires --cc-layout <name>, where <name> is one of:")
  for (const n of CC_LAYOUTS) console.error(`    ${n}`)
  console.error("(or use --replay <path> to reuse a captured body)")
  process.exit(2)
}
if (ccLayoutRaw && !(CC_LAYOUTS as readonly string[]).includes(ccLayoutRaw)) {
  console.error(`unknown --cc-layout "${ccLayoutRaw}". valid values: ${CC_LAYOUTS.join(", ")}`)
  process.exit(2)
}
const ccLayout = (ccLayoutRaw ?? null) as CCLayout | null
if (uniqueTail && !replayPath) {
  console.error("--unique-tail only applies with --replay (synthetic layouts already vary the tail per iteration)")
  process.exit(2)
}

// ── Body synthesis ────────────────────────────────────────────────────
// The synthetic body intentionally uses TWO system messages so that
// layouts which want both `system[0]` and `system[last]` as distinct
// anchors have somewhere to place them. Each iteration appends 2 tail
// messages (assistant + user) to simulate a tool loop growing by 2 per
// turn. Content per-position is fixed → the only thing that changes
// across iterations is cache_control placement for sliding layouts.
function buildLayoutBody(iter: number, layout: CCLayout): any {
  const fillerA = Array.from({ length: 60 }, (_, i) =>
    `Header rule ${i + 1}: cached prefix must stay byte-identical across turns. ` +
    `Any dynamic content inside the cached region invalidates the write.`,
  ).join(" ")
  const fillerB = Array.from({ length: 60 }, (_, i) =>
    `Tail rule ${i + 1}: dynamic outputs (tool results, timestamps, UUIDs) ` +
    `must live outside the cached anchor to preserve prefix invariance.`,
  ).join(" ")
  const systemA = `System anchor A — stable across turns. ${fillerA}`
  const systemB = `System anchor B — stable across turns. Reply with "ok" only. ${fillerB}`

  const turn = (k: number) => [
    { role: "assistant", content: `Turn ${k} assistant observation. Proceeding.` },
    { role: "user", content: `Turn ${k} user follow-up. Continue.` },
  ]

  const messages: any[] = [
    { role: "system", content: systemA },
    { role: "system", content: systemB },
    { role: "user", content: "Initial task: please respond." },
  ]
  for (let k = 1; k <= iter; k++) messages.push(...turn(k))

  // Mark the system edges and per-layout tail anchors.
  const systemIdxs = messages.map((m, idx) => m.role === "system" ? idx : -1).filter((i) => i >= 0)
  const firstSys = systemIdxs[0]
  const lastSys = systemIdxs[systemIdxs.length - 1]
  const nonSysIdxs = messages.map((m, idx) => m.role === "system" ? -1 : idx).filter((i) => i >= 0)
  const firstNonSys = nonSysIdxs[0]
  const lastNonSys = nonSysIdxs[nonSysIdxs.length - 1]
  const secondLastNonSys = nonSysIdxs[nonSysIdxs.length - 2]

  const mark = (idx: number) => {
    if (idx < 0 || idx >= messages.length) return
    messages[idx].cache_control = { type: "ephemeral" }
  }

  switch (layout) {
    case "current-4slot":
      mark(firstSys)
      mark(lastSys)
      mark(secondLastNonSys)
      mark(lastNonSys)
      break
    case "single-sliding":
      mark(firstSys)
      mark(lastSys)
      mark(lastNonSys)
      break
    case "system-only":
      mark(firstSys)
      mark(lastSys)
      break
    case "fixed-invariant":
      mark(firstSys)
      mark(lastSys)
      mark(firstNonSys)  // never moves in append-only tool loop
      break
  }

  return {
    model: syntheticModel,
    messages,
    stream: false,
    max_tokens: maxTokensOverride,
  }
}

// ── Replay support ────────────────────────────────────────────────────
function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let k = arr.length - 1; k >= 0; k--) if (pred(arr[k])) return k
  return -1
}

function mutateTail(src: any, iter: number) {
  // Append a unique nonce to the LAST user message so LiteLLM's
  // full-body response cache can't hit. cache_control in the replay body
  // is untouched — Anthropic's prefix cache can still match bytes up to
  // the last anchor in the replay.
  const clone = structuredClone(src)
  const msgs = clone.messages as Array<any>
  const idx = findLastIndex(msgs, (m) => m.role === "user")
  if (idx < 0) return clone
  const m = msgs[idx]
  const nonce = ` [nonce:${iter}:${Date.now()}]`
  if (typeof m.content === "string") m.content = m.content + nonce
  else if (Array.isArray(m.content)) {
    const lastText = findLastIndex(m.content, (p: any) => p?.type === "text")
    if (lastText >= 0) m.content[lastText].text = (m.content[lastText].text ?? "") + nonce
    else m.content.push({ type: "text", text: nonce })
  }
  return clone
}

let replayBody: any
let capturedXUser: string | undefined
if (replayPath) {
  const raw = JSON.parse(readFileSync(resolve(replayPath), "utf8"))
  replayBody = raw.request?.body ?? raw.body ?? raw
  capturedXUser = (raw.metadata?.headers?.["x-user"] ?? raw.headers?.["x-user"]) as string | undefined
  // Keep cache_control as-is; force non-stream + cap max_tokens.
  replayBody.stream = false
  delete replayBody.stream_options
  replayBody.max_tokens = maxTokensOverride
  if (!replayBody.model || !Array.isArray(replayBody.messages)) {
    console.error("replay body is missing .model or .messages — refusing to run")
    process.exit(2)
  }
}

const xUser = xUserOverride ?? capturedXUser ?? `hexin-bench-${ccLayoutRaw ?? "replay"}-${Date.now()}`

// ── Endpoint ──────────────────────────────────────────────────────────
function resolveEndpoint(): string {
  return `${HEXIN_GATEWAY_URL.replace(/\/+$/, "")}/chat/completions`
}
const endpoint = endpointOverride ?? resolveEndpoint()

console.log(`hexin cache benchmark`)
console.log(`  mode     : ${replayPath ? `replay (${replayPath})` : `synthetic cc-layout=${ccLayout}`}`)
console.log(`  endpoint : ${endpoint}`)
console.log(`  model    : ${replayBody?.model ?? syntheticModel}`)
console.log(`  x-user   : ${xUser}${xUserOverride ? " (override)" : capturedXUser ? " (from replay)" : " (synthetic)"}`)
console.log(`  iters    : ${iterations}  sleep: ${sleepMs}ms  max_tokens: ${maxTokensOverride}`)
console.log(`  flags    : unique-tail=${uniqueTail}  no-litellm-cache=${bypassLiteLlmCache}`)
console.log(``)

// ── Observation ───────────────────────────────────────────────────────
interface Observation {
  i: number
  t0: number
  latency_ms: number
  http_status: number
  ok: boolean
  cache_read: number
  cache_creation: number
  input_tokens: number
  output_tokens: number
  effective_input_billed: number  // input + 1.25*creation + 0.1*read
  route: Record<string, string>
  error?: string
}

function effectiveInputBilled(input: number, creation: number, read: number): number {
  // Normalized to 1.0× input-rate units. Matches Anthropic's posted
  // multipliers for ephemeral cache (1.25× write, 0.1× read).
  return Math.round(input + 1.25 * creation + 0.1 * read)
}

async function once(i: number): Promise<Observation> {
  const t0 = Date.now()
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${HEXIN_BUILTIN_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-user": xUser,
  }
  if (bypassLiteLlmCache) {
    headers["Cache-Control"] = "no-cache"
    headers["x-litellm-cache"] = "no-cache"
  }

  const payload: any = (() => {
    if (ccLayout) return buildLayoutBody(i, ccLayout)
    if (uniqueTail) return mutateTail(replayBody, i)
    return replayBody
  })()
  if (bypassLiteLlmCache && !("cache" in payload)) {
    payload.cache = { "no-cache": true }
  }

  let res: Response
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) })
  } catch (err) {
    return {
      i, t0, latency_ms: Date.now() - t0, http_status: 0, ok: false,
      cache_read: 0, cache_creation: 0, input_tokens: 0, output_tokens: 0,
      effective_input_billed: 0, route: {},
      error: err instanceof Error ? err.message : String(err),
    }
  }
  const latency = Date.now() - t0
  const route: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    const K = k.toLowerCase()
    if (
      K.startsWith("x-") ||
      K.startsWith("cf-") ||
      K.startsWith("anthropic-") ||
      K.startsWith("openai-") ||
      K === "server" ||
      K === "via"
    ) route[K] = v
  })
  const text = await res.text()
  if (!res.ok) {
    return {
      i, t0, latency_ms: latency, http_status: res.status, ok: false,
      cache_read: 0, cache_creation: 0, input_tokens: 0, output_tokens: 0,
      effective_input_billed: 0, route, error: text.slice(0, 400),
    }
  }
  let json: any
  try { json = JSON.parse(text) } catch {
    return {
      i, t0, latency_ms: latency, http_status: res.status, ok: false,
      cache_read: 0, cache_creation: 0, input_tokens: 0, output_tokens: 0,
      effective_input_billed: 0, route, error: `non-json body: ${text.slice(0, 200)}`,
    }
  }
  const usage = json.usage ?? {}
  const cacheRead =
    usage.cache_read_input_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0
  const cacheCreate =
    usage.cache_creation_input_tokens ??
    usage.prompt_tokens_details?.cache_creation_tokens ??
    0
  const inTok = usage.prompt_tokens ?? usage.input_tokens ?? 0
  // When LiteLLM reports prompt_tokens as the TOTAL (including cached),
  // back out the non-cached portion to keep effective_input_billed honest.
  const freshInput = Math.max(0, inTok - cacheRead - cacheCreate)
  return {
    i, t0, latency_ms: latency, http_status: res.status, ok: true,
    cache_read: cacheRead,
    cache_creation: cacheCreate,
    input_tokens: inTok,
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    effective_input_billed: effectiveInputBilled(freshInput, cacheCreate, cacheRead),
    route,
  }
}

// ── Run loop ──────────────────────────────────────────────────────────
const jsonlPath = `${outputPrefix}.jsonl`
const mdPath = `${outputPrefix}.md`
writeFileSync(jsonlPath, "")
const obs: Observation[] = []

const routeKey = (o: Observation) =>
  o.route["x-litellm-model-id"] ??
  o.route["anthropic-request-id"]?.split("_")[1]?.slice(0, 8) ??
  "—"

const fmtRow = (o: Observation) => {
  const rk = routeKey(o)
  const status =
    !o.ok ? `ERR(${o.http_status || "net"})` :
    o.cache_read > 0 ? `HIT   ${o.cache_read.toString().padStart(6)}r` :
    o.cache_creation > 0 ? `MISS  ${o.cache_creation.toString().padStart(6)}c` :
    `? (read=${o.cache_read}, create=${o.cache_creation})`
  return `#${o.i.toString().padStart(2)}  ${status}  ${o.latency_ms.toString().padStart(5)}ms  ` +
    `in=${o.input_tokens}  billed=${o.effective_input_billed}  route=${rk}`
}

console.log(`running ${iterations} iterations...`)
for (let i = 1; i <= iterations; i++) {
  const o = await once(i)
  obs.push(o)
  appendFileSync(jsonlPath, JSON.stringify(o) + "\n")
  console.log(fmtRow(o))
  if (o.error) console.log(`     err: ${o.error.slice(0, 160)}`)
  if (i < iterations && sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
}

// ── Summarize ─────────────────────────────────────────────────────────
const ok = obs.filter((o) => o.ok)
const hits = ok.filter((o) => o.cache_read > 0)
const misses = ok.filter((o) => o.cache_read === 0)
const errors = obs.filter((o) => !o.ok)
const sum = (arr: Observation[], f: (o: Observation) => number) => arr.reduce((s, o) => s + f(o), 0)
const avgLat = (arr: Observation[]) => arr.length ? Math.round(sum(arr, (o) => o.latency_ms) / arr.length) : 0

const byRoute = new Map<string, { hit: number; miss: number }>()
for (const o of ok) {
  const k = routeKey(o)
  const cur = byRoute.get(k) ?? { hit: 0, miss: 0 }
  if (o.cache_read > 0) cur.hit++; else cur.miss++
  byRoute.set(k, cur)
}

const totals = {
  cache_read: sum(ok, (o) => o.cache_read),
  cache_creation: sum(ok, (o) => o.cache_creation),
  input_tokens: sum(ok, (o) => o.input_tokens),
  effective_input_billed: sum(ok, (o) => o.effective_input_billed),
}
const hitRatio = ok.length ? (hits.length / ok.length * 100) : 0

// Markdown
let md = ""
md += `# Hexin cache benchmark\n\n`
md += `- mode: \`${replayPath ? `replay (${replayPath})` : `synthetic cc-layout=${ccLayout}`}\`\n`
md += `- endpoint: \`${endpoint}\`\n`
md += `- model: \`${replayBody?.model ?? syntheticModel}\`  iterations: ${iterations}  sleep: ${sleepMs}ms  x-user: \`${xUser}\`\n\n`
md += `## Overall\n\n`
md += `| metric | value |\n|---|---|\n`
md += `| hit_ratio | **${hitRatio.toFixed(1)}%** (${hits.length}/${ok.length}) |\n`
md += `| miss      | ${misses.length} |\n`
md += `| error     | ${errors.length} |\n`
md += `| Σ cache_read     | ${totals.cache_read} |\n`
md += `| Σ cache_creation | ${totals.cache_creation} |\n`
md += `| Σ input_tokens   | ${totals.input_tokens} |\n`
md += `| Σ effective_input_billed | ${totals.effective_input_billed} |\n`
md += `| avg_lat hit  | ${avgLat(hits)} ms |\n`
md += `| avg_lat miss | ${avgLat(misses)} ms |\n\n`
md += `## By routing fingerprint\n\n`
md += `| route_key | hits | misses |\n|---|---|---|\n`
for (const [k, v] of [...byRoute.entries()].sort((a, b) => (b[1].hit + b[1].miss) - (a[1].hit + a[1].miss))) {
  md += `| \`${k}\` | ${v.hit} | ${v.miss} |\n`
}
md += `\n## Per-iteration\n\n`
md += `| # | status | latency_ms | input | output | cache_read | cache_creation | effective_input_billed | route |\n`
md += `|---|---|---|---|---|---|---|---|---|\n`
for (const o of obs) {
  const status = !o.ok ? "ERROR" : o.cache_read > 0 ? "HIT" : "MISS"
  md += `| ${o.i} | ${status} | ${o.latency_ms} | ${o.input_tokens} | ${o.output_tokens} | ${o.cache_read} | ${o.cache_creation} | ${o.effective_input_billed} | \`${routeKey(o)}\` |\n`
}
writeFileSync(mdPath, md)

// Stdout summary
console.log(``)
console.log(`── Summary ──`)
console.log(`  hit_ratio=${hitRatio.toFixed(1)}%  hit=${hits.length}  miss=${misses.length}  error=${errors.length}`)
console.log(`  Σ cache_read=${totals.cache_read}  Σ cache_creation=${totals.cache_creation}`)
console.log(`  Σ input_tokens=${totals.input_tokens}  Σ effective_input_billed=${totals.effective_input_billed}`)
console.log(`  avg latency: hit=${avgLat(hits)}ms  miss=${avgLat(misses)}ms`)
if (byRoute.size > 1) {
  console.log(`  route distribution (${byRoute.size} distinct fingerprints):`)
  for (const [k, v] of byRoute) console.log(`    ${k}: ${v.hit} hits / ${v.miss} misses`)
  const missOnlyRoutes = [...byRoute.entries()].filter(([, v]) => v.hit === 0 && v.miss > 0)
  if (missOnlyRoutes.length > 0) {
    console.log(`  ⚠ ${missOnlyRoutes.length} route(s) saw ONLY misses — sticky-routing breakage confirmed`)
  }
} else if (byRoute.size === 1) {
  console.log(`  single route observed → sticky held; any miss is not upstream-shift`)
}
console.log(``)
console.log(`  wrote:  ${jsonlPath}`)
console.log(`          ${mdPath}`)
