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

    await reloadProjectScope({ restoreWorkspace: false })

    const scoped = requests.filter((req) =>
      ["config", "channel", "skill/installed", "mcp", "path", "vcs", "executor"].includes(req.path),
    )
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((req) => req.query?.directory === "D:/repo/from-task")).toBe(true)
    expect(appStore.skills).toEqual([{ name: "task-skill", builtin: false }])
    expect(appStore.mcp).toEqual({ docs: { status: "connected" } })
  })

  test("syncActiveDirectoryApiContext retargets direct panel requests to the task directory", () => {
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

    expect(syncActiveDirectoryApiContext()).toBe("D:/repo/from-task")
    expect(new URL(apiUrl("panel/knowledge/memory?taskID=task_1")).searchParams.get("directory")).toBe(
      "D:/repo/from-task",
    )
  })
})
