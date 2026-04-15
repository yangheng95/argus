/**
 * Micro-bench / correctness tests for the batched sub-agent drop logic in
 * provider/llm.ts. We exercise `growEvictedCallIds` + `dropEvictedRounds`
 * against synthetic (assistant, tool) rounds to verify:
 *
 *   1. Drop pairs entire (assistant+tool) rounds — never strands a tool_use
 *      without its tool_result.
 *   2. Prefix is byte-stable between batch boundaries (the core cache-hit
 *      invariant — if this breaks, Anthropic prompt cache flips to write).
 *   3. Message count / byte count reduction matches expectation.
 *   4. Keeps the first user message and the last `keepRounds` rounds.
 */
import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { __pruneInternal } from "@/provider/llm"

const { growEvictedCallIds, dropEvictedRounds } = __pruneInternal

function makeRound(idx: number, outputSize = 200): ModelMessage[] {
  const callId = `call_${idx}`
  const assistant: ModelMessage = {
    role: "assistant",
    content: [
      { type: "text", text: `turn ${idx} reasoning` },
      { type: "tool-call", toolCallId: callId, toolName: "read", input: { path: `/f${idx}` } },
    ] as any,
  }
  const tool: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: callId,
        toolName: "read",
        output: { type: "text", value: "x".repeat(outputSize) },
      },
    ] as any,
  }
  return [assistant, tool]
}

function synthesizeHistory(rounds: number): ModelMessage[] {
  const msgs: ModelMessage[] = [
    { role: "user", content: "initial task description" },
  ]
  for (let i = 0; i < rounds; i++) msgs.push(...makeRound(i))
  return msgs
}

function bytes(msgs: ModelMessage[]): number {
  return JSON.stringify(msgs).length
}

describe("sub-agent batched drop", () => {
  test("keeps first user + last keepRounds; drops the rest entirely", () => {
    const msgs = synthesizeHistory(10)
    const evicted = new Set<string>()
    growEvictedCallIds(msgs, 4, evicted)
    const out = dropEvictedRounds(msgs, evicted)

    // 1 user + 10 (assistant+tool) rounds = 21 msgs -> drop 6 earliest rounds
    // = drop 12 messages. Result: 21 - 12 = 9 = 1 user + 4 kept rounds * 2.
    expect(out.length).toBe(9)
    expect(out[0].role).toBe("user")
    for (let i = 1; i < out.length; i++) {
      expect(["assistant", "tool"]).toContain(out[i].role)
    }
    // Every remaining tool message must reference a non-evicted callId
    for (const m of out) {
      if (m.role !== "tool") continue
      const c = m.content as any[]
      for (const part of c) {
        if (part.type === "tool-result") {
          expect(evicted.has(part.toolCallId)).toBe(false)
        }
      }
    }
  })

  test("prefix byte-stable between boundaries (cache-hit invariant)", () => {
    // Simulate the prepareStep closure: evictedIds grows only at boundaries.
    const evicted = new Set<string>()
    const keep = 4
    // At boundary 1 (after ~12 rounds accumulated), set grows once.
    const base = synthesizeHistory(12)
    growEvictedCallIds(base, keep, evicted)
    const snapshot = dropEvictedRounds(base, evicted)
    const snapshotBytes = JSON.stringify(snapshot).slice(0, 400)

    // Between boundaries, each new step appends ONE round to history but the
    // evicted set is unchanged. Dropping the extended history should produce
    // the SAME prefix as snapshot — only the growing tail differs.
    for (let extra = 1; extra <= 7; extra++) {
      const extended = [...base]
      for (let i = 0; i < extra; i++) extended.push(...makeRound(12 + i))
      const pruned = dropEvictedRounds(extended, evicted)
      // The shared prefix (everything before the extra rounds) must match byte-for-byte.
      const prunedPrefix = JSON.stringify(pruned.slice(0, snapshot.length)).slice(0, 400)
      expect(prunedPrefix).toBe(snapshotBytes)
    }
  })

  test("byte reduction scales with round count (100KB → ~30KB at 30 rounds)", () => {
    const rounds = 30
    const msgs = synthesizeHistory(rounds)
    const before = bytes(msgs)

    const evicted = new Set<string>()
    growEvictedCallIds(msgs, 4, evicted)
    const after = bytes(dropEvictedRounds(msgs, evicted))

    expect(after).toBeLessThan(before)
    // Keeping 4 of 30 rounds = 4/30 ≈ 13% of round bytes. User message is
    // tiny; expect after/before roughly 15-25% (there's JSON overhead).
    const ratio = after / before
    expect(ratio).toBeLessThan(0.3)
    expect(ratio).toBeGreaterThan(0.05)
  })

  test("no-op when evicted set is empty", () => {
    const msgs = synthesizeHistory(5)
    const out = dropEvictedRounds(msgs, new Set())
    expect(out).toBe(msgs)
  })

  test("no-op when tool count <= keepRounds", () => {
    const msgs = synthesizeHistory(3)
    const evicted = new Set<string>()
    growEvictedCallIds(msgs, 4, evicted)
    expect(evicted.size).toBe(0)
    const out = dropEvictedRounds(msgs, evicted)
    expect(out).toBe(msgs)
  })

  test("growing the evicted set is monotonic", () => {
    const evicted = new Set<string>()
    const rounds1 = synthesizeHistory(10)
    growEvictedCallIds(rounds1, 4, evicted)
    const size1 = evicted.size
    // Re-growing with the SAME history is a no-op (idempotent).
    growEvictedCallIds(rounds1, 4, evicted)
    expect(evicted.size).toBe(size1)
    // Extending history grows the set further (more rounds exceed keepRounds).
    const rounds2 = [...rounds1]
    for (let i = 0; i < 8; i++) rounds2.push(...makeRound(10 + i))
    growEvictedCallIds(rounds2, 4, evicted)
    expect(evicted.size).toBeGreaterThan(size1)
  })

  test("never strands a tool_use in assistant without its tool_result", () => {
    const msgs = synthesizeHistory(10)
    const evicted = new Set<string>()
    growEvictedCallIds(msgs, 4, evicted)
    const out = dropEvictedRounds(msgs, evicted)

    const callsInAssistant: string[] = []
    const resultsInTool: string[] = []
    for (const m of out) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const part of m.content as any[]) {
          if (part.type === "tool-call") callsInAssistant.push(part.toolCallId)
        }
      }
      if (m.role === "tool" && Array.isArray(m.content)) {
        for (const part of m.content as any[]) {
          if (part.type === "tool-result") resultsInTool.push(part.toolCallId)
        }
      }
    }
    // Every remaining tool_use must have a matching tool_result.
    for (const id of callsInAssistant) expect(resultsInTool).toContain(id)
    for (const id of resultsInTool) expect(callsInAssistant).toContain(id)
  })
})
