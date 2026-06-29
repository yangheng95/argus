import { beforeEach, describe, expect, mock, test } from "bun:test"

let promptError: Error | undefined
let resourceError: Error | undefined
let toolErrorDuringStartup: Error | undefined
let toolErrorAfterStartup: Error | undefined
let promptFetchError: Error | undefined
let resourceFetchError: Error | undefined
let listToolsCalls = 0
let listPromptsCalls = 0
let listResourcesCalls = 0
let closeCalls = 0
let transportCloseCalls = 0
let resourceList: Array<{ uri: string; name: string; title?: string; description?: string; mimeType?: string }> = []
let serverCapabilities: Record<string, Record<string, unknown>> = {}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect() {}
    async close() {
      closeCalls += 1
    }
    setNotificationHandler() {}
    getServerCapabilities() {
      return serverCapabilities
    }
    async listTools() {
      listToolsCalls += 1
      if (toolErrorDuringStartup) throw toolErrorDuringStartup
      if (toolErrorAfterStartup && listToolsCalls > 1) throw toolErrorAfterStartup
      return { tools: [] }
    }
    async listPrompts() {
      listPromptsCalls += 1
      if (promptError) throw promptError
      return { prompts: [] }
    }
    async listResources() {
      listResourcesCalls += 1
      if (resourceError) throw resourceError
      return { resources: resourceList }
    }
    async getPrompt() {
      if (promptFetchError) throw promptFetchError
      return { messages: [] }
    }
    async readResource() {
      if (resourceFetchError) throw resourceFetchError
      return { contents: [] }
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    constructor(_url: URL, _options?: unknown) {}
    async close() {
      transportCloseCalls += 1
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSEClientTransport {
    constructor(_url: URL, _options?: unknown) {}
    async close() {
      transportCloseCalls += 1
    }
  },
}))

const { MCP } = await import("../../src/mcp")
const { Instance } = await import("../../src/project/instance")
const { resetDatabase } = await import("../fixture/db")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(async () => {
  promptError = undefined
  resourceError = undefined
  toolErrorDuringStartup = undefined
  toolErrorAfterStartup = undefined
  promptFetchError = undefined
  resourceFetchError = undefined
  resourceList = []
  listToolsCalls = 0
  listPromptsCalls = 0
  listResourcesCalls = 0
  closeCalls = 0
  transportCloseCalls = 0
  serverCapabilities = { tools: {}, prompts: {}, resources: {} }
  await Instance.disposeAll()
  await resetDatabase()
})

