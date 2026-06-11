import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type { HostTransport, TransportRequest } from "../src/services/host-transport"
import { loadDiscoveredProjects } from "../src/services/workspace"

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

describe("workspace discovery service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
  })

  test("loads launch-directory project discovery through the global route", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport(requests))
    configure({ directory: "D:/active/project" })

    const discovery = await loadDiscoveredProjects()

    expect(discovery).toEqual({
      root: "D:/workspace",
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
})
