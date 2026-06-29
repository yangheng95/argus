import { describe, expect, test } from "bun:test"
import { AgentRunError, classifyAttemptOutcome } from "../../src/agent/runner"
import { Message } from "../../src/session/message"

/**
 * Phase F of deleted pre-June record 2026-04-28-structured-output-systemic-fix:
 * `runAgentSessionWithRetry` must NOT loop on deterministic structural
 * failures (prompt-budget / tool-schema-budget overflow), and must NOT
 * loop after the caller's `isComplete` signals a deterministic completed
 * attempt failure (`terminal: true`). Transient
 * provider/stream errors keep the existing retry behaviour.
 *
 * The classifier is a pure function so tests cover the full decision
 * matrix without standing up SessionPrompt / Provider mocks.
 */
describe("classifyAttemptOutcome", () => {
  test("PromptBudgetOverflowError throw → fail-fast", () => {
    const err = new Message.PromptBudgetOverflowError({
      message: "system + tool schemas alone exceed budget",
      systemTokensEst: 1000,
      messagePayloadChars: 0,
      toolSchemaChars: 250_000,
      compressibleMessageChars: 0,
      nonCompressiblePromptChars: 250_000,
      usableBudget: 262_144,
      limit: 235_929,
      toolNames: "submit_a,submit_b",
    })
    const out = classifyAttemptOutcome({ thrownError: err })
    expect(out.action).toBe("fail-fast")
    if (out.action === "fail-fast") {
      expect(out.reason).toContain("system + tool schemas alone exceed budget")
    }
  })

  test("ToolSchemaBudgetError throw → fail-fast", () => {
    const err = new Message.ToolSchemaBudgetError({
      message: "Tool schema payload exceeds 50% of model input budget",
      toolSchemaChars: 200_000,
      usableBudget: 262_144,
      ratio: 0.5,
      toolNames: "submit_a,submit_b",
    })
    const out = classifyAttemptOutcome({ thrownError: err })
    expect(out.action).toBe("fail-fast")
  })

  test("generic Error throw → retry (transient/unexpected)", () => {
    // Network blip, JSON-RPC timeout, anything that's not a structural
    // budget overflow. Spec §F: keep current retry behaviour for these.
    const out = classifyAttemptOutcome({ thrownError: new Error("ECONNRESET") })
    expect(out.action).toBe("retry")
    if (out.action === "retry") {
      expect(out.reason).toBe("ECONNRESET")
    }
  })

  test("session streamErrors → retry", () => {
    const out = classifyAttemptOutcome({
      streamErrors: [{ reason: "upstream 503", name: "APIError" }],
    })
    expect(out.action).toBe("retry")
    if (out.action === "retry") {
      expect(out.reason).toContain("APIError")
      expect(out.reason).toContain("upstream 503")
    }
  })

  test("isComplete ok=true → ok", () => {
    const out = classifyAttemptOutcome({ decision: { ok: true } })
    expect(out.action).toBe("ok")
  })

  test("isComplete ok=false terminal=true → fail-fast (no retry)", () => {
    // This is the Phase F behaviour: once a caller has proven an attempt
    // ended in a deterministic terminal-contract miss, spawning a fresh
    // session against the same model repeats the same work.
    const out = classifyAttemptOutcome({
      decision: {
        ok: false,
        terminal: true,
        reason: "agent ended without its explicit terminal collector tool",
      },
    })
    expect(out.action).toBe("fail-fast")
    if (out.action === "fail-fast") {
      expect(out.reason).toContain("terminal collector tool")
    }
  })

  test("isComplete ok=false terminal=false → retry (default)", () => {
    // Existing behaviour preserved: callers that don't opt into terminal
    // (e.g. acceptance, whose retries genuinely give the model another shot
    // at code generation) get the same retry loop they had before Phase F.
    const out = classifyAttemptOutcome({
      decision: { ok: false, reason: "missing dimension verdicts" },
    })
    expect(out.action).toBe("retry")
  })

  test("isComplete ok=false with no terminal flag defaults to retry", () => {
    const out = classifyAttemptOutcome({ decision: { ok: false } })
    expect(out.action).toBe("retry")
  })

  test("no thrown error, no streamErrors, no decision → fail-fast (defensive)", () => {
    // The retry loop should never reach this state, but the classifier
    // surfaces it as fail-fast so an internal bug surfaces fast instead
    // of looping silently.
    const out = classifyAttemptOutcome({})
    expect(out.action).toBe("fail-fast")
  })

  test("AgentRunError nonRetryable=true → fail-fast (no retry)", () => {
    // Regression for the intent-analysis "秒退" incident on tsk_ddf383614:
    // deepseek-reasoner returned HTTP 400 "tool_choice not supported"
    // (isRetryable=false). The runner now wraps such failures as
    // AgentRunError with nonRetryable=true; the classifier MUST fail-fast
    // so retry helpers do not burn maxRetries on a deterministically
    // failing request (rule 7 — no fallback, surface real cause).
    const err = new AgentRunError(
      "intent-analysis",
      "LLM error during intent-analysis: APIError: deepseek-reasoner does not support this tool_choice",
      { nonRetryable: true },
    )
    const out = classifyAttemptOutcome({ thrownError: err })
    expect(out.action).toBe("fail-fast")
    if (out.action === "fail-fast") {
      expect(out.reason).toContain("deepseek-reasoner")
    }
  })

  test("AgentRunError nonRetryable=false → retry (transient)", () => {
    // The default for AgentRunError without an explicit nonRetryable flag
    // is treated as transient (e.g. ECONNRESET wrapped by the runner).
    const err = new AgentRunError("requirements", "transient ECONNRESET")
    expect(err.nonRetryable).toBe(false)
    const out = classifyAttemptOutcome({ thrownError: err })
    expect(out.action).toBe("retry")
  })

  test("thrown error precedence over decision (throw wins)", () => {
    // If runAgentSession threw, we never produce an isComplete decision —
    // but if both are passed (defensive), throw must win because the
    // attempt didn't reach the contract-check stage.
    const err = new Message.PromptBudgetOverflowError({
      message: "budget overflow",
      systemTokensEst: 0,
      messagePayloadChars: 0,
      toolSchemaChars: 0,
      compressibleMessageChars: 0,
      nonCompressiblePromptChars: 0,
      usableBudget: 1,
      limit: 1,
      toolNames: "",
    })
    const out = classifyAttemptOutcome({
      thrownError: err,
      decision: { ok: true }, // would say success — must be ignored
    })
    expect(out.action).toBe("fail-fast")
  })
})
