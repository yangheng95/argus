import { describe, test, expect } from "bun:test"
import { estimateTokens } from "../../../src/mirror/shared/token-estimator"

describe("estimateTokens", () => {
  test("empty input → 0", () => {
    expect(estimateTokens("")).toBe(0)
  })

  test("ASCII text ~4 chars/token with 15% margin", () => {
    // 16 ASCII chars → 4 raw tokens → ceil(4 * 1.15) = 5
    expect(estimateTokens("a".repeat(16))).toBe(5)
  })

  test("CJK text ~1.5 chars/token with 15% margin", () => {
    // 3 CJK chars → 2 raw tokens → ceil(2 * 1.15) = 3
    expect(estimateTokens("你好吗")).toBe(3)
  })

  test("mixed CJK + ASCII counted per-class", () => {
    // "hello你好" → 5 ascii + 2 cjk
    // ascii: 5/4 = 1.25
    // cjk:   2/1.5 ≈ 1.333
    // total raw ≈ 2.583, * 1.15 ≈ 2.97 → ceil = 3
    expect(estimateTokens("hello你好")).toBe(3)
  })

  test("Hiragana / Katakana / Hangul all counted as CJK", () => {
    expect(estimateTokens("ひらがな")).toBe(estimateTokens("カタカナ"))
    expect(estimateTokens("한국어")).toBeGreaterThan(0)
  })

  test("monotonic — longer text produces >= estimate", () => {
    const short = estimateTokens("hello world")
    const long = estimateTokens("hello world".repeat(10))
    expect(long).toBeGreaterThan(short)
  })
})
