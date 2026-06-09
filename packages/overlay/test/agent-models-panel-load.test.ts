import { afterEach, describe, expect, test } from "bun:test"
import { loadAgentModelsData, requireAgentModelsDirectory } from "../src/components/settings/agent-models-data"
import { __setHostTransportForTest } from "../src/services/host-transport"
import { applySettings, DEFAULT_SETTINGS, setSettingsStore } from "../src/store/settings"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return (await responder(req)) as TransportResponse<T>
    },
    openStream() {
      throw new Error("openStream not used in agent model panel load tests")
    },
    async native() {
      throw new Error("native not used in agent model panel load tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

afterEach(() => {
  __setHostTransportForTest(undefined)
  applySettings({ ...DEFAULT_SETTINGS })
})

describe("agent model panel data loading", () => {
  test("rejects before project-scoped requests when no working directory is selected", async () => {
    let calls = 0
    __setHostTransportForTest(
      fakeTransport(() => {
        calls++
        throw new Error("request must not run without a directory")
      }),
    )

    expect(() => requireAgentModelsDirectory()).toThrow("Working directory required")
    await expect(loadAgentModelsData(5)).rejects.toThrow("Working directory required")
    expect(calls).toBe(0)
  })

  test("times out stalled provider load with the failing route preserved", async () => {
    setSettingsStore("directory", "D:/overlay/workspace/app")
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "agent") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: [{ name: "build", mode: "primary", options: {} }],
          }
        }
        if (req.path === "config/providers") {
          return new Promise((_, reject) => {
            const abort = () => reject(new Error("aborted by timeout"))
            if (req.signal?.aborted) {
              abort()
              return
            }
            req.signal?.addEventListener("abort", abort, { once: true })
            setTimeout(() => reject(new Error("request signal did not abort")), 250)
          })
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    let caught: unknown
    try {
      await loadAgentModelsData(5)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain("config/providers")
    expect((caught as Error).message).toContain("aborted by timeout")
  })
})
