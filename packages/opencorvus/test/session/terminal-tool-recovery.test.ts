import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

describe("SessionLoop terminal tool recovery", () => {
  const base = {
    finish: "stop" as SessionLoop.TurnFinishReason,
    satisfied: false,
    hasExistingError: false,
  }

  test("enters recovery when a terminal collector tool is missing on stop", () => {
    expect(SessionLoop.shouldEnterTerminalToolRecovery(base)).toBe(true)
  })

  test("does not recover while the model is still executing tool calls", () => {
    expect(
      SessionLoop.shouldEnterTerminalToolRecovery({ ...base, finish: "tool-calls" }),
    ).toBe(false)
  })

  test("does not recover once the terminal collector contract is satisfied", () => {
    expect(
      SessionLoop.shouldEnterTerminalToolRecovery({ ...base, satisfied: true }),
    ).toBe(false)
  })

  test("hard-pins a single terminal tool when collector facts are ready", () => {
    const contract = {
      toolName: "submit_architect",
      isSatisfied: () => false,
      isReadyToFinalize: () => true,
    }
    const tools = { submit_architect: {} as any, register_goal: {} as any }

    expect(SessionLoop.terminalToolChoice(contract, tools)).toEqual({
      type: "tool",
      toolName: "submit_architect",
    })
  })

  test("keeps work tools available until collector facts are ready to finalize", () => {
    const contract = {
      toolName: "report_build_result",
      isSatisfied: () => false,
      isReadyToFinalize: () => false,
    }
    const tools = {
      report_build_result: {} as any,
      merge_back: {} as any,
    }

    expect(SessionLoop.terminalToolChoice(contract, tools)).toBe("required")
  })

  test("does not choose a terminal tool that is absent from the model tool set", () => {
    const contract = {
      toolName: "submit_architect",
      isSatisfied: () => false,
      isReadyToFinalize: () => true,
    }

    expect(SessionLoop.terminalToolChoice(contract, { register_goal: {} as any })).toBeUndefined()
  })

  test("narrows tool surface to the terminal tool when collector facts are ready", () => {
    const contract = {
      toolName: "submit_architect",
      isSatisfied: () => false,
      isReadyToFinalize: () => true,
    }
    const tools = { submit_architect: {} as any, register_goal: {} as any }

    expect(Object.keys(SessionLoop.terminalToolScopedTools(contract, tools))).toEqual(["submit_architect"])
  })

  test("keeps work tools when terminal facts are not ready", () => {
    const contract = {
      toolName: "report_build_result",
      isSatisfied: () => false,
      isReadyToFinalize: () => false,
    }
    const tools = { report_build_result: {} as any, merge_back: {} as any }

    expect(Object.keys(SessionLoop.terminalToolScopedTools(contract, tools)).sort()).toEqual([
      "merge_back",
      "report_build_result",
    ])
  })
})
