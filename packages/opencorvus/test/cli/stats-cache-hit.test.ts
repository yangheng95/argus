import { describe, expect, test } from "bun:test"
import { formatHitRatio } from "../../src/cli/cmd/stats"

describe("formatHitRatio", () => {
  // Realistic OpenAI-style usage. Session.getUsage() has already subtracted
  // cache.read from inputTokens, so `input` = uncached billable input.
  test("openai-style: input excludes cached", () => {
    // 4096 cached + 184 uncached => 4280 billable, 95.7% hit
    expect(formatHitRatio({ input: 184, cache: { read: 4096, write: 0 } })).toBe("95.7%  (4.1K / 4.3K)")
  })

  // Anthropic-style usage. Session.getUsage() leaves input untouched
  // (Anthropic returns inputTokens already excluding cache.read+cache.write).
  // The same formula applies because input is conceptually the same.
  test("anthropic-style: cache write counted in billable", () => {
    // 60k cached read + 200 cache write + 50 uncached => 60250 billable
    const out = formatHitRatio({ input: 50, cache: { read: 60_000, write: 200 } })
    expect(out.startsWith("99.6%")).toBe(true)
  })

  test("zero billable returns n/a (no LLM calls yet)", () => {
    expect(formatHitRatio({ input: 0, cache: { read: 0, write: 0 } })).toBe("n/a")
  })

  test("cold start with no cache hits", () => {
    // 1000 uncached, 0 cached => 0% hit
    expect(formatHitRatio({ input: 1000, cache: { read: 0, write: 0 } })).toBe("0.0%  (0 / 1.0K)")
  })

  test("perfect cache hit (read-only replay)", () => {
    // 0 uncached, 4096 cached => 100% hit
    expect(formatHitRatio({ input: 0, cache: { read: 4096, write: 0 } })).toBe("100.0%  (4.1K / 4.1K)")
  })

  test("monotone: more cache.read raises ratio strictly", () => {
    const low = formatHitRatio({ input: 1000, cache: { read: 1000, write: 0 } })
    const high = formatHitRatio({ input: 1000, cache: { read: 9000, write: 0 } })
    const lowPct = parseFloat(low.split("%")[0])
    const highPct = parseFloat(high.split("%")[0])
    expect(highPct).toBeGreaterThan(lowPct)
  })
})
