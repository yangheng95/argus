import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { MCPServe } from "../../src/mcp/serve"
import { tmpdir } from "../fixture/fixture"

describe("mcp.serve", () => {
  afterEach(() => {
    mock.restore()
  })

  test("builds a re-entrant command for executor toolset", () => {
    const spec = MCPServe.command("/repo")
    expect(spec.name).toBe("opencorvus")
    expect(spec.command.length).toBeGreaterThan(0)
    expect(spec.args[0]).toEndWith("stdio.ts")
    expect(spec.args.slice(-4)).toEqual(["--cwd", "/repo", "--toolset", "executor"])
  })

  test("exposes the executor MCP toolset", async () => {
    expect(MCPServe.executorToolNames().sort()).toEqual([
      "figma_analyze",
      "figma_compile",
      "figma_extract",
      "memory",
      "task_report",
      "webpage_analyze",
      "webpage_compile",
      "webpage_evaluate",
      "webpage_extract",
      "webpage_image_analyze",
      "webpage_image_compile",
      "webpage_image_extract",
      "webpage_render",
      "webpage_text_diff",
      "webpage_vision_judge",
    ].sort())
  })

  test("maps executor tools to Claude Code MCP-prefixed names", () => {
    expect(MCPServe.claudeToolName("webpage_extract")).toBe("mcp__opencorvus__webpage_extract")
    expect(MCPServe.normalizeClaudeToolName("mcp__opencorvus__webpage_compile")).toBe("webpage_compile")
    const prompt = MCPServe.claudeExecutorPromptSection()
    expect(prompt).toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(prompt).toContain("Mirror extraction artifacts must come from the mirror MCP toolchain")
  })

  test("includes proxied external MCP tools in definitions", async () => {
    await using tmp = await tmpdir({ git: true })
    const proxiedTools = [
      {
        key: "docs_lookup",
        client: "docs",
        name: "lookup",
        description: "Lookup docs",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    ]

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defs = await MCPServe.toolDefinitions("executor", { includeRuntime: false, proxiedTools })
        const match = defs.find((item) => item.name === "docs_lookup")
        expect(match?.metadata?.proxied_client).toBe("docs")
        expect(match?.metadata?.proxied_tool).toBe("lookup")
      },
    })
  })

  test("includes proxied prompts and resources in executor MCP toolset support", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(MCP, "serverPrompts").mockResolvedValue([
      {
        key: "docs:review",
        client: "docs",
        name: "review",
        title: "Review Prompt",
        description: "Prompt from external MCP",
        arguments: [{ name: "topic", required: true }],
      },
    ])
    spyOn(MCP, "serverResources").mockResolvedValue([
      {
        key: "docs_readme",
        client: "docs",
        uri: "docs://README",
        name: "README",
        title: "README",
        description: "Resource from external MCP",
        mimeType: "text/plain",
      },
    ])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts = await MCP.serverPrompts()
        const resources = await MCP.serverResources()
        expect(prompts[0]?.key).toBe("docs:review")
        expect(resources[0]?.key).toBe("docs_readme")
      },
    })
  })
})
