/**
 * Verifies the verbose normalisation path used by llm.request / llm.outbound.
 * The point of the verbose profile is: store enough information per LLM call
 * that cache-diff analysis can pinpoint where prefix caching breaks, without
 * blowing past Trace's 1MB per-event line cap.
 *
 * We assert four shape properties:
 *   1. Large strings are preserved up to MAX_TEXT_VERBOSE (64k) — enough to
 *      keep a full fetched HTML page or a large tool result intact.
 *   2. Deeply nested structures don't get eagerly truncated; depth budget
 *      is higher than the "normal" profile.
 *   3. `data:` base64 strings are sampled (prefix + first 16 base64 chars)
 *      so two different images produce two different normalised forms —
 *      the prior version replaced the body with a constant placeholder,
 *      which hid image drift in diffs.
 *   4. The "normal" profile is still tight enough (8k strings) to not
 *      accidentally inflate non-verbose categories like llm.step.
 */
import { describe, expect, test } from "bun:test"
import { LLMTrace } from "../../src/session/llm-trace"

const { normalize, normalizeVerbose, limits } = LLMTrace._internalsForTest

describe("verbose normalise preserves enough bytes for cache diffs", () => {
  test("long strings are preserved up to 64k", () => {
    const big = "a".repeat(40_000)
    const verbose = normalizeVerbose({ body: big })
    expect((verbose as any).body.length).toBe(40_000)
    // Normal profile truncates at 8k.
    const small = normalize({ body: big })
    expect((small as any).body.length).toBeLessThan(9_000)
    expect((small as any).body).toContain("[truncated")
  })

  test("limits struct is exposed and matches documentation", () => {
    expect(limits.verbose.text).toBe(64_000)
    expect(limits.verbose.array).toBe(600)
    expect(limits.verbose.depth).toBe(12)
    expect(limits.normal.text).toBe(8_000)
  })

  test("different base64 images yield different normalised forms", () => {
    const imgA = "data:image/png;base64," + "A".repeat(120_000)
    const imgB = "data:image/png;base64," + "B".repeat(120_000)
    const normA = normalizeVerbose(imgA) as string
    const normB = normalizeVerbose(imgB) as string
    // Both still get elided (120k > 64k), but the sample in the middle must
    // differ, so a diff tool sees that the image actually changed.
    expect(normA).not.toBe(normB)
    // Header is preserved so callers can still tell the mime type.
    expect(normA.startsWith("data:image/png;base64,")).toBe(true)
  })

  test("long arrays survive up to 600 items (vs 120 in normal)", () => {
    const arr = Array.from({ length: 300 }, (_, i) => `msg-${i}`)
    const verbose = normalizeVerbose(arr) as unknown[]
    expect(verbose.length).toBe(300)
    const normal = normalize(arr) as unknown[]
    expect(normal.length).toBe(121) // 120 + overflow marker
    expect(normal[120]).toContain("[+")
  })

  test("deeply nested structure keeps more depth in verbose mode", () => {
    let deep: any = "leaf"
    for (let i = 0; i < 10; i++) deep = { next: deep }
    const verbose = normalizeVerbose(deep) as any
    // Walk 10 levels — verbose depth cap is 12.
    let cur: any = verbose
    for (let i = 0; i < 10; i++) cur = cur.next
    expect(cur).toBe("leaf")
    // Normal cap is 8 — bottom turns into "[max-depth]".
    const normal = normalize(deep) as any
    let cur2: any = normal
    for (let i = 0; i < 8; i++) cur2 = cur2.next
    expect(cur2 === "leaf" || cur2 === "[max-depth]").toBe(true)
    if (cur2 !== "leaf") expect(cur2).toBe("[max-depth]")
  })

  test("typical full request payload fits under 1MB even in verbose mode", () => {
    // Reproduce a worst-case LLM request: 200k-char system, 4 user messages
    // with 30k-char tool results each, one base64 image.
    const fakeReq = {
      system: "X".repeat(200_000),
      messages: [
        { role: "user", content: [{ type: "text", text: "Q" }, { type: "file", data: "data:image/png;base64," + "Z".repeat(50_000), mediaType: "image/png" }] },
        ...Array.from({ length: 4 }, (_, i) => ({
          role: i % 2 === 0 ? "assistant" : "tool",
          content: [{ type: "text", text: "Y".repeat(30_000) }],
        })),
      ],
    }
    const verbose = normalizeVerbose(fakeReq)
    const serialized = JSON.stringify(verbose)
    // Must fit inside the 1MB per-event Trace cap (1_048_576 bytes).  Leave
    // some headroom for the wrapping Trace envelope (ts/seq/taskID/etc.).
    expect(serialized.length).toBeLessThan(1_000_000)
    // And the system prompt must be mostly preserved (≥ 60k of the 200k —
    // truncation marker leaves a readable tail).
    const sysInOut = (verbose as any).system as string
    expect(sysInOut.length).toBeGreaterThan(60_000)
  })
})

describe("cache-probe can be updated to read the new categories", () => {
  test("llm.request and llm.outbound are valid Trace categories", async () => {
    // Smoke check: the Trace module accepts the new categories without
    // rejection. We look them up indirectly through emitting events via
    // Trace.event with an ad-hoc taskID; the schema uses z.string() for
    // category, so the test just confirms no surprise runtime rejection.
    const { Trace } = await import("../../src/trace")
    // This must not throw.
    expect(() => Trace.event({ taskID: "t-test", category: "llm.request", payload: {} })).not.toThrow()
    expect(() => Trace.event({ taskID: "t-test", category: "llm.outbound", payload: {} })).not.toThrow()
  })
})
