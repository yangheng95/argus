import { describe, expect, test } from "bun:test"
import { BuildAgent, externalEventPartText, externalToolProtocolErrorMessage } from "../../src/build/agent"

describe("BuildAgent external coding system prompt", () => {
  test("injects OpenCorvus MCP tool aliases for Codex build sessions", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "codex",
      baseSystem: "base system",
      skillPrompt: "skill prompt",
    })

    expect(composed.mcpPromptInjected).toBe(true)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through codex.")
    expect(composed.system).toContain("Treat the user prompt as a build contract, not as a chat request.")
    expect(composed.system).toContain("Do not call OpenCorvus-only tools such as report_build_result or merge_back")
    expect(composed.system).toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(composed.system).toContain("webpage_compile => mcp__opencorvus__webpage_compile")
    expect(composed.system).toContain("Do not create, copy, or handwrite")
    expect(composed.system).toContain("those references are authoritative")
    expect(composed.system).toContain("Match them 1:1 as closely as the stack allows")
    expect(composed.system).toContain("skill prompt")
  })

  test("leaves Claude Code MCP alias injection to the Claude provider", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "claude-code",
      baseSystem: "base system",
      skillPrompt: "skill prompt",
    })

    expect(composed.mcpPromptInjected).toBe(false)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through claude-code.")
    expect(composed.system).toContain("Keep reasoning, plans, prompt/rule details, and progress narration out of assistant text.")
    expect(composed.system).toContain("skill prompt")
  })

  test("does not materialize external assistant narration as card text", () => {
    expect(externalEventPartText({ type: "text_delta", text: "Let me inspect the repo." }, "claude-code")).toBeUndefined()
    expect(externalEventPartText({ type: "reasoning_delta", text: "thinking aloud" }, "claude-code")).toBeUndefined()
    expect(externalEventPartText({ type: "plan_delta", summary: "1. inspect files\n2. write code" }, "codex")).toBeUndefined()
    expect(externalEventPartText({ type: "diff_delta", summary: "updated src/app.ts" }, "codex")).toBeUndefined()
    expect(externalEventPartText({ type: "error", message: "Claude Code process aborted by user" }, "claude-code")).toContain(
      "Claude Code process aborted by user",
    )
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
