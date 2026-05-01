import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * 2026-04-30 — overlay-web-benchmark round-1 wedged for 5+ min on
 * `webpage_vision_judge` calling alibaba-coding-plan-cn (kimi-k2.5).
 * The provider is documented to hang 20+ min on transient failures
 * (memory: feedback_alibaba_connection.md). The chat path's
 * stream-activity gate is pause()d while a tool runs (session.processor
 * pause-around-tool semantics), so the parent agent's idle abort cannot
 * unblock a tool that calls its own LLM. Without an internal gate,
 * the SDK stream reader parks on a reader.read() promise that AbortController
 * alone does not unblock and the entire build session hangs.
 *
 * Fix: webpage_vision_judge spins up its own `withStreamActivity` gate
 * (idleMs=180000, label includes provider/model) and wires the combined
 * signal into `streamText({ output: Output.object(...), abortSignal })`.
 * Each fullStream chunk bumps the activity gate.
 *
 * This regression pins the wiring at the source level — any future
 * refactor that drops the gate or stops calling observe() fails CI.
 */

describe("webpage_vision_judge — stream-activity idle gate", () => {
  test("source wires LLM activity gate into structured stream abortSignal + observes chunks", async () => {
    const src = await fs.readFile(
      path.join(import.meta.dir, "..", "..", "src", "mirror", "tools", "webpage-vision-judge.ts"),
      "utf8",
    )
    expect(src).toMatch(/withLLMActivity/)
    expect(src).toMatch(/idleMs:\s*VISION_JUDGE_IDLE_MS/)
    expect(src).toMatch(/abortSignal:\s*run\.signal/)
    expect(src).toMatch(/run\.bump\(/)
    expect(src).toMatch(/Output\.object\(\{\s*schema:\s*VerdictSchema\s*\}\)/)
    // Idle window must be a hard constant, not a magic number sprinkled
    // inline — keeps in sync with session.processor's 180s gate.
    expect(src).toMatch(/const\s+VISION_JUDGE_IDLE_MS\s*=\s*180_000/)
  })
})
