import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { apiUrl, configure } from "../src/services/api"
import { HOST_CAPABILITIES, __setHostTransportForTest, type HostTransport } from "../src/services/host-transport"
import { resetWriter } from "../src/services/tree-writer"
import { boardStore, setBoardStore } from "../src/store/board"
import { cardTreeStore, setCardTreeStore } from "../src/store/card-tree"
import { setSettingsStore } from "../src/store/settings"
import { stopSSE, stopTaskListSSE } from "../src/services/sse"

mock.module("../src/services/conversation", () => ({
  cancelConversationReplay: () => undefined,
  hydrateTaskConversation: async () => 0,
}))

const { restoreInitialTaskSelection, restoreInitialWorkspace } = await import("../src/services/init")

function fakeTransport(): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request() {
      return { status: 200, ok: true, headers: {}, body: null }
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

describe("initial workspace restore directory sync", () => {
  beforeEach(() => {
    __setHostTransportForTest(fakeTransport())
    configure({
      serverUrl: "http://127.0.0.1:7878",
      directory: "D:/projects/old",
    })
    setSettingsStore({
      directory: "D:/projects/old",
      savedDirectory: "D:/projects/old",
      workspaceDirectory: "D:/projects/new",
      workspaceTaskID: "tsk_saved",
      workspaceEpoch: 0,
      directoryEpoch: 0,
    })
    setBoardStore({
      board: null,
      tasks: [
        {
          task: {
            id: "tsk_saved",
            status: "active",
            directory: "D:/projects/new",
            time: { created: 1, updated: 1 },
          },
          pending_interactions: 0,
        },
      ],
      pendingTasks: [],
      selectedSource: null,
      taskSwitching: false,
      selectEpoch: 0,
    })
  })

  afterEach(() => {
    stopSSE()
    stopTaskListSSE()
    __setHostTransportForTest(undefined)
    configure({ directory: "" })
    setSettingsStore({
      directory: "",
      savedDirectory: "",
      workspaceDirectory: "",
      workspaceTaskID: "",
      workspaceEpoch: 0,
      directoryEpoch: 0,
    })
    setBoardStore({
      board: null,
      tasks: [],
      pendingTasks: [],
      selectedSource: null,
      taskSwitching: false,
      selectEpoch: 0,
    })
    resetWriter()
  })

  test("retargets the API client before selecting a restored cross-project task", async () => {
    await expect(restoreInitialWorkspace()).resolves.toBe(true)

    expect(boardStore.selectedSource).toEqual({ kind: "task", id: "tsk_saved", directory: "D:/projects/new" })
    expect(new URL(apiUrl("agent")).searchParams.get("directory")).toBe("D:/projects/new")
  })

  test("selects a URL task deep link before persisted workspace restore", async () => {
    setSettingsStore({
      workspaceDirectory: "D:/projects/new",
      workspaceTaskID: "tsk_saved",
    })
    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_saved",
          status: "active",
          directory: "D:/projects/new",
          time: { created: 1, updated: 1 },
        },
        pending_interactions: 0,
      },
      {
        task: {
          id: "tsk_linked",
          status: "completed",
          directory: "D:/projects/old",
          time: { created: 2, updated: 2 },
        },
        pending_interactions: 0,
      },
    ])

    await expect(restoreInitialTaskSelection({ search: "?taskID=tsk_linked" })).resolves.toBe(true)

    expect(boardStore.selectedSource).toEqual({ kind: "task", id: "tsk_linked", directory: "D:/projects/old" })
    expect(new URL(apiUrl("agent")).searchParams.get("directory")).toBe("D:/projects/old")
  })

  test("rejects URL directory task deep links without selecting a saved task", async () => {
    await expect(
      restoreInitialTaskSelection({ search: "?taskID=tsk_saved&directory=D%3A%2Fprojects%2Fnew" }),
    ).rejects.toThrow('Unsupported task deep link parameter "directory"')

    expect(boardStore.selectedSource).toBeNull()
    expect(boardStore.board).toBeNull()
  })

  test("uses persisted workspace restore when the URL has no task deep link", async () => {
    await expect(restoreInitialTaskSelection({ search: "?theme=dark" })).resolves.toBe(true)

    expect(boardStore.selectedSource).toEqual({ kind: "task", id: "tsk_saved", directory: "D:/projects/new" })
  })

  test("clears stale conversation cards when the saved task was deleted", async () => {
    setSettingsStore({
      workspaceDirectory: "D:/projects/old",
      workspaceTaskID: "tsk_deleted",
    })
    setBoardStore({
      selectedSource: { kind: "task", id: "tsk_deleted" },
      board: {
        task: {
          id: "tsk_deleted",
          status: "active",
          directory: "D:/projects/old",
        },
        snapshotVersion: "stale",
      },
      tasks: [
        {
          task: {
            id: "tsk_existing",
            status: "completed",
            directory: "D:/projects/old",
          },
          pending_interactions: 0,
        },
      ],
    })
    setCardTreeStore("cards", {
      stale: {
        id: "stale",
        kind: "agent",
        stage: "architect",
        title: "Deleted session card",
        status: "idle",
        parts: [],
        childIDs: [],
      } as any,
    })
    setCardTreeStore("order", ["stale"])

    await expect(restoreInitialWorkspace()).resolves.toBe(false)

    expect(boardStore.selectedSource).toBeNull()
    expect(boardStore.board).toBeNull()
    expect(cardTreeStore.order).toEqual([])
  })

  test("does not clear an active standalone session when no task is restorable", async () => {
    setSettingsStore({
      workspaceDirectory: "",
      workspaceTaskID: "",
    })
    setBoardStore({
      selectedSource: { kind: "session", id: "ses_mission" },
      board: {
        kind: "session",
        sessionID: "ses_mission",
        title: "Mission",
      },
      tasks: [
        {
          task: {
            id: "tsk_done",
            status: "completed",
            directory: "D:/projects/old",
          },
          pending_interactions: 0,
        },
      ],
    })
    setCardTreeStore("cards", {
      sessionCard: {
        id: "sessionCard",
        kind: "agent",
        stage: "mission",
        title: "Mission card",
        status: "idle",
        parts: [],
        childIDs: [],
      } as any,
    })
    setCardTreeStore("order", ["sessionCard"])

    await expect(restoreInitialWorkspace()).resolves.toBe(false)

    expect(boardStore.selectedSource).toEqual({ kind: "session", id: "ses_mission" })
    expect(boardStore.board?.sessionID).toBe("ses_mission")
    expect(cardTreeStore.order).toEqual(["sessionCard"])
  })

  test("does not overwrite an active standalone session with a restorable running task", async () => {
    setBoardStore({
      selectedSource: { kind: "session", id: "ses_assistant" },
      board: {
        kind: "session",
        sessionID: "ses_assistant",
        title: "Assistant",
      },
      tasks: [
        {
          task: {
            id: "tsk_saved",
            status: "active",
            directory: "D:/projects/new",
          },
          pending_interactions: 0,
        },
      ],
    })
    setCardTreeStore("cards", {
      assistantCard: {
        id: "assistantCard",
        kind: "agent",
        stage: "assistant",
        title: "Assistant card",
        status: "idle",
        parts: [],
        childIDs: [],
      } as any,
    })
    setCardTreeStore("order", ["assistantCard"])

    await expect(restoreInitialWorkspace()).resolves.toBe(false)

    expect(boardStore.selectedSource).toEqual({ kind: "session", id: "ses_assistant" })
    expect(boardStore.board?.sessionID).toBe("ses_assistant")
    expect(cardTreeStore.order).toEqual(["assistantCard"])
  })
})
