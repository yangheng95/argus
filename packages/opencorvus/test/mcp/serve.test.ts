import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { MCPServe } from "../../src/mcp/serve"
import { BrowserMCPBuiltin } from "../../src/mcp/browser/builtin"
import { tmpdir } from "../fixture/fixture"

describe("mcp.serve", () => {
  afterEach(() => {
    mock.restore()
  })

  test("builds a Bun source stdio command for the executor toolset", () => {
    const config = MCPServe.command("/repo", {
      execPath: "C:\\tools\\bun.exe",
      moduleDir: "D:\\repo\\packages\\opencorvus\\src\\mcp",
    })
    expect(config.name).toBe("opencorvus")
    expect(config.command).toBe("C:\\tools\\bun.exe")
    expect(config.args[0]).toEndWith("stdio.ts")
    expect(config.args.slice(-4)).toEqual(["--cwd", "/repo", "--toolset", "executor"])
    expect("env" in config).toBe(false)
  })

  test("builds a packaged Windows command without Bun virtual source paths", () => {
    const config = MCPServe.command("D:\\repo\\worktree", {
      execPath: "C:\\Users\\me\\AppData\\Local\\OpenCorvus\\opencorvus.exe",
      moduleDir: "B:\\~BUN\\root\\src\\mcp",
    })
    expect(config.name).toBe("opencorvus")
    expect(config.command).toBe("C:\\Users\\me\\AppData\\Local\\OpenCorvus\\opencorvus.exe")
    expect(config.args).toEqual(["mcp", "serve", "--cwd", "D:\\repo\\worktree", "--toolset", "executor"])
    expect(config.args.join(" ")).not.toContain("B:\\~BUN")
    expect("env" in config).toBe(false)
  })

  test("builds a packaged POSIX command without Bun virtual source paths", () => {
    const config = MCPServe.command("/repo/worktree", {
      execPath: "/usr/local/bin/opencorvus",
      moduleDir: "/$bunfs/root/src/mcp",
    })
    expect(config.name).toBe("opencorvus")
    expect(config.command).toBe("/usr/local/bin/opencorvus")
    expect(config.args).toEqual(["mcp", "serve", "--cwd", "/repo/worktree", "--toolset", "executor"])
    expect(config.args.join(" ")).not.toContain("$bunfs")
    expect("env" in config).toBe(false)
  })

  test("builds a Bun source stdio command for the built-in browser MCP", () => {
    const command = BrowserMCPBuiltin.command({
      execPath: "C:\\tools\\bun.exe",
      moduleDir: "D:\\repo\\packages\\opencorvus\\src\\mcp\\browser",
    })
    expect(command[0]).toBe("C:\\tools\\bun.exe")
    expect(command[1]).toEndWith("node-stdio.ts")
  })

  test("builds a packaged command for the built-in browser MCP", () => {
    const command = BrowserMCPBuiltin.command({
      execPath: "C:\\Users\\me\\AppData\\Local\\OpenCorvus\\opencorvus.exe",
      moduleDir: "B:\\~BUN\\root\\src\\mcp\\browser",
    })
    expect(command).toEqual(["C:\\Users\\me\\AppData\\Local\\OpenCorvus\\opencorvus.exe", "mcp", "browser"])
    expect(command.join(" ")).not.toContain("B:\\~BUN")
  })

  test("exposes the executor MCP toolset", async () => {
    expect(MCPServe.executorToolNames().sort()).toEqual(["skill", "memory", "task_report"].sort())
  })

  test("exports Claude-compatible object input schemas", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defs = await MCPServe.toolDefinitions("executor", { includeProxied: false })
        for (const def of defs) {
          expect(def.inputSchema.type).toBe("object")
          expect(def.inputSchema.anyOf).toBeUndefined()
          expect(def.inputSchema.oneOf).toBeUndefined()
          expect(def.inputSchema.allOf).toBeUndefined()
        }
        const memory = defs.find((item) => item.name === "memory")
        expect(memory?.inputSchema.required).toEqual(["action"])
        expect(memory?.inputSchema.properties?.action).toEqual({
          type: "string",
          enum: ["search", "get", "write", "list", "delete"],
        })
      },
    })
  })

  test("maps executor tools to coding executor MCP-prefixed names without mirror aliases", () => {
    expect(MCPServe.codingExecutorToolName("memory")).toBe("mcp__opencorvus__memory")
    expect(MCPServe.normalizeCodingExecutorToolName("mcp__opencorvus__task_report")).toBe("task_report")
    const prompt = MCPServe.codingExecutorPromptSection()
    expect(prompt).toContain("skill => mcp__opencorvus__skill")
    expect(prompt).toContain("memory => mcp__opencorvus__memory")
    expect(prompt).toContain("task_report => mcp__opencorvus__task_report")
    expect(prompt).not.toContain("webpage_extract =>")
    expect(prompt).not.toContain("figma_extract =>")
    expect(prompt).toContain("Mirror extraction artifacts are produced by the upstream frontend_design stage")
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

  test("filters webpage clone and webpage evidence tools from executor proxied definitions", async () => {
    await using tmp = await tmpdir({ git: true })
    const proxiedTools = [
      {
        key: "docs_lookup",
        client: "docs",
        name: "lookup",
        description: "Lookup docs",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
      {
        key: "opencorvus_webpage_extract",
        client: "opencorvus",
        name: "webpage_extract",
        description: "Extract webpage",
        inputSchema: { type: "object", properties: {} },
      },
      {
        key: "opencorvus_web_clone_prepare_context",
        client: "opencorvus",
        name: "web_clone_prepare_context",
        description: "Prepare clone context",
        inputSchema: { type: "object", properties: {} },
      },
      {
        key: "opencorvus_web_clone_generate_source_project",
        client: "opencorvus",
        name: "web_clone_generate_source_project",
        description: "Generate clone source project",
        inputSchema: { type: "object", properties: {} },
      },
    ]

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const defs = await MCPServe.toolDefinitions("executor", { includeRuntime: false, proxiedTools })
        const names = defs.map((item) => item.name)
        expect(names).toContain("docs_lookup")
        expect(names).not.toContain("opencorvus_webpage_extract")
        expect(names).not.toContain("opencorvus_web_clone_prepare_context")
        expect(names).not.toContain("opencorvus_web_clone_generate_source_project")
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
