import { describe, expect, test } from "bun:test"
import { AgentRunError, buildHardErrorFromFinalMessage } from "../../src/agent/runner"
import { Message } from "../../src/session/message"

/**
 * Regression tests for the silent-completed bug surfaced by the
 * intent-analysis "秒退" incident on tsk_ddf383614 (2026-04-30T16:28:24Z).
 *
 * Previously: SessionPrompt.prompt stamped `processor.message.error` on
 * the assistant message and returned "stop" without throwing. The runner
 * returned the (errored) finalMessage as success → orchestrator tools
 * fed fallback defaults forward → workflow.step silently flipped to
 * "completed" despite an HTTP 400 from the upstream provider.
 *
 * After fix: `buildHardErrorFromFinalMessage` converts a stamped error
 * into a thrown AgentRunError; `Message.AbortedError` is the only soft
 * exception. Provider `isRetryable: false` propagates as
 * `AgentRunError.nonRetryable: true` so retry helpers fail-fast.
 *
 * Rule 7 / rule 16: no fallback path — the assistant returning an error
 * MUST surface to the caller. Pure helper extracted from runAgentSession
 * so this assertion runs without standing up SessionPrompt / Provider.
 */

const KIND = "intent-analysis" as const

describe("buildHardErrorFromFinalMessage", () => {
  test("no error stamped → null (success path)", () => {
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant" } },
    })
    expect(result).toBeNull()
  })

  test("non-assistant role → null (defensive — runner only stamps on assistant)", () => {
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: {
        info: {
          role: "user",
          error: { name: "APIError", data: { message: "should be ignored" } },
        },
      },
    })
    expect(result).toBeNull()
  })

  test("AbortedError stamped → null (soft cancellation, not a failure)", () => {
    const aborted = new Message.AbortedError({ message: "user pressed stop" })
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: aborted } },
    })
    expect(result).toBeNull()
  })

  test("APIError isRetryable=false → AgentRunError nonRetryable=true (deepseek 400)", () => {
    // Mirrors the actual error shape from the tsk_ddf383614 incident.
    const apiError = {
      name: "APIError",
      data: {
        message: "deepseek-reasoner does not support this tool_choice",
        statusCode: 400,
        isRetryable: false,
      },
    }
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: apiError } },
    })
    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(AgentRunError)
    expect(result!.nonRetryable).toBe(true)
    expect(result!.kind).toBe(KIND)
    expect(result!.message).toContain("intent-analysis")
    expect(result!.message).toContain("APIError")
    expect(result!.message).toContain("deepseek-reasoner does not support this tool_choice")
  })

  test("APIError isRetryable=true → AgentRunError nonRetryable=false (transient 503)", () => {
    const apiError = {
      name: "APIError",
      data: {
        message: "Upstream service unavailable",
        statusCode: 503,
        isRetryable: true,
      },
    }
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: apiError } },
    })
    expect(result).not.toBeNull()
    expect(result!.nonRetryable).toBe(false)
  })

  test("error without isRetryable flag → nonRetryable=false (default to transient)", () => {
    // Generic Error or provider error missing the flag — be conservative
    // and let the retry loop decide. Only an explicit false short-circuits.
    const genericError = {
      name: "SomeError",
      data: { message: "stream interrupted" },
    }
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: genericError } },
    })
    expect(result).not.toBeNull()
    expect(result!.nonRetryable).toBe(false)
  })

  test("error with no name and no data.message → falls back to UnknownError", () => {
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: {} } },
    })
    expect(result).not.toBeNull()
    expect(result!.message).toContain("UnknownError")
  })

  test("StructuredOutputError → wrapped (covers the case where loop.ts stamps it)", () => {
    // SessionLoop stamps Message.StructuredOutputError when the model finishes
    // without calling StructuredOutput. That's a hard miss that callers must
    // see, not a silent default — so the helper must propagate it (the
    // classifier separately decides retry vs fail-fast based on session-level
    // state). This locks in that the StructuredOutputError name flows through.
    const err = new Message.StructuredOutputError({
      message: "Model did not produce structured output (finish=stop)",
      retries: 0,
    })
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "intent-analysis",
      finalMessage: { info: { role: "assistant", error: err } },
    })
    expect(result).not.toBeNull()
    expect(result!.message).toContain("StructuredOutputError")
  })

  test("agentName appears in the error message for operator triage", () => {
    const apiError = {
      name: "APIError",
      data: { message: "boom", isRetryable: false },
    }
    const result = buildHardErrorFromFinalMessage({
      kind: KIND,
      agentName: "requirements-strict",
      finalMessage: { info: { role: "assistant", error: apiError } },
    })
    expect(result!.message).toContain("requirements-strict")
  })
})
