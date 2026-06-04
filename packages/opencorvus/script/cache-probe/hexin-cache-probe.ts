/**
 * Hexin gateway prompt-cache probe.
 *
 * Hits https://aimemodeldev.myhexin.com/litellm/v1 directly
 * (no ai-sdk wrapper) so we observe raw OpenAI-compatible usage fields.
 *
 * The gateway sits in front of Azure OpenAI / OpenAI upstreams and uses
 * LiteLLM-style round-robin across a pool of upstream API keys. The
 * `x-user` request header is hashed for sticky upstream-key routing —
 * without it, every request lands on a random upstream whose prompt
 * cache was populated by someone else.
 *
 * What we measure: response.usage.prompt_tokens_details.cached_tokens
 *   (and total prompt_tokens to derive hit ratio).
 *
 * Probes:
 *   1. baseline-with-sticky    — same prompt × N, with stable x-user
 *   2. baseline-no-sticky      — same prompt × N, no x-user header
 *   3. prefix-length-floor     — 256 / 1024 / 4096 / 16k / 60k token prefix × 2
 *   4. sticky-isolation        — N distinct x-user, each sends 2 requests
 *   5. prefix-instability      — fixed body, vary one knob at a time:
 *                                trailing-newline, dynamic-timestamp,
 *                                tools-order, response-format, temperature
 *   6. ttl-decay               — warm cache, then wait 0/30/120/300/600s
 *
 * Usage:
 *   HEXIN_API_KEY=... bun script/cache-probe/hexin-cache-probe.ts \
 *     [--model=gpt-5.4] [--out=./out] [--skip=ttl] [--only=baseline-with-sticky]
 *
 * Output:
 *   <out>/hexin-cache-probe.ndjson   one row per HTTP call
 *   <out>/hexin-cache-probe.md       summary report
 */

import path from "path"
import fs from "fs"
import { performance } from "perf_hooks"

const HEXIN_URL = process.env.HEXIN_OPENAI_URL?.trim()
  ? `${process.env.HEXIN_OPENAI_URL.replace(/\/+$/, "")}/v1`
  : "https://aimemodeldev.myhexin.com/litellm/v1"
// Embedded fallback removed — operator must export HEXIN_API_KEY before
// running the cache probe (rule 7: no fallback / rule 10: no hardcoded
// credentials).
const API_KEY = process.env.HEXIN_API_KEY?.trim()
if (!API_KEY) {
  console.error("HEXIN_API_KEY is not set — export it before running this script.")
  process.exit(1)
}

type Vendor = "openai" | "anthropic"

interface Args {
  model: string
  vendor: Vendor
  out: string
  only?: string
  skip: Set<string>
}

function parseArgs(): Args {
  // Resolve relative to this script file, not cwd, so we don't get
  // packages/opencorvus/packages/opencorvus/... when invoked from package root.
  const defaultOut = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out")
  const args: Args = { model: "gpt-5.4", vendor: "openai", out: defaultOut, skip: new Set() }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--model=")) args.model = a.slice(8)
    else if (a.startsWith("--vendor=")) args.vendor = (a.slice(9) as Vendor)
    else if (a.startsWith("--out=")) args.out = path.resolve(a.slice(6))
    else if (a.startsWith("--only=")) args.only = a.slice(7)
    else if (a.startsWith("--skip=")) a.slice(7).split(",").forEach((s) => args.skip.add(s.trim()))
  }
  // Auto-derive vendor from model id when vendor was left default but model
  // is clearly Claude. Saves a flag in the common case.
  if (!process.argv.some((a) => a.startsWith("--vendor=")) && /^claude/i.test(args.model)) {
    args.vendor = "anthropic"
  }
  // Suffix vendor onto output filenames so OpenAI + Anthropic runs don't
  // overwrite each other.
  return args
}

