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

  test("ACP bridge maps protocol remote servers to SSE", async () => {
    const source = await Bun.file(new URL("../../src/acp/agent.ts", import.meta.url)).text()
    expect(source).toMatch(/mcpCapabilities:\s*\{[\s\S]*?sse:\s*true,/)
    expect(source).toContain('transport: "sse"')
  })
})
