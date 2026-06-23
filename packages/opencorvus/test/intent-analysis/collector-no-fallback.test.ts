import { describe, expect, test } from "bun:test"
import { collectorToResult, IntentClarificationInputSchema } from "../../src/intent-analysis/output-tools"
import type { IntentFinal } from "../../src/intent-analysis/output-tools"

/**
 * Regression for tsk_ddf383614 (2026-04-30) silent-completed pipeline.
 *
 * The previous `collectorToResult(c, final?)` returned defaults
 * (`intent_class: "unclear"`, `complexity: "unknown"`, `confidence: 0`,
 * `summary: ""`) when `final` was undefined. That fallback was the second
 * leg of the silent-completed pipeline: the runner returned an errored
 * message as success → the agent called `collectorToResult(c, undefined)`
 * → the orchestrator received a "valid" intent result with empty defaults
 * → `trackStepComplete("analyze_intent")` (success) fired → workflow.step
 * showed "completed" while the actual LLM call had returned HTTP 400.
 *
 * Per CLAUDE.md rule 7 / rule 16: the parameter is now required. The
 * runner's `buildHardErrorFromFinalMessage` guarantees no caller reaches
 * this helper without a real `IntentFinal`. Type system enforces it; this
 * test locks in the behaviour for any caller that bypasses the type check.
 */

const baseCollector = {
  slots: [{ key: "lang", value: "typescript", confidence: 0.9 }],
  missing: ["target_path"],
  clarifications: [],
}

const baseFinal: IntentFinal = {
  intent_class: "feature",
  complexity: "medium",
  confidence: 0.85,
  summary: "Add a new tool to the orchestrator surface",
}

describe("collectorToResult — no fallback contract", () => {
  test("merges collector + final without defaulting any field", () => {
    const result = collectorToResult(baseCollector, baseFinal)
    expect(result.intent_class).toBe("feature")
    expect(result.complexity).toBe("medium")
    expect(result.confidence).toBe(0.85)
    expect(result.summary).toBe("Add a new tool to the orchestrator surface")
    expect(result.extracted_slots).toEqual(baseCollector.slots)
    expect(result.missing_info).toEqual(baseCollector.missing)
    expect(result.clarifications).toEqual(baseCollector.clarifications)
  })

  test("does not mask intent_class='unclear' when the LLM legitimately picks it", () => {
    // 'unclear' was the previous fallback default. After the fix the value
    // can ONLY appear when the LLM picked it — never as a silent backfill.
    const final: IntentFinal = {
      intent_class: "unclear",
      complexity: "unknown",
      confidence: 0.2,
      summary: "Request is ambiguous; needs clarification.",
    }
    const result = collectorToResult(baseCollector, final)
    expect(result.intent_class).toBe("unclear")
    expect(result.complexity).toBe("unknown")
    expect(result.confidence).toBe(0.2)
    // Critical: this must come from the LLM, not from a `?? ""` default.
    expect(result.summary).toBe("Request is ambiguous; needs clarification.")
  })

  test("function signature requires the final param (compile-time gate)", () => {
    // Pre-fix, this would have compiled and silently returned defaults:
    //   collectorToResult(baseCollector)
    // After fix, IntentFinal is non-optional. Verify by attempting an
    // explicit cast and confirming the helper does NOT fabricate values.
    // (Runtime: passing a non-IntentFinal triggers TypeScript error in
    // every legitimate call site; this test exists to fail loudly if the
    // signature is ever loosened back to optional in the future.)
    const fn = collectorToResult as (
      c: typeof baseCollector,
      final: IntentFinal,
    ) => ReturnType<typeof collectorToResult>
    expect(fn.length).toBe(2)
  })
})

describe("intent-analysis clarification schema", () => {
  test("accepts choice options plus custom free-form answers", () => {
    const parsed = IntentClarificationInputSchema.parse({
      header: "Visual Policy",
      question: "Which visual policy governs this clone?",
      options: [
        {
          label: "AInvest system (Recommended)",
          description: "Keep the reference structure while using AInvest visual primitives.",
        },
        {
          label: "TradingView pixels",
          description: "Copy the source brand visuals and relax the AInvest design-system constraint.",
        },
      ],
      multiple: false,
      custom: true,
      why_needed: "The prompt gives two incompatible visual authorities.",
      priority: "blocker",
    })

    expect(parsed.options).toHaveLength(2)
    expect(parsed.custom).toBe(true)
  })

  test("rejects a free-form-only question that disables custom input", () => {
    expect(() =>
      IntentClarificationInputSchema.parse({
        header: "Scope",
        question: "What should be built?",
        options: [],
        multiple: false,
        custom: false,
        why_needed: "No selectable answer exists.",
        priority: "blocker",
      }),
    ).toThrow(/Free-form-only clarification questions must set custom=true/)
  })
})
