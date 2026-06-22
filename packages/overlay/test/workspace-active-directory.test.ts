import { afterEach, describe, expect, test } from "bun:test"
import { boardStore, setBoardStore } from "../src/store/board"
import { setSettingsStore } from "../src/store/settings"
import { appStore, setAppStore } from "../src/store/app"
import { apiUrl, configure } from "../src/services/api"
import { activeDirectory, applyDirectory, closeProject, pickDirectory, pickFiles } from "../src/services/workspace"
import { startTaskListSSE, stopTaskListSSE } from "../src/services/sse"
import { __setHostTransportForTest, HOST_CAPABILITIES, type HostTransport } from "../src/services/host-transport"
import { activeTaskID } from "../src/store/board"

describe("workspace active directory", () => {
  afterEach(() => {
    stopTaskListSSE()
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setBoardStore({
      board: null,
      tasks: [],
      selectedSource: null,
      pendingTasks: [],
      path: null,
      vcs: null,
      changes: [],
      boardEtag: "",
      snapshotVersion: "",
    })
    setSettingsStore({
      directory: "",
      savedDirectory: "",
      workspaceTaskID: "",
      workspaceDirectory: "",
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

  test("uses selected task directory when settings directory is empty", () => {
    setSettingsStore("directory", "")
    setBoardStore("board", {
      task: {
        id: "task_1",
        directory: "D:/repo/from-task",
      },
    })

    expect(activeDirectory()).toBe("D:/repo/from-task")
  })

  test("selected task directory owns project-scoped controls over stale settings", () => {
    setSettingsStore("directory", "D:/repo/from-settings")
    setBoardStore("board", {
      task: {
        id: "task_2",
        directory: "D:/repo/from-task",
      },
    })

    expect(activeDirectory()).toBe("D:/repo/from-task")
  })

  test("closeProject clears selected directory and project-scoped projections", () => {
    const nativeCommands: unknown[] = []
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      request: async () => ({ status: 200, ok: true, headers: {}, body: null }),
      openStream: () => ({ close: () => undefined }),
      native: async (command) => {
        nativeCommands.push(command)
        return true
      },
      subscribeUiCommand: () => ({ unsubscribe: () => undefined }),
    } satisfies HostTransport)

    setSettingsStore({
      directory: "D:/repo/current",
      savedDirectory: "D:/repo/current",
      workspaceTaskID: "task_1",
      workspaceDirectory: "D:/repo/current",
    })
    setBoardStore({
      selectedSource: { kind: "task", id: "task_1" },
      board: { task: { id: "task_1", directory: "D:/repo/current" } },
      tasks: [{ task: { id: "task_1" } }],
      pendingTasks: [{ id: "pending_1" }],
      path: { directory: "D:/repo/current" },
      vcs: { branch: "main" },
      changes: [{ file: "src/app.ts" }],
      boardEtag: "etag-current",
      snapshotVersion: "snapshot-current",
    })
    setAppStore({
      config: { model: "provider/model" },
      executors: [{ id: "codex" }],
      providerCatalog: { all: [] },
      providerAuth: { openai: true },
      channels: [{ id: "slack" }],
      skills: [{ name: "skill" }],
      mcp: { local: {} },
      memoryFiles: [{ path: "memory.md" }],
      promptEntries: [{ key: "core" }],
    })

    closeProject()

    expect(activeDirectory()).toBe("")
    expect(boardStore.selectedSource).toBeNull()
    expect(activeTaskID()).toBe("")
    expect(boardStore.board).toBeNull()
    expect(boardStore.tasks).toEqual([])
    expect(boardStore.pendingTasks).toEqual([])
    expect(boardStore.path).toBeNull()
    expect(boardStore.vcs).toBeNull()
    expect(boardStore.changes).toEqual([])
    expect(boardStore.boardEtag).toBe("")
    expect(boardStore.snapshotVersion).toBe("")
    expect(appStore.config).toBeNull()
    expect(appStore.executors).toEqual([])
    expect(appStore.providerCatalog).toBeNull()
    expect(appStore.providerAuth).toBeNull()
    expect(appStore.channels).toEqual([])
    expect(appStore.skills).toEqual([])
    expect(appStore.mcp).toEqual({})
    expect(appStore.memoryFiles).toEqual([])
    expect(appStore.promptEntries).toEqual([])
    expect(new URL(apiUrl("tasks")).searchParams.has("directory")).toBe(false)
    expect(nativeCommands).toContainEqual({
      kind: "settings.save",
      payload: expect.objectContaining({ directory: undefined }),
    })
  })

  test("closeProject stops the task-list SSE stream bound to the old directory", () => {
    let openCalls = 0
    let closeCalls = 0
    let streamDirectory = ""
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      request: async () => ({ status: 200, ok: true, headers: {}, body: null }),
      openStream: (input) => {
        openCalls += 1
        streamDirectory = String(input.query?.directory ?? "")
        return {
          close: () => {
            closeCalls += 1
          },
        }
      },
      native: async () => true,
      subscribeUiCommand: () => ({ unsubscribe: () => undefined }),
    } satisfies HostTransport)

    setSettingsStore("directory", "D:/repo/current")

    startTaskListSSE()
    expect(openCalls).toBe(1)
    expect(streamDirectory).toBe("D:/repo/current")
    expect(closeCalls).toBe(0)

    closeProject()

    expect(closeCalls).toBe(1)
  })

  test("manual applyDirectory clears selected task state before reloading the new project", async () => {
    const requests: string[] = []
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      async request(req) {
        requests.push(`${req.method ?? "GET"} ${req.path} ${String(req.query?.directory ?? "")}`)
        if (req.path === "global/health") {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: { paths: { database: "db.sqlite", data: "data", home: "home" } },
          }
        }
        if (req.path === "config") return { status: 200, ok: true, headers: {}, body: { model: "" } }
        if (req.path === "channel") return { status: 200, ok: true, headers: {}, body: [] }
        if (req.path === "skill/installed") return { status: 200, ok: true, headers: {}, body: [] }
        if (req.path === "mcp") return { status: 200, ok: true, headers: {}, body: {} }
        if (req.path === "path") {
          return { status: 200, ok: true, headers: {}, body: { directory: "D:/repo/next" } }
        }
        if (req.path === "vcs") return { status: 200, ok: true, headers: {}, body: { branch: "main" } }
        if (req.path === "global/tasks") return { status: 200, ok: true, headers: {}, body: { tasks: [] } }
        if (req.path === "executor") return { status: 200, ok: true, headers: {}, body: [] }
        return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
      },
      openStream() {
        return { close: () => undefined }
      },
      async native() {
        return true
      },
      subscribeUiCommand() {
        return { unsubscribe: () => undefined }
      },
    } satisfies HostTransport)

    setSettingsStore({
      directory: "D:/repo/current",
      savedDirectory: "D:/repo/current",
      workspaceTaskID: "tsk_current",
      workspaceDirectory: "D:/repo/current",
      directoryEpoch: 0,
    })
    configure({ directory: "D:/repo/current" })
    setBoardStore({
      selectedSource: { kind: "task", id: "tsk_current", directory: "D:/repo/current" },
      board: {
        snapshotVersion: "board:current",
        task: {
          id: "tsk_current",
          directory: "D:/repo/current",
          time: { created: 1, updated: 1 },
        },
      },
      tasks: [{ task: { id: "tsk_current", directory: "D:/repo/current", time: { created: 1, updated: 1 } } }],
      taskSwitching: true,
    })

    await applyDirectory("D:/repo/next", { persist: false, save: false, restoreWorkspace: false })

    expect(activeTaskID()).toBe("")
    expect(boardStore.selectedSource).toBeNull()
    expect(boardStore.board).toBeNull()
    expect(boardStore.taskSwitching).toBe(false)
    expect(boardStore.tasks).toEqual([])
    expect(activeDirectory()).toBe("D:/repo/next")
    expect(requests).toContain("GET config D:/repo/next")
    expect(requests).toContain("GET path D:/repo/next")
    expect(requests).toContain("GET executor D:/repo/next")
    expect(requests).toContain("GET global/tasks ")
  })

  test("native pickers preserve cancel but reject malformed host payloads", async () => {
    const nativeResponses: unknown[] = [null, "D:/picked", undefined, ["D:/a", "D:/b"], { path: "D:/bad" }, ["D:/ok", 123]]
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      request: async () => ({ status: 200, ok: true, headers: {}, body: null }),
      openStream: () => ({ close: () => undefined }),
      native: async () => nativeResponses.shift(),
      subscribeUiCommand: () => ({ unsubscribe: () => undefined }),
    } satisfies HostTransport)

    await expect(pickDirectory()).resolves.toBe("")
    await expect(pickDirectory()).resolves.toBe("D:/picked")
    await expect(pickFiles()).resolves.toEqual([])
    await expect(pickFiles()).resolves.toEqual(["D:/a", "D:/b"])
    await expect(pickDirectory()).rejects.toThrow("workspace.pickDir returned a non-string payload")
    await expect(pickFiles()).rejects.toThrow("workspace.pickFiles returned a non-string-array payload")
  })
})
