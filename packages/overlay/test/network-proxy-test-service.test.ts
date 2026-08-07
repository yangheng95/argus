import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { testNetworkProxy } from "../src/services/config"
import { HOST_CAPABILITIES } from "../src/services/host-transport"
import { __setHostTransportForTest } from "../src/services/host-transport-runtime"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { setConnectionStatus } from "../src/store/app"

const PROJECT_DIR = "C:/Users/example/project"

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          ok: true,
          status: "connected",
          targetUrl: "https://www.gstatic.com/generate_204",
          statusCode: 204,
          durationMs: 12,
          message: "Proxy is reachable.",
        } as T,
      }
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
  }
}

describe("network proxy test service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setConnectionStatus("offline")
  })

  test("posts the edited proxy draft to the project-scoped config proxy test route", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))
    configure({ directory: PROJECT_DIR })
    setConnectionStatus("online")

    const result = await testNetworkProxy({
      url: "http://127.0.0.1:7890",
      username: "hexin",
      password: "hx300033",
      llmProvider: true,
      webResearch: false,
    })

    expect(result.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe("config/proxy/test")
    expect(requests[0].method).toBe("POST")
    expect(requests[0].query).toEqual({ directory: PROJECT_DIR })
    expect(requests[0].body).toEqual({
      kind: "json",
      value: {
        proxy: {
          url: "http://127.0.0.1:7890",
          username: "hexin",
          password: "hx300033",
          llmProvider: true,
          webResearch: false,
        },
      },
    })
  })

  test("fails before transport when overlay is disconnected", async () => {
    let called = false
    __setHostTransportForTest(
      fakeTransport(() => {
        called = true
      }),
    )
    configure({ directory: PROJECT_DIR })
    setConnectionStatus("offline")

    await expect(
      testNetworkProxy({
        url: "http://127.0.0.1:7890",
        llmProvider: false,
        webResearch: false,
      }),
    ).rejects.toThrow("Cannot test network proxy while disconnected")
    expect(called).toBe(false)
  })
})
