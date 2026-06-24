import { describe, expect, test } from "bun:test"
import { AGENT_CREATE_AVAILABLE_GLOBAL_TOOLS, buildAgentCreateFrontmatter } from "../../src/cli/cmd/agent"

describe("agent create tool frontmatter", () => {
  test("writes selected custom-agent tools as global pool entries", () => {
    expect(
      buildAgentCreateFrontmatter({
        description: "review code",
        mode: "subagent",
        selectedTools: ["read", "glob", "search_code"],
      }),
    ).toEqual({
      description: "review code",
      mode: "subagent",
      tools: { global: ["read", "glob", "search_code"] },
    })
  })

  test("omits tools when the custom agent uses the full default global selection", () => {
    expect(
      buildAgentCreateFrontmatter({
        description: "review code",
        mode: "all",
        selectedTools: AGENT_CREATE_AVAILABLE_GLOBAL_TOOLS,
      }),
    ).toEqual({
      description: "review code",
      mode: "all",
    })
  })

  test("rejects unknown tool IDs instead of silently ignoring them", () => {
    expect(() =>
      buildAgentCreateFrontmatter({
        description: "review code",
        mode: "primary",
        selectedTools: ["read", "read_file"],
      }),
    ).toThrow("Unknown agent tool(s): read_file")
  })
})
