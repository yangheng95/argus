/**
 * Tests the cache-probe script's ability to detect three distinct failure
 * modes in a trace.jsonl artifact. Each scenario is a synthetic trace that
 * injects one failure archetype — the probe's verdict must localize it.
 *
 * Why unit-test the probe rather than run the benchmark: the probe only
 * reads trace.jsonl, so its behavior is a pure function of the file
 * contents. Regression-testing it against handcrafted scenarios is cheaper
 * than wiring up a full task.
 *
 * Scenarios:
 *   S1 — "dead provider cache": every call has cached=0 while input>0.
 *        Models the H2 finding (openai-compatible path skips applyCaching).
 *   S2 — "mid-loop collapse": round 1-2 have healthy hit ratio, then round 3
 *        drops to ~0. Models the H5 finding (tail breakpoint shift /
 *        non-deterministic tool-result bytes mid-loop).
 *   S3 — "one-shot agents can't cache": many calls, each with a single
 *        round and cached=0. This is expected (single-turn can't benefit
 *        from cache *within* the call), but the probe should NOT raise a
 *        collapse alarm for them.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

const PROBE = path.resolve(import.meta.dir, "../../script/benchmark/cache-probe.ts")

let TMP_DIR = ""

beforeAll(async () => {
  TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cache-probe-test-"))
})

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
})

// ────────── trace builders ──────────

interface SyntheticStep {
  agent: string
  session: string
  call_id: string
  round: number
  input: number
  cached: number
  output?: number
  tool_calls?: number
  tool_results?: number
}

function stepEvent(s: SyntheticStep, seq: number): any {
  return {
    ts: 1_700_000_000_000 + seq * 1000,
    seq,
    taskID: "tsk_synthetic",
    sessionID: s.session,
    agent: s.agent,
    round: s.round,
    category: "llm.step",
    payload: {
      call_id: s.call_id,
      finish_reason: "tool-calls",
      text_len: 0,
      reasoning_len: 0,
      tool_call_count: s.tool_calls ?? 1,
      tool_result_count: s.tool_results ?? 0,
      usage: {
        inputTokens: s.input,
        outputTokens: s.output ?? 100,
        reasoningTokens: 0,
        cachedInputTokens: s.cached,
      },
    },
  }
}

function outboundEvent(opts: { agent: string; session: string; call_id: string; round: number; body: unknown }, seq: number): any {
  return {
    ts: 1_700_000_000_000 + seq * 1000,
    seq,
    taskID: "tsk_synthetic",
    sessionID: opts.session,
    agent: opts.agent,
    round: opts.round,
    category: "llm.outbound",
    payload: { call_id: opts.call_id, body: opts.body },
  }
}

async function writeTrace(file: string, steps: SyntheticStep[]): Promise<void> {
  const lines = steps.map((s, i) => JSON.stringify(stepEvent(s, i)))
  await fs.writeFile(file, lines.join("\n") + "\n")
}

function runProbe(traceFile: string): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", ["run", PROBE, "--trace-file", traceFile, "--quiet"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  })
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? -1,
  }
}

async function readReport(traceFile: string): Promise<any> {
  const raw = await fs.readFile(traceFile + ".cache-probe.json", "utf8")
  return JSON.parse(raw)
}

// ────────── S1 — dead provider cache ──────────

describe("S1 — dead provider cache (every call cached=0)", () => {
  test("verdict flags the agent and cites H2", async () => {
    const file = path.join(TMP_DIR, "s1.jsonl")
    const steps: SyntheticStep[] = []
    // 5 multi-round calls for "design-analyst" on a dashscope-like setup:
    // sizable input but zero cache reads.
    for (let call = 0; call < 5; call++) {
      for (let round = 1; round <= 4; round++) {
        steps.push({
          agent: "design-analyst",
          session: `sess-${call}`,
          call_id: `call-${call}`,
          round,
          input: 50_000 + round * 10_000,
          cached: 0,
        })
      }
    }
    await writeTrace(file, steps)
    const r = runProbe(file)
    expect(r.code).toBe(0)
    const report = await readReport(file)
    const designAnalyst = report.agents.find((a: any) => a.agent === "design-analyst")
    expect(designAnalyst).toBeTruthy()
    expect(designAnalyst.hit_ratio).toBe(0)
    expect(designAnalyst.zero_hit_steps).toBe(20)
    expect(String(report.verdict)).toContain("< 5% aggregate cache hit")
    expect(String(report.verdict)).toContain("transform.ts:171-181")
  })
})

// ────────── S2 — mid-loop collapse ──────────

describe("S2 — mid-loop cache collapse", () => {
  test("probe detects the exact round where hit ratio crashes", async () => {
    const file = path.join(TMP_DIR, "s2.jsonl")
    const steps: SyntheticStep[] = [
      // One long call with healthy cache for 2 rounds, then collapse.
      { agent: "executor", session: "sess-a", call_id: "call-a", round: 1, input: 60_000, cached: 50_000 },
      { agent: "executor", session: "sess-a", call_id: "call-a", round: 2, input: 75_000, cached: 62_000 },
      // Collapse: tool-result bytes drifted mid-loop.
      { agent: "executor", session: "sess-a", call_id: "call-a", round: 3, input: 90_000, cached: 5_000 },
      { agent: "executor", session: "sess-a", call_id: "call-a", round: 4, input: 110_000, cached: 3_000 },
    ]
    await writeTrace(file, steps)
    const r = runProbe(file)
    expect(r.code).toBe(0)
    const report = await readReport(file)
    const call = report.calls.find((c: any) => c.call_id === "call-a")
    expect(call).toBeTruthy()
    expect(call.cache_collapse_round).toBe(3)
    expect(call.first_cache_hit_round).toBe(1)
    expect(String(report.verdict)).toContain("collapsed mid-loop")
  })
})

// ────────── S3 — one-shot agents should not be flagged ──────────

describe("S3 — single-round agents are not mistaken for a bug", () => {
  test("no collapse alarm, no 'never hit cache' alarm for single-round calls", async () => {
    const file = path.join(TMP_DIR, "s3.jsonl")
    const steps: SyntheticStep[] = []
    for (let i = 0; i < 10; i++) {
      steps.push({
        agent: "requirements",
        session: `s-${i}`,
        call_id: `c-${i}`,
        round: 1,
        input: 8_000,
        cached: 0, // cache-read expected 0 for the first round of any call
      })
    }
    await writeTrace(file, steps)
    const r = runProbe(file)
    expect(r.code).toBe(0)
    const report = await readReport(file)
    expect(String(report.verdict)).not.toContain("collapsed mid-loop")
    expect(String(report.verdict)).not.toContain("NEVER hit cache")
    // "< 5% hit" WILL still fire if the aggregate input crosses 2k AND hit
    // is < 5%. That's the point — single-round-only agents on a provider
    // without cache_control really do waste tokens. The probe's job is to
    // surface this; the operator decides if it's acceptable.
  })
})

// ────────── S3b — prefix drift localization ──────────

describe("S3b — prefix drift detection across rounds", () => {
  test("probe localizes byte-level divergence between consecutive outbound bodies", async () => {
    const file = path.join(TMP_DIR, "s3b.jsonl")
    // Round 1 body: system + user. Round 2 body: system + user + assistant +
    // tool-result (the extension healthy case). Round 3 body: the tool-result
    // drifts in the middle (simulates litellm `skipped N chars` number change
    // or any other non-deterministic proxy edit).
    const healthyExtension = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "analyze this page" },
        { role: "assistant", content: "calling webfetch" },
        { role: "user", content: "(tool-result: html with skipped 48210 chars)" },
      ],
    }
    const drifted = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "analyze this page" },
        { role: "assistant", content: "calling webfetch" },
        // NOTE: the byte sequence differs inside the tool-result — litellm
        // truncated slightly differently on the replay.
        { role: "user", content: "(tool-result: html with skipped 48213 chars)" },
        { role: "assistant", content: "now calling fetchCss" },
        { role: "user", content: "(tool-result: css)" },
      ],
    }
    const round1Body = { messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "analyze this page" },
    ]}
    const events = [
      outboundEvent({ agent: "design-analyst", session: "s1", call_id: "c1", round: 1, body: round1Body }, 0),
      outboundEvent({ agent: "design-analyst", session: "s1", call_id: "c1", round: 2, body: healthyExtension }, 1),
      outboundEvent({ agent: "design-analyst", session: "s1", call_id: "c1", round: 3, body: drifted }, 2),
      // Also need at least one llm.step so main() doesn't exit.
      stepEvent({ agent: "design-analyst", session: "s1", call_id: "c1", round: 1, input: 10_000, cached: 0 }, 3),
    ]
    await fs.writeFile(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n")

    const r = runProbe(file)
    expect(r.code).toBe(0)
    const report = await readReport(file)
    // Round 1 → 2 must NOT be a drift (round 2 extends round 1).
    // Round 2 → 3 is a drift (tool-result byte differs).
    const driftList: any[] = report.drifts ?? []
    const driftHits = driftList.filter((d: any) => d.call_id === "c1")
    expect(driftHits.length).toBe(1)
    expect(driftHits[0].from_round).toBe(2)
    expect(driftHits[0].to_round).toBe(3)
    expect(driftHits[0].prefix_match_ratio).toBeGreaterThan(0) // partial match
    expect(driftHits[0].prefix_match_ratio).toBeLessThan(1)   // but not full
    // The divergence context should include the byte where the digits differ.
    const combined = driftHits[0].before + driftHits[0].after
    expect(combined).toContain("skipped")
  })
})

// ────────── S4 — healthy cache run should produce a clean verdict ──────────

describe("S4 — healthy run", () => {
  test("no warnings emitted when cache is consistently hot", async () => {
    const file = path.join(TMP_DIR, "s4.jsonl")
    const steps: SyntheticStep[] = []
    for (let round = 1; round <= 5; round++) {
      steps.push({
        agent: "executor",
        session: "sess-h",
        call_id: "call-h",
        round,
        input: 80_000,
        cached: round === 1 ? 0 : 72_000,
      })
    }
    await writeTrace(file, steps)
    const r = runProbe(file)
    expect(r.code).toBe(0)
    const report = await readReport(file)
    expect(String(report.verdict)).toContain("No gross anomalies")
  })
})
