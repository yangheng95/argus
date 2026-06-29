import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

let connectError: Error | undefined
let oauthConnectRequiresAuth = false
let promptError: Error | undefined
let resourceError: Error | undefined
let toolErrorDuringStartup: Error | undefined
let toolErrorAfterStartup: Error | undefined
let promptFetchError: Error | undefined
let resourceFetchError: Error | undefined
let connectOptions: unknown[] = []
let listToolOptions: unknown[] = []
let callToolOptions: unknown[] = []
let listPromptOptions: unknown[] = []
let listResourceOptions: unknown[] = []
let getPromptOptions: unknown[] = []
let readResourceOptions: unknown[] = []
let transportRequestInits: unknown[] = []
let finishAuthRequestInits: unknown[] = []
let finishAuthCalls = 0
let listToolsCalls = 0
let listPromptsCalls = 0
let listResourcesCalls = 0
let closeCalls = 0
let transportCloseCalls = 0
let toolList: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> = []
let resourceList: Array<{ uri: string; name: string; title?: string; description?: string; mimeType?: string }> = []
let serverCapabilities: Record<string, Record<string, unknown>> = {}

class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport?: { start?: () => Promise<void> }, options?: unknown) {
      connectOptions.push(options)
      if (connectError) throw connectError
      if (transport?.start) await transport.start()
    }
    async close() {
      closeCalls += 1
    }
    setNotificationHandler() {}
    getServerCapabilities() {
      return serverCapabilities
    }
    async listTools(_params?: unknown, options?: unknown) {
      listToolOptions.push(options)
      listToolsCalls += 1
      if (toolErrorDuringStartup) throw toolErrorDuringStartup
      if (toolErrorAfterStartup && listToolsCalls > 1) throw toolErrorAfterStartup
      return { tools: toolList }
    }
    async callTool(_params: unknown, _schema?: unknown, options?: unknown) {
      callToolOptions.push(options)
      return { content: [] }
    }
    async listPrompts(_params?: unknown, options?: unknown) {
      listPromptOptions.push(options)
      listPromptsCalls += 1
      if (promptError) throw promptError
      return { prompts: [] }
    }
    async listResources(_params?: unknown, options?: unknown) {
      listResourceOptions.push(options)
      listResourcesCalls += 1
      if (resourceError) throw resourceError
      return { resources: resourceList }
    }
    async getPrompt(_params?: unknown, options?: unknown) {
      getPromptOptions.push(options)
      if (promptFetchError) throw promptFetchError
      return { messages: [] }
    }
    async readResource(_params?: unknown, options?: unknown) {
      readResourceOptions.push(options)
      if (resourceFetchError) throw resourceFetchError
      return { contents: [] }
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    requestInit: unknown
    constructor(
      _url: URL,
      options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> }; requestInit?: unknown },
    ) {
      this.authProvider = options?.authProvider
      this.requestInit = options?.requestInit
      transportRequestInits.push(options?.requestInit)
    }
    async start() {
      if (oauthConnectRequiresAuth) {
        await this.authProvider?.redirectToAuthorization?.(new URL("https://auth.example.test/authorize"))
        throw new MockUnauthorizedError()
      }
    }
    async finishAuth() {
      finishAuthCalls += 1
      finishAuthRequestInits.push(this.requestInit)
      if (!(this.requestInit && typeof this.requestInit === "object" && "signal" in this.requestInit)) {
        throw new Error("finishAuth missing request signal")
      }
    }
    async close() {
      transportCloseCalls += 1
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSEClientTransport {
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    requestInit: unknown
    constructor(
      _url: URL,
      options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> }; requestInit?: unknown },
    ) {
      this.authProvider = options?.authProvider
      this.requestInit = options?.requestInit
      transportRequestInits.push(options?.requestInit)
    }
    async start() {
      if (oauthConnectRequiresAuth) {
        await this.authProvider?.redirectToAuthorization?.(new URL("https://auth.example.test/authorize"))
        throw new MockUnauthorizedError()
      }
    }
    async finishAuth() {
      finishAuthCalls += 1
      finishAuthRequestInits.push(this.requestInit)
      if (!(this.requestInit && typeof this.requestInit === "object" && "signal" in this.requestInit)) {
        throw new Error("finishAuth missing request signal")
      }
    }
    async close() {
      transportCloseCalls += 1
    }
  },
}))

const { MCP } = await import("../../src/mcp")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { Instance } = await import("../../src/project/instance")
const { Database } = await import("../../src/storage/db")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(async () => {
  connectError = undefined
  oauthConnectRequiresAuth = false
  promptError = undefined
  resourceError = undefined
  toolErrorDuringStartup = undefined
  toolErrorAfterStartup = undefined
  promptFetchError = undefined
  resourceFetchError = undefined
  connectOptions = []
  listToolOptions = []
  callToolOptions = []
  listPromptOptions = []
  listResourceOptions = []
  getPromptOptions = []
  readResourceOptions = []
  transportRequestInits = []
  finishAuthRequestInits = []
  finishAuthCalls = 0
  resourceList = []
  toolList = []
  listToolsCalls = 0
  listPromptsCalls = 0
  listResourcesCalls = 0
  closeCalls = 0
  transportCloseCalls = 0
  serverCapabilities = { tools: {}, prompts: {}, resources: {} }
  await Instance.disposeAll()
  await McpOAuthCallback.stop()
  Database.close()
})

