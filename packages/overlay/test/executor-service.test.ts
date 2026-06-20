import { afterEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { appStore, setAppStore } from "../src/store/app"
import { loadExecutors, setExecutorModel } from "../src/services/executor"

function fakeTransport(calls: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      calls.push(req)
      return {
        status: 200,
        ok: true,
        headers: {},
        body: [{ id: "codex", label: "Codex", selectable: true, model: "gpt-5" }] as T,
      }
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

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setAppStore("executors", [])
})

test("loadExecutors sends the explicit project directory", async () => {
  const calls: TransportRequest[] = []
  configure({ directory: "D:/repo/from-settings" })
  __setHostTransportForTest(fakeTransport(calls))

  await loadExecutors("D:/repo/from-row")

  expect(calls).toHaveLength(1)
  expect(calls[0]!.path).toBe("executor")
  expect(calls[0]!.method).toBe("GET")
  expect(calls[0]!.query?.directory).toBe("D:/repo/from-row")
  expect(appStore.executors).toEqual([{ id: "codex", label: "Codex", selectable: true, model: "gpt-5" }])
})

test("setExecutorModel patches and reloads with the same explicit project directory", async () => {
  const calls: TransportRequest[] = []
  configure({ directory: "D:/repo/from-settings" })
  __setHostTransportForTest(fakeTransport(calls))

  await setExecutorModel({ executorID: "codex", model: "gpt-5.1", directory: "D:/repo/from-row" })

  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "PATCH executor/codex/model",
    "GET executor",
  ])
  expect(calls.map((call) => call.query?.directory)).toEqual(["D:/repo/from-row", "D:/repo/from-row"])
  expect(calls[0]!.body?.kind).toBe("json")
  expect((calls[0]!.body as { kind: "json"; value: unknown }).value).toEqual({ model: "gpt-5.1" })
})

test("executor service rejects missing explicit directories before transport", async () => {
  const calls: TransportRequest[] = []
  __setHostTransportForTest(fakeTransport(calls))

  await expect(loadExecutors("")).rejects.toThrow("executor service requires a project directory")
  await expect(setExecutorModel({ executorID: "codex", model: "gpt-5.1", directory: "" })).rejects.toThrow(
    "executor service requires a project directory",
  )
  expect(calls).toEqual([])
})
