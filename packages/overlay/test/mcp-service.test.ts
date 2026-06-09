import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { addMcpServer, buildMcpAddRequest, parseMcpArguments } from "../src/services/mcp"

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

describe("MCP overlay service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
  })

  test("persists new remote MCP servers to config and then connects them", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))
    configure({ directory: "C:/Users/chuan/myhexin-local/vibecodingclient" })

    await addMcpServer({
      name: "docs",
      type: "remote",
      url: "https://mcp.example.com/api",
    })

    expect(requests).toHaveLength(3)

    expect(requests[0].path).toBe("config")
    expect(requests[0].method).toBe("GET")
    expect(requests[0].query).toEqual({
      directory: "C:/Users/chuan/myhexin-local/vibecodingclient",
    })

    expect(requests[1].path).toBe("config")
    expect(requests[1].method).toBe("PATCH")
    expect(requests[1].query).toEqual({
      directory: "C:/Users/chuan/myhexin-local/vibecodingclient",
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
      directory: "C:/Users/chuan/myhexin-local/vibecodingclient",
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

  test("rejects malformed local MCP arguments instead of changing their meaning", () => {
    expect(() => parseMcpArguments('"C:/repo with spaces')).toThrow("unterminated quote")
  })
})
