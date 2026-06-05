import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import {
  buildTuiHostConnectUrl,
  formatTuiHostError,
  loadTuiHostStatus,
  resizeTuiHost,
  startTuiHost,
  stopTuiHost,
  TUI_CODING_AGENT,
} from "../src/services/tui-host"
import { ApiError } from "../src/services/api"

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
          title: "OpenCorvus TUI",
          command: "opencorvus",
          args: [],
          cwd: "D:/repo",
          status: "running",
          pid: 123,
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
  test("uses the OpenCode-style PTY routes instead of the old TUI host routes", async () => {
    const requests: TransportRequest[] = []
    configure({ directory: "D:/repo" })
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))

    await startTuiHost({ cols: 120, rows: 40 })
    await loadTuiHostStatus()
    await resizeTuiHost({ id: "pty_test", cols: 100, rows: 30 })
    await stopTuiHost({ id: "pty_test" })

    expect(requests.map((req) => `${req.method ?? "GET"} ${req.path}`)).toEqual([
      "POST pty",
      "PUT pty/pty_test",
      "GET pty",
      "PUT pty/pty_test",
      "DELETE pty/pty_test",
    ])
    expect(requests.some((req) => req.path === "tui/runtime/status")).toBe(false)
    expect(requests.some((req) => req.path.startsWith("tui/host"))).toBe(false)
    expect(requests.every((req) => req.query?.directory === "D:/repo")).toBe(true)
    expect(requests[0]?.body).toEqual({ kind: "json", value: { title: "OpenCorvus TUI", agent: TUI_CODING_AGENT } })
    expect(requests[1]?.body).toEqual({ kind: "json", value: { size: { cols: 120, rows: 40 } } })
    expect(requests[3]?.body).toEqual({ kind: "json", value: { size: { cols: 100, rows: 30 } } })
  })

  test("builds PTY websocket URLs through the API directory context", () => {
    configure({ serverUrl: "http://127.0.0.1:4096", directory: "D:/repo" })

    const url = new URL(buildTuiHostConnectUrl({ id: "pty_1", cursor: 12 }))
    expect(url.protocol).toBe("ws:")
    expect(url.pathname).toBe("/pty/pty_1/connect")
    expect(url.searchParams.get("cursor")).toBe("12")
    expect(url.searchParams.get("directory")).toBe("D:/repo")
  })

  test("formats named PTY creation failures for the visible TUI panel", () => {
    const error = new ApiError(400, "pty", {
      name: "PtyCreateFailedError",
      data: {
        message: "spawn opencorvus ENOENT",
        cwd: "D:/repo",
        command: "opencorvus",
        args: ["D:/repo", "--agent", TUI_CODING_AGENT],
        env: { SHOULD_NOT_RENDER: "secret" },
      },
    })

    expect(formatTuiHostError(error)).toBe("TUI host failed to start (opencorvus): spawn opencorvus ENOENT")
    expect(formatTuiHostError(error)).not.toContain("secret")
  })
})
