import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import {
  loadTuiHostOutput,
  loadTuiHostSnapshot,
  loadTuiHostStatus,
  resizeTuiHost,
  sendTuiHostInput,
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
    await loadTuiHostOutput(5)
    await sendTuiHostInput("abc")
    await resizeTuiHost({ cols: 100, rows: 30 })
    await stopTuiHost()

    expect(requests.map((req) => `${req.method ?? "GET"} ${req.path}`)).toEqual([
      "POST tui/host/start",
      "GET tui/host/status",
      "GET tui/host/snapshot",
      "GET tui/host/output",
      "POST tui/host/input",
      "POST tui/host/resize",
      "POST tui/host/stop",
    ])
    expect(requests.some((req) => req.path === "tui/runtime/status")).toBe(false)
    expect(requests.every((req) => req.query?.directory === "D:/repo")).toBe(true)
    expect(requests[0]?.body).toEqual({ kind: "json", value: { cols: 120, rows: 40 } })
    expect(requests[3]?.query).toMatchObject({ cursor: "5", directory: "D:/repo" })
    expect(requests[4]?.body).toEqual({ kind: "json", value: { data: "abc" } })
    expect(requests[5]?.body).toEqual({ kind: "json", value: { cols: 100, rows: 30 } })
  })
})
