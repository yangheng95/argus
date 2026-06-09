import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

/**
 * Phase D of specs/new-arch/2026-04-28-structured-output-systemic-fix.md:
 * after a turn ends, the loop must enter the StructuredOutput recovery
 * channel (stamp `StructuredOutputError`) ONLY when
 *
 *   - the user contract is `format=json_schema`,
 *   - the model did NOT call StructuredOutput,
 *   - no provider/runtime error is already on the turn,
 *   - and the turn finished with a non-tool-call reason
 *     (`stop` / `length` / `content-filter` / `error` / etc).
 *
 * `finish=tool-calls` without StructuredOutput is the model still working
 * its tool flow (e.g. integrity reviewer between two
 * `submit_<dim>_verdict` calls) — it is NOT a structured miss and must
 * NOT trigger the recovery path.
 */
describe("SessionLoop.shouldEnterStructuredOutputRecovery", () => {
  const base = {
    finish: "stop" as SessionLoop.TurnFinishReason,
    structuredCalled: false,
    formatType: "json_schema" as const,
    hasExistingError: false,
  }

  test("text-output sessions never enter the recovery channel", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, formatType: "text" })).toBe(false)
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, formatType: undefined })).toBe(false)
  })

  test("does NOT stamp when StructuredOutput was successfully called", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, structuredCalled: true })).toBe(false)
  })

  test("does NOT stamp when a provider/runtime error is already on the turn", () => {
    // Spec §D: keep the original error so retry layer sees the real cause.
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, hasExistingError: true })).toBe(false)
  })

  test("does NOT stamp when finish=tool-calls (model still in tool flow)", () => {
    // Integrity reviewer between two submit_*_verdict calls; build agent
    // calling read_file/edit before merge_back. Both are normal in-flight
    // states, not structured misses.
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "tool-calls" })).toBe(false)
  })

  test("does NOT stamp when finish is missing (turn still in flight)", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: undefined })).toBe(false)
  })

  test("stamps when finish=stop without a StructuredOutput call", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "stop" })).toBe(true)
  })

  test("stamps when finish=length without a StructuredOutput call", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "length" })).toBe(true)
  })

  test("stamps when finish=content-filter without a StructuredOutput call", () => {
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "content-filter" })).toBe(true)
  })

  test("stamps for non-tool-call provider-specific finish reasons", () => {
    // Provider-specific finish reasons (e.g. `error` from kimi/litellm) that
    // are not `tool-calls` should still flow into recovery — the model
    // hasn't produced structured output and we don't have a more specific
    // error stamped yet.
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "error" })).toBe(true)
  })

  test("does NOT stamp on finish=unknown (preserve pre-Phase-D behaviour)", () => {
    // The original gate (`!["tool-calls", "unknown"].includes(finish)`) excluded
    // `unknown`, presumably because it indicates a mid-stream cut / provider-
    // side hiccup rather than a deliberate model finalisation. The next loop
    // iteration runs naturally; Phase D preserves that, since promoting it
    // to a structured miss would be over-aggressive.
    expect(SessionLoop.shouldEnterStructuredOutputRecovery({ ...base, finish: "unknown" })).toBe(false)
  })
})
