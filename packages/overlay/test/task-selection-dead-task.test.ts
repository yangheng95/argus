import { beforeEach, describe, expect, mock, test } from "bun:test"

const hydrateCalls: Array<{ taskID: string; options: any }> = []
const startedStreams: Array<{ kind: string; id: string; sequence: number }> = []
let stoppedStreams = 0
const DEFAULT_TEST_DIRECTORY = "D:/repo/current"

function orderKey(domain: "message" | "part", time: number, id: string): string {
  const rank = domain === "message" ? 30 : 31
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

mock.module("../src/services/conversation", () => ({
  cancelConversationReplay: () => undefined,
  conversationSourceDirectory: () => "",
  hydrateTaskConversation: async (taskID: string, options: any) => {
    hydrateCalls.push({ taskID, options })
    return 0
  },
}))

mock.module("../src/services/sse", () => ({
  isSelectedTaskSSEConnected: () => false,
  startSSE: (source: { kind: string; id: string }, sequence: number) => {
    startedStreams.push({ ...source, sequence })
  },
  startTaskListSSE: () => undefined,
  stopSSE: () => {
    stoppedStreams += 1
  },
  stopTaskListSSE: () => undefined,
}))

const { deleteTask, selectTask } = await import("../src/services/task")
const { activeTaskID, boardStore, setBoardStore } = await import("../src/store/board")
const { __setHostTransportForTest, HOST_CAPABILITIES } = await import("../src/services/host-transport")
const { setSettingsStore } = await import("../src/store/settings")
const { configure } = await import("../src/services/api")
const { taskOwningDirectory } = await import("../src/services/task-directory")
const { setMessages, setSelectedTaskID, messageStore } = await import("../src/store/messages")
const { cardTreeStore, setCardTreeStore } = await import("../src/store/card-tree")
const { resetWriter } = await import("../src/services/tree-writer")

beforeEach(() => {
  hydrateCalls.length = 0
  startedStreams.length = 0
  stoppedStreams = 0
  setBoardStore("board", null as any)
  setBoardStore("tasks", [])
  setBoardStore("pendingTasks", [])
  setBoardStore("selectedSource", null)
  setBoardStore("taskSwitching", false)
  setBoardStore("selectEpoch", 0)
  setMessages([])
  setSelectedTaskID("")
  resetWriter()
  setSettingsStore({
    directory: DEFAULT_TEST_DIRECTORY,
    savedDirectory: DEFAULT_TEST_DIRECTORY,
    workspaceTaskID: "",
    workspaceDirectory: "",
    directoryEpoch: 0,
    autoServer: false,
  })
  configure({ directory: DEFAULT_TEST_DIRECTORY })
  __setHostTransportForTest(undefined)
})

describe("task selection initial hydrate", () => {
  test("task selection hydrates with a small initial tail", async () => {
    setBoardStore("tasks", [
      {
        task: { id: "tsk_dead", status: "cancelled", directory: DEFAULT_TEST_DIRECTORY },
        pending_interactions: 0,
      },
    ])

    await selectTask("tsk_dead")

    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0].taskID).toBe("tsk_dead")
    expect(hydrateCalls[0].options.tailLimit).toBe(8)
    expect(activeTaskID()).toBe("tsk_dead")
  })

  test("active tasks use the same bounded initial hydrate and still start SSE", async () => {
    setBoardStore("tasks", [
      {
        task: { id: "tsk_live", status: "active", directory: DEFAULT_TEST_DIRECTORY },
        pending_interactions: 0,
      },
    ])

    await selectTask("tsk_live")

    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0].options.tailLimit).toBe(8)
    expect(startedStreams).toEqual([{ kind: "task", id: "tsk_live", sequence: 0 }])
  })

  test("cross-directory task selection preserves the clicked task owning directory while project data reloads", async () => {
    const currentDirectory = "D:/repo/current"
    const nextDirectory = "D:/repo/next"
    setSettingsStore({
      directory: currentDirectory,
      savedDirectory: currentDirectory,
      directoryEpoch: 0,
    })
    configure({ directory: currentDirectory })
    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_cross",
          status: "active",
          directory: nextDirectory,
          time: { created: 1, updated: 1 },
        },
        pending_interactions: 0,
      },
    ])
    __setHostTransportForTest({
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      async request(req: any) {
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
        if (req.path === "skill/mounts")
          return {
            status: 200,
            ok: true,
            headers: {},
            body: { scope: "project", skills: [], agents: [], source: nextDirectory },
          }
        if (req.path === "mcp") return { status: 200, ok: true, headers: {}, body: {} }
        if (req.path === "path") return { status: 200, ok: true, headers: {}, body: { directory: nextDirectory } }
        if (req.path === "vcs") return { status: 200, ok: true, headers: {}, body: { branch: "main" } }
        if (req.path === "global/tasks") return { status: 200, ok: true, headers: {}, body: { tasks: [] } }
        if (req.path === "executor") return { status: 200, ok: true, headers: {}, body: [] }
        return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
      },
      openStream() {
        return { close() {} }
      },
      async native(input: unknown) {
        const kind = (input as { kind?: string }).kind
        if (kind === "settings.save" || kind === "badge.set" || kind === "tray.attention.set") return true
        throw new Error(`unexpected native call: ${JSON.stringify(input)}`)
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } as any)

    await selectTask("tsk_cross")

    expect(activeTaskID()).toBe("tsk_cross")
    expect(boardStore.selectedSource).toEqual({ kind: "task", id: "tsk_cross", directory: nextDirectory })
    expect(taskOwningDirectory("tsk_cross")).toBe(nextDirectory)
    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0].options.directory).toBe(nextDirectory)
  })

  test("deselect advances the selection epoch so stale task loads cannot win", async () => {
    setBoardStore("selectEpoch", 41)
    setBoardStore("selectedSource", { kind: "task", id: "tsk_old" })

    await selectTask("")

    expect(boardStore.selectEpoch).toBe(42)
    expect(activeTaskID()).toBe("")
    expect(boardStore.taskSwitching).toBe(false)
    expect(stoppedStreams).toBe(1)
  })

  test("deselect clears a selected Mission session instead of treating it as an empty task", async () => {
    setBoardStore("selectEpoch", 7)
    setBoardStore("selectedSource", { kind: "session", id: "ses_mission" })
    setBoardStore("board", { title: "Mission session", snapshotVersion: "session-v1" } as any)

    await selectTask("")

    expect(boardStore.selectEpoch).toBe(8)
    expect(boardStore.selectedSource).toBeNull()
    expect(boardStore.board).toBeNull()
    expect(boardStore.taskSwitching).toBe(false)
    expect(stoppedStreams).toBe(1)
  })

  test("deselect clears stale message panel projections even when no source is selected", async () => {
    setMessages([
      {
        info: {
          id: "msg_stale",
          sessionID: "ses_stale",
          role: "assistant",
          channel: "assistant",
          resolvedRole: "assistant",
          orderKey: orderKey("message", 1, "msg_stale"),
          time: { created: 1 },
        },
        parts: [
          {
            id: "part_stale",
            messageID: "msg_stale",
            sessionID: "ses_stale",
            type: "text",
            text: "old response",
            orderKey: orderKey("part", 2, "part_stale"),
          },
        ],
      },
    ])
    setCardTreeStore("order", ["card_stale"])
    setCardTreeStore("cards", "card_stale", {
      id: "card_stale",
      title: "Old response",
      parts: [{ id: "part_stale", type: "text", text: "old response" }],
      childIDs: [],
    } as any)
    setBoardStore({
      selectedSource: null,
      board: null,
      taskSwitching: false,
    })

    await selectTask("")

    expect(messageStore.messages).toEqual([])
    expect(messageStore.messagesBySession).toEqual({})
    expect(cardTreeStore.order).toEqual([])
    expect(Object.keys(cardTreeStore.cards)).toEqual([])
    expect(boardStore.selectEpoch).toBe(1)
    expect(stoppedStreams).toBe(1)
  })

  test("deleting the selected task clears selection before the delete response", async () => {
    setBoardStore("tasks", [
      {
        task: { id: "tsk_deleted", status: "cancelled", directory: DEFAULT_TEST_DIRECTORY },
        pending_interactions: 0,
      },
    ])
    setBoardStore("selectedSource", { kind: "task", id: "tsk_deleted" })
    let requested = false
    const nativeCalls: unknown[] = []
    __setHostTransportForTest({
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      async request(req: any) {
        requested = true
        if (req.method === "DELETE" && req.path === "task/tsk_deleted") {
          expect(req.query?.directory).toBeUndefined()
          expect(activeTaskID()).toBe("")
          return { status: 404, ok: false, headers: {}, body: { error: "missing" } }
        }
        if (req.method === "GET" && req.path === "global/tasks") {
          return { status: 200, ok: true, headers: {}, body: { tasks: [] } }
        }
        return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
      },
      openStream() {
        throw new Error("openStream not used")
      },
      async native(input: unknown) {
        nativeCalls.push(input)
        if ((input as { kind?: string }).kind === "settings.save") return true
        throw new Error(`unexpected native call: ${JSON.stringify(input)}`)
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } as any)

    await expect(deleteTask("tsk_deleted")).resolves.toBe(true)

    expect(requested).toBe(true)
    expect(activeTaskID()).toBe("")
    const settingsSave = nativeCalls.find((input) => (input as { kind?: string }).kind === "settings.save")
    expect(settingsSave).toEqual(
      expect.objectContaining({
        kind: "settings.save",
        payload: expect.objectContaining({
          workspaceTaskID: undefined,
          workspaceDirectory: undefined,
        }),
      }),
    )
  })

  test("deleting a missing selected task surfaces task-list refresh failures", async () => {
    setBoardStore("tasks", [
      {
        task: { id: "tsk_refresh_fail", status: "cancelled", directory: DEFAULT_TEST_DIRECTORY },
        pending_interactions: 0,
      },
    ])
    setBoardStore("selectedSource", { kind: "task", id: "tsk_refresh_fail" })
    const requests: string[] = []
    __setHostTransportForTest({
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      async request(req: any) {
        requests.push(`${req.method} ${req.path}`)
        if (req.method === "DELETE" && req.path === "task/tsk_refresh_fail") {
          expect(req.query?.directory).toBeUndefined()
          expect(activeTaskID()).toBe("")
          return { status: 404, ok: false, headers: {}, body: { error: "missing" } }
        }
        if (req.method === "GET" && req.path === "global/tasks") {
          return { status: 503, ok: false, headers: {}, body: { error: "task list unavailable" } }
        }
        return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
      },
      openStream() {
        throw new Error("openStream not used")
      },
      async native(input: unknown) {
        const kind = (input as { kind?: string }).kind
        if (kind === "settings.save" || kind === "badge.set" || kind === "tray.attention.set") return true
        throw new Error(`unexpected native call: ${JSON.stringify(input)}`)
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } as any)

    await expect(deleteTask("tsk_refresh_fail")).rejects.toThrow("task list unavailable")

    expect(requests).toEqual(["DELETE task/tsk_refresh_fail", "GET global/tasks"])
    expect(activeTaskID()).toBe("")
  })

  test("deleteTask rejects backend failures for visible caller error handling", async () => {
    __setHostTransportForTest({
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      async request(req: any) {
        if (req.method === "DELETE" && req.path === "task/tsk_delete_500") {
          return { status: 500, ok: false, headers: {}, body: { error: "delete unavailable" } }
        }
        return { status: 404, ok: false, headers: {}, body: { error: `unhandled ${req.path}` } }
      },
      openStream() {
        throw new Error("openStream not used")
      },
      async native(input: unknown) {
        throw new Error(`unexpected native call: ${JSON.stringify(input)}`)
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } as any)

    await expect(deleteTask("tsk_delete_500")).rejects.toThrow("API 500")
  })
})
