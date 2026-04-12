/**
 * probe-cache.ts — 探测 hexin LiteLLM 是否支持 prompt caching
 *
 * 使用方法:
 *   cd packages/opencorvus
 *   bun run script/benchmark/probe-cache.ts
 *
 * 测试逻辑:
 *   1. 发送一个带 cache_control 的大 system prompt（>1024 tokens 确保命中 Anthropic 最低缓存阈值）
 *   2. 发同样的请求第二次
 *   3. 对比两次 usage 中的 cached_tokens / cache_read_input_tokens
 *   4. 对 GPT 模型也做同样测试（OpenAI 自动缓存，不需要 cache_control）
 */

const BASE_URL = "https://aimemodeldev.myhexin.com/litellm/v1"
const API_KEY = "sk-eq7WQu0ylelH6uyedbf6PA"

// > 1024 tokens 的 system prompt，确保超过 Anthropic prompt caching 最低阈值
const LONG_SYSTEM = `You are a senior financial analyst specializing in quantitative trading strategies. ` +
  `Your expertise includes technical analysis, fundamental analysis, risk management, and portfolio optimization. `.repeat(40) +
  `Always respond concisely.`

interface UsageInfo {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
  }
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

async function probe(model: string, useExplicitCacheControl: boolean) {
  const systemMessage: any = {
    role: "system",
    content: LONG_SYSTEM,
  }
  if (useExplicitCacheControl) {
    systemMessage.cache_control = { type: "ephemeral" }
  }

  const body = {
    model,
    messages: [
      systemMessage,
      { role: "user", content: "Say hello in one word." },
    ],
    max_tokens: 10,
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`Model: ${model} | cache_control: ${useExplicitCacheControl}`)
  console.log(`${"=".repeat(60)}`)

  for (const round of [1, 2]) {
    console.log(`\n--- Round ${round} ---`)
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

    if (!resp.ok) {
      const text = await resp.text()
      console.log(`  HTTP ${resp.status}: ${text.slice(0, 200)}`)
      return
    }

    const data = await resp.json()
    const usage: UsageInfo = data.usage ?? {}

    console.log(`  Time: ${elapsed.toFixed(0)}ms`)
    console.log(`  prompt_tokens: ${usage.prompt_tokens}`)
    console.log(`  completion_tokens: ${usage.completion_tokens}`)

    // OpenAI 格式: prompt_tokens_details.cached_tokens
    if (usage.prompt_tokens_details?.cached_tokens !== undefined) {
      console.log(`  ✅ prompt_tokens_details.cached_tokens: ${usage.prompt_tokens_details.cached_tokens}`)
    } else {
      console.log(`  ❌ prompt_tokens_details.cached_tokens: NOT PRESENT`)
    }

    // Anthropic 原生格式 (LiteLLM 有时直接透传)
    if (usage.cache_creation_input_tokens !== undefined) {
      console.log(`  ✅ cache_creation_input_tokens: ${usage.cache_creation_input_tokens}`)
    }
    if (usage.cache_read_input_tokens !== undefined) {
      console.log(`  ✅ cache_read_input_tokens: ${usage.cache_read_input_tokens}`)
    }

    // 打印完整 usage 便于调试
    console.log(`  Raw usage: ${JSON.stringify(usage)}`)

    // Round 1 和 Round 2 之间等 2 秒让缓存生效
    if (round === 1) {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

// 同时探测 /health 和 / 获取版本信息
async function probeVersion() {
  console.log("Probing LiteLLM version...")
  for (const path of ["/health", "/version", "/"]) {
    try {
      const url = BASE_URL.replace("/v1", "") + path
      const resp = await fetch(url, {
        headers: { "Authorization": `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      if (resp.ok) {
        const text = await resp.text()
        console.log(`  ${path}: ${text.slice(0, 300)}`)
      } else {
        console.log(`  ${path}: HTTP ${resp.status}`)
      }
    } catch (e: any) {
      console.log(`  ${path}: ${e.message}`)
    }
  }
}

async function main() {
  await probeVersion()

  // Claude: 带 cache_control 标记
  await probe("claude-sonnet-4-6", true)

  // Claude: 不带 cache_control（对照组）
  await probe("claude-sonnet-4-6", false)

  // GPT: OpenAI 自动缓存不需要 cache_control
  await probe("gpt-5.4-mini", false)

  console.log("\n" + "=".repeat(60))
  console.log("DONE. 如果 Round 2 的 cached_tokens > 0，说明缓存生效。")
  console.log("如果所有字段都是 NOT PRESENT，说明 LiteLLM 没有返回缓存信息。")
}

main().catch(console.error)
