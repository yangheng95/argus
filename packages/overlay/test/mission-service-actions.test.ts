import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

interface Captured {
  path: string
  method: string
  query: Record<string, string | number | boolean> | undefined
  body: unknown
}

function fakeTransport(responder: (req: TransportRequest) => TransportResponse<unknown>): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as TransportResponse<T>
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
  } satisfies HostTransport
}

const { abortMission, deleteMission, renameMission } = await import("../src/services/mission")

let captured: Captured[]

beforeEach(() => {
  captured = []
})

afterEach(() => __setHostTransportForTest(undefined))

function recordingTransport(): HostTransport {
  return fakeTransport((req) => {
    captured.push({
      path: req.path,
      method: req.method,
      query: req.query,
      body: req.body && (req.body as any).kind === "json" ? (req.body as any).value : req.body,
    })
    if (req.method === "PATCH") {
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          missionID: "m-alpha",
          sessionID: "ses_alpha",
          title: "Renamed",
          directory: "D:/repo",
          created: 1,
          updated: 2,
          tasks: [],
          taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
        },
      }
    }
    return { status: 200, ok: true, headers: {}, body: true }
  })
}

describe("Mission service action contract", () => {
  test("renameMission PATCHes mission/<id>/title with a trimmed title", async () => {
    __setHostTransportForTest(recordingTransport())
    const result = await renameMission({ missionID: "m-alpha", directory: "D:/repo" }, "  Renamed  ")
    expect(result.title).toBe("Renamed")
    expect(captured).toEqual([
      {
        path: "mission/m-alpha/title",
        method: "PATCH",
        query: { directory: "D:/repo" },
        body: { title: "Renamed" },
      },
    ])
  })

  test("renameMission rejects empty and oversize titles before network", async () => {
    __setHostTransportForTest(recordingTransport())
    await expect(renameMission({ missionID: "m-alpha", directory: "D:/repo" }, "   ")).rejects.toThrow("renameMission")
    await expect(renameMission({ missionID: "m-alpha", directory: "D:/repo" }, "x".repeat(201))).rejects.toThrow(
      "renameMission",
    )
    await expect(renameMission({ missionID: "m-alpha", directory: "" }, "Renamed")).rejects.toThrow("missionActionPath")
    expect(captured).toEqual([])
  })

  test("abortMission POSTs mission/<id>/abort", async () => {
    __setHostTransportForTest(recordingTransport())
    await expect(abortMission({ missionID: "m-alpha", directory: "D:/repo" })).resolves.toBe(true)
    expect(captured).toEqual([
      {
        path: "mission/m-alpha/abort",
        method: "POST",
        query: { directory: "D:/repo" },
        body: undefined,
      },
    ])
  })

  test("deleteMission DELETEs mission/<id>", async () => {
    __setHostTransportForTest(recordingTransport())
    await expect(deleteMission({ missionID: "m-alpha", directory: "D:/repo" })).resolves.toBe(true)
    expect(captured).toEqual([
      {
        path: "mission/m-alpha",
        method: "DELETE",
        query: { directory: "D:/repo" },
        body: undefined,
      },
    ])
  })
})
