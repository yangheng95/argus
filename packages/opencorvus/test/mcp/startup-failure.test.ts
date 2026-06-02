import { expect, mock, test } from "bun:test"

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioClientTransport {
    constructor() {
      throw new Error("stdio transport constructor failed")
    }
  },
}))

const { Instance } = await import("../../src/project/instance")
const { MCP } = await import("../../src/mcp")
const { tmpdir } = await import("../fixture/fixture")

test("MCP startup captures transport construction errors as failed status", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        broken: {
          type: "local",
          command: ["broken-mcp-command"],
          timeout: 1,
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.broken).toEqual({
        status: "failed",
        error: "stdio transport constructor failed",
      })

      await expect(MCP.tools()).resolves.toEqual({})
    },
  })
})
