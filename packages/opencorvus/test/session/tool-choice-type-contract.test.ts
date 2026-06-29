import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import type { LLM } from "../../src/session/llm"

/**
 * Phase E of deleted pre-June record 2026-04-28-structured-output-systemic-fix:
 * after ripping out `ProviderLLM.stream` (rule 2 / rule 22 — single source
 * for the agent stream entry), `LLM.StreamInput.toolChoice` is the only
 * type that decides what shapes the loop can pass to `streamText`.
 *
 * The pin form `{ type: "tool", toolName: "StructuredOutput" }` is the
 * protocol-level guarantee that the next assistant turn cannot select a
 * different tool to dodge finalisation. If a future refactor narrowed
 * this back to `"auto" | "required" | "none"` (the old `ProviderLLM`
 * shape), the integrity reviewer's hard-pin path would silently fail to
 * type-check at the call site and we'd be back to soft-prompt-only. This
 * test makes the type a regression target.
 */
describe("LLM.StreamInput.toolChoice type contract", () => {
  test("accepts auto / required / none / specific-tool pin", () => {
    type TC = NonNullable<LLM.StreamInput["toolChoice"]>
    const auto: TC = "auto"
    const required: TC = "required"
    const none: TC = "none"
    const pinned: TC = { type: "tool", toolName: "StructuredOutput" }
    expect(auto).toBe("auto")
    expect(required).toBe("required")
    expect(none).toBe("none")
    expect(pinned).toEqual({ type: "tool", toolName: "StructuredOutput" })
  })

  test("optional — omitting toolChoice is the unconstrained-tools default", () => {
    // The session loop omits `toolChoice` when the user contract is
    // `format=text`; the property must remain optional.
    const undef: LLM.StreamInput["toolChoice"] = undefined
    expect(undef).toBeUndefined()
  })
})
