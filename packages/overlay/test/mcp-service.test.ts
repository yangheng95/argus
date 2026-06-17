import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import {
  addMcpServer,
  buildMcpAddRequest,
  connectMcp,
  deleteAllMcp,
  disconnectMcp,
  parseMcpArguments,
  removeMcpAuth,
} from "../src/services/mcp"
import { setMcp } from "../src/store/app"

const PROJECT_DIR = "C:/Users/example/project"

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return { status: 200, ok: true, headers: {}, body: {} as T }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

function failingTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    ...fakeTransport(capture),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return { status: 503, ok: false, headers: {}, body: { error: "mcp operation unavailable" } as T }
    },
  }
}

function authFailureTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    ...fakeTransport(capture),
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      if (req.path.endsWith("/auth")) {
        return { status: 503, ok: false, headers: {}, body: { error: "mcp auth removal unavailable" } as T }
      }
      return { status: 200, ok: true, headers: {}, body: {} as T }
    },
  }
}

describe("MCP overlay service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setMcp({})
  })

  test("persists new remote MCP servers to config and then connects them", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })

    await addMcpServer({
      name: "docs",
      type: "remote",
      url: "https://mcp.example.com/api",
    })

    expect(requests).toHaveLength(3)

    expect(requests[0].path).toBe("config")
    expect(requests[0].method).toBe("GET")
    expect(requests[0].query).toEqual({
      directory: PROJECT_DIR,
    })

    expect(requests[1].path).toBe("config")
    expect(requests[1].method).toBe("PATCH")
    expect(requests[1].query).toEqual({
      directory: PROJECT_DIR,
    })
    expect(requests[1].body).toEqual({
      kind: "json",
      value: {
        mcp: {
          docs: {
            type: "remote",
            url: "https://mcp.example.com/api",
          },
        },
      },
    })

    expect(requests[2].path).toBe("mcp/docs/connect")
    expect(requests[2].method).toBe("POST")
    expect(requests[2].query).toEqual({
      directory: PROJECT_DIR,
    })
    expect(requests[2].body).toBeUndefined()
  })

  test("builds local MCP config using the server-side command array contract", () => {
    expect(
      buildMcpAddRequest({
        name: "filesystem",
        type: "local",
        command: "npx",
        args: '-y @modelcontextprotocol/server-filesystem "C:\\repo with spaces"',
      }),
    ).toEqual({
      name: "filesystem",
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\repo with spaces"],
      },
    })
  })

  test("connects and disconnects configured MCP servers through project-scoped routes", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })

    await connectMcp("browser")
    await disconnectMcp("browser")

    expect(requests.map((req) => [req.method, req.path, req.query])).toEqual([
      [
        "POST",
        "mcp/browser/connect",
        {
          directory: PROJECT_DIR,
        },
      ],
      [
        "POST",
        "mcp/browser/disconnect",
        {
          directory: PROJECT_DIR,
        },
      ],
    ])
  })

  test("rejects malformed local MCP arguments instead of changing their meaning", () => {
    expect(() => parseMcpArguments('"C:/repo with spaces')).toThrow("unterminated quote")
  })

  test("disconnect and auth removal surface backend failures", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(failingTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })

    await expect(disconnectMcp("browser")).rejects.toThrow("mcp operation unavailable")
    await expect(removeMcpAuth("browser")).rejects.toThrow("mcp operation unavailable")

    expect(requests.map((req) => [req.method, req.path])).toEqual([
      ["POST", "mcp/browser/disconnect"],
      ["DELETE", "mcp/browser/auth"],
    ])
  })

  test("delete-all stops at the first disconnect failure before auth removal", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(failingTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })
    setMcp({ browser: { status: "connected" }, filesystem: { status: "connected" } })

    await expect(deleteAllMcp()).rejects.toThrow("mcp operation unavailable")

    expect(requests.map((req) => [req.method, req.path])).toEqual([["POST", "mcp/browser/disconnect"]])
  })

  test("delete-all stops at the first auth removal failure", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(authFailureTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })
    setMcp({ browser: { status: "connected" }, filesystem: { status: "connected" } })

    await expect(deleteAllMcp()).rejects.toThrow("mcp auth removal unavailable")

    expect(requests.map((req) => [req.method, req.path])).toEqual([
      ["POST", "mcp/browser/disconnect"],
      ["POST", "mcp/filesystem/disconnect"],
      ["DELETE", "mcp/browser/auth"],
    ])
  })
})
