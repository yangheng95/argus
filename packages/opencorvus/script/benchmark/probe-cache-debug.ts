/**
 * probe-cache-debug.ts — 深入诊断 hexin LiteLLM 网关为何 Round 2 不命中 cache
 *
 * 初步发现（probe-cache.ts）:
 *   Round 1: cache_creation=2211, cache_read=0  ← 正常：首次建 cache
 *   Round 2: cache_creation=2211, cache_read=0  ← 异常：本应 creation=0, read=2211
 *
 * 假设:
 *   A. LiteLLM 挂了多把 Anthropic key，round-robin 每次路由到不同 workspace → cache 不共享
 *   B. 请求里某个字段（trace-id / x-request-id / idempotency）变动导致 cache prefix hash 不同
 *   C. LiteLLM 版本不保存 cache，或没透传 anthropic-beta: prompt-caching-2024-07-31
 *   D. upstream 根本就是 mock，cache_creation 是假的
 *
 * 诊断策略: 连发 N 次完全相同 body，统计 cache_read 出现次数、观察响应头。
 */

const BASE_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
const API_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"
const N = 10

const LONG_SYSTEM = (
  `You are a senior financial analyst specializing in quantitative trading strategies. ` +
  `Your expertise includes technical analysis, fundamental analysis, risk management, and portfolio optimization. ` +
  `You understand derivatives, fixed income instruments, equity valuation, macroeconomic indicators, and market microstructure. ` +
  `You are familiar with Python, pandas, numpy, scipy, statsmodels, and common backtesting frameworks like backtrader and vectorbt. ` +
  `You can explain complex concepts such as Black-Scholes, Monte Carlo simulation, mean-variance optimization, and factor models. `
).repeat(20) + `Always respond concisely in one word.`

interface RoundResult {
  round: number
  elapsed_ms: number
  prompt_tokens: number
  cached_tokens: number
  cache_creation: number
  cache_read: number
  ephemeral_5m: number
  ephemeral_1h: number
  upstream_headers: Record<string, string>
  response_id: string
  x_litellm_model_id: string
}

async function oneRound(model: string, round: number): Promise<RoundResult> {
  const body = {
    model,
    messages: [
      { role: "system", content: LONG_SYSTEM, cache_control: { type: "ephemeral" } },
      { role: "user", content: "Say hello in one word." },
    ],
    max_tokens: 10,
  }

  const start = performance.now()
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const elapsed = performance.now() - start

  const text = await resp.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch {}

  const usage = data.usage ?? {}
  const ptd = usage.prompt_tokens_details ?? {}
  const cct = ptd.cache_creation_token_details ?? {}

  const interesting = [
    "x-litellm-model-id",
    "x-litellm-cache-key",
    "x-litellm-call-id",
    "x-litellm-version",
    "x-request-id",
    "anthropic-request-id",
    "server",
    "via",
  ]
  const headers: Record<string, string> = {}
  for (const key of interesting) {
    const v = resp.headers.get(key)
    if (v) headers[key] = v
  }

  return {
    round,
    elapsed_ms: Math.round(elapsed),
    prompt_tokens: usage.prompt_tokens ?? 0,
    cached_tokens: ptd.cached_tokens ?? 0,
    cache_creation: usage.cache_creation_input_tokens ?? ptd.cache_creation_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    ephemeral_5m: cct.ephemeral_5m_input_tokens ?? 0,
    ephemeral_1h: cct.ephemeral_1h_input_tokens ?? 0,
    upstream_headers: headers,
    response_id: data.id ?? "",
    x_litellm_model_id: headers["x-litellm-model-id"] ?? "",
  }
}

function fmt(r: RoundResult) {
  const hit = r.cache_read > 0 ? "HIT" : "MISS"
  return `#${String(r.round).padStart(2)} ${hit.padEnd(4)} ${r.elapsed_ms}ms  prompt=${r.prompt_tokens}  creat=${r.cache_creation}  read=${r.cache_read}  model_id=${r.x_litellm_model_id}  resp_id=${r.response_id.slice(0, 40)}`
}

async function main() {
  const model = process.argv[2] ?? "claude-sonnet-4-6"
  console.log(`Probing cache behavior for ${model} with ${N} identical requests...`)
  console.log()

  const results: RoundResult[] = []
  for (let i = 1; i <= N; i++) {
    const r = await oneRound(model, i)
    results.push(r)
    console.log(fmt(r))
    if (i === 1 || i === 2) {
      console.log(`      headers: ${JSON.stringify(r.upstream_headers)}`)
    }
  }

  console.log()
  console.log("=".repeat(60))
  const hits = results.filter(r => r.cache_read > 0).length
  const misses = results.length - hits
  console.log(`HIT: ${hits}/${N}  MISS: ${misses}/${N}`)

  const uniqueModelIds = new Set(results.map(r => r.x_litellm_model_id).filter(Boolean))
  console.log(`unique x-litellm-model-id: ${uniqueModelIds.size}  → [${[...uniqueModelIds].join(", ")}]`)

  const totalCreated = results.reduce((s, r) => s + r.cache_creation, 0)
  const totalRead = results.reduce((s, r) => s + r.cache_read, 0)
  console.log(`total cache_creation_tokens: ${totalCreated}  (charged 1.25x)`)
  console.log(`total cache_read_tokens:     ${totalRead}  (charged 0.1x)`)

  if (uniqueModelIds.size > 1) {
    console.log()
    console.log("🔴 ROOT CAUSE CANDIDATE: 多个 upstream model_id 说明 LiteLLM 在多把 Anthropic key / deployment 间做 round-robin，cache 无法共享。")
  } else if (hits === 0) {
    console.log()
    console.log("🔴 cache 完全不命中，但 upstream 只有 1 个 model_id → 可能是 LiteLLM 没有透传 cache_control，或 upstream 禁用了 prompt caching。")
  } else if (hits < N - 1) {
    console.log()
    console.log("🟡 部分命中：可能有多个 deployment 但带粘性，或存在缓存抖动。")
  }
}

main().catch(err => {
  console.error("ERROR:", err)
  process.exit(1)
})