interface ProbeRow {
  probe: string
  variant: string
  iteration: number
  status: number
  prompt_tokens?: number
  cached_tokens?: number
  cache_hit_ratio?: number
  completion_tokens?: number
  total_tokens?: number
  latency_ms: number
  request_id?: string
  upstream?: string
  sticky_key?: string
  error?: string
}

const rows: ProbeRow[] = []

interface CallOpts {
  probe: string
  variant: string
  iteration: number
  stickyKey?: string
  body: Record<string, unknown>
}

let CURRENT_VENDOR: Vendor = "openai"

async function call(opts: CallOpts): Promise<ProbeRow> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "User-Agent": "opencorvus-cache-probe/1",
  }
  if (opts.stickyKey) headers["x-user"] = opts.stickyKey

  const t0 = performance.now()
  let status = 0
  let request_id: string | undefined
  let upstream: string | undefined
  const row: ProbeRow = {
    probe: opts.probe,
    variant: opts.variant,
    iteration: opts.iteration,
    status: 0,
    latency_ms: 0,
    sticky_key: opts.stickyKey,
  }
  try {
    const res = await fetch(`${HEXIN_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body),
    })
    status = res.status
    request_id = res.headers.get("x-request-id") ?? res.headers.get("x-litellm-call-id") ?? undefined
    upstream = res.headers.get("x-litellm-model-id") ?? res.headers.get("x-openai-model") ?? undefined
    const text = await res.text()
    row.latency_ms = Math.round(performance.now() - t0)
    row.status = status
    row.request_id = request_id
    row.upstream = upstream

    if (!res.ok) {
      row.error = text.slice(0, 400)
      return row
    }
    const json = JSON.parse(text)
    const usage = json.usage ?? {}
    const details = usage.prompt_tokens_details ?? usage.input_token_details ?? {}
    row.prompt_tokens = usage.prompt_tokens ?? usage.input_tokens
    row.completion_tokens = usage.completion_tokens ?? usage.output_tokens
    row.total_tokens = usage.total_tokens
    if (CURRENT_VENDOR === "anthropic") {
      // Anthropic prompt cache reports two distinct counters, NOT
      // prompt_tokens_details.cached_tokens. LiteLLM passes them through
      // either at usage root or under cache_*_input_tokens keys.
      const cacheRead =
        usage.cache_read_input_tokens ??
        details.cache_read_input_tokens ??
        details.cached_tokens ??
        0
      const cacheCreate =
        usage.cache_creation_input_tokens ?? details.cache_creation_input_tokens ?? 0
      row.cached_tokens = cacheRead
      // For Anthropic, prompt_tokens excludes cache_read/cache_creation —
      // total prompt = prompt_tokens + cache_read + cache_creation. Use the
      // sum as the denominator so hit ratio reflects what % of the input
      // bytes actually hit cache.
      const totalInput = (row.prompt_tokens ?? 0) + cacheRead + cacheCreate
      if (totalInput > 0) row.cache_hit_ratio = cacheRead / totalInput
    } else {
      row.cached_tokens = details.cached_tokens ?? details.cached ?? 0
      if (typeof row.prompt_tokens === "number" && row.prompt_tokens > 0) {
        row.cache_hit_ratio = (row.cached_tokens ?? 0) / row.prompt_tokens
      }
    }
  } catch (err) {
    row.latency_ms = Math.round(performance.now() - t0)
    row.error = err instanceof Error ? err.message : String(err)
  }
  return row
}

function record(row: ProbeRow) {
  rows.push(row)
  const compact = {
    probe: row.probe,
    variant: row.variant,
    iter: row.iteration,
    status: row.status,
    prompt: row.prompt_tokens,
    cached: row.cached_tokens,
    hit: row.cache_hit_ratio !== undefined ? Number(row.cache_hit_ratio.toFixed(3)) : undefined,
    out: row.completion_tokens,
    ms: row.latency_ms,
    sticky: row.sticky_key,
    err: row.error,
  }
  console.log(JSON.stringify(compact))
}

/**
 * Build a long, deterministic system prompt of approximately `targetTokens`.
 * Uses repeating but structurally varied content so the gateway/upstream
 * cannot trivially compress, but the prefix is bytewise identical across
 * calls. Token count is approximate (we use ~4 chars/token heuristic).
 */
function makeSystem(targetTokens: number, seed = "alpha"): string {
  const charsTarget = targetTokens * 4
  const lines: string[] = [
    "You are a precise assistant participating in a prompt-cache benchmark.",
    "Reply with the single word OK and nothing else.",
    `# Section ${seed}`,
  ]
  let i = 0
  while (lines.join("\n").length < charsTarget) {
    lines.push(
      `- rule ${i}: do not invent facts; only acknowledge with OK.`,
      `- rule ${i}.a: payload tag ${seed}-${i.toString(16)} kept stable across calls.`,
      `- rule ${i}.b: this line exists purely to lengthen the cacheable prefix to test gateway prompt cache behavior.`,
    )
    i++
  }
  return lines.join("\n").slice(0, charsTarget)
}

