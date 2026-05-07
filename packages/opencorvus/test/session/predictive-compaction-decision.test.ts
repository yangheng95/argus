import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

/**
 * Phase C of specs/new-arch/2026-04-28-structured-output-systemic-fix.md:
 * predictive compaction must NOT fire when compaction cannot rescue the
 * turn — either the tool schemas alone overrun budget (no shrink target),
 * the residue after a perfect compaction would still be over budget, or
 * the compressible message body is too small to absorb the overflow.
 *
 * `assistantMsgCount === 0` is no longer a hard fail-fast trigger; a jumbo
 * first user message can still be compactable.
 */
describe("SessionLoop.predictiveCompactionDecision", () => {
  const baseInput = {
    totalTokensEst: 100,
    limit: 200,
    usableBudget: 220,
    systemChars: 4_000,
    toolSchemaChars: 20_000,
    messagePayloadChars: 40_000,
    imageTokensEst: 0,
    toolSchemaBudgetRatio: 0.5,
    lastFinishedSummary: false,
  }

  test("skips when usable budget is unknown (zero)", () => {
    const out = SessionLoop.predictiveCompactionDecision({ ...baseInput, usableBudget: 0 })
    expect(out.kind).toBe("skip")
  })

  test("skips when the previous turn was a compaction summary", () => {
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      lastFinishedSummary: true,
      totalTokensEst: 999,
    })
    expect(out.kind).toBe("skip")
  })

  test("skips when total tokens are within the predictive limit", () => {
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 150,
      limit: 200,
    })
    expect(out.kind).toBe("skip")
  })

  test("fails fast when tool schemas alone overrun the budget ratio", () => {
    // toolSchemaChars=140K vs usableBudget=200K * ratio=0.5 = 100K → overrun
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 250,
      limit: 200,
      usableBudget: 200_000,
      toolSchemaChars: 140_000,
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("fail-tool-schema")
  })

  test("fails fast when post-compaction residue would still exceed the budget", () => {
    // system+tools alone are already over the limit, even with a 6K residue
    // the request can't shrink under the budget. usableBudget bumped to 2000
    // and toolSchemaBudgetRatio raised so the tool-schema rule does NOT
    // fire — we want to isolate the post-compaction-residue branch.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 1_000,
      limit: 800,
      usableBudget: 2_000,
      systemChars: 2_500,
      toolSchemaChars: 1_500,
      toolSchemaBudgetRatio: 0.95,
    })
    expect(out.kind).toBe("fail-prompt-budget")
    if (out.kind === "fail-prompt-budget") {
      expect(out.reason).toBe("post-compaction-still-over")
    }
  })

  test("fails fast when there is nothing meaningful to compress", () => {
    // overflow exists, but messagePayload (compressible) is tiny — compaction
    // cannot deliver enough headroom.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 60_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 100_000,
      toolSchemaChars: 50_000,
      messagePayloadChars: 1_000, // tiny — nothing to fold up
      toolSchemaBudgetRatio: 0.95, // bypass tool-schema rule
    })
    // Either post-compaction-still-over or nothing-to-compress can trip
    // first depending on residue math; the contract is "do not compact".
    expect(out.kind).toBe("fail-prompt-budget")
  })

  test("compacts when there is enough compressible history to shrink under budget", () => {
    // overflow=1000 tokens, compressibleMessage=200K chars (50K tokens)
    // and post-compaction residue safely under limit.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 51_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 4_000,
      toolSchemaChars: 6_000, // 10K non-compressible chars total
      messagePayloadChars: 200_000, // 50K tokens compressible
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("compact")
  })

  test("a context-cold session with a compactable jumbo user message is allowed to compact", () => {
    // Scenario: step 1, assistantMsgCount === 0, user pasted a 200KB requirements doc.
    // Per spec the assistant count is no longer the gate — only the
    // compressibility math is.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 60_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 3_000,
      toolSchemaChars: 5_000,
      messagePayloadChars: 240_000, // huge user paste — but compactable
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("compact")
  })
})
