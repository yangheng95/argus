/**
 * probe-cache-matrix.ts — 批量扫 hexin 所有模型的 cache 支持情况。
 * 每个模型发 3 次请求（固定 system + 变化 tail + user=sess-A），
 * 报告是否出现 cache_read（命中）以及字段来源（anthropic vs openai）。
 */

const BASE_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
const API_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"

const LONG_SYSTEM = (
  `You are a senior financial analyst specializing in quantitative trading strategies. ` +
  `Your expertise includes technical analysis, fundamental analysis, risk management, and portfolio optimization. ` +
  `You understand derivatives, fixed income instruments, equity valuation, macroeconomic indicators, and market microstructure. ` +
  `You are familiar with Python, pandas, numpy, scipy, statsmodels, and common backtesting frameworks like backtrader and vectorbt. ` +
  `You can explain complex concepts such as Black-Scholes, Monte Carlo simulation, mean-variance optimization, and factor models. `
).repeat(20) + `Always respond concisely in one word.`

type Result = {
  model: string
  rounds: Array<{
    http: number
    cache_read: number
    cache_creation: number
    prompt_tokens: number
    source: "anthropic" | "openai" | "none"
    err?: string
  }>
  verdict: string
}

async function probe(model: string): Promise<Result> {
  const rounds: Result["rounds"] = []
  for (let i = 1; i <= 3; i++) {
    try {
      const body = {
        model,
        messages: [
          { role: "system", content: LONG_SYSTEM, cache_control: { type: "ephemeral" } },
          { role: "user", content: `Say hello in one word. [req-${i}-${Math.random().toString(36).slice(2, 6)}]` },
        ],
        max_tokens: 10,
        user: "opencorvus-matrix-probe-A",
      }
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const text = await resp.text()
      let data: any = {}
      try { data = JSON.parse(text) } catch {}
      if (resp.status !== 200) {
        rounds.push({ http: resp.status, cache_read: 0, cache_creation: 0, prompt_tokens: 0, source: "none", err: text.slice(0, 100) })
        continue
      }
      const usage = data.usage ?? {}
      const ptd = usage.prompt_tokens_details ?? {}
      const anthRead = usage.cache_read_input_tokens
      const anthCreat = usage.cache_creation_input_tokens
      const oaiCached = ptd.cached_tokens
      let source: "anthropic" | "openai" | "none" = "none"
      if (anthRead !== undefined || anthCreat !== undefined) source = "anthropic"
      else if (oaiCached !== undefined) source = "openai"
      rounds.push({
        http: 200,
        cache_read: anthRead ?? oaiCached ?? 0,
        cache_creation: anthCreat ?? ptd.cache_creation_tokens ?? 0,
        prompt_tokens: usage.prompt_tokens ?? 0,
        source,
      })
    } catch (e: any) {
      rounds.push({ http: -1, cache_read: 0, cache_creation: 0, prompt_tokens: 0, source: "none", err: e.message })
    }
    await new Promise(r => setTimeout(r, 400))
  }

  // Verdict logic
  const ok = rounds.filter(r => r.http === 200)
  if (ok.length === 0) {
    const first = rounds[0]?.err ?? "all failed"
    return { model, rounds, verdict: `❌ HTTP ${rounds[0]?.http}: ${first}` }
  }
  const sources = new Set(ok.map(r => r.source))
  const hasHit = ok.some(r => r.cache_read > 0)
  const hasCreation = ok.some(r => r.cache_creation > 0)
  if (!sources.has("anthropic") && !sources.has("openai")) {
    return { model, rounds, verdict: "⚪ no cache fields at all (not supported/not reported)" }
  }
  if (!hasHit && !hasCreation) {
    return { model, rounds, verdict: `⚪ ${[...sources].join(",")} fields present but all zero (cache disabled upstream)` }
  }
  if (hasHit) {
    const last = ok[ok.length - 1]
    return { model, rounds, verdict: `✅ ${[...sources].join(",")} cache WORKS (last round read=${last.cache_read}/${last.prompt_tokens})` }
  }
  return { model, rounds, verdict: `🟡 ${[...sources].join(",")} cache CREATING but never READING (round 2/3 miss)` }
}

async function main() {
  // Fetch live model list
  const resp = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } })
  const data = await resp.json() as any
  const models: string[] = (data.data ?? []).map((m: any) => m.id)
  // Skip image/vision-only models (probe uses text-only prompt)
  const skip = /image|embed|whisper|tts|audio/i
  const targets = models.filter(m => !skip.test(m))
  console.log(`Scanning ${targets.length} models in parallel:\n  ${targets.join("\n  ")}\n`)

  const results = await Promise.all(targets.map(probe))
  results.sort((a, b) => a.model.localeCompare(b.model))

  console.log("=".repeat(80))
  for (const r of results) {
    console.log(`  ${r.model.padEnd(45)}  ${r.verdict}`)
  }
  console.log("=".repeat(80))
  const good = results.filter(r => r.verdict.startsWith("✅")).length
  const flaky = results.filter(r => r.verdict.startsWith("🟡")).length
  const none = results.filter(r => r.verdict.startsWith("⚪")).length
  const err = results.filter(r => r.verdict.startsWith("❌")).length
  console.log(`summary: ✅ ${good}  🟡 ${flaky}  ⚪ ${none}  ❌ ${err}  (total ${results.length})`)
}

main().catch(e => { console.error(e); process.exit(1) })
