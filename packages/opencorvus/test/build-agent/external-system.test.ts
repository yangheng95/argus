import { describe, expect, test } from "bun:test"
import { BuildAgent, externalEventPartText, externalToolProtocolErrorMessage } from "../../src/build/agent"

describe("BuildAgent external coding system prompt", () => {
  test("injects OpenCorvus MCP executor aliases without reopening mirror tools", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "codex",
      baseSystem: "base system",
      userAppend: "operator build append",
    })

    expect(composed.mcpPromptInjected).toBe(true)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through codex.")
    expect(composed.system).toContain("Treat the user prompt as a build contract, not as a chat request.")
    expect(composed.system).toContain("complete source/target investigation is implementation work")
    expect(composed.system).toContain("context-menu/right-click behavior")
    expect(composed.system).toContain("restate the detailed req/goal contract")
    expect(composed.system).toContain("warn subsequent agents where to dig deeper for workload")
    expect(composed.system).toContain("Do not perform unrelated broad inventories")
    expect(composed.system).toContain("If required source evidence is absent or incomplete")
    expect(composed.system).toContain("Do not call OpenCorvus-only tools such as report_build_result or merge_back")
    expect(composed.system).toContain("Follow task-specific overlays in the user prompt")
    expect(composed.system).toContain("memory => mcp__opencorvus__memory")
    expect(composed.system).toContain("skill => mcp__opencorvus__skill")
    expect(composed.system).toContain("task_report => mcp__opencorvus__task_report")
    expect(composed.system).not.toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(composed.system).not.toContain("figma_extract => mcp__opencorvus__figma_extract")
    expect(composed.system).toContain("Mirror extraction artifacts are produced by the upstream frontend_design stage")
    expect(composed.system).not.toContain("`web-clone-source/` package remains the compact evidence entrypoint")
    expect(composed.system).not.toContain("Do not generate another separate source project for webpage clone acceptance")
    expect(composed.system).toContain("Write shell commands for the actual platform and shell")
    expect(composed.system).toContain("PowerShell-native commands")
    expect(composed.system).toContain("On Windows, start Playwright only through Node Package Manager (`npm`)")
    expect(composed.system).toContain("never through `bun`")
    expect(composed.system).toContain("severe connection-timeout bug on Windows")
    expect(composed.system).toContain("operator build append")
    expect(composed.system).not.toContain("skill prompt")
  })

  test("leaves Claude Code MCP alias injection to the Claude provider", () => {
    const composed = BuildAgent.composeExternalCodingSystem({
      executor: "claude-code",
      baseSystem: "base system",
    })

    expect(composed.mcpPromptInjected).toBe(false)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through claude-code.")
    expect(composed.system).toContain("Keep reasoning, plans, prompt/rule details, and progress narration out of assistant text.")
    expect(composed.system).not.toContain("skill prompt")
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
