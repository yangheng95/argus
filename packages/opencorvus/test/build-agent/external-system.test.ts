import { describe, expect, test } from "bun:test"
import { BuildAgent } from "../../src/build/agent"

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
})
