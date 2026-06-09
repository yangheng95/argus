import { test, expect } from "bun:test"
// Import order matters: SessionPrompt pulls in the session module graph so
// SessionLoop's namespace is fully populated by the time we reference it.
// Loading SessionLoop directly ahead of SessionPrompt triggers a module-init
// cycle (prompt/index destructure sees an empty stub) — same pattern noted
// in `test/session/extra-tools.test.ts`.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
void SessionPrompt

/**
 * Regression for the intent-analysis "秒退" failure (task tsk_ddf383614,
 * 2026-04-30T16:28:24Z). DeepSeek-Reasoner / DeepSeek-V4-Flash (the official
 * `deepseek` provider aliases v4-flash to the reasoner family) returns HTTP
 * 400 on every json_schema turn:
 *
 *   "deepseek-reasoner does not support this tool_choice"
 *
 * Root cause: `structuredOutputToolChoice` returned `"required"` regardless
 * of `model.capabilities.reasoning`. The reasoning-model branch in the peer
 * function `terminalToolChoice` already handled the same provider quirk
 * (alibaba-coding-plan-cn/glm-5 thinking mode rejects required + object) but
 * the structured-output path lacked the same guard.
 *
 * Fix: reasoning models get `"auto"` (truthy short-circuit so the `??` chain
 * at loop.ts:1201 does not fall through to terminalToolChoice). The
 * structured-output soft-pin runs through STRUCTURED_OUTPUT_SYSTEM_PROMPT +
 * shouldEnterStructuredOutputRecovery — the same prompt-soft-pin / scoping
 * pattern terminalToolChoice uses for reasoning models. Non-reasoning models
 * keep the hard `"required"` pin for determinism.
 */

const jsonSchema = {
  type: "json_schema" as const,
  schema: { type: "object" } as Record<string, unknown>,
  retryCount: 2,
}

test("non-reasoning model + json_schema → required", () => {
  const choice = SessionLoop.structuredOutputToolChoice(jsonSchema, {
    capabilities: { reasoning: false },
  })
  expect(choice).toBe("required")
})

test("reasoning model + json_schema → auto (avoids deepseek-reasoner 400)", () => {
  const choice = SessionLoop.structuredOutputToolChoice(jsonSchema, {
    capabilities: { reasoning: true },
  })
  expect(choice).toBe("auto")
})

test("text format → undefined regardless of reasoning capability", () => {
  const text = { type: "text" as const }
  expect(SessionLoop.structuredOutputToolChoice(text, { capabilities: { reasoning: true } })).toBeUndefined()
  expect(SessionLoop.structuredOutputToolChoice(text, { capabilities: { reasoning: false } })).toBeUndefined()
})

test("model param omitted → behaves like non-reasoning (required)", () => {
  // Backwards compatibility: existing call sites that pre-date the model
  // parameter must continue to receive the deterministic hard pin.
  const choice = SessionLoop.structuredOutputToolChoice(jsonSchema)
  expect(choice).toBe("required")
})

test("model with no capabilities object → behaves like non-reasoning", () => {
  const choice = SessionLoop.structuredOutputToolChoice(jsonSchema, {} as any)
  expect(choice).toBe("required")
})

test("reasoning=auto truthy short-circuits the ?? chain to terminalToolChoice", () => {
  // The call site at loop.ts:1201 chains:
  //   structuredOutputToolChoice(format, model) ?? terminalToolChoice(...)
  // For json_schema turns we must NEVER fall through to terminal-tool
  // logic — those two contracts are independent. Returning a truthy value
  // ("auto") guarantees the chain short-circuits even when the model is
  // a reasoning one.
  const choice = SessionLoop.structuredOutputToolChoice(jsonSchema, {
    capabilities: { reasoning: true },
  })
  expect(choice).toBeDefined()
  expect(choice).not.toBeUndefined()
})
