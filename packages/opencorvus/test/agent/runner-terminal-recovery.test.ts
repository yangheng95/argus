import { describe, expect, test } from "bun:test"
import {
  shouldContinueForMissingTerminalTool,
  terminalToolMissingErrorFor,
} from "../../src/agent/runner"
import { Message } from "../../src/session/message"

describe("runAgentSession terminal tool same-session recovery", () => {
  test("recognizes the matching missing terminal tool error", () => {
    const err = new Message.TerminalToolMissingError({
      message: "missing report",
      toolName: "report_build_result",
      retries: 0,
    }).toObject()

    expect(
      terminalToolMissingErrorFor({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
      })?.message,
    ).toBe("missing report")
  })

  test("does not recover a different terminal tool contract", () => {
    const err = new Message.TerminalToolMissingError({
      message: "missing architect submit",
      toolName: "submit_architect",
      retries: 0,
    })

    expect(
      terminalToolMissingErrorFor({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
      }),
    ).toBeNull()
  })

  test("continues the same session while recovery budget remains", () => {
    const err = new Message.TerminalToolMissingError({
      message: "missing report",
      toolName: "report_build_result",
      retries: 0,
    })

    expect(
      shouldContinueForMissingTerminalTool({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
        satisfied: false,
        attempt: 0,
        maxTurns: 3,
      }),
    ).toBe(true)
  })

  test("stops recovery once the report is present or the same-session budget is exhausted", () => {
    const err = new Message.TerminalToolMissingError({
      message: "missing report",
      toolName: "report_build_result",
      retries: 0,
    })

    expect(
      shouldContinueForMissingTerminalTool({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
        satisfied: true,
        attempt: 0,
        maxTurns: 3,
      }),
    ).toBe(false)
    expect(
      shouldContinueForMissingTerminalTool({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
        satisfied: false,
        attempt: 3,
        maxTurns: 3,
      }),
    ).toBe(false)
  })
})