async function withRemoteMcp(fn: () => Promise<void>) {
  await using tmp = await tmpdir({
    git: true,
    config: {
      mcp: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          transport: "streamable-http",
          oauth: false,
        },
        browser: {
          enabled: false,
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn,
  })
}

describe("MCP prompt and resource listing", () => {
  test("startup tool list failures reject tools instead of returning an empty map", async () => {
    toolErrorDuringStartup = new Error("startup tool list unavailable")

    await withRemoteMcp(async () => {
      await expect(MCP.tools()).rejects.toThrow("startup tool list unavailable")
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "failed", error: "startup tool list unavailable" })
      expect(closeCalls).toBeGreaterThan(0)
      expect(transportCloseCalls).toBeGreaterThan(0)
    })
  })

  test("tool list failures mark and close the server instead of returning a partial map", async () => {
    toolErrorAfterStartup = new Error("tool list unavailable")

    await withRemoteMcp(async () => {
      await expect(MCP.tools()).rejects.toThrow("tool list unavailable")
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "failed", error: "tool list unavailable" })
      expect(closeCalls).toBeGreaterThan(0)
      expect(transportCloseCalls).toBeGreaterThan(0)
    })
  })

  test("prompt list failures mark and close the server instead of returning an empty map", async () => {
    promptError = new Error("prompt list unavailable")

    await withRemoteMcp(async () => {
      await expect(MCP.prompts()).rejects.toThrow("prompt list unavailable")
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "failed", error: "prompt list unavailable" })
      expect(closeCalls).toBeGreaterThan(0)
      expect(transportCloseCalls).toBeGreaterThan(0)
    })
  })

  test("resource list failures mark and close the server instead of returning an empty map", async () => {
    resourceError = new Error("resource list unavailable")

    await withRemoteMcp(async () => {
      await expect(MCP.resources()).rejects.toThrow("resource list unavailable")
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "failed", error: "resource list unavailable" })
      expect(closeCalls).toBeGreaterThan(0)
      expect(transportCloseCalls).toBeGreaterThan(0)
    })
  })

  test("prompt listing skips clients that do not advertise prompts", async () => {
    serverCapabilities = { tools: {}, resources: {} }
    promptError = new Error("prompt list should not be called")

    await withRemoteMcp(async () => {
      await expect(MCP.prompts()).resolves.toEqual({})
      expect(listPromptsCalls).toBe(0)
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "connected" })
    })
  })

  test("resource listing skips clients that do not advertise resources", async () => {
    serverCapabilities = { tools: {}, prompts: {} }
    resourceError = new Error("resource list should not be called")

    await withRemoteMcp(async () => {
      await expect(MCP.resources()).resolves.toEqual({})
      expect(listResourcesCalls).toBe(0)
      const status = await MCP.status()
      expect(status.remote).toEqual({ status: "connected" })
    })
  })

  test("resources use URI identity so same-name resources do not overwrite each other", async () => {
    resourceList = [
      { uri: "mcp://fixture/a.md", name: "README", mimeType: "text/markdown" },
      { uri: "mcp://fixture/b.md", name: "README", mimeType: "text/markdown" },
    ]

    await withRemoteMcp(async () => {
      const resources = await MCP.resources()
      expect(Object.keys(resources).sort()).toEqual([
        `client:${Buffer.from("remote", "utf8").toString("base64url")}:uri:${Buffer.from("mcp://fixture/a.md", "utf8").toString("base64url")}`,
        `client:${Buffer.from("remote", "utf8").toString("base64url")}:uri:${Buffer.from("mcp://fixture/b.md", "utf8").toString("base64url")}`,
      ])
      expect(Object.values(resources).map((item) => item.uri).sort()).toEqual([
        "mcp://fixture/a.md",
        "mcp://fixture/b.md",
      ])
    })
  })

  test("resource keys encode client identity so sanitized client-name collisions cannot overwrite resources", async () => {
    resourceList = [{ uri: "mcp://fixture/shared.md", name: "README", mimeType: "text/markdown" }]

    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          "remote/a": {
            type: "remote",
            url: "https://example.com/a",
            transport: "streamable-http",
            oauth: false,
          },
          remote_a: {
            type: "remote",
            url: "https://example.com/b",
            transport: "streamable-http",
            oauth: false,
          },
          browser: {
            enabled: false,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resources = await MCP.resources()
        expect(Object.keys(resources).sort()).toEqual([
          `client:${Buffer.from("remote/a", "utf8").toString("base64url")}:uri:${Buffer.from("mcp://fixture/shared.md", "utf8").toString("base64url")}`,
          `client:${Buffer.from("remote_a", "utf8").toString("base64url")}:uri:${Buffer.from("mcp://fixture/shared.md", "utf8").toString("base64url")}`,
        ])
        expect(Object.values(resources).map((item) => item.client).sort()).toEqual(["remote/a", "remote_a"])
      },
    })
  })

  test("selected prompt fetch failures reject instead of returning undefined", async () => {
    promptFetchError = new Error("prompt fetch unavailable")

    await withRemoteMcp(async () => {
      await MCP.prompts()
      await expect(MCP.getPrompt("remote", "broken")).rejects.toThrow("prompt fetch unavailable")
    })
  })

  test("selected resource fetch failures reject instead of returning undefined", async () => {
    resourceFetchError = new Error("resource fetch unavailable")

    await withRemoteMcp(async () => {
      await MCP.resources()
      await expect(MCP.readResource("remote", "mcp://broken")).rejects.toThrow("resource fetch unavailable")
    })
  })
})
