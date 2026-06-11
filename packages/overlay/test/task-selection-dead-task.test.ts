import { beforeEach, describe, expect, mock, test } from "bun:test"

const hydrateCalls: Array<{ taskID: string; options: any }> = []
const startedStreams: Array<{ kind: string; id: string; sequence: number }> = []
let stoppedStreams = 0

mock.module("../src/services/conversation", () => ({
  cancelConversationReplay: () => undefined,
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
const { __setHostTransportForTest } = await import("../src/services/host-transport")

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
  __setHostTransportForTest(undefined)
})

describe("task selection initial hydrate", () => {
  test("task selection hydrates with a small initial tail", async () => {
    setBoardStore("tasks", [{ task: { id: "tsk_dead", status: "cancelled", directory: "" }, pending_interactions: 0 }])

    await selectTask("tsk_dead")

    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0].taskID).toBe("tsk_dead")
    expect(hydrateCalls[0].options.tailLimit).toBe(8)
    expect(activeTaskID()).toBe("tsk_dead")
  })

  test("active tasks use the same bounded initial hydrate and still start SSE", async () => {
    setBoardStore("tasks", [{ task: { id: "tsk_live", status: "active", directory: "" }, pending_interactions: 0 }])

    await selectTask("tsk_live")

    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0].options.tailLimit).toBe(8)
    expect(startedStreams).toEqual([{ kind: "task", id: "tsk_live", sequence: 0 }])
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

  test("deleting the selected task clears selection before the delete response", async () => {
    setBoardStore("tasks", [
      { task: { id: "tsk_deleted", status: "cancelled", directory: "" }, pending_interactions: 0 },
    ])
    setBoardStore("selectedSource", { kind: "task", id: "tsk_deleted" })
    let requested = false
    __setHostTransportForTest({
      kind: "tauri",
      async request() {
        requested = true
        expect(activeTaskID()).toBe("")
        return { status: 404, ok: false, headers: {}, body: { error: "missing" } }
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
    } as any)

    await expect(deleteTask("tsk_deleted")).resolves.toBe(true)

    expect(requested).toBe(true)
    expect(activeTaskID()).toBe("")
  })
})
