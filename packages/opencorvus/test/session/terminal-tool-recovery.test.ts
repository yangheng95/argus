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

  test("can hard-pin a single terminal tool when explicitly requested", () => {
    const contract = {
      toolName: "submit_architect",
      isSatisfied: () => false,
    }
    const tools = { submit_architect: {} as any, register_goal: {} as any }

    expect(SessionLoop.terminalToolChoice(contract, tools)).toBe("required")
    expect(
      SessionLoop.terminalToolChoice(contract, tools, { forceTerminalTool: true }),
    ).toEqual({ type: "tool", toolName: "submit_architect" })
  })

  test("keeps discriminator terminal tools on required choice instead of pinning one branch", () => {
    const contract = {
      toolName: "report_build_passed",
      toolNames: ["report_build_passed", "report_build_failed"],
      allowHardPin: false,
      isSatisfied: () => false,
    }
    const tools = {
      report_build_passed: {} as any,
      report_build_failed: {} as any,
    }

    expect(
      SessionLoop.terminalToolChoice(contract, tools, { forceTerminalTool: true }),
    ).toBe("required")
  })
})
