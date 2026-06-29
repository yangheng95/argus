import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { loadConfigInfo, loadProviderInfo, loadSettingsInfo } from "../src/services/init"
import { __setHostTransportForTest } from "../src/services/host-transport"
import { appStore, setAppStore } from "../src/store/app"
import { setSettingsStore } from "../src/store/settings"
import { configure } from "../src/services/api"
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
      throw new Error("openStream not used in config load tests")
    },
    async native() {
      throw new Error("native not used in config load tests")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

beforeEach(() => {
  configure({ directory: "D:/repo/config-load-test" })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    channels: [],
    promptEntries: [],
  })
  setSettingsStore("directory", "")
  setSettingsStore("directoryEpoch", 0)
})

describe("loadConfigInfo", () => {
  test("startup mode does not request settings-only provider or prompt data", async () => {
    const requested: string[] = []
    __setHostTransportForTest(
      fakeTransport((req) => {
        requested.push(req.path)
        if (req.path === "config") {
          return { status: 200, ok: true, headers: {}, body: { model: "openai/gpt-4o-mini" } }
        }
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadConfigInfo(5, { includeSettingsData: false })

    expect(appStore.config).toEqual({ model: "openai/gpt-4o-mini" })
    expect(appStore.providerCatalog).toBeNull()
    expect(appStore.promptEntries).toEqual([])
    expect(requested).toEqual(["config", "channel"])
  })

  test("does not hang when provider catalog loading stalls", async () => {
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "provider") {
          return new Promise((_, reject) => {
            const abort = () => reject(new Error("provider request aborted"))
            if (req.signal?.aborted) {
              abort()
              return
            }
            req.signal?.addEventListener("abort", abort, { once: true })
            setTimeout(() => reject(new Error("provider request did not abort")), 250)
          })
        }
        if (req.path === "config") {
          return { status: 200, ok: true, headers: {}, body: { model: "openai/gpt-4o-mini" } }
        }
        if (req.path === "provider/auth") {
          return { status: 200, ok: true, headers: {}, body: {} }
        }
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        if (req.path === "config/prompt") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadSettingsInfo(5)

    expect(appStore.config).toEqual({ model: "openai/gpt-4o-mini" })
    expect(appStore.providerCatalog).toBeNull()
    expect(appStore.providerAuth).toEqual({})
    expect(appStore.configLoadErrors.provider).toContain("provider request aborted")
  })

  test("loadProviderInfo skips stale directory commits while returning provider requests", async () => {
    const requests: TransportRequest[] = []
    setAppStore({
      providerCatalog: { all: [{ id: "current" }] },
      providerAuth: { current: [{ type: "api_key" }] },
      providerAuthRefreshRevision: 4,
      configLoadErrors: {},
    })
    __setHostTransportForTest(
      fakeTransport((req) => {
        requests.push(req)
        if (req.path === "provider") {
          return { status: 200, ok: true, headers: {}, body: { all: [{ id: "stale" }] } }
        }
        if (req.path === "provider/auth") {
          return { status: 200, ok: true, headers: {}, body: { stale: [{ type: "oauth" }] } }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadProviderInfo(5, {
      directory: "D:/repo/stale",
      isCurrentDirectory: (directory) => directory === "D:/repo/current",
    })

    expect(requests.map((item) => item.path)).toEqual(["provider", "provider/auth"])
    expect(requests.map((item) => item.query?.directory)).toEqual(["D:/repo/stale", "D:/repo/stale"])
    expect(appStore.providerCatalog).toEqual({ all: [{ id: "current" }] })
    expect(appStore.providerAuth).toEqual({ current: [{ type: "api_key" }] })
    expect(appStore.providerAuthRefreshRevision).toBe(4)
  })

  test("clears stale settings-only projections when their bootstrap routes fail", async () => {
    const existingCatalog = { provider: { openai: { id: "openai" } } }
    setAppStore({
      config: { model: "openai/gpt-4o-mini" },
      providerCatalog: existingCatalog,
      providerAuth: { openai: { authenticated: true } },
      channels: [{ id: "current-channel" }],
      promptEntries: [{ id: "current-prompt" }],
    })
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "provider") {
          return new Promise((_, reject) => {
            const abort = () => reject(new Error("provider request aborted"))
            if (req.signal?.aborted) {
              abort()
              return
            }
            req.signal?.addEventListener("abort", abort, { once: true })
          })
        }
        if (req.path === "config") {
          return { status: 200, ok: true, headers: {}, body: { model: "openai/gpt-4.1" } }
        }
        if (req.path === "provider/auth") {
          return { status: 200, ok: true, headers: {}, body: { openai: { authenticated: true } } }
        }
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [{ id: "fresh-channel" }] }
        }
        if (req.path === "config/prompt") {
          return new Promise((_, reject) => {
            const abort = () => reject(new Error("prompt request aborted"))
            if (req.signal?.aborted) {
              abort()
              return
            }
            req.signal?.addEventListener("abort", abort, { once: true })
          })
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadSettingsInfo(5)

    expect(appStore.config).toEqual({ model: "openai/gpt-4.1" })
    expect(appStore.providerCatalog).toBeNull()
    expect(appStore.providerAuth).toEqual({ openai: { authenticated: true } })
    expect(appStore.channels).toEqual([{ id: "fresh-channel" }])
    expect(appStore.promptEntries).toEqual([])
    expect(appStore.configLoadErrors.provider).toContain("provider request aborted")
    expect(appStore.configLoadErrors["config/prompt"]).toContain("prompt request aborted")
  })

  test("older config refresh cannot overwrite a newer completed refresh", async () => {
    let configCalls = 0
    let releaseFirstConfig: (() => void) | undefined
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "config") {
          configCalls += 1
          if (configCalls === 1) {
            return new Promise((resolve) => {
              releaseFirstConfig = () =>
                resolve({
                  status: 200,
                  ok: true,
                  headers: {},
                  body: { model: "openai/old" },
                })
            })
          }
          return { status: 200, ok: true, headers: {}, body: { model: "openai/new" } }
        }
        if (req.path === "provider") {
          return { status: 200, ok: true, headers: {}, body: { all: [] } }
        }
        if (req.path === "provider/auth") {
          return { status: 200, ok: true, headers: {}, body: {} }
        }
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        if (req.path === "config/prompt") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const first = loadSettingsInfo(1_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await loadSettingsInfo(1_000)
    expect(appStore.config).toEqual({ model: "openai/new" })

    releaseFirstConfig?.()
    await first

    expect(appStore.config).toEqual({ model: "openai/new" })
  })

  test("project close invalidates in-flight config refresh before it can repopulate stores", async () => {
    let releaseConfig: (() => void) | undefined
    const requested: string[] = []
    setSettingsStore("directory", "D:/repo/closing")
    setSettingsStore("directoryEpoch", 12)
    setAppStore({
      config: null,
      channels: [],
      configLoadErrors: {},
    })
    __setHostTransportForTest(
      fakeTransport((req) => {
        requested.push(req.path)
        if (req.path === "config") {
          return new Promise((resolve) => {
            releaseConfig = () =>
              resolve({
                status: 200,
                ok: true,
                headers: {},
                body: { model: "openai/stale-after-close" },
              })
          })
        }
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [{ id: "stale-channel" }] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const pending = loadConfigInfo(1_000, { includeSettingsData: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    setSettingsStore("directoryEpoch", (value) => value + 1)
    setSettingsStore("directory", "")

    releaseConfig?.()
    await pending

    expect(requested).toEqual(["config", "channel"])
    expect(appStore.config).toBeNull()
    expect(appStore.channels).toEqual([])
    expect(appStore.configLoadErrors).toEqual({})
  })
})
