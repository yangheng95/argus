import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import {
  buildTuiHostConnectUrl,
  createTuiHostConnectToken,
  loadTuiHostSnapshot,
  loadTuiHostStatus,
  resizeTuiHost,
  startTuiHost,
  stopTuiHost,
} from "../src/services/tui-host"

function fakeTransport(capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          id: "pty_test",
          running: true,
          status: "running",
          cols: 100,
          rows: 30,
          url: "http://127.0.0.1:1234",
          directory: "D:/repo",
          exitCode: null,
          createdAt: 1,
          updatedAt: 2,
          buffer: "hello",
          data: "hello",
          cursor: 5,
          from: 0,
          truncated: false,
        } as T,
      }
    },
    openStream() {
      throw new Error("openStream not used in tui host service tests")
    },
    async native() {
      throw new Error("native not used in tui host service tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

describe("tui host service", () => {
  test("uses the embedded host routes instead of the old runtime status route", async () => {
    const requests: TransportRequest[] = []
    configure({ directory: "D:/repo" })
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))

    await startTuiHost({ cols: 120, rows: 40 })
    await loadTuiHostStatus()
    await loadTuiHostSnapshot()
    await createTuiHostConnectToken()
    await resizeTuiHost({ cols: 100, rows: 30 })
    await stopTuiHost()

    expect(requests.map((req) => `${req.method ?? "GET"} ${req.path}`)).toEqual([
      "POST tui/host/start",
      "GET tui/host/status",
      "GET tui/host/snapshot",
      "POST tui/host/connect-token",
      "POST tui/host/resize",
      "POST tui/host/stop",
    ])
    expect(requests.some((req) => req.path === "tui/runtime/status")).toBe(false)
    expect(requests.every((req) => req.query?.directory === "D:/repo")).toBe(true)
    expect(requests[0]?.body).toEqual({ kind: "json", value: { cols: 120, rows: 40 } })
    expect(requests[3]?.headers).toEqual({ "x-opencode-ticket": "1" })
    expect(requests[4]?.body).toEqual({ kind: "json", value: { cols: 100, rows: 30 } })
  })

  test("builds ticketed websocket URLs through the API directory context", () => {
    configure({ serverUrl: "http://127.0.0.1:4096", directory: "D:/repo" })

    const url = new URL(buildTuiHostConnectUrl({ ticket: "ticket-1", cursor: 12 }))
    expect(url.protocol).toBe("ws:")
    expect(url.pathname).toBe("/tui/host/connect")
    expect(url.searchParams.get("ticket")).toBe("ticket-1")
    expect(url.searchParams.get("cursor")).toBe("12")
    expect(url.searchParams.get("directory")).toBe("D:/repo")
  })
})
