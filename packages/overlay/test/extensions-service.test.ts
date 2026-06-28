import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import {
  deleteAllSkills,
  importSkillFile,
  installSkill,
  loadExtensions,
  loadInstalledSkills,
  loadMcpStatus,
  loadSkillMarket,
  loadSkillMountMatrix,
  removeSkillSource,
} from "../src/services/extensions"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { appStore, setMcp, setSkillMarket, setSkillMounts, setSkills } from "../src/store/app"

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

function fakeSkillMutationTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      if (req.path === "skill/remove") return { status: 200, ok: true, headers: {}, body: true as T }
      if (req.path === "skill/install") return { status: 200, ok: true, headers: {}, body: true as T }
      if (req.path === "skill/import-file") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { name: "dropped", source: "D:/skills/dropped", kind: "path" } as T,
        }
      }
      if (req.path === "skill/installed") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: [{ name: "owned-skill", source: "D:/skills/owned", source_type: "config_path" }] as T,
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

function fakeExtensionLoadTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      if (req.path === "skill/mounts") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            scope: "project",
            skills: [
              {
                name: "mounted-skill",
                source: "D:/skills/mounted-skill",
                source_type: "config_path",
                mounted_agents: ["build"],
                unmounted: false,
              },
            ],
            agents: [],
            matrix: [],
            project_mounts: { agents: { build: ["mounted-skill"] } },
            unmounted_count: 0,
          } as T,
        }
      }
      if (req.path === "mcp") {
        return { status: 200, ok: true, headers: {}, body: { docs: { status: "connected" } } as T }
      }
      if (req.path === "skill/market") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: [
            {
              id: "stale-market",
              name: "Stale Market",
              provider: "test",
              trust: "local",
              install_kind: "git",
              source: "https://example.invalid/stale.git",
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
    setSkillMounts(null)
    setMcp({})
    setSkillMarket([])
  })

  test("loadExtensions uses skill mount matrix as the single skill projection", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeExtensionLoadTransport(requests))
    configure({ directory: PROJECT_DIR })
    setSkills([{ name: "stale-installed-skill" }])

    const result = await loadExtensions()

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET skill/mounts", "GET mcp"])
    expect(requests.every((item) => item.query?.directory === PROJECT_DIR)).toBe(true)
    expect(result.skills.map((item) => item.name)).toEqual(["mounted-skill"])
    expect(appStore.skills.map((item) => item.name)).toEqual(["mounted-skill"])
    expect(appStore.skillMounts?.project_mounts).toEqual({ agents: { build: ["mounted-skill"] } })
    expect(appStore.mcp.docs).toEqual({ status: "connected" })
  })

  test("loadSkillMountMatrix refresh uses the matrix projection with explicit cache invalidation", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeExtensionLoadTransport(requests))
    configure({ directory: PROJECT_DIR })

    const result = await loadSkillMountMatrix({ refresh: true })

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET skill/mounts"])
    expect(requests[0]?.query).toEqual({ refresh: "true", directory: PROJECT_DIR })
    expect(result.skills.map((item) => item.name)).toEqual(["mounted-skill"])
    expect(appStore.skills.map((item) => item.name)).toEqual(["mounted-skill"])
  })

  test("loadSkillMountMatrix skips stale directory commits while returning the response", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeExtensionLoadTransport(requests))
    configure({ directory: "D:/repo/current" })
    setSkills([{ name: "current-skill" }])
    setSkillMounts({ skills: [{ name: "current-skill" }], agents: [], matrix: [], unmounted_count: 0 })

    const result = await loadSkillMountMatrix({
      directory: "D:/repo/stale",
      isCurrentDirectory: (directory) => directory === "D:/repo/current",
    })

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET skill/mounts"])
    expect(requests[0]?.query?.directory).toBe("D:/repo/stale")
    expect(result.skills.map((item) => item.name)).toEqual(["mounted-skill"])
    expect(appStore.skills.map((item) => item.name)).toEqual(["current-skill"])
    expect(appStore.skillMounts?.skills.map((item: { name: string }) => item.name)).toEqual(["current-skill"])
  })

  test("setMcp replaces the server map instead of merging stale server names", () => {
    setMcp({ docs: { status: "connected" }, browser: { status: "connected" } })
    setMcp({ current: { status: "connected" } })

    expect(appStore.mcp).toEqual({ current: { status: "connected" } })
  })

  test("loadMcpStatus skips stale directory commits while returning the response", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeExtensionLoadTransport(requests))
    configure({ directory: "D:/repo/current" })
    setMcp({ current: { status: "connected" } })

    const result = await loadMcpStatus({
      directory: "D:/repo/stale",
      isCurrentDirectory: (directory) => directory === "D:/repo/current",
    })

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET mcp"])
    expect(requests[0]?.query?.directory).toBe("D:/repo/stale")
    expect(result.docs).toEqual({ status: "connected" })
    expect(appStore.mcp).toEqual({ current: { status: "connected" } })
  })

  test("loadSkillMarket skips stale directory commits while returning the response", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeExtensionLoadTransport(requests))
    configure({ directory: "D:/repo/current" })
    setSkillMarket([{ id: "current-market", name: "Current Market" }])

    const result = await loadSkillMarket({
      directory: "D:/repo/stale",
      isCurrentDirectory: (directory) => directory === "D:/repo/current",
    })

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET skill/market"])
    expect(requests[0]?.query?.directory).toBe("D:/repo/stale")
    expect(result.map((item) => item.id)).toEqual(["stale-market"])
    expect(appStore.skillMarket.map((item) => item.id)).toEqual(["current-market"])
  })

  test("loadInstalledSkills skips stale directory commits while returning the response", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeSkillMutationTransport(requests))
    configure({ directory: "D:/repo/current" })
    setSkills([{ name: "current-skill" }])

    const result = await loadInstalledSkills({
      directory: "D:/repo/stale",
      isCurrentDirectory: (directory) => directory === "D:/repo/current",
    })

    expect(requests.map((item) => `${item.method ?? "GET"} ${item.path}`)).toEqual(["GET skill/installed"])
    expect(requests[0]?.query?.directory).toBe("D:/repo/stale")
    expect(result.map((item) => item.name)).toEqual(["owned-skill"])
    expect(appStore.skills.map((item) => item.name)).toEqual(["current-skill"])
  })

  test("skill mutation helpers use the explicit action directory", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeSkillMutationTransport(requests))
    configure({ directory: "D:/repo/active-after-confirm" })

    await installSkill("git", "https://example.invalid/skill.git", "allow", { directory: PROJECT_DIR })
    await importSkillFile("SKILL.md", "# Skill", "ask", { directory: PROJECT_DIR })
    await removeSkillSource("D:/skills/old", "path", { directory: PROJECT_DIR })

    expect(requests.map((item) => [item.method, item.path, item.query?.directory])).toEqual([
      ["POST", "skill/install", PROJECT_DIR],
      ["POST", "skill/import-file", PROJECT_DIR],
      ["POST", "skill/remove", PROJECT_DIR],
    ])
  })

  test("deleteAllSkills uses the captured list and directory", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeSkillMutationTransport(requests))
    configure({ directory: "D:/repo/active-after-confirm" })
    setSkills([
      {
        name: "current-active-project-skill",
        source: "D:/skills/current-active",
        source_type: "config_path",
        builtin: false,
      },
    ])

    await deleteAllSkills({
      directory: PROJECT_DIR,
      skills: [
        {
          name: "confirmed-skill",
          source: "D:/skills/confirmed",
          source_type: "config_path",
          builtin: false,
        },
      ],
    })

    expect(requests.map((item) => [item.method, item.path, item.query?.directory])).toEqual([
      ["POST", "skill/remove", PROJECT_DIR],
      ["GET", "skill/installed", PROJECT_DIR],
    ])
    expect(requests[0]?.body).toEqual({
      kind: "json",
      value: { source: "D:/skills/confirmed", kind: "path" },
    })
    expect(appStore.skills.map((item) => item.name)).toEqual(["owned-skill"])
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
