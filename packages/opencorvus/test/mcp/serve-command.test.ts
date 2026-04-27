import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import yargs from "yargs/yargs"
import { MCPServe } from "../../src/mcp/serve"
import { McpCommand } from "../../src/cli/cmd/mcp"

const serveCalls: Array<{ cwd: string; toolset: string }> = []

describe("mcp serve command", () => {
  afterEach(() => {
    mock.restore()
    serveCalls.length = 0
  })

  test("registers the stdio serve subcommand used by external executors", async () => {
    spyOn(MCPServe, "serve").mockImplementation((input: { cwd: string; toolset: "executor" }) => {
      serveCalls.push(input)
      return Promise.resolve()
    })

    await yargs(["mcp", "serve", "--cwd", "D:\\repo\\worktree", "--toolset", "executor"])
      .scriptName("opencorvus")
      .command(McpCommand)
      .strict()
      .parseAsync()

    expect(serveCalls).toEqual([
      {
        cwd: "D:\\repo\\worktree",
        toolset: "executor",
      },
    ])
  })
})
