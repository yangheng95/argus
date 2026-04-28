import { describe, expect, test } from "bun:test"
import { BuildAgent, externalToolProtocolErrorMessage } from "../../src/build/agent"

describe("BuildAgent external coding system prompt", () => {
  test("injects OpenCorvus MCP tool aliases for Codex build sessions", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "codex",
      baseSystem: "base system",
      skillPrompt: "skill prompt",
    })

    expect(composed.mcpPromptInjected).toBe(true)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(composed.system).toContain("webpage_compile => mcp__opencorvus__webpage_compile")
    expect(composed.system).toContain("Do not create, copy, or handwrite")
    expect(composed.system).toContain("skill prompt")
  })

  test("leaves Claude Code MCP alias injection to the Claude provider", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "claude-code",
      baseSystem: "base system",
      skillPrompt: "skill prompt",
    })

    expect(composed.mcpPromptInjected).toBe(false)
    expect(composed.system).toBe("base system\n\nskill prompt")
  })

  test("classifies external tool event misalignment before host merge_back", () => {
    expect(externalToolProtocolErrorMessage({
      executor: "codex",
      kind: "unmatched_result",
      callID: "call_123",
      toolName: "bash",
    })).toBe(
      "External executor protocol error (codex): tool_result id=\"call_123\" for bash " +
      "arrived without a prior tool_call; refusing to run host merge_back because tool telemetry is misaligned.",
    )

    expect(externalToolProtocolErrorMessage({
      executor: "claude-code",
      kind: "unclosed_call",
      callID: "toolu_1",
      toolName: "Read",
    })).toBe(
      "External executor protocol error (claude-code): tool_call id=\"toolu_1\" for Read " +
      "ended without a matching tool_result; refusing to run host merge_back because tool telemetry is incomplete.",
    )
  })
})
