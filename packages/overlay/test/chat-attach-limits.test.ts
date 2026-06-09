import { describe, expect, test } from "bun:test"
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  aggregateEncodedSize,
  wouldExceedAggregateLimit,
} from "../src/services/chat-attach-limits"

/**
 * audit-2026-04-29 W2-V15. Pre-fix the per-file cap was enforced
 * but the aggregate was not — a user could drag 10 × 10 MiB
 * files; each base64-inflated data URL is ~13 MiB, totalling
 * ~130 MiB held in the webview's V8 heap until submit. The
 * composer froze under GC pressure on as few as 4–5 large files.
 *
 * The check function is the entire boundary; lock its semantics
 * so a future drift (e.g. accidentally summing raw file.size
 * instead of encoded url.length) trips this test.
 */

describe("chat-attach-limits (audit W2-V15)", () => {
  test("MAX_ATTACHMENT_SIZE and MAX_TOTAL_ATTACHMENT_SIZE are sane", () => {
    expect(MAX_ATTACHMENT_SIZE).toBe(10 * 1024 * 1024)
    expect(MAX_TOTAL_ATTACHMENT_SIZE).toBe(32 * 1024 * 1024)
    // Total budget must hold at least a single max-size file's
    // base64-inflated form (roughly 4/3 expansion).
    expect(MAX_TOTAL_ATTACHMENT_SIZE).toBeGreaterThan(Math.ceil((MAX_ATTACHMENT_SIZE * 4) / 3))
  })

  test("aggregateEncodedSize sums the post-encoding lengths, not raw bytes", () => {
    const list = [
      { url: "data:text/plain;base64," + "A".repeat(100) },
      { url: "data:text/plain;base64," + "B".repeat(200) },
    ]
    const expected = list[0]!.url.length + list[1]!.url.length
    expect(aggregateEncodedSize(list)).toBe(expected)
  })

  test("aggregateEncodedSize tolerates entries with missing url field", () => {
    const list = [{ url: "ABC" }, {} as { url?: string }, { url: "DE" }]
    expect(aggregateEncodedSize(list)).toBe(5)
  })

  test("wouldExceedAggregateLimit: empty list + single small file → false", () => {
    expect(wouldExceedAggregateLimit([], 100)).toBe(false)
  })

  test("wouldExceedAggregateLimit: empty list + above-budget single file → true", () => {
    expect(wouldExceedAggregateLimit([], MAX_TOTAL_ATTACHMENT_SIZE + 1)).toBe(true)
  })

  test("wouldExceedAggregateLimit: existing list near budget → next add tips over", () => {
    // Three entries each 10 MiB encoded — total 30 MiB. Adding a
    // 3 MiB file pushes to 33 MiB, past the 32 MiB budget.
    const tenMib = 10 * 1024 * 1024
    const list = [{ url: "x".repeat(tenMib) }, { url: "y".repeat(tenMib) }, { url: "z".repeat(tenMib) }]
    expect(aggregateEncodedSize(list)).toBe(30 * 1024 * 1024)
    expect(wouldExceedAggregateLimit(list, 3 * 1024 * 1024)).toBe(true)
    // 1.5 MiB add stays within budget (30 + 1.5 = 31.5 ≤ 32).
    expect(wouldExceedAggregateLimit(list, 1.5 * 1024 * 1024)).toBe(false)
  })

  test("wouldExceedAggregateLimit: the regression scenario — 10 × 10 MiB files would be rejected after the 3rd", () => {
    // Pre-fix: this list could grow unbounded. Post-fix: from the
    // 3rd entry on, wouldExceedAggregateLimit returns true.
    const tenMib = 10 * 1024 * 1024
    const list: Array<{ url: string }> = []
    let admitted = 0
    for (let i = 0; i < 10; i++) {
      const next = "x".repeat(tenMib)
      if (wouldExceedAggregateLimit(list, next.length)) break
      list.push({ url: next })
      admitted++
    }
    // 3 × 10 MiB = 30 MiB ≤ 32 MiB budget; 4th would be 40 MiB → rejected.
    expect(admitted).toBe(3)
    expect(list.length).toBe(3)
  })
})
