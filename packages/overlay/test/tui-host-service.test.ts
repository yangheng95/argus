import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import {
  formatTuiEmbedError,
  loadTuiEmbedStatus,
  resizeTuiEmbed,
  sendTuiEmbedInput,
  startTuiEmbed,
  stopTuiEmbed,
  TUI_CODING_AGENT,
} from "../src/plugins/coding-agent-tui/embedded-target"
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
          running: true,
          cols: 120,
          rows: 40,
          mode: "light",
          directory: "D:/repo",
          frame: {
            cols: 120,
            rows: 40,
            cursor: [0, 0],
            lines: [{ spans: [{ text: "OpenTUI", fg: "rgb(255, 255, 255)", bg: "rgb(0, 0, 0)", attributes: 0, width: 7 }] }],
          },
          text: "OpenTUI",
          createdAt: 1,
          updatedAt: 2,
        } as T,
      }
    },
    openStream() {
      throw new Error("openStream not used in tui embed service tests")
    },
    async native() {
      throw new Error("native not used in tui embed service tests")
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

describe("tui embed service", () => {
  test("uses OpenTUI embed routes instead of PTY websocket routes", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport((req) => requests.push(req)))

    await startTuiEmbed({ cols: 120, rows: 40, mode: "light", directory: "D:/repo" })
    await loadTuiEmbedStatus({ directory: "D:/repo" })
    await sendTuiEmbedInput({ directory: "D:/repo", text: "坦克大战" })
    await resizeTuiEmbed({ cols: 100, rows: 30, directory: "D:/repo" })
    await stopTuiEmbed({ directory: "D:/repo" })

    expect(requests.map((req) => `${req.method ?? "GET"} ${req.path}`)).toEqual([
      "POST tui/embed/start",
      "GET tui/embed/status",
      "POST tui/embed/input",
      "POST tui/embed/resize",
      "POST tui/embed/stop",
    ])
    expect(requests.every((req) => req.query?.directory === "D:/repo")).toBe(true)
    expect(requests.some((req) => req.path === "pty")).toBe(false)
    expect(requests.some((req) => req.path.includes("/connect"))).toBe(false)
    expect(requests[0]?.body).toEqual({
      kind: "json",
      value: {
        cols: 120,
        rows: 40,
        mode: "light",
        agent: TUI_CODING_AGENT,
      },
    })
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(requests[2]?.body).toEqual({ kind: "json", value: { text: "坦克大战" } })
    expect(requests[3]?.body).toEqual({ kind: "json", value: { cols: 100, rows: 30 } })
  })

  test("rejects embed calls without an explicit plugin workspace directory", async () => {
    await expect(startTuiEmbed({ cols: 120, rows: 40, mode: "dark", directory: "" })).rejects.toThrow(
      "Coding agent TUI requires an active workspace directory.",
    )
  })

  test("formats named embed failures for the visible TUI panel", () => {
    const error = new ApiError(400, "tui/embed/start", {
      name: "EmbeddedTuiError",
      data: {
        message: "renderer failed",
        env: { SHOULD_NOT_RENDER: "secret" },
      },
    })

    expect(formatTuiEmbedError(error)).toBe("EmbeddedTuiError: renderer failed")
    expect(formatTuiEmbedError(error)).not.toContain("secret")
  })
})
