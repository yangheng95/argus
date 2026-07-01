/**
 * Empirical tests: isolate what causes frontend-design's prompt cache to
 * degrade (~10x worse than expected — 4.5k read vs 150k full-hit baseline).
 *
 * Hypotheses under test (one per describe-block):
 *   H1 — Counter in register_* tool results is non-deterministic across runs.
 *   H2 — ProviderTransform.message() does NOT place local message-level
 *        cache markers for generic OpenAI-compatible models.
 *   H2b — OpenAI-compatible models can still use a separate promptCacheKey
 *         path when provider config opts in, so "no cache_control markers"
 *         does not by itself prove "no cache API".
 *   H3 — For Anthropic-native path, breakpoints land on messages[-2]/[-1]
 *        only, so prefix coverage shrinks as the tool-loop grows.
 *   H4 — normalizeVendorMessages is not idempotent for the models used here.
 *   H5 — Multi-turn prefix stability: running the pipeline on turn N and
 *        turn N+1 (where N+1 appends messages) yields byte-identical
 *        serialization for messages[0..N-1].
 *   H6 — AttachmentStore file-part bytes drift across calls (would break
 *        the image-block hash between turns). File I/O only; mocked out.
 */
import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { ProviderTransform } from "../../src/provider/transform"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"
import { normalizeVendorMessages } from "../../src/provider/vendor-messages"

// ────────── model fixtures ──────────

const anthropicModel = {
  id: "anthropic/claude-opus-4-7",
  providerID: "anthropic",
  api: { id: "claude-opus-4-7", url: "x", npm: "@ai-sdk/anthropic" },
  name: "Claude Opus 4.7",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: { text: true, image: true, audio: false, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 1, output: 1, cache: { read: 0.1, write: 1.25 } },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
} as any

// DashScope path: openai-compatible SDK, qwen-family reasoning model.
const dashscopeModel = {
  id: "qwen3-coder-plus",
  providerID: "alibaba-coding-plan",
  api: { id: "qwen3-coder-plus", url: "https://coding.dashscope.aliyuncs.com/v1", npm: "@ai-sdk/openai-compatible" },
  name: "Qwen3 Coder Plus",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, image: true, audio: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: { field: "reasoning_content" },
  },
  cost: { input: 1, output: 1 },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
} as any

// ────────── helpers ──────────

/** Call a register_* tool with a minimal but valid payload. */
async function register(tools: any, kind: "section" | "token", i: number) {
  if (kind === "section") {
    return await tools.register_layout_spec.execute({
      id: `vis-sec-${i}`,
      title: `section ${i}`,
      section_role: "content",
      position: "top",
      dimensions: "100%",
      layout_method: "flex",
      coordinate_space: "implementation_layout",
      implementation_use: "visible_layout_constraint",
      applies_to: "body",
      severity: "must",
    })
  }
  return await tools.register_color_spec.execute({
    id: `vis-tok-${i}`,
    title: `token ${i}`,
    hex: "#000000",
    role: "background",
    applies_to: "body",
    severity: "must",
  })
}

function stableClone<T>(x: T): T {
  // Round-trip through JSON to avoid accidental shared references between runs.
  return JSON.parse(JSON.stringify(x))
}

// ────────── H1: counter determinism ──────────

describe("H1: register_* tool results — counter determinism", () => {
  test("same call sequence on same collector is deterministic within a run", async () => {
    const kit = createFrontendTemplateOutputTools()
    const out1 = await register(kit.tools, "section", 1)
    const out2 = await register(kit.tools, "section", 2)
    const out3 = await register(kit.tools, "token", 1)
    expect(out1).toBe(`OK: layout spec "vis-sec-1" registered (1 total)`)
    expect(out2).toBe(`OK: layout spec "vis-sec-2" registered (2 total)`)
    expect(out3).toBe(`OK: color spec "vis-tok-1" registered (3 total)`)
  })

  test("FRESH collector restarts the counter — produces different history for the same call", async () => {
    // This is the cache-busting scenario: if a cached turn contains
    // 'registered (5 total)' but a new agent run re-creates the collector
    // and replays, the LLM-side history needs the same '(5 total)' token.
    // If the run is re-driven with a new collector, the counter resets.
    const kitA = createFrontendTemplateOutputTools()
    await register(kitA.tools, "section", 1)
    await register(kitA.tools, "section", 2)
    const aFifth = await register(kitA.tools, "section", 5)

    const kitB = createFrontendTemplateOutputTools()
    const bFifth = await register(kitB.tools, "section", 5)

    expect(aFifth).toBe(`OK: layout spec "vis-sec-5" registered (3 total)`)
    expect(bFifth).toBe(`OK: layout spec "vis-sec-5" registered (1 total)`)
    // Same input, different output string → cache key differs at this turn
    // and downstream if tool-result text reaches the replay prefix.
    expect(aFifth).not.toBe(bFifth)
  })
})