afterEach(async () => {
  await McpOAuthCallback.stop()
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

  test("runtime MCP requests use the documented 30000ms default timeout", async () => {
    toolList = [
      {
        name: "lookup",
        description: "Lookup fixture",
        inputSchema: { type: "object", properties: {} },
      },
    ]
    resourceList = [{ uri: "mcp://fixture/shared.md", name: "README", mimeType: "text/markdown" }]

    await withRemoteMcp(async () => {
      await MCP.prompts()
      await MCP.resources()
      await MCP.callTool({ key: "remote_lookup", args: {} })
      await MCP.getPrompt("remote", "template")
      await MCP.readResource("remote", "mcp://fixture/shared.md")
    })

    expect(listToolOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
    expect(callToolOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
    expect(listPromptOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
    expect(listResourceOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
    expect(getPromptOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
    expect(readResourceOptions.at(-1)).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
  })

  test("connect and startup tool discovery use the global MCP timeout override", async () => {
    toolList = []

    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          mcp_timeout: 12_345,
        },
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
      fn: async () => {
        await MCP.tools()
      },
    })

    expect(connectOptions[0]).toEqual({ resetTimeoutOnProgress: true, timeout: 12_345 })
    expect(listToolOptions[0]).toEqual({ resetTimeoutOnProgress: true, timeout: 12_345 })
  })

  test("OAuth startAuth closes the probe client and transport after an already-authenticated probe", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          remote: {
            type: "remote",
            url: "https://example.com/mcp",
            transport: "streamable-http",
            enabled: false,
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
        const closeCallsBefore = closeCalls
        const transportCloseCallsBefore = transportCloseCalls
        await expect(MCP.startAuth("remote")).resolves.toEqual({ authorizationUrl: "" })
        expect(closeCalls - closeCallsBefore).toBe(1)
        expect(transportCloseCalls - transportCloseCallsBefore).toBe(1)
      },
    })

    expect(connectOptions[0]).toEqual({ resetTimeoutOnProgress: true, timeout: 30_000 })
  })

  test("OAuth startAuth closes the probe client and transport after non-auth connection failures", async () => {
    connectError = new Error("connect exploded")

    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          remote: {
            type: "remote",
            url: "https://example.com/mcp",
            transport: "streamable-http",
            enabled: false,
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
        const closeCallsBefore = closeCalls
        const transportCloseCallsBefore = transportCloseCalls
        await expect(MCP.startAuth("remote")).rejects.toThrow("connect exploded")
        expect(closeCalls - closeCallsBefore).toBe(1)
        expect(transportCloseCalls - transportCloseCallsBefore).toBe(1)
      },
    })
  })

  test("OAuth authorization flow closes probe and token-exchange transports", async () => {
    oauthConnectRequiresAuth = true

    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          remote: {
            type: "remote",
            url: "https://example.com/mcp",
            transport: "streamable-http",
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
        const closeCallsBefore = closeCalls
        const transportCloseCallsBefore = transportCloseCalls
        await expect(MCP.startAuth("remote")).resolves.toEqual({ authorizationUrl: "https://auth.example.test/authorize" })
        expect(closeCalls - closeCallsBefore).toBe(1)
        expect(transportCloseCalls - transportCloseCallsBefore).toBe(1)

        oauthConnectRequiresAuth = false
        const transportCloseCallsBeforeFinish = transportCloseCalls
        await expect(MCP.finishAuth("remote", "code")).resolves.toEqual({ status: "connected" })
        expect(finishAuthCalls).toBe(1)
        const finishRequestInit = finishAuthRequestInits.at(-1) as { signal?: AbortSignal } | undefined
        expect(finishRequestInit?.signal).toBeInstanceOf(AbortSignal)
        expect(transportCloseCalls - transportCloseCallsBeforeFinish).toBeGreaterThanOrEqual(1)
      },
    })
  })

  test("removeAuth clears pending OAuth flow and callback even when credential storage removal fails", async () => {
    oauthConnectRequiresAuth = true

    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          remote: {
            type: "remote",
            url: "https://example.com/mcp",
            transport: "streamable-http",
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
        await expect(MCP.startAuth("remote")).resolves.toEqual({ authorizationUrl: "https://auth.example.test/authorize" })
        const authKey = McpAuth.scopedKey({ projectID: Instance.project.id, mcpName: "remote" })
        const pendingCallback = McpOAuthCallback.waitForCallback("remove-auth-state", authKey)
        const pendingCallbackRejection = pendingCallback.catch((error) => error)
        const removeSpy = spyOn(McpAuth, "remove").mockRejectedValueOnce(new Error("auth storage remove exploded"))
        await expect(MCP.removeAuth("remote")).rejects.toThrow("auth storage remove exploded")
        removeSpy.mockRestore()
        await expect(pendingCallbackRejection).resolves.toMatchObject({ message: "Authorization cancelled" })
        await expect(MCP.finishAuth("remote", "code")).rejects.toThrow("No pending OAuth flow")
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
