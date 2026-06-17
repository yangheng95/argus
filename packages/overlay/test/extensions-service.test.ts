import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { deleteAllSkills } from "../src/services/extensions"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { appStore, setSkills } from "../src/store/app"

const PROJECT_DIR = "C:/Users/example/project"

function fakeSkillDeleteAllTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      if (req.path === "skill/remove") {
        const source = (req.body?.kind === "json" ? (req.body.value as { source?: string }).source : "") ?? ""
        if (source.endsWith("skill-b")) {
          return { status: 503, ok: false, headers: {}, body: { error: "skill remove unavailable" } as T }
        }
        return { status: 200, ok: true, headers: {}, body: true as T }
      }
      if (req.path === "skill/installed") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: [
            {
              name: "skill-b",
              source: "D:/skills/skill-b",
              source_type: "config_path",
              builtin: false,
            },
          ] as T,
        }
      }
      throw new Error(`unexpected request ${req.method ?? "GET"} ${req.path}`)
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

describe("Extension overlay service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setSkills([])
  })

  test("deleteAllSkills refreshes installed projection after partial removal failure", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeSkillDeleteAllTransport(requests))
    configure({ directory: PROJECT_DIR })
    setSkills([
      {
        name: "skill-a",
        source: "D:/skills/skill-a",
        source_type: "config_path",
        builtin: false,
      },
      {
        name: "skill-b",
        source: "D:/skills/skill-b",
        source_type: "config_path",
        builtin: false,
      },
    ])

    await expect(deleteAllSkills()).rejects.toThrow("skill remove unavailable")

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual([
      "POST skill/remove",
      "POST skill/remove",
      "GET skill/installed",
    ])
    expect(requests.every((item) => item.query?.directory === PROJECT_DIR)).toBe(true)
    expect(appStore.skills.map((item) => item.name)).toEqual(["skill-b"])
  })
})
