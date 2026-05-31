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
 * Regression for the architect-loop catch-22 surfaced by r8 bench
 * (`_session-r8-glm5cn-aborthonor.out` lines 6829, 9764, …).
 * `terminalToolChoice` was forcing `tool_choice = {type:"tool",toolName:…}`
 * the moment `shouldExposeOnlyTerminalTool()` flipped true. Reasoning
 * ("thinking") providers — alibaba-coding-plan-cn/glm-5 in particular —
 * reject that form *and* `"required"` with HTTP 400:
 *
 *   "The tool_choice parameter does not support being set to required
 *    or object in thinking mode"
 *
 * Result: architect spent 5–7 min satisfying the heavy validator
 * (output-tools.ts:115-273), the predicate flipped, the next stream
 * call hit 400, the architect threw "submit_architect not called",
 * and orchestrator respawned a fresh architect that reproduced the
 * same trap. Self-healing in name only — every retry burnt the same
 * budget without ever reaching submit.
 *
 * Fix: when the model exposes `capabilities.reasoning`, drop the
 * tool_choice override entirely. The terminal system prompt and recovery
 * channel carry the terminal contract without hiding work tools.
 * Non-reasoning models keep the hard pin.
 */

const contract = (overrides: Partial<Parameters<typeof SessionLoop.terminalToolChoice>[0] & object> = {}) => ({
  toolName: "submit_architect",
  isSatisfied: () => false,
  shouldExposeOnlyTerminalTool: () => true,
  ...overrides,
}) as any

const tools = { submit_architect: { description: "stub" } } as any

test("non-reasoning model keeps the object-form pin once ready", () => {
  const choice = SessionLoop.terminalToolChoice(contract(), tools, {
    capabilities: { reasoning: false },
  })
  expect(choice).toEqual({ type: "tool", toolName: "submit_architect" })
})

test("non-reasoning model with shouldExpose=false still requires a tool call", () => {
  const choice = SessionLoop.terminalToolChoice(
    contract({ shouldExposeOnlyTerminalTool: () => false }),
    tools,
    { capabilities: { reasoning: false } },
  )
  expect(choice).toBe("required")
})

test("reasoning model drops the override and relies on prompt plus recovery", () => {
  const choice = SessionLoop.terminalToolChoice(contract(), tools, {
    capabilities: { reasoning: true },
  })
  expect(choice).toBeUndefined()
})

test("reasoning model with shouldExpose=false also drops the override", () => {
  const choice = SessionLoop.terminalToolChoice(
    contract({ shouldExposeOnlyTerminalTool: () => false }),
    tools,
    { capabilities: { reasoning: true } },
  )
  expect(choice).toBeUndefined()
})

test("model param is optional; absent model behaves like non-reasoning", () => {
  const choice = SessionLoop.terminalToolChoice(contract(), tools)
  expect(choice).toEqual({ type: "tool", toolName: "submit_architect" })
})

test("isSatisfied=true short-circuits regardless of reasoning", () => {
  const choiceA = SessionLoop.terminalToolChoice(
    contract({ isSatisfied: () => true }),
    tools,
    { capabilities: { reasoning: true } },
  )
  const choiceB = SessionLoop.terminalToolChoice(
    contract({ isSatisfied: () => true }),
    tools,
    { capabilities: { reasoning: false } },
  )
  expect(choiceA).toBeUndefined()
  expect(choiceB).toBeUndefined()
})

test("planner stage agents use exact runtime tools to avoid registry and browser tool bloat", () => {
  for (const agentName of [
    "architect",
    "frontend-design",
    "goal-workload-analyst",
    "intent-analysis",
    "requirements",
  ]) {
    expect(SessionLoop.usesExactRuntimeContractTools(agentName, {
      identity: {
        agentKind: agentName,
        contractKind: "stage-attempt",
      },
    } as any)).toBe(true)
  }

  for (const agentName of ["build", "research", "fact-check"]) {
    expect(SessionLoop.usesExactRuntimeContractTools(agentName, {
      identity: {
        agentKind: agentName,
        contractKind: "stage-attempt",
      },
    } as any)).toBe(false)
  }

  expect(SessionLoop.usesExactRuntimeContractTools("requirements", {
    identity: {
      agentKind: "architect",
      contractKind: "stage-attempt",
    },
  } as any)).toBe(false)
})
