/**
 * probe-cache-prefix.ts — 验证 LiteLLM 是否真正把 cache_control 透传给上游 Anthropic
 *
 * 前面发现: 裸重放 10 次同一 body，response_id 完全相同 → LiteLLM 在做响应级缓存，
 * 根本没发给上游。真实 opencorvus 场景每次 user tail 变动，response cache 不命中。
 *
 * 本 probe: system prompt（长、带 cache_control）固定，user tail 每次加随机字符串。
 *   - 如果 Anthropic prompt caching 真正生效 → Round N 应 cache_read ≈ 2211（system 被缓存）
 *   - 如果 LiteLLM 只做响应级 cache → Round N cache_read = 0（tail 变了，响应 cache miss）
 */

const BASE_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
const API_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"
const N = 6

const LONG_SYSTEM = (
  `You are a senior financial analyst specializing in quantitative trading strategies. ` +
  `Your expertise includes technical analysis, fundamental analysis, risk management, and portfolio optimization. ` +
  `You understand derivatives, fixed income instruments, equity valuation, macroeconomic indicators, and market microstructure. ` +
  `You are familiar with Python, pandas, numpy, scipy, statsmodels, and common backtesting frameworks like backtrader and vectorbt. ` +
  `You can explain complex concepts such as Black-Scholes, Monte Carlo simulation, mean-variance optimization, and factor models. `
).repeat(20) + `Always respond concisely in one word.`

async function oneRound(model: string, round: number, userSuffix: string) {
  const body = {
    model,
    messages: [
      { role: "system", content: LONG_SYSTEM, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Say hello in one word. [${userSuffix}]` },
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

  return {
    round,
    elapsed_ms: Math.round(elapsed),
    response_id: data.id ?? "",
    prompt_tokens: usage.prompt_tokens ?? 0,
    cached_tokens: ptd.cached_tokens ?? 0,
    cache_creation: usage.cache_creation_input_tokens ?? ptd.cache_creation_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    content: data.choices?.[0]?.message?.content ?? "",
  }
}

async function main() {
  const model = process.argv[2] ?? "claude-sonnet-4-6"
  console.log(`Probing PREFIX cache for ${model}: same system, different user tail.\n`)

  for (let i = 1; i <= N; i++) {
    const suffix = `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const r = await oneRound(model, i, suffix)
    const label = r.cache_read > 0 ? "HIT " : "MISS"
    console.log(
      `#${i} ${label} ${r.elapsed_ms}ms  prompt=${r.prompt_tokens}  creat=${r.cache_creation}  read=${r.cache_read}  resp_id=${r.response_id.slice(0, 36)}  reply="${r.content.replace(/\n/g, " ").slice(0, 30)}"`,
    )
    await new Promise(rs => setTimeout(rs, 500))
  }

  console.log(`\n结论:`)
  console.log(`  - 若 #2..#N 显示 HIT (cache_read ≈ system tokens) → Anthropic prompt caching 生效，问题在 opencorvus 调用方。`)
  console.log(`  - 若 #2..#N 全 MISS → LiteLLM 没把 cache_control 透给 Anthropic，真实负载下 cache 无效，网关方必须修。`)
}

main().catch(e => { console.error(e); process.exit(1) })
