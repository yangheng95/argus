import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"

let finishAuthFailure: Error | undefined
let startAuthFailure: Error | undefined
const finishedAuthUrls: string[] = []

class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    url: string
    constructor(url: URL, options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> } }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider
    }
    async start() {
      if (startAuthFailure) throw startAuthFailure
      await this.authProvider?.redirectToAuthorization?.(new URL("https://auth.example.test/authorize?state=route"))
      throw new MockUnauthorizedError()
    }
    async finishAuth() {
      finishedAuthUrls.push(this.url)
      if (finishAuthFailure) throw finishAuthFailure
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSEClientTransport {
    async start() {
      throw new Error("route SSE connect unavailable")
    }
    async finishAuth() {
      if (finishAuthFailure) throw finishAuthFailure
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start?: () => Promise<void> } | undefined) {
      if (transport?.start) await transport.start()
      throw new Error("route connect unavailable")
    }
    async close() {}
    setNotificationHandler() {}
    async listTools() {
      return { tools: [] }
    }
  },
}))

const { Instance } = await import("../../src/project/instance")
const { Server } = await import("../../src/server/server")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { MCP } = await import("../../src/mcp")
const { McpAuth } = await import("../../src/mcp/auth")
const { resetDatabase } = await import("../fixture/db")
const { tmpdir } = await import("../fixture/fixture")

afterEach(async () => {
  mock.restore()
  finishAuthFailure = undefined
  startAuthFailure = undefined
  finishedAuthUrls.length = 0
  await McpOAuthCallback.stop()
  await Instance.disposeAll()
  await resetDatabase()
})

async function expectMissingMcp(response: Response) {
  expect(response.status).toBe(404)
  await expect(response.json()).resolves.toMatchObject({ name: "NotFoundError" })
}

describe("MCP routes", () => {
  test("missing server connect, disconnect, and auth routes return 404", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const headers = { "x-opencorvus-directory": tmp.path }

        await expectMissingMcp(await app.request("/mcp/missing/connect", { method: "POST", headers }))
        await expectMissingMcp(await app.request("/mcp/missing/disconnect", { method: "POST", headers }))
        await expectMissingMcp(await app.request("/mcp/missing/auth", { method: "POST", headers }))
        await expectMissingMcp(await app.request("/mcp/missing/auth/authenticate", { method: "POST", headers }))
        await expectMissingMcp(await app.request("/mcp/missing/auth", { method: "DELETE", headers }))
        await expectMissingMcp(
          await app.request("/mcp/missing/auth/callback", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ code: "unused" }),
          }),
        )
      },
    })
  })

  test("configured server connect startup failures do not return true", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          broken: {
            type: "local",
            command: [process.execPath, "-e", ""],
            timeout: 1,
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
        const app = Server.App()
        const response = await app.request("/mcp/broken/connect", {
          method: "POST",
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({ name: "UnknownError" })
      },
    })
  })

  test("unsupported OAuth routes return BadRequestError response shape", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          local: {
            type: "local",
            command: [process.execPath, "-e", ""],
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
        const app = Server.App()
        const headers = { "x-opencorvus-directory": tmp.path }

        for (const path of ["/mcp/local/auth", "/mcp/local/auth/authenticate"]) {
          const response = await app.request(path, { method: "POST", headers })
          expect(response.status).toBe(400)
          await expect(response.json()).resolves.toMatchObject({
            success: false,
            data: { message: "MCP server local does not support OAuth" },
            errors: [{ message: "MCP server local does not support OAuth" }],
          })
        }
      },
    })
  })

  test("OAuth credential removal failures return a documented route error", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          oauth: {
            type: "remote",
            transport: "streamable-http",
            url: "https://mcp.example.test/rpc",
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
        const app = Server.App()
        const headers = { "x-opencorvus-directory": tmp.path }
        spyOn(MCP, "removeAuth").mockRejectedValueOnce(new Error("auth storage remove exploded"))

        const response = await app.request("/mcp/oauth/auth", { method: "DELETE", headers })
        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: expect.stringContaining("auth storage remove exploded") },
        })
      },
    })
  })

  test("OAuth callback finish failures return a route error instead of failed status 200", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          oauth: {
            type: "remote",
            transport: "streamable-http",
            url: "https://mcp.example.test/rpc",
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
        const app = Server.App()
        const headers = { "x-opencorvus-directory": tmp.path }

        const start = await app.request("/mcp/oauth/auth", { method: "POST", headers })
        expect(start.status).toBe(200)
        await expect(start.json()).resolves.toEqual({
          authorizationUrl: "https://auth.example.test/authorize?state=route",
        })

        finishAuthFailure = new Error("oauth finish exploded")
        const callback = await app.request("/mcp/oauth/auth/callback", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ code: "route-code" }),
        })
        expect(callback.status).toBe(500)
        await expect(callback.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: expect.stringContaining("oauth finish exploded") },
        })
      },
    })
  })

  test("same-name OAuth pending transports are isolated by active project", async () => {
    await using projectA = await tmpdir({
      git: true,
      config: {
        mcp: {
          oauth: {
            type: "remote",
            transport: "streamable-http",
            url: "https://project-a.example.test/rpc",
          },
          browser: {
            enabled: false,
          },
        },
      },
    })
    await using projectB = await tmpdir({
      git: true,
      config: {
        mcp: {
          oauth: {
            type: "remote",
            transport: "streamable-http",
            url: "https://project-b.example.test/rpc",
          },
          browser: {
            enabled: false,
          },
        },
      },
    })

    const projectAID = await Instance.provide({ directory: projectA.path, fn: () => Instance.project.id })
    const projectBID = await Instance.provide({ directory: projectB.path, fn: () => Instance.project.id })
    const authKeyA = McpAuth.scopedKey({ projectID: projectAID, mcpName: "oauth" })
    const authKeyB = McpAuth.scopedKey({ projectID: projectBID, mcpName: "oauth" })

    try {
      const app = Server.App()
      const headersA = { "x-opencorvus-directory": projectA.path }
      const headersB = { "x-opencorvus-directory": projectB.path }

      const startA = await app.request("/mcp/oauth/auth", { method: "POST", headers: headersA })
      expect(startA.status).toBe(200)
      const startB = await app.request("/mcp/oauth/auth", { method: "POST", headers: headersB })
      expect(startB.status).toBe(200)

      const callbackA = await app.request("/mcp/oauth/auth/callback", {
        method: "POST",
        headers: { ...headersA, "content-type": "application/json" },
        body: JSON.stringify({ code: "project-a-code" }),
      })
      expect(callbackA.status).toBe(200)
      expect(finishedAuthUrls).toEqual(["https://project-a.example.test/rpc"])

      const credentials = await McpAuth.all()
      expect(credentials[authKeyA]?.oauthState).toBeTruthy()
      expect(credentials[authKeyB]?.oauthState).toBeTruthy()
      expect(credentials.oauth).toBeUndefined()
    } finally {
      await McpAuth.remove(authKeyA).catch(() => undefined)
      await McpAuth.remove(authKeyB).catch(() => undefined)
    }
  })

  test("OAuth start failures return a documented route error", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        mcp: {
          oauth: {
            type: "remote",
            transport: "streamable-http",
            url: "https://mcp.example.test/rpc",
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
        const app = Server.App()
        const headers = { "x-opencorvus-directory": tmp.path }
        startAuthFailure = new Error("oauth start exploded")

        const response = await app.request("/mcp/oauth/auth", { method: "POST", headers })
        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: expect.stringContaining("oauth start exploded") },
        })
      },
    })
  })
})
