import { afterEach, describe, expect, test } from "bun:test"
import { appStore, setAppStore } from "../src/store/app"
import { boardStore, setBoardStore } from "../src/store/board"
import { setSettingsStore } from "../src/store/settings"
import { apiUrl, configure } from "../src/services/api"
import { reloadProjectScope } from "../src/services/config"
import { syncActiveDirectoryApiContext } from "../src/services/workspace"
import {
  __setHostTransportForTest,
  HOST_CAPABILITIES,
  type HostTransport,
  type TransportRequest,
} from "../src/services/host-transport"

function fakeTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "browser",
    capabilities: HOST_CAPABILITIES.browser,
    async request(req) {
      requests.push(req)
      if (req.path === "config") return { status: 200, ok: true, headers: {}, body: { model: "" } }
      if (req.path === "channel") return { status: 200, ok: true, headers: {}, body: [] }
      if (req.path === "skill/installed") {
        return { status: 200, ok: true, headers: {}, body: [{ name: "task-skill", builtin: false }] }
      }
      if (req.path === "mcp") return { status: 200, ok: true, headers: {}, body: { docs: { status: "connected" } } }
      if (req.path === "path") return { status: 200, ok: true, headers: {}, body: { directory: "D:/repo/from-task" } }
      if (req.path === "vcs") return { status: 200, ok: true, headers: {}, body: { branch: "main", dirty: false } }
      if (req.path === "global/tasks") return { status: 200, ok: true, headers: {}, body: { tasks: [] } }
      if (req.path === "executor") return { status: 200, ok: true, headers: {}, body: [] }
      return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
    },
    openStream() {
      return { close() {} }
    },
    async native() {
      return true
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  } satisfies HostTransport
}

function fakeTransportFailing(requests: TransportRequest[], failingPath: string, message: string): HostTransport {
  const base = fakeTransport(requests)
  return {
    ...base,
    async request(req) {
      if (req.path === failingPath) {
        requests.push(req)
        return { status: 503, ok: false, headers: {}, body: { error: message } }
      }
      return base.request(req)
    },
  } satisfies HostTransport
}

function selectTaskDirectory(): void {
  configure({ directory: "" })
  setSettingsStore("directory", "")
  setBoardStore("board", {
    snapshotVersion: "snapshot-task-dir",
    task: {
      id: "task_1",
      directory: "D:/repo/from-task",
      time: { created: 1, updated: 1 },
    },
    goalWorkflows: [],
    interactions: [],
  })
}

describe("task directory project-scope reload", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setSettingsStore({
      directory: "",
      savedDirectory: "",
      workspaceTaskID: "",
      workspaceDirectory: "",
      directoryEpoch: 0,
    })
    setBoardStore({
      board: null,
      tasks: [],
      pendingTasks: [],
      selectedSource: null,
      path: null,
      vcs: null,
      changes: [],
      taskSequence: 0,
      boardEtag: "",
      snapshotVersion: "",
      tasksError: "",
    })
    setAppStore({
      config: null,
      executors: [],
      providerCatalog: null,
      providerAuth: null,
      configLoadErrors: {},
      channels: [],
      skills: [],
      mcp: {},
      memoryFiles: [],
      promptEntries: [],
    })
  })

  test("reloadProjectScope uses selected task directory when settings directory is empty", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransport(requests))
    selectTaskDirectory()

    await reloadProjectScope({ restoreWorkspace: false })

    const scoped = requests.filter((req) =>
      ["config", "channel", "skill/installed", "mcp", "path", "vcs", "executor"].includes(req.path),
    )
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((req) => req.query?.directory === "D:/repo/from-task")).toBe(true)
    expect(appStore.skills).toEqual([{ name: "task-skill", builtin: false }])
    expect(appStore.mcp.docs).toEqual({ status: "connected" })
  })

  test("reloadProjectScope rejects extension reload failures instead of preserving stale projections silently", async () => {
    const requests: TransportRequest[] = []
    __setHostTransportForTest(fakeTransportFailing(requests, "skill/installed", "skill inventory unavailable"))
    selectTaskDirectory()
    setAppStore("skills", [{ name: "stale-skill", builtin: false }])

    await expect(reloadProjectScope({ restoreWorkspace: false })).rejects.toThrow("skill inventory unavailable")

    expect(appStore.skills).toEqual([{ name: "stale-skill", builtin: false }])
  })

  for (const failingPath of ["config", "channel", "path", "vcs", "executor"] as const) {
    test(`reloadProjectScope rejects ${failingPath} reload failures instead of rewriting stale projections`, async () => {
      const requests: TransportRequest[] = []
      __setHostTransportForTest(fakeTransportFailing(requests, failingPath, `${failingPath} unavailable`))
      selectTaskDirectory()
      setAppStore({
        config: { model: "stale-model" },
        channels: [{ id: "stale-channel" }],
        executors: [{ id: "stale-executor" }],
      })
      setBoardStore({
        path: { directory: "D:/repo/stale" },
        vcs: { branch: "stale" },
      })

      await expect(reloadProjectScope({ restoreWorkspace: false })).rejects.toThrow(`${failingPath} unavailable`)

      if (failingPath === "config") {
        expect(appStore.config?.model).toBe("stale-model")
        expect(appStore.configLoadErrors.config).toContain("config unavailable")
      }
      if (failingPath === "channel") expect(appStore.channels).toEqual([{ id: "stale-channel" }])
      if (failingPath === "path") expect(boardStore.path).toEqual({ directory: "D:/repo/stale" })
      if (failingPath === "vcs") expect(boardStore.vcs).toEqual({ branch: "stale" })
      if (failingPath === "executor") expect(appStore.executors).toEqual([{ id: "stale-executor" }])
    })
  }

  test("syncActiveDirectoryApiContext retargets direct panel requests to the task directory", () => {
    selectTaskDirectory()

    expect(syncActiveDirectoryApiContext()).toBe("D:/repo/from-task")
    expect(new URL(apiUrl("panel/knowledge/memory?taskID=task_1")).searchParams.get("directory")).toBe(
      "D:/repo/from-task",
    )
  })
})
