import { describe, test, expect } from "bun:test"
import {
  similarity,
  adaptiveMinSimilarity,
  similarityGuard,
  MIN_SIMILARITY,
} from "../../../src/mirror/shared/similarity"

describe("similarity", () => {
  test("identical strings → 1", () => {
    expect(similarity("hello world", "hello world")).toBe(1)
  })

  test("strings under 2 chars → 0", () => {
    expect(similarity("", "abc")).toBe(0)
    expect(similarity("a", "abc")).toBe(0)
    expect(similarity("ab", "")).toBe(0)
  })

  test("disjoint strings have low overlap", () => {
    expect(similarity("abcdef", "uvwxyz")).toBeLessThan(0.1)
  })

  test("near-duplicate code edits stay high", () => {
    const a = "const foo = () => { return 42 }"
    const b = "const foo = () => { return 43 }"
    expect(similarity(a, b)).toBeGreaterThan(0.8)
  })

  test("symmetric — similarity(a,b) === similarity(b,a)", () => {
    const a = "import React from 'react'"
    const b = "import { useState } from 'react'"
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10)
  })

  test("repeated bigrams are counted with min-of-both", () => {
    // "aaa" bigrams: aa, aa  (count 2)
    // "aa"  bigrams: aa      (count 1)
    // overlap = min(2,1) = 1
    // 2 * overlap / ((3-1) + (2-1)) = 2/3
    expect(similarity("aaa", "aa")).toBeCloseTo(2 / 3, 10)
  })
})

describe("adaptiveMinSimilarity", () => {
  test("< 500 chars → 0.15", () => {
    expect(adaptiveMinSimilarity(0)).toBe(0.15)
    expect(adaptiveMinSimilarity(499)).toBe(0.15)
  })

  test("< 2000 chars → 0.25", () => {
    expect(adaptiveMinSimilarity(500)).toBe(0.25)
    expect(adaptiveMinSimilarity(1999)).toBe(0.25)
  })

  test(">= 2000 chars → MIN_SIMILARITY (0.40)", () => {
    expect(adaptiveMinSimilarity(2000)).toBe(MIN_SIMILARITY)
    expect(adaptiveMinSimilarity(100000)).toBe(MIN_SIMILARITY)
  })
})

describe("similarityGuard", () => {
  test("accepts near-identical modifications", () => {
    const orig = "const x = 1".repeat(300) // > 2000 chars, threshold 0.40
    const mod = orig.replace("1", "2")
    const result = similarityGuard(orig, mod, "test.ts", "test")
    expect(result.accepted).toBe(true)
    expect(result.code).toBe(mod)
    expect(result.threshold).toBe(0.4)
  })

  test("rejects destructive modifications, returns original", () => {
    const orig = "const x = 1".repeat(300)
    const mod = "totally different content"
    const result = similarityGuard(orig, mod, "test.ts", "test")
    expect(result.accepted).toBe(false)
    expect(result.code).toBe(orig)
    expect(result.similarity).toBeLessThan(result.threshold)
  })

  test("uses lenient threshold for small files", () => {
    // Small file: threshold 0.15
    const orig = "foo()"
    const mod = "bar()"
    const result = similarityGuard(orig, mod, "tiny.ts", "test")
    // similarity("foo()", "bar()") = 2*2 / (4+4) = 0.5  ← "o(" and "()" overlap
    expect(result.threshold).toBe(0.15)
    expect(result.accepted).toBe(true)
  })
})