/**
 * Build a body whose system prefix is bytewise stable across calls but whose
 * final user message carries a nonce.  This separates two cache layers:
 *   - LiteLLM/gateway response cache: keys on the WHOLE request hash, so a
 *     nonce in the user message busts it.
 *   - OpenAI/Azure prompt cache: keys on the message PREFIX, so the long
 *     stable system prompt should still hit (when the prefix is ≥ the
 *     upstream's minimum, typically 1024 tokens).
 * If we see fast (<200ms) responses with cached_tokens=0 after busting the
 * nonce, that's strong evidence the gateway response cache is masking
 * everything — and prompt cache is never being measured.
 */
function baseBody(model: string, system: string, nonce: string, extra: Record<string, unknown> = {}) {
  const userMessage = `Reply with OK. [probe nonce=${nonce}]`
  // Wire shape verified against the production @ai-sdk/openai-compatible
  // adapter via trace-aisdk-wire.ts: `cache_control` lives at the MESSAGE
  // top level (sibling of role/content), NOT inside a content array. Hexin
  // gateway forwards that exact shape to the upstream Anthropic provider.
  // An earlier version put cache_control on a content[].text block — that
  // shape is silently ignored by the gateway, returning 0% cache hits in
  // probes despite cache_control "looking right" at a glance.
  const systemMessage: Record<string, unknown> =
    CURRENT_VENDOR === "anthropic"
      ? { role: "system", content: system, cache_control: { type: "ephemeral" } }
      : { role: "system", content: system }
  return {
    model,
    messages: [systemMessage, { role: "user", content: userMessage }],
    max_tokens: 4,
    temperature: 0,
    stream: false,
    ...extra,
  }
}

