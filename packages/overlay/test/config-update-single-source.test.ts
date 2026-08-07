import { afterEach, describe, expect, test } from "bun:test"
import { setAppStore, appStore } from "../src/store/app"
import { configure as configureApi } from "../src/services/api"
import {
  type HostTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport"
import { __setHostTransportForTest } from "../src/services/host-transport-runtime"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch
  const base = isRecord(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key]
    } else {
      base[key] = mergePatch(base[key], value)
    }
  }
  return base
}

function fakeConfigTransport(calls: TransportRequest[]): HostTransport {
  let config: Record<string, unknown> = {
    model: "before",
    agent: { coding: { model: "hexin/old-coding" } },
    provider: {},
  }
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      calls.push(req)
      if (req.path !== "config") {
        throw new Error(`unexpected request ${req.path}`)
      }
      if (req.method === "GET") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: structuredClone(config) as T,
        }
      }
      if (req.method === "PATCH") {
        const patch = req.body?.kind === "json" ? req.body.value : {}
        config = mergePatch(config, patch) as Record<string, unknown>
        return {
          status: 200,
          ok: true,
          headers: {},
          body: structuredClone(config) as T,
        }
      }
      throw new Error(`unexpected method ${req.method}`)
    },
    openStream() {
      throw new Error("openStream not used")
    },
    async native() {
      throw new Error("native not used")
    },
  }
}

describe("updateConfig writes through the Solid config store", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configureApi({ directory: "" })
    setAppStore({ config: null, connected: false })
  })

  test("PATCH response becomes the local config mirror without a second config fetch", async () => {
    const calls: TransportRequest[] = []
    __setHostTransportForTest(fakeConfigTransport(calls))
    configureApi({ directory: "D:/workspace/app" })
    setAppStore("config", { model: "stale" })
    const { updateConfig } = await import("../src/services/config")

    const saved = await updateConfig((config) => {
      config.model = "after"
      config.provider.openai = { api: "https://api.openai.com/v1" }
    })

    expect(saved).toEqual(appStore.config)
    expect(appStore.config.model).toBe("after")
    expect(appStore.config.provider.openai.api).toBe("https://api.openai.com/v1")
    expect(appStore.config.agent.coding.model).toBe("hexin/old-coding")
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"])
    expect(calls.map((call) => call.query?.directory)).toEqual(["D:/workspace/app", "D:/workspace/app"])
    expect(calls[1].body?.kind).toBe("json")
    expect(calls[1].body?.value).toEqual({
      model: "after",
      provider: {
        openai: { api: "https://api.openai.com/v1" },
      },
    })
    expect(calls[1].body?.value).not.toHaveProperty("agent")
  })

  test("explicit directory owns both updateConfig requests when the global directory changes mid-flight", async () => {
    const calls: TransportRequest[] = []
    let config: Record<string, unknown> = { model: "before" }
    __setHostTransportForTest({
      kind: "tauri",
      async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
        calls.push(req)
        if (req.path !== "config") throw new Error(`unexpected request ${req.path}`)
        if (req.method === "GET") {
          configureApi({ directory: "D:/project-b" })
          return { status: 200, ok: true, headers: {}, body: structuredClone(config) as T }
        }
        if (req.method === "PATCH") {
          const patch = req.body?.kind === "json" ? req.body.value : {}
          config = mergePatch(config, patch) as Record<string, unknown>
          return { status: 200, ok: true, headers: {}, body: structuredClone(config) as T }
        }
        throw new Error(`unexpected method ${req.method}`)
      },
      openStream() {
        throw new Error("openStream not used")
      },
      async native() {
        throw new Error("native not used")
      },
    })
    configureApi({ directory: "D:/project-a" })
    const { updateConfig } = await import("../src/services/config")

    await updateConfig(
      (current) => {
        current.model = "after"
      },
      { directory: "D:/project-a" },
    )

    expect(calls.map((call) => call.query?.directory)).toEqual(["D:/project-a", "D:/project-a"])
  })

  test("session config helpers use explicit directory and do not update appStore.config", async () => {
    const calls: TransportRequest[] = []
    const directory = "D:/workspace/session-app"
    let sessionConfig = {
      config: {
        model: "openai/gpt-4o-mini",
        agent: {},
      },
      origin: {
        model: "project",
        agent: {},
      },
    }
    __setHostTransportForTest({
      kind: "tauri",
      async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
        calls.push(req)
        if (req.path !== "session/session_123/config") {
          throw new Error(`unexpected request ${req.path}`)
        }
        if (req.method === "GET") {
          return { status: 200, ok: true, headers: {}, body: structuredClone(sessionConfig) as T }
        }
        if (req.method === "PATCH") {
          const patch = req.body?.kind === "json" && isRecord(req.body.value) ? req.body.value : {}
          sessionConfig = {
            config: {
              model: patch.model,
              agent: {},
            },
            origin: {
              model: "session",
              agent: {},
            },
          }
          return { status: 200, ok: true, headers: {}, body: structuredClone(sessionConfig) as T }
        }
        throw new Error(`unexpected method ${req.method}`)
      },
      openStream() {
        throw new Error("openStream not used")
      },
      async native() {
        throw new Error("native not used")
      },
    })
    setAppStore({ connected: true, config: { model: "project/base" } })
    const { getSessionConfig, patchSessionConfig } = await import("../src/services/config")

    const before = await getSessionConfig({ sessionID: "session_123", directory })
    const after = await patchSessionConfig({
      sessionID: "session_123",
      directory,
      diff: { model: "anthropic/claude-sonnet-4-6" },
    })

    expect(before.config.model).toBe("openai/gpt-4o-mini")
    expect(after.config.model).toBe("anthropic/claude-sonnet-4-6")
    expect(appStore.config.model).toBe("project/base")
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET session/session_123/config",
      "PATCH session/session_123/config",
    ])
    expect(calls.map((call) => call.query?.directory)).toEqual([directory, directory])
  })
})
