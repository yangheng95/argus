import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("mcp remote transport config", () => {
  test("requires explicit remote transport", () => {
    expect(
      Config.Mcp.safeParse({
        type: "remote",
        url: "https://example.com/mcp",
      }).success,
    ).toBe(false)

    expect(
      Config.Mcp.parse({
        type: "remote",
        url: "https://example.com/mcp",
        transport: "streamable-http",
      }).transport,
    ).toBe("streamable-http")

    expect(
      Config.Mcp.parse({
        type: "remote",
        url: "https://example.com/mcp",
        transport: "sse",
      }).transport,
    ).toBe("sse")
  })

  test("schema descriptions match the runtime MCP timeout default", async () => {
    const configSource = await Bun.file(new URL("../../src/config/config.ts", import.meta.url)).text()
    const mcpSource = await Bun.file(new URL("../../src/mcp/index.ts", import.meta.url)).text()

    expect(mcpSource).toContain("const DEFAULT_TIMEOUT = 30_000")
    expect(configSource).toContain("Defaults to 30000 (30 seconds)")
    expect(configSource).not.toContain("Defaults to 5000 (5 seconds)")
  })

  test("MCP client requests use explicit timeout options instead of SDK defaults", async () => {
    const mcpSource = await Bun.file(new URL("../../src/mcp/index.ts", import.meta.url)).text()
    const mcpCliSource = await Bun.file(new URL("../../src/cli/cmd/mcp.ts", import.meta.url)).text()

    expect(mcpSource).not.toMatch(/client\.connect\(transport\)/)
    expect(mcpSource).not.toMatch(/client\.listTools\(\)/)
    expect(mcpSource).not.toMatch(/client\.listPrompts\(\)/)
    expect(mcpSource).not.toMatch(/client\.listResources\(\)/)
    expect(mcpSource).not.toContain("withTimeout(client.connect")
    expect(mcpCliSource).not.toContain("withTimeout(client.connect")
    expect(mcpSource).toContain("client.connect(transport, mcpRequestOptions(requestTimeout))")
    expect(mcpSource).toContain("client.connect(transport, mcpRequestOptions(authTimeout))")
    expect(mcpSource).toContain("mcpFetchRequestInit(requestTimeout)")
    expect(mcpSource).toContain("mcpFetchRequestInit(authTimeout)")
    expect(mcpCliSource).not.toMatch(/client\.connect\(transport\)/)
    expect(mcpCliSource).toContain("MCP.effectiveTimeout(serverConfig, config.experimental?.mcp_timeout)")
    expect(mcpCliSource).toContain("...MCP.mcpFetchRequestInit(debugTimeout)")
    expect(mcpCliSource).toContain("MCP.createRemoteTransport(")
    expect(mcpCliSource).toContain("MCP.mcpFetchRequestInit(debugTimeout)")
    expect(mcpCliSource).not.toContain("new StreamableHTTPClientTransport")
    expect(mcpCliSource).toContain("client.connect(transport, MCP.mcpRequestOptions(debugTimeout))")
  })

  test("ACP bridge maps protocol remote servers to SSE", async () => {
    const source = await Bun.file(new URL("../../src/acp/agent.ts", import.meta.url)).text()
    expect(source).toMatch(/mcpCapabilities:\s*\{[\s\S]*?sse:\s*true,/)
    expect(source).toContain('transport: "sse"')
  })
})
