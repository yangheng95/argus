import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { loadConfigInfo, loadProviderInfo } from "../src/services/config-load"
import { __setHostTransportForTest } from "../src/services/host-transport-runtime"
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
  }
}

beforeEach(() => {
  configure({ directory: "D:/repo/config-load-test" })
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    providerLoadIssues: [],
    channels: [],
  })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setAppStore({
    config: null,
    composerModel: "",
    providerCatalog: null,
    providerAuth: null,
    providerLoadIssues: [],
    channels: [],
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

    await loadConfigInfo(5)

    expect(appStore.config).toEqual({ model: "openai/gpt-4o-mini" })
    expect(appStore.providerCatalog).toBeNull()
    expect(requested).toEqual(["config", "channel"])
  })

  test("does not hang when provider catalog loading stalls", async () => {
    setAppStore({
      config: { model: "openai/existing" },
      providerCatalog: { all: [{ id: "existing" }] },
      providerAuth: { existing: [{ type: "api_key" }] },
      channels: [{ id: "existing-channel" }],
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
            setTimeout(() => reject(new Error("provider request did not abort")), 250)
          })
        }
        if (req.path === "provider/auth") {
          return { status: 200, ok: true, headers: {}, body: {} }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const issues = await loadProviderInfo(5, {
      directory: "D:/repo/config-load-test",
      isCurrentDirectory: (directory) => directory === "D:/repo/config-load-test",
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.resource).toBe("catalog")
    expect(issues[0]?.message).toContain("request aborted")

    expect(appStore.config).toEqual({ model: "openai/existing" })
    expect(appStore.providerCatalog).toEqual({ all: [{ id: "existing" }] })
    expect(appStore.providerAuth).toEqual({})
    expect(appStore.providerLoadIssues).toHaveLength(1)
    expect(appStore.providerLoadIssues[0]?.resource).toBe("catalog")
    expect(appStore.providerLoadIssues[0]?.message).toContain("request aborted")
    expect(appStore.channels).toEqual([{ id: "existing-channel" }])
  })

  test("no-project provider loading uses the global provider contract", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(
      fakeTransport((req) => {
        requests.push(req)
        if (req.path === "global/providers") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: {
              catalog: { all: [{ id: "openai" }], connected: ["openai"], default: { openai: "gpt-5.4" } },
            },
          }
        }
        if (req.path === "global/config") {
          return { status: 200, ok: true, headers: {}, body: { model: "openai/gpt-5.4" } }
        }
        if (req.path === "global/providers/auth") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: {
              openai: [
                { type: "oauth", label: "ChatGPT Plus/Pro" },
                { type: "oauth", label: "ChatGPT Plus/Pro (Headless)" },
                { type: "api", label: "Manually enter API Key" },
              ],
            },
          }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    await loadProviderInfo(5)

    expect(requests.map((request) => request.path).sort()).toEqual([
      "global/config",
      "global/providers",
      "global/providers/auth",
    ])
    expect(appStore.config).toEqual({ model: "openai/gpt-5.4" })
    expect(appStore.providerCatalog).toEqual({
      all: [{ id: "openai" }],
      connected: ["openai"],
      default: { openai: "gpt-5.4" },
    })
    expect(appStore.providerAuth?.openai?.map((method: any) => method.label)).toEqual([
      "ChatGPT Plus/Pro",
      "ChatGPT Plus/Pro (Headless)",
      "Manually enter API Key",
    ])
    expect(appStore.providerLoadIssues).toEqual([])
  })

  test("global Provider resources commit independently when config loading fails", async () => {
    setAppStore({
      config: { model: "existing/model" },
      providerCatalog: { all: [{ id: "existing" }] },
      providerAuth: { existing: [{ type: "api" }] },
    })
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "global/providers") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: {
              catalog: {
                all: [{ id: "hexin" }],
                connected: ["hexin"],
                default: { hexin: "gpt-5.6-sol" },
                issues: [{ phase: "provider.loader", providerID: "broken", message: "loader exploded" }],
              },
            },
          }
        }
        if (req.path === "global/providers/auth") {
          return { status: 200, ok: true, headers: {}, body: { hexin: [{ type: "api" }] } }
        }
        if (req.path === "global/config") throw new Error("config service unavailable")
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const issues = await loadProviderInfo(5)

    expect(appStore.config).toEqual({ model: "existing/model" })
    expect(appStore.providerCatalog?.all).toEqual([{ id: "hexin" }])
    expect(appStore.providerAuth).toEqual({ hexin: [{ type: "api" }] })
    expect(issues).toEqual([
      {
        resource: "provider",
        phase: "provider.loader",
        providerID: "broken",
        message: "loader exploded",
      },
      {
        resource: "config",
        message: "global/config: config service unavailable",
      },
    ])
  })

  test("loadProviderInfo skips stale directory commits while returning provider requests", async () => {
    const requests: TransportRequest[] = []
    setAppStore({
      providerCatalog: { all: [{ id: "current" }] },
      providerAuth: { current: [{ type: "api_key" }] },
      providerAuthRefreshRevision: 4,
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
        if (req.path === "channel") {
          return { status: 200, ok: true, headers: {}, body: [] }
        }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const first = loadConfigInfo(1_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await loadConfigInfo(1_000)
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

    const pending = loadConfigInfo(1_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    setSettingsStore("directoryEpoch", (value) => value + 1)
    setSettingsStore("directory", "")

    releaseConfig?.()
    await pending

    expect(requested).toEqual(["config", "channel"])
    expect(appStore.config).toBeNull()
    expect(appStore.channels).toEqual([])
  })

  test("config and channel resources settle independently and preserve the failed resource", async () => {
    setAppStore({
      config: { model: "stale/model" },
      channels: [{ id: "stale-channel" }],
      configLoadIssues: [],
    })
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "config") {
          return { status: 200, ok: true, headers: {}, body: { model: "fresh/model" } }
        }
        if (req.path === "channel") throw new Error("channel catalogue unavailable")
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const issues = await loadConfigInfo(50)

    expect(appStore.config).toEqual({ model: "fresh/model" })
    expect(appStore.channels).toEqual([{ id: "stale-channel" }])
    expect(issues).toEqual([{ resource: "channel", message: "channel: channel catalogue unavailable" }])
    expect(appStore.configLoadIssues).toEqual(issues)
  })

  test("provider issue dedupe preserves equal messages from distinct phases", async () => {
    __setHostTransportForTest(
      fakeTransport((req) => {
        if (req.path === "provider") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: {
              all: [],
              issues: [
                { phase: "declaration", providerID: "broken", message: "invalid provider" },
                { phase: "models", providerID: "broken", message: "invalid provider" },
              ],
            },
          }
        }
        if (req.path === "provider/auth") return { status: 200, ok: true, headers: {}, body: {} }
        throw new Error(`unexpected route ${req.path}`)
      }),
    )

    const issues = await loadProviderInfo(50, {
      directory: "D:/repo/provider-issues",
      isCurrentDirectory: () => true,
    })

    expect(issues.map((issue) => issue.phase)).toEqual(["declaration", "models"])
  })
})
