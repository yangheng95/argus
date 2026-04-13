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
    expect(spec.args.slice(-6)).toEqual(["mcp", "serve", "--cwd", "/repo", "--toolset", "executor"])
  })

  test("exposes the executor MCP toolset", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defs = await MCPServe.toolDefinitions("executor")
        expect(defs.map((item) => item.name).sort()).toEqual([
          "apply_patch",
          "fetch_url",
          "find_files",
          "memory",
          "read_file",
          "search_code",
          "shell_command",
          "task_report",
          "web_search",
        ])
        expect(defs.every((item) => item.metadata?.surface === "mcp")).toBe(true)
      },
    })
  })

  test("includes proxied external MCP tools in definitions", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(MCP, "serverTools").mockResolvedValue([
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
    ])

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defs = await MCPServe.toolDefinitions("executor")
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