function nonce(probe: string, variant: string, iter: number): string {
  return `${probe}-${variant}-${iter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Probe 0 — separate gateway response cache from upstream prompt cache.
 * Send the SAME body twice (same nonce) → if 2nd is suspiciously fast and
 * usage matches 1st exactly, the gateway is response-caching. Then send
 * a new nonce → if that one is also fast with cached_tokens=0, the
 * gateway is masking everything and we never see prompt cache at all.
 */
async function probe0_response_cache(model: string) {
  const system = makeSystem(4096, "p0")
  const stickyKey = `probe-respcache-${Date.now()}`

  // Same body sent twice — bytewise identical (including nonce)
  const fixedNonce = `fixed-${Date.now()}`
  const fixedBody = baseBody(model, system, fixedNonce)
  for (let i = 0; i < 2; i++) {
    record(await call({ probe: "0-response-cache", variant: "same-body-repeat", iteration: i, stickyKey, body: fixedBody }))
  }

  // Different nonce each time — busts gateway response cache, but the
  // 4096-token system prefix is identical, so OpenAI prompt cache *should*
  // hit (if the gateway forwards prompt_tokens_details correctly).
  for (let i = 0; i < 4; i++) {
    record(await call({ probe: "0-response-cache", variant: "fresh-nonce", iteration: i, stickyKey, body: baseBody(model, system, nonce("0", "fresh", i)) }))
  }
}

async function probe1_sticky(model: string) {
  const system = makeSystem(4096, "p1")
  const stickyKey = `probe-sticky-${Date.now()}`
  for (let i = 0; i < 4; i++) {
    record(await call({ probe: "1-sticky", variant: "with-sticky", iteration: i, stickyKey, body: baseBody(model, system, nonce("1", "sticky", i)) }))
  }
}

async function probe2_no_sticky(model: string) {
  const system = makeSystem(4096, "p2")
  for (let i = 0; i < 6; i++) {
    record(await call({ probe: "2-no-sticky", variant: "no-sticky", iteration: i, body: baseBody(model, system, nonce("2", "nosticky", i)) }))
  }
}

async function probe3_prefix_floor(model: string) {
  const targets = [256, 1024, 4096, 16384, 60000]
  for (const t of targets) {
    const system = makeSystem(t, `p3-${t}`)
    const stickyKey = `probe-floor-${t}-${Date.now()}`
    for (let i = 0; i < 3; i++) {
      record(await call({ probe: "3-prefix-floor", variant: `tokens-${t}`, iteration: i, stickyKey, body: baseBody(model, system, nonce("3", `t${t}`, i)) }))
    }
  }
}

async function probe4_sticky_isolation(model: string) {
  const system = makeSystem(4096, "p4")
  const keys = ["alpha", "beta", "gamma"].map((k) => `probe-iso-${k}-${Date.now()}`)
  for (const k of keys) {
    for (let i = 0; i < 3; i++) {
      record(await call({ probe: "4-sticky-isolation", variant: `key-${k.split("-")[2]}`, iteration: i, stickyKey: k, body: baseBody(model, system, nonce("4", k, i)) }))
    }
  }
}

async function probe5_prefix_instability(model: string) {
  const stickyKey = `probe-instab-${Date.now()}`
  const baseSystem = makeSystem(4096, "p5")
  const mkBody = (tag: string, sys: string, extra: Record<string, unknown> = {}) =>
    baseBody(model, sys, nonce("5", tag, 0), extra)

  const variants: Array<{ tag: string; body: Record<string, unknown> }> = [
    { tag: "baseline", body: mkBody("baseline", baseSystem) },
    { tag: "trailing-newline", body: mkBody("trailing-newline", baseSystem + "\n") },
    { tag: "dynamic-timestamp", body: mkBody("dynamic-timestamp", baseSystem + `\n# now=${Date.now()}`) },
    { tag: "temperature-changed", body: mkBody("temperature-changed", baseSystem, { temperature: 0.3 }) },
    {
      tag: "with-tools-A",
      body: mkBody("with-tools-A", baseSystem, {
        tools: [
          { type: "function", function: { name: "noop_a", description: "no-op", parameters: { type: "object", properties: {} } } },
          { type: "function", function: { name: "noop_b", description: "no-op", parameters: { type: "object", properties: {} } } },
        ],
      }),
    },
    {
      tag: "with-tools-B-reordered",
      body: mkBody("with-tools-B-reordered", baseSystem, {
        tools: [
          { type: "function", function: { name: "noop_b", description: "no-op", parameters: { type: "object", properties: {} } } },
          { type: "function", function: { name: "noop_a", description: "no-op", parameters: { type: "object", properties: {} } } },
        ],
      }),
    },
  ]

  // Warm cache on baseline (use unique nonces so this is real prefix-cache priming, not response cache)
  for (let i = 0; i < 2; i++) {
    record(await call({ probe: "5-instability", variant: "warmup-baseline", iteration: i, stickyKey, body: baseBody(model, baseSystem, nonce("5", "warmup", i)) }))
  }
  for (const v of variants) {
    record(await call({ probe: "5-instability", variant: v.tag, iteration: 0, stickyKey, body: v.body }))
  }
}

