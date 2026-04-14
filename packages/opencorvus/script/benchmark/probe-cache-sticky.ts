/**
 * probe-cache-sticky.ts — 对照实验：客户端能否通过 user / prompt_cache_key /
 * x-litellm-deployment-id 让 hexin LiteLLM 粘到同一 upstream key。
 *
 * 基线（probe-cache-prefix.ts 已跑）: prefix 固定 + 随机 tail，6 次里 2 次 miss。
 * 本 probe 用 3 组策略各跑 N=10 次，对比 hit ratio。
 */

const BASE_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
const API_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"
const MODEL = process.argv[2] ?? "claude-sonnet-4-6"
const N = 10

const LONG_SYSTEM = (
  `You are a senior financial analyst specializing in quantitative trading strategies. ` +
  `Your expertise includes technical analysis, fundamental analysis, risk management, and portfolio optimization. ` +
  `You understand derivatives, fixed income instruments, equity valuation, macroeconomic indicators, and market microstructure. ` +
  `You are familiar with Python, pandas, numpy, scipy, statsmodels, and common backtesting frameworks like backtrader and vectorbt. ` +
  `You can explain complex concepts such as Black-Scholes, Monte Carlo simulation, mean-variance optimization, and factor models. `
).repeat(20) + `Always respond concisely in one word.`

type Strategy = {
  name: string
  bodyExtra?: Record<string, unknown>
  headers?: Record<string, string>
}

const STRATEGIES: Strategy[] = [
  { name: "baseline (nothing)" },
  { name: "user field", bodyExtra: { user: "opencorvus-sess-sticky-A" } },
  { name: "prompt_cache_key", bodyExtra: { prompt_cache_key: "opencorvus-sess-sticky-A" } },
  { name: "metadata.user", bodyExtra: { metadata: { user: "opencorvus-sess-sticky-A" } } },
  { name: "header x-litellm-tags", headers: { "x-litellm-tags": "sess-A" } },
  { name: "header x-user", headers: { "x-user": "opencorvus-sess-sticky-A" } },
]

async function oneRound(strategy: Strategy, suffix: string) {
  const body: any = {
    model: MODEL,
    messages: [
      { role: "system", content: LONG_SYSTEM, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Say hello in one word. [${suffix}]` },
    ],
    max_tokens: 10,
    ...(strategy.bodyExtra ?? {}),
  }

  const start = performance.now()
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(strategy.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
  const elapsed = Math.round(performance.now() - start)
  const text = await resp.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch {}

  const usage = data.usage ?? {}
  const ptd = usage.prompt_tokens_details ?? {}
  // Anthropic-style vs OpenAI-style cache accounting: read both.
  // Anthropic: cache_read_input_tokens / cache_creation_input_tokens (flat on usage)
  // OpenAI:    prompt_tokens_details.cached_tokens (no creation field — it's implicit)
  const cache_read = usage.cache_read_input_tokens ?? ptd.cached_tokens ?? 0
  const cache_creation = usage.cache_creation_input_tokens ?? ptd.cache_creation_tokens ?? 0
  const http = resp.status
  return { http, elapsed, cache_read, cache_creation }
}

async function runStrategy(strategy: Strategy) {
  console.log(`\n── ${strategy.name} ──`)
  let hits = 0, misses = 0, http_err = 0
  let totalCreated = 0, totalRead = 0
  for (let i = 1; i <= N; i++) {
    const r = await oneRound(strategy, `nonce-${i}-${Date.now()}`)
    if (r.http !== 200) {
      http_err++
      console.log(`  #${i} HTTP ${r.http}`)
      continue
    }
    if (r.cache_read > 0) hits++
    else misses++
    totalCreated += r.cache_creation
    totalRead += r.cache_read
    const label = r.cache_read > 0 ? "HIT " : "MISS"
    process.stdout.write(`  #${i} ${label} creat=${r.cache_creation} read=${r.cache_read}  `)
    if (i % 5 === 0) process.stdout.write("\n")
    await new Promise(r => setTimeout(r, 300))
  }
  console.log()
  const hitRatio = hits / (hits + misses || 1)
  const reviseCost = totalCreated * 1.25 + totalRead * 0.1 // 相对 input 全价 1.0 的倍数
  const baselineCost = (totalCreated + totalRead) * 1.0
  const saving = 1 - reviseCost / baselineCost
  console.log(`  summary: HIT=${hits}/${N}  hitRatio=${(hitRatio * 100).toFixed(0)}%  created=${totalCreated}  read=${totalRead}  est.saving_vs_no_cache=${(saving * 100).toFixed(0)}%  http_err=${http_err}`)
  return { name: strategy.name, hits, misses, hitRatio }
}

async function main() {
  console.log(`Sticky-routing A/B, model=${MODEL}, N=${N} per strategy\n`)
  const results = []
  for (const s of STRATEGIES) {
    results.push(await runStrategy(s))
  }
  console.log("\n" + "=".repeat(60))
  console.log("RESULTS (higher hitRatio = sticky worked)")
  for (const r of results) {
    const stars = "█".repeat(Math.round(r.hitRatio * 20)).padEnd(20, "░")
    console.log(`  ${stars}  ${(r.hitRatio * 100).toFixed(0)}%  ${r.name}`)
  }
  const baseline = results[0].hitRatio
  const bestName = results.reduce((a, b) => b.hitRatio > a.hitRatio ? b : a)
  if (bestName.hitRatio - baseline > 0.1) {
    console.log(`\n✅ "${bestName.name}" 显著高于 baseline (${(baseline * 100).toFixed(0)}%) — 客户端打补丁可行`)
  } else {
    console.log(`\n❌ 所有策略 hit ratio 与 baseline 接近，hexin LiteLLM 没把客户端信号用于路由 — 只能走服务端方案`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
