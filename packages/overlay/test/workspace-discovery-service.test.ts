import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { settingsStore, setSettingsStore } from "../src/store/settings"
import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type { HostTransport, TransportRequest } from "../src/services/host-transport"
import { ensureDefaultDirectory, loadDiscoveredProjects } from "../src/services/workspace"

function fakeTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "browser",
    capabilities: HOST_CAPABILITIES.browser,
    async request(req) {
      requests.push(req)
      if (req.path === "global/projects/discover") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            root: "D:/workspace",
            defaultDirectory: "D:/workspace/1a2b3c4d",
            projects: [
              {
                directory: "D:/workspace/app",
                name: "app",
                marker: "D:/workspace/app/.opencorvus",
              },
            ],
          },
        }
      }
      return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
    },
    openStream() {
      return { close() {} }
    },
    async native() {
      throw new Error("native not used")
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
}

function emptyDefaultTransport(requests: TransportRequest[]): HostTransport {
  return {
    ...fakeTransport(requests),
    async request(req) {
      requests.push(req)
      if (req.path === "global/projects/discover") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            root: "D:/workspace",
            defaultDirectory: "",
            projects: [],
          },
        }
      }
      return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
    },
  } satisfies HostTransport
}

function failingDiscoveryTransport(requests: TransportRequest[]): HostTransport {
  return {
    ...fakeTransport(requests),
    async request(req) {
      requests.push(req)
      if (req.path === "global/projects/discover") {
        return {
          status: 503,
          ok: false,
          headers: {},
          body: { error: "discovery unavailable" },
        }
      }
      return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
    },
  } satisfies HostTransport
}

describe("workspace discovery service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setSettingsStore({
      directory: "",
      savedDirectory: "",
    })
  })

  test("loads launch-directory project discovery through the global route", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport(requests))
    configure({ directory: "D:/active/project" })

    const discovery = await loadDiscoveredProjects()

    expect(discovery).toEqual({
      root: "D:/workspace",
      defaultDirectory: "D:/workspace/1a2b3c4d",
      projects: [
        {
          directory: "D:/workspace/app",
          name: "app",
          marker: "D:/workspace/app/.opencorvus",
        },
      ],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("global/projects/discover")
    expect(requests[0]!.query?.directory).toBeUndefined()
  })

  test("ensureDefaultDirectory uses backend-created default when no saved directory exists", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport(requests))
    setSettingsStore({
      directory: "",
      savedDirectory: "",
    })

    await expect(ensureDefaultDirectory()).resolves.toBe(true)

    expect(requests[0]!.path).toBe("global/projects/discover")
    expect(settingsStore.directory).toBe("D:/workspace/1a2b3c4d")
  })

  test("ensureDefaultDirectory keeps the workspace empty when backend default is empty", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(emptyDefaultTransport(requests))

    await expect(ensureDefaultDirectory()).resolves.toBe(false)

    expect(requests[0]!.path).toBe("global/projects/discover")
    expect(settingsStore.directory).toBe("")
  })

  test("ensureDefaultDirectory surfaces discovery failures instead of replacing them with an empty workspace", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(failingDiscoveryTransport(requests))

    await expect(ensureDefaultDirectory()).rejects.toThrow("discovery unavailable")

    expect(requests[0]!.path).toBe("global/projects/discover")
    expect(settingsStore.directory).toBe("")
  })

  test("loadDiscoveredProjects surfaces failed discovery responses with status and body detail", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(failingDiscoveryTransport(requests))

    await expect(loadDiscoveredProjects()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      path: "global/projects/discover",
      body: { error: "discovery unavailable" },
      message: "API 503 global/projects/discover: discovery unavailable",
    })

    expect(requests[0]!.path).toBe("global/projects/discover")
  })
})
