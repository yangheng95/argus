import { describe, expect, test } from "bun:test"
import { terminalToolMissingErrorFor } from "../../src/agent/runner"
import { Message } from "../../src/session/message"

describe("runAgentSession terminal tool missing detection", () => {
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

  test("exposes matching terminal misses for visible continuation classification", async () => {
    const err = new Message.TerminalToolMissingError({
      message: "missing report",
      toolName: "report_build_result",
      retries: 0,
    })

    expect(
      terminalToolMissingErrorFor({
        finalMessage: { info: { role: "assistant", error: err } },
        toolName: "report_build_result",
      })?.message,
    ).toBe("missing report")
  })

})
