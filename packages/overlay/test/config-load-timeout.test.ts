import { afterEach, describe, expect, test } from "bun:test"
import { loadConfigInfo, loadSettingsInfo } from "../src/services/init"
import { __setHostTransportForTest } from "../src/services/host-transport"
import { appStore, setAppStore } from "../src/store/app"
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

afterEach(() => {
  __setHostTransportForTest(undefined)
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    channels: [],
    promptEntries: [],
  })
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

  test("preserves existing provider data when a bootstrap route times out", async () => {
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
          return { status: 200, ok: true, headers: {}, body: [{ id: "fresh-prompt" }] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadSettingsInfo(5)

    expect(appStore.config).toEqual({ model: "openai/gpt-4.1" })
    expect(appStore.providerCatalog).toEqual(existingCatalog)
    expect(appStore.providerAuth).toEqual({ openai: { authenticated: true } })
    expect(appStore.channels).toEqual([{ id: "fresh-channel" }])
    expect(appStore.promptEntries).toEqual([{ id: "fresh-prompt" }])
    expect(appStore.configLoadErrors.provider).toContain("provider request aborted")
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
})