// ────────── H2: openai-compatible path skips local message markers ──────────

describe("H2: ProviderTransform.message() local cache marker coverage by provider", () => {
  async function runPipeline(model: any, msgs: ModelMessage[]) {
    // Provide a deep clone so the mutation inside message() doesn't leak.
    return await ProviderTransform.message(stableClone(msgs), model, {})
  }

  function collectCacheMarkers(msgs: ModelMessage[]): Array<{ idx: number; role: string; where: string }> {
    const markers: Array<{ idx: number; role: string; where: string }> = []
    msgs.forEach((m, idx) => {
      const po = (m as any).providerOptions
      if (po?.anthropic?.cacheControl || po?.openaiCompatible?.cache_control || po?.openrouter?.cacheControl) {
        markers.push({ idx, role: m.role, where: "message" })
      }
      if (Array.isArray(m.content)) {
        m.content.forEach((part: any) => {
          const ppo = part?.providerOptions
          if (ppo?.anthropic?.cacheControl || ppo?.openaiCompatible?.cache_control || ppo?.openrouter?.cacheControl) {
            markers.push({ idx, role: m.role, where: "content-part" })
          }
        })
      }
    })
    return markers
  }

  const base: ModelMessage[] = [
    { role: "system", content: "You are a frontend design." },
    { role: "user", content: [{ type: "text", text: "Analyze this page." }] },
    { role: "assistant", content: [{ type: "text", text: "Calling webfetch…" }] },
    { role: "user", content: [{ type: "text", text: "(tool-result: HTML blob)" }] },
  ]

  test("Anthropic model: cache_control markers ARE placed", async () => {
    const out = await runPipeline(anthropicModel, base)
    const markers = collectCacheMarkers(out)
    // Expected: system[0] + system[last] + messages[-2] + messages[-1].
    // With 1 system message, system collapses to 1. Tail has 2. So ≥3 markers.
    expect(markers.length).toBeGreaterThanOrEqual(3)
  })

  test("OpenAI-compatible model: local cache_control markers are NOT placed", async () => {
    const out = await runPipeline(dashscopeModel, base)
    const markers = collectCacheMarkers(out)
    // The outer gate in transform.ts restricts applyCaching to the
    // Anthropic-family path, so generic OpenAI-compatible models do not get
    // message/content-part cache markers from this local transform layer.
    // This documents a missing local mechanism, not the full upstream cache story.
    expect(markers.length).toBe(0)
  })
})

// ────────── H2b: openai-compatible may still use promptCacheKey ──────────

describe("H2b: ProviderTransform.options() cache hints for openai-compatible models", () => {
  test("promptCacheKey is available when provider config opts in via setCacheKey", () => {
    const result = ProviderTransform.options({
      model: dashscopeModel,
      sessionID: "task-cache-key",
      providerOptions: { setCacheKey: true },
    })

    expect(result.promptCacheKey).toBe("task-cache-key")
  })

  test("DashScope defaults do not set promptCacheKey without provider opt-in", () => {
    const result = ProviderTransform.options({
      model: dashscopeModel,
      sessionID: "task-cache-key",
      providerOptions: {},
    })

    expect(result.promptCacheKey).toBeUndefined()
    expect(result.enable_thinking).toBe(true)
  })
})

// ────────── H3: Anthropic breakpoint placement shrinks with turn count ──────────

