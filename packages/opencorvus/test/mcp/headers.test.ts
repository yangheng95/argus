import { test, expect, mock, beforeEach } from "bun:test"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit }
}> = []

// Mock the transport constructors to capture their arguments
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
    async close() {}
  },
}))

beforeEach(() => {
  transportCalls.length = 0
})

function expectHeaders(requestInit: RequestInit | undefined, expected: Record<string, string>) {
  expect(requestInit).toBeDefined()
  const headers = new Headers(requestInit?.headers)
  for (const [name, value] of Object.entries(expected)) {
    expect(headers.get(name)).toBe(value)
  }
}

function expectTimeoutSignal(requestInit: RequestInit | undefined) {
  expect(requestInit?.signal).toBeInstanceOf(AbortSignal)
}

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("headers are passed to transports when oauth is enabled (default)", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Trigger MCP initialization - it will fail to connect but we can check the transport options
      await MCP.add("test-server", {
        type: "remote",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      }).catch(() => {})

      expect(transportCalls.map((call) => call.type)).toEqual(["streamable"])

      for (const call of transportCalls) {
        expectHeaders(call.options.requestInit, {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        })
        expectTimeoutSignal(call.options.requestInit)
        // OAuth should be enabled by default, so authProvider should exist
        expect(call.options.authProvider).toBeDefined()
      }
    },
  })
})

test("headers are passed to transports when oauth is explicitly disabled", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-oauth", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
        headers: {
          Authorization: "Bearer test-token",
        },
      }).catch(() => {})

      expect(transportCalls.map((call) => call.type)).toEqual(["streamable"])

      for (const call of transportCalls) {
        expectHeaders(call.options.requestInit, {
          Authorization: "Bearer test-token",
        })
        expectTimeoutSignal(call.options.requestInit)
        // OAuth is disabled, so no authProvider
        expect(call.options.authProvider).toBeUndefined()
      }
    },
  })
})

test("timeout requestInit is passed when headers are not provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-headers", {
        type: "remote",
        url: "https://example.com/mcp",
      }).catch(() => {})

      expect(transportCalls.map((call) => call.type)).toEqual(["streamable"])

      for (const call of transportCalls) {
        expectTimeoutSignal(call.options.requestInit)
        expect(new Headers(call.options.requestInit?.headers).has("Authorization")).toBe(false)
      }
    },
  })
})

test("remote MCP uses SSE only when transport is explicit", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-sse", {
        type: "remote",
        transport: "sse",
        url: "https://example.com/mcp",
      }).catch(() => {})

      expect(transportCalls.map((call) => call.type)).toEqual(["sse"])
    },
  })
})