/**
 * Probe 7 — tools-stable repeat. The instability matrix showed that adding
 * a tools array busts the cache — but is that because tools fundamentally
 * disable caching, or because adding tools changed the prefix shape vs the
 * tools-less warmup? Re-test with tools present from the very first call.
 */
async function probe7_tools_stable(model: string) {
  const system = makeSystem(4096, "p7")
  const stickyKey = `probe-tools-${Date.now()}`
  const tools = [
    { type: "function", function: { name: "search", description: "stub search", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } },
    { type: "function", function: { name: "fetch", description: "stub fetch", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  ]
  for (let i = 0; i < 4; i++) {
    record(await call({ probe: "7-tools-stable", variant: "with-tools", iteration: i, stickyKey, body: baseBody(model, system, nonce("7", "tools", i), { tools }) }))
  }
  // Now same prefix, different tool order — does reordering alone bust cache?
  const reordered = [tools[1], tools[0]]
  record(await call({ probe: "7-tools-stable", variant: "tools-reordered", iteration: 0, stickyKey, body: baseBody(model, system, nonce("7", "reord", 0), { tools: reordered }) }))
  // Add a 3rd tool — does adding bust?
  const expanded = [...tools, { type: "function", function: { name: "noop", description: "noop", parameters: { type: "object", properties: {} } } }]
  record(await call({ probe: "7-tools-stable", variant: "tools-expanded", iteration: 0, stickyKey, body: baseBody(model, system, nonce("7", "exp", 0), { tools: expanded }) }))
  // Change one tool's description — does desc text bust?
  const desc_changed = [{ ...tools[0], function: { ...tools[0].function, description: "stub search v2" } }, tools[1]]
  record(await call({ probe: "7-tools-stable", variant: "tool-desc-changed", iteration: 0, stickyKey, body: baseBody(model, system, nonce("7", "desc", 0), { tools: desc_changed }) }))
}

async function probe6_ttl(model: string) {
  const system = makeSystem(4096, "p6")
  const stickyKey = `probe-ttl-${Date.now()}`
  for (let i = 0; i < 2; i++) {
    record(await call({ probe: "6-ttl", variant: "warmup", iteration: i, stickyKey, body: baseBody(model, system, nonce("6", "warmup", i)) }))
  }
  const waits = [0, 30, 120, 300, 600]
  for (const w of waits) {
    if (w > 0) {
      console.error(`[ttl] sleeping ${w}s ...`)
      await new Promise((r) => setTimeout(r, w * 1000))
    }
    record(await call({ probe: "6-ttl", variant: `wait-${w}s`, iteration: 0, stickyKey, body: baseBody(model, system, nonce("6", `w${w}`, 0)) }))
  }
}

interface Summary {
  probe: string
  variant: string
  n: number
  avg_prompt: number
  avg_cached: number
  avg_hit: number
  errors: number
}

function summarize(): Summary[] {
  const buckets = new Map<string, ProbeRow[]>()
  for (const r of rows) {
    const k = `${r.probe}|${r.variant}`
    const arr = buckets.get(k) ?? []
    arr.push(r)
    buckets.set(k, arr)
  }
  const out: Summary[] = []
  for (const [k, list] of buckets) {
    const [probe, variant] = k.split("|")
    const errs = list.filter((r) => r.status !== 200).length
    const ok = list.filter((r) => r.status === 200)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    out.push({
      probe,
      variant,
      n: list.length,
      avg_prompt: Math.round(avg(ok.map((r) => r.prompt_tokens ?? 0))),
      avg_cached: Math.round(avg(ok.map((r) => r.cached_tokens ?? 0))),
      avg_hit: Number(avg(ok.map((r) => r.cache_hit_ratio ?? 0)).toFixed(3)),
      errors: errs,
    })
  }
  return out.sort((a, b) => a.probe.localeCompare(b.probe) || a.variant.localeCompare(b.variant))
}

function writeReports(args: Args) {
  fs.mkdirSync(args.out, { recursive: true })
  const suffix = args.vendor === "anthropic" ? "-anthropic" : ""
  const ndjsonPath = path.join(args.out, `hexin-cache-probe${suffix}.ndjson`)
  fs.writeFileSync(ndjsonPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")

  const summary = summarize()
  const md: string[] = []
  md.push(`# Hexin gateway cache probe`)
  md.push(``)
  md.push(`- Endpoint: \`${HEXIN_URL}\``)
  md.push(`- Model: \`${args.model}\``)
  md.push(`- Date: ${new Date().toISOString()}`)
  md.push(`- Total calls: ${rows.length} (${rows.filter((r) => r.status !== 200).length} errors)`)
  md.push(``)
  md.push(`## Summary by probe/variant`)
  md.push(``)
  md.push(`| Probe | Variant | N | avg prompt_tok | avg cached_tok | avg hit | errors |`)
  md.push(`|-------|---------|---|---------------:|---------------:|--------:|-------:|`)
  for (const s of summary) {
    md.push(`| ${s.probe} | ${s.variant} | ${s.n} | ${s.avg_prompt} | ${s.avg_cached} | ${(s.avg_hit * 100).toFixed(1)}% | ${s.errors} |`)
  }
  md.push(``)
  md.push(`## Per-call detail`)
  md.push(``)
  md.push(`| probe | variant | iter | status | prompt | cached | hit | latency_ms | sticky | upstream |`)
  md.push(`|-------|---------|-----:|-------:|-------:|-------:|----:|-----------:|--------|----------|`)
  for (const r of rows) {
    md.push(
      `| ${r.probe} | ${r.variant} | ${r.iteration} | ${r.status} | ${r.prompt_tokens ?? "-"} | ${r.cached_tokens ?? "-"} | ${r.cache_hit_ratio !== undefined ? (r.cache_hit_ratio * 100).toFixed(1) + "%" : "-"} | ${r.latency_ms} | ${r.sticky_key ?? "-"} | ${r.upstream ?? "-"} |`,
    )
  }
  const mdPath = path.join(args.out, `hexin-cache-probe${suffix}.md`)
  fs.writeFileSync(mdPath, md.join("\n") + "\n")

  console.error(`\nndjson  → ${ndjsonPath}`)
  console.error(`report  → ${mdPath}`)
}

async function main() {
  const args = parseArgs()
  CURRENT_VENDOR = args.vendor
  console.error(`probe model=${args.model} vendor=${args.vendor} endpoint=${HEXIN_URL} key=<env>`)

  const probes: Array<{ id: string; fn: () => Promise<void> }> = [
    { id: "0-response-cache", fn: () => probe0_response_cache(args.model) },
    { id: "1-sticky", fn: () => probe1_sticky(args.model) },
    { id: "2-no-sticky", fn: () => probe2_no_sticky(args.model) },
    { id: "3-prefix-floor", fn: () => probe3_prefix_floor(args.model) },
    { id: "4-sticky-isolation", fn: () => probe4_sticky_isolation(args.model) },
    { id: "5-instability", fn: () => probe5_prefix_instability(args.model) },
    { id: "7-tools-stable", fn: () => probe7_tools_stable(args.model) },
    { id: "6-ttl", fn: () => probe6_ttl(args.model) },
  ]

  for (const p of probes) {
    if (args.only && args.only !== p.id) continue
    if (args.skip.has(p.id) || args.skip.has(p.id.split("-")[0])) continue
    console.error(`\n[probe ${p.id}] start`)
    await p.fn()
    writeReports(args) // intermediate save in case of crash
  }
  writeReports(args)
}

main().catch((err) => {
  console.error("probe failed", err)
  writeReports(parseArgs())
  process.exit(1)
})
