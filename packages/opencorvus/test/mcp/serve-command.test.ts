import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import yargs from "yargs/yargs"
import { MCPServe } from "../../src/mcp/serve"
import { BrowserMCPNodeLauncher } from "../../src/mcp/browser/node-launcher"
import { McpCommand } from "../../src/cli/cmd/mcp"

describe("mcp serve command", () => {
  afterEach(() => {
    mock.restore()
  })

  test("starts the stdio MCP server for the executor toolset", async () => {
    const serveCalls: Array<Parameters<typeof MCPServe.serve>[0]> = []
    spyOn(MCPServe, "serve").mockImplementation(async (input) => {
      serveCalls.push(input)
    })

    await yargs(["mcp", "serve", "--cwd", "D:\\repo\\worktree", "--toolset", "executor"])
      .scriptName("opencorvus")
      .command(McpCommand as any)
      .parseAsync()

    expect(serveCalls).toEqual([
      {
        cwd: "D:\\repo\\worktree",
        toolset: "executor",
      },
    ])
  })

  test("starts the built-in browser MCP stdio server", async () => {
    let called = 0
    spyOn(BrowserMCPNodeLauncher, "serveStdio").mockImplementation(async () => {
      called++
    })

    await yargs(["mcp", "browser"])
      .scriptName("opencorvus")
      .command(McpCommand as any)
      .parseAsync()

    expect(called).toBe(1)
  })
})
