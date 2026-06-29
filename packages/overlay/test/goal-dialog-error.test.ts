import { afterEach, beforeEach, expect, test } from "bun:test"
import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { setLocale } from "../src/utils/i18n"

const { openGoalDialog, saveGoalDialog } = await import("../src/services/dialog")
const { dialogStore } = await import("../src/store/dialog")
const { setBoardStore, setTasksData } = await import("../src/store/board")

const GOAL_TASK_DIRECTORY = "D:/repo/goal-dialog"

installRealOverlayI18n()
await setLocale("en-US")

function fakeTransport(responder: (req: TransportRequest) => TransportResponse<unknown>): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as TransportResponse<T>
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

beforeEach(() => {
  setBoardStore("selectedSource", { kind: "task", id: "tsk_goal_save", directory: GOAL_TASK_DIRECTORY })
  setBoardStore("board", {
    snapshotVersion: "goal-dialog:error",
    task: {
      id: "tsk_goal_save",
      directory: GOAL_TASK_DIRECTORY,
      status: "active",
      time: { created: 1, updated: 1 },
    },
  })
  setTasksData([
    {
      task: {
        id: "tsk_goal_save",
        directory: GOAL_TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  __setHostTransportForTest(
    fakeTransport((req) => {
      if (req.method === "POST" && req.path === "task/tsk_goal_save/message") {
        return { status: 500, ok: false, headers: {}, body: { message: "goal save backend failed" } }
      }
      return { status: 200, ok: true, headers: {}, body: {} }
    }),
  )
  openGoalDialog("", "Persist goal failure", "Acceptance")
})

afterEach(() => {
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
  setTasksData([])
  __setHostTransportForTest(undefined)
})

test("saveGoalDialog rejects panelMessage failures and clears saving", async () => {
  await expect(saveGoalDialog()).rejects.toThrow("goal save backend failed")

  expect(dialogStore.goal.open).toBe(true)
  expect(dialogStore.goal.saving).toBe(false)
  expect(dialogStore.goal.title).toBe("Persist goal failure")
})