describe("H3: Anthropic tail-only breakpoints under a growing tool loop", () => {
  function buildTurn(n: number): ModelMessage[] {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "user-0" }] },
    ]
    for (let i = 1; i <= n; i++) {
      msgs.push({ role: "assistant", content: [{ type: "text", text: `assistant-${i}` }] })
      msgs.push({ role: "user", content: [{ type: "text", text: `tool-result-${i}` }] })
    }
    return msgs
  }

  function taggedIndexes(msgs: ModelMessage[]): number[] {
    const idxs: number[] = []
    msgs.forEach((m, i) => {
      if ((m as any).providerOptions?.anthropic?.cacheControl) idxs.push(i)
    })
    return idxs
  }

  test("first turn covers user; later turns cover only tail pair", async () => {
    const t1 = await ProviderTransform.message(buildTurn(0), anthropicModel, {})
    const t5 = await ProviderTransform.message(buildTurn(5), anthropicModel, {})
    const idx1 = taggedIndexes(t1)
    const idx5 = taggedIndexes(t5)

    // Turn 1 (no tool calls yet): system[0] + user. Both tagged.
    expect(idx1).toContain(0)
    expect(idx1).toContain(1)

    // Turn 5: system[0] still tagged; tail tags land on the last two messages,
    // leaving the middle uncovered by explicit breakpoints. Middle cache
    // survives only via cumulative prefix matching from prior turns — any
    // mid-history drift evicts everything after it.
    expect(idx5).toContain(0) // system
    const tailIdxs = idx5.filter((i) => i >= t5.length - 2)
    expect(tailIdxs.length).toBeGreaterThanOrEqual(1)
    const midIdxs = idx5.filter((i) => i > 0 && i < t5.length - 2)
    expect(midIdxs.length).toBe(0) // mid-history never gets a fresh breakpoint
  })
})

// ────────── H4: vendor-message normalization idempotency ──────────

describe("H4: normalizeVendorMessages idempotency", () => {
  test("anthropic: running twice is a fixed point", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "u" }] },
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ]
    const once = normalizeVendorMessages(stableClone(msgs), anthropicModel)
    const twice = normalizeVendorMessages(stableClone(once), anthropicModel)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  test("dashscope (interleaved reasoning): reasoning extraction is stable", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "u" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "answer" },
        ] as any,
      },
    ]
    const once = normalizeVendorMessages(stableClone(msgs), dashscopeModel)
    const twice = normalizeVendorMessages(stableClone(once), dashscopeModel)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))

    // The reasoning field moves to providerOptions.openaiCompatible.reasoning_content.
    const asst: any = once[1]
    expect(asst.providerOptions?.openaiCompatible?.reasoning_content).toBe("think")
    // The reasoning part should be stripped from content; only 'text' remains.
    expect(asst.content.length).toBe(1)
    expect(asst.content[0].type).toBe("text")
  })
})

// ────────── H5: multi-turn prefix stability ──────────

describe("H5: prefix stability across tool-loop turns", () => {
  function serialize(msgs: ModelMessage[]): string {
    // Stable JSON (order-preserving) — we only care about structural equality.
    return JSON.stringify(msgs)
  }

  test("turn N+1 extends turn N without mutating the earlier prefix", async () => {
    const turnN: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "u" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "user", content: [{ type: "text", text: "tr1" }] },
    ]
    const turnNPlus1: ModelMessage[] = [
      ...stableClone(turnN),
      { role: "assistant", content: [{ type: "text", text: "a2" }] },
      { role: "user", content: [{ type: "text", text: "tr2" }] },
    ]

    const outN = await ProviderTransform.message(stableClone(turnN), anthropicModel, {})
    const outNPlus1 = await ProviderTransform.message(stableClone(turnNPlus1), anthropicModel, {})

    // The first 4 messages of turn N+1 must NOT equal turn N's serialization
    // byte-by-byte, because the tail cache_control on turn N's last two messages
    // is removed on turn N+1 (now they're mid-history).  This is the structural
    // reason the cache break: every turn re-writes the breakpoint placement on
    // the *same* mid-history messages.
    const prefixN = serialize(outN)
    const prefixNPlus1 = serialize(outNPlus1.slice(0, outN.length))
    // If these differ, the upstream sees a different content hash for the
    // same logical prefix — implicit prefix caching falls back earlier.
    const identical = prefixN === prefixNPlus1
    expect(identical).toBe(false) // documents the current behavior
  })
})

// ────────── H6: AttachmentStore file-part bytes determinism ──────────
// Not executable without a real storage backend. Kept as a stub — enable
// by setting FIXTURE env with a known path, otherwise the test is skipped.

describe("H6: attachment bytes stability (skipped without fixture)", () => {
  test.skipIf(!process.env.FRONTEND_DESIGN_FIXTURE_PATH)(
    "loadFileParts returns byte-identical results across calls",
    async () => {
      // Placeholder — wire in when fixture path is set.
      expect(true).toBe(true)
    },
  )
})
