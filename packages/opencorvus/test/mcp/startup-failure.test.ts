import { expect, mock, test } from "bun:test"

let stdioTransportConstructed = 0

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioClientTransport {
    constructor() {
      stdioTransportConstructed += 1
      throw new Error("stdio transport constructor failed")
    }
  },
}))

const { Instance } = await import("../../src/project/instance")
const { MCP } = await import("../../src/mcp")
const { tmpdir } = await import("../fixture/fixture")

test("MCP status does not start local transports", async () => {
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
      expect(status.broken).toEqual({ status: "disconnected" })
      expect(stdioTransportConstructed).toBe(0)

      await expect(MCP.tools()).resolves.toEqual({})
      expect(stdioTransportConstructed).toBe(0)

      await MCP.connect("broken")
      expect(stdioTransportConstructed).toBe(1)
      expect((await MCP.status()).broken).toEqual({
        status: "failed",
        error: "stdio transport constructor failed",
      })
    },
  })
})
