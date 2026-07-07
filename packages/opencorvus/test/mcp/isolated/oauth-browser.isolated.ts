import { test, expect, mock, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "events"

// Track open() calls and control failure behavior
let openShouldFail = false
let openCalledWith: string | undefined
let openWaiters: Array<() => void> = []

function waitForOpenCall(): Promise<void> {
  if (openCalledWith) return Promise.resolve()
  return new Promise((resolve) => {
    openWaiters.push(resolve)
  })
}

mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    const waiters = openWaiters
    openWaiters = []
    for (const resolve of waiters) resolve()

    // Return a mock subprocess that emits an error if openShouldFail is true
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      // Emit error asynchronously like a real subprocess would
      setTimeout(() => {
        subprocess.emit("error", new Error("spawn xdg-open ENOENT"))
      }, 10)
    }
    return subprocess
  },
}))

// Mock UnauthorizedError
class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []

async function expectSignalBeforeAuthSettles(
  signal: Promise<void>,
  authPromise: Promise<unknown>,
  authError: () => unknown,
): Promise<void> {
  const outcome = await Promise.race([signal.then(() => "signal" as const), authPromise.then(() => "auth" as const)])
  if (outcome === "auth") {
    const error = authError()
    throw error instanceof Error ? error : new Error(`OAuth authentication settled before the expected signal: ${error}`)
  }
}

// Mock the transport constructors
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    url: string
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    constructor(url: URL, options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> } }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      // Simulate OAuth redirect by calling the authProvider's redirectToAuthorization
      if (this.authProvider?.redirectToAuthorization) {
        await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=test"))
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      // Mock successful auth completion
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: {},
      })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
    async close() {}
  },
}))

// Mock the MCP SDK Client to trigger OAuth flow
mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
    async close() {}
  },
}))

// Mock UnauthorizedError in the auth module
mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  openShouldFail = false
  openCalledWith = undefined
  openWaiters = []
  transportCalls.length = 0
})

// Import modules after mocking
const { MCP } = await import("../../../src/mcp/index")
const { Bus } = await import("../../../src/bus")
const { McpOAuthCallback } = await import("../../../src/mcp/oauth-callback")
const { McpAuth } = await import("../../../src/mcp/auth")
const { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } = await import("../../../src/mcp/oauth-provider")
const { Instance } = await import("../../../src/project/instance")
const { tmpdir } = await import("../../fixture/fixture")

afterEach(async () => {
  mock.restore()
  await McpOAuthCallback.stop()
  await Instance.disposeAll()
})

function currentAuthKey(mcpName: string): string {
  return McpAuth.scopedKey({ projectID: Instance.project.id, mcpName })
}

async function completePendingOAuth(mcpName: string): Promise<void> {
  const state = await McpAuth.getOAuthState(currentAuthKey(mcpName))
  expect(state).toBeTruthy()
  const url = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  url.searchParams.set("code", `${mcpName}-code`)
  url.searchParams.set("state", state!)
  const response = await fetch(url)
  expect(response.status).toBe(200)
}

test("BrowserOpenFailed event is published when open() throws", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencorvus.json`,
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            "test-oauth-server": {
              type: "remote",
              transport: "streamable-http",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      openShouldFail = true

      const events: Array<{ mcpName: string; url: string }> = []
      let resolveBrowserOpenFailed!: () => void
      const browserOpenFailed = new Promise<void>((resolve) => {
        resolveBrowserOpenFailed = resolve
      })
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
        resolveBrowserOpenFailed()
      })

      // Attach a handler immediately so callback shutdown rejections
      // don't show up as unhandled between tests.
      let authError: unknown
      const authPromise = MCP.authenticate("test-oauth-server").catch((error) => {
        authError = error
        return undefined
      })

      await expectSignalBeforeAuthSettles(browserOpenFailed, authPromise, () => authError)

      await completePendingOAuth("test-oauth-server")
      await authPromise
      await McpOAuthCallback.stop()

      unsubscribe()

      // Verify the BrowserOpenFailed event was published
      expect(events.length).toBe(1)
      expect(events[0].mcpName).toBe("test-oauth-server")
      expect(events[0].url).toContain("https://")
    },
  })
})

test("BrowserOpenFailed event is NOT published when open() succeeds", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencorvus.json`,
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            "test-oauth-server-2": {
              type: "remote",
              transport: "streamable-http",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      openShouldFail = false

      const events: Array<{ mcpName: string; url: string }> = []
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
      })

      let authError: unknown
      const authPromise = MCP.authenticate("test-oauth-server-2").catch((error) => {
        authError = error
        return undefined
      })

      await expectSignalBeforeAuthSettles(waitForOpenCall(), authPromise, () => authError)
      expect(openCalledWith).toBeDefined()

      await completePendingOAuth("test-oauth-server-2")
      await authPromise
      await McpOAuthCallback.stop()

      unsubscribe()

      // Verify NO BrowserOpenFailed event was published
      expect(events.length).toBe(0)
      // Verify open() was still called
      expect(openCalledWith).toBeDefined()
    },
  })
})

test("open() is called with the authorization URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencorvus.json`,
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            "test-oauth-server-3": {
              type: "remote",
              transport: "streamable-http",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      openShouldFail = false
      openCalledWith = undefined

      let authError: unknown
      const authPromise = MCP.authenticate("test-oauth-server-3").catch((error) => {
        authError = error
        return undefined
      })

      await expectSignalBeforeAuthSettles(waitForOpenCall(), authPromise, () => authError)
      expect(openCalledWith).toBeDefined()

      await completePendingOAuth("test-oauth-server-3")
      await authPromise
      await McpOAuthCallback.stop()

      // Verify open was called with a URL
      expect(openCalledWith).toBeDefined()
      expect(typeof openCalledWith).toBe("string")
      expect(openCalledWith!).toContain("https://")
    },
  })
})
