import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { configure } from "../src/services/api"
import { HOST_CAPABILITIES, __setHostTransportForTest } from "../src/services/host-transport"
import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
import { boardStore, clearBoard, loadBoard, setBoardStore, setTasksData } from "../src/store/board"
import { setChatRequest } from "../src/store/messages"
import { registerConversationSourceDirectory } from "../src/services/conversation"
import { panelMessage, stopChatRequest } from "../src/services/chat"
import { taskOwningDirectory } from "../src/services/task-directory"
import { currentTraceDirectory } from "../src/services/trace-directory"
import { fetchFullDiffs } from "../src/services/diff"
import { AppLog } from "../src/utils/log"
import { setLocale } from "../src/utils/i18n"
import { installRealOverlayI18n } from "./fixtures/i18n"

installRealOverlayI18n()
await setLocale("en-US")

const SETTINGS_DIRECTORY = "D:/repo/from-settings"
const TASK_DIRECTORY = "D:/repo/from-task-row"
const SESSION_DIRECTORY = "D:/repo/from-session-row"

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as Promise<TransportResponse<T>> | TransportResponse<T>
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
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

function ok(body: unknown = {}): TransportResponse<unknown> {
  return { status: 200, ok: true, headers: {}, body }
}

afterEach(() => {
  mock.restore()
  clearBoard()
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
  setTasksData([])
  setChatRequest(null as any)
})

function userMessage(sessionID: string): unknown {
  return {
    info: {
      id: `msg_${sessionID}`,
      role: "user",
      resolvedRole: "user",
      channel: "main",
      sessionID,
      time: { created: 1 },
      orderKey: `v1:0000000000000001:0000000000000030:0000000000000000:message:msg_${sessionID}`,
    },
    parts: [
      {
        id: `part_${sessionID}`,
        type: "text",
        text: "operator input",
        resolvedRole: "user",
        messageID: `msg_${sessionID}`,
        sessionID,
        orderKey: `v1:0000000000000001:0000000000000031:0000000000000000:part:part_${sessionID}`,
      },
    ],
  }
}

test("taskOwningDirectory rejects task IDs without a frozen row or board directory", () => {
  configure({ directory: SETTINGS_DIRECTORY })

  expect(() => taskOwningDirectory("tsk_missing")).toThrow("owning project directory")
})

test("taskOwningDirectory keeps the selected task source directory through project-scope reloads", () => {
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("selectedSource", { kind: "task", id: "tsk_selected", directory: TASK_DIRECTORY })

  expect(taskOwningDirectory("tsk_selected")).toBe(TASK_DIRECTORY)
})

test("taskOwningDirectory rejects inconsistent selected source and task row directories", () => {
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_inconsistent",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", {
    kind: "task",
    id: "tsk_inconsistent",
    directory: "D:/repo/other-task-row",
  })

  expect(() => taskOwningDirectory("tsk_inconsistent")).toThrow("inconsistent project directories")
})

test("panelMessage sends task messages with the task row directory", async () => {
  const captures: TransportRequest[] = []
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_chat",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_chat" })
  setBoardStore("board", {
    snapshotVersion: "board:chat",
    task: {
      id: "tsk_chat",
      directory: TASK_DIRECTORY,
      status: "active",
      sessionID: "ses_task",
      time: { created: 1, updated: 1 },
    },
  })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captures.push(req)
      if (req.path === "task/tsk_chat/board") return { status: 304, ok: true, headers: {}, body: {} }
      return ok({ user_message: userMessage("ses_task") })
    }),
  )

  await panelMessage("continue")

  expect(captures[0]?.path).toBe("task/tsk_chat/message")
  expect(captures[0]?.query?.directory).toBe(TASK_DIRECTORY)
})

test("loadBoard refreshes the selected task with its row directory", async () => {
  let captured: TransportRequest | undefined
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_board",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board" })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      return ok({
        snapshotVersion: "board:test",
        task: {
          id: "tsk_board",
          directory: TASK_DIRECTORY,
          status: "active",
          time: { created: 1, updated: 1 },
        },
        lastSequence: 0,
      })
    }),
  )

  await loadBoard({ sync: true })

  expect(captured?.path).toBe("task/tsk_board/board")
  expect(captured?.query?.sync).toBe("1")
  expect(captured?.query?.directory).toBe(TASK_DIRECTORY)
})

test("loadBoard requireFresh rejects selected-task board reload failures", async () => {
  let captured: TransportRequest | undefined
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_board_fail",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board_fail" })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      return { status: 500, ok: false, headers: {}, body: { error: "board reload failed" } }
    }),
  )

  const originalConsoleError = console.error
  try {
    console.error = () => undefined
    await expect(loadBoard({ sync: true, requireFresh: true })).rejects.toThrow(/board reload failed/)
  } finally {
    console.error = originalConsoleError
  }

  expect(captured?.path).toBe("task/tsk_board_fail/board")
  expect(captured?.query?.sync).toBe("1")
  expect(captured?.query?.directory).toBe(TASK_DIRECTORY)
  expect(boardStore.boardRetryCount).toBe(0)
})

test("loadBoard requireFresh starts after an older in-flight board refresh settles", async () => {
  let releaseFirst!: () => void
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const captures: TransportRequest[] = []
  let requestIndex = 0
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_board_fresh",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board_fresh" })

  __setHostTransportForTest(
    fakeTransport(async (req) => {
      captures.push(req)
      requestIndex += 1
      const current = requestIndex
      if (current === 1) await firstPending
      return ok({
        snapshotVersion: current === 1 ? "board:stale" : "board:fresh",
        task: {
          id: "tsk_board_fresh",
          directory: TASK_DIRECTORY,
          status: "active",
          time: { created: 1, updated: current },
        },
        lastSequence: current,
      })
    }),
  )

  const stale = loadBoard({ sync: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(captures).toHaveLength(1)

  const requiredFresh = loadBoard({ sync: true, requireFresh: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(captures).toHaveLength(1)

  releaseFirst()
  await Promise.all([stale, requiredFresh])

  expect(captures.map((req) => req.path)).toEqual(["task/tsk_board_fresh/board", "task/tsk_board_fresh/board"])
  expect(captures.map((req) => req.query?.sync)).toEqual(["1", "1"])
  expect(boardStore.snapshotVersion).toBe("board:fresh")
})

test("loadBoard requireFresh rechecks selected task after stale in-flight board refresh settles", async () => {
  let releaseFirst!: () => void
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const captures: TransportRequest[] = []
  let requestIndex = 0
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_board_initial",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
    {
      task: {
        id: "tsk_board_current",
        directory: SESSION_DIRECTORY,
        status: "active",
        time: { created: 2, updated: 2 },
      },
      updated_at: 2,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board_initial" })

  __setHostTransportForTest(
    fakeTransport(async (req) => {
      captures.push(req)
      requestIndex += 1
      const current = requestIndex
      if (current === 1) await firstPending
      const taskID = current === 1 ? "tsk_board_initial" : "tsk_board_current"
      const directory = current === 1 ? TASK_DIRECTORY : SESSION_DIRECTORY
      return ok({
        snapshotVersion: `board:${taskID}`,
        task: {
          id: taskID,
          directory,
          status: "active",
          time: { created: current, updated: current },
        },
        lastSequence: current,
      })
    }),
  )

  const stale = loadBoard({ sync: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(captures).toHaveLength(1)

  const requiredFresh = loadBoard({ sync: true, requireFresh: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(captures).toHaveLength(1)
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board_current" })

  releaseFirst()
  await Promise.all([stale, requiredFresh])

  expect(captures.map((req) => req.path)).toEqual(["task/tsk_board_initial/board", "task/tsk_board_current/board"])
  expect(captures.map((req) => req.query?.directory)).toEqual([TASK_DIRECTORY, SESSION_DIRECTORY])
  expect(boardStore.snapshotVersion).toBe("board:tsk_board_current")
})

test("loadBoard reports non-required selected-task board refresh failures visibly and retries", async () => {
  configure({ directory: SETTINGS_DIRECTORY })
  setTasksData([
    {
      task: {
        id: "tsk_board_visible_fail",
        directory: TASK_DIRECTORY,
        status: "active",
        time: { created: 1, updated: 1 },
      },
      updated_at: 1,
    },
  ])
  setBoardStore("selectedSource", { kind: "task", id: "tsk_board_visible_fail" })

  __setHostTransportForTest(
    fakeTransport((req) => {
      if (req.path === "task/tsk_board_visible_fail/board") {
        return { status: 500, ok: false, headers: {}, body: { error: "board refresh failed" } }
      }
      return ok()
    }),
  )
  const logError = spyOn(AppLog, "error").mockImplementation(() => undefined)

  await loadBoard({ sync: true })

  expect(logError).toHaveBeenCalledTimes(1)
  expect(logError.mock.calls[0]?.[0]).toBe("board")
  expect(logError.mock.calls[0]?.[1]).toBe("Selected task board refresh failed")
  expect(logError.mock.calls[0]?.[2]).toMatchObject({
    taskID: "tsk_board_visible_fail",
    notificationID: "board:refresh-failed:tsk_board_visible_fail",
    notificationTitle: "Task board refresh failed",
  })
  expect(boardStore.boardRetryCount).toBeGreaterThan(0)
})

test("currentTraceDirectory uses selected task and session owning directories", () => {
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("selectedSource", { kind: "task", id: "tsk_trace" })
  setBoardStore("board", {
    snapshotVersion: "board:trace",
    task: {
      id: "tsk_trace",
      directory: TASK_DIRECTORY,
      status: "active",
      time: { created: 1, updated: 1 },
    },
  })
  expect(currentTraceDirectory()).toBe(TASK_DIRECTORY)

  setBoardStore("selectedSource", { kind: "session", id: "ses_trace" })
  setBoardStore("board", null)
  registerConversationSourceDirectory({ kind: "session", id: "ses_trace" }, SESSION_DIRECTORY)
  expect(currentTraceDirectory()).toBe(SESSION_DIRECTORY)
})

test("panelMessage sends session prompts with the registered session directory", async () => {
  let captured: TransportRequest | undefined
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("selectedSource", { kind: "session", id: "ses_mission" })
  registerConversationSourceDirectory({ kind: "session", id: "ses_mission" }, SESSION_DIRECTORY)

  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      return ok({ user_message: userMessage("ses_mission") })
    }),
  )

  await panelMessage("continue mission")

  expect(captured?.path).toBe("session/ses_mission/prompt_async")
  expect(captured?.query?.directory).toBe(SESSION_DIRECTORY)
})

test("stopChatRequest sends aborts with the request target directory", async () => {
  let captured: TransportRequest | undefined
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("selectedSource", { kind: "task", id: "tsk_abort" })
  setBoardStore("board", {
    snapshotVersion: "board:abort",
    task: {
      id: "tsk_abort",
      directory: TASK_DIRECTORY,
      status: "active",
      sessionID: "ses_abort",
      time: { created: 1, updated: 1 },
    },
  })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captured = req
      return ok()
    }),
  )

  setChatRequest({
    requestID: "req_abort",
    stopping: false,
    target: { kind: "task", taskID: "tsk_abort", directory: TASK_DIRECTORY },
  } as any)

  await stopChatRequest()

  expect(captured?.path).toBe("task/tsk_abort/cancel")
  expect(captured?.query?.directory).toBe(TASK_DIRECTORY)
})

test("workspace diff fetch uses the selected task directory in request and cache key", async () => {
  const captures: TransportRequest[] = []
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("board", {
    task: { id: "tsk_diff", directory: TASK_DIRECTORY },
  })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captures.push(req)
      return ok([{ file: "src/app.ts", status: "modified", additions: 1, deletions: 0 }])
    }),
  )

  await fetchFullDiffs("run_diff")
  await fetchFullDiffs("run_diff")

  expect(captures).toHaveLength(1)
  expect(captures[0]?.path).toBe("run/run_diff/diff")
  expect(captures[0]?.query?.directory).toBe(TASK_DIRECTORY)
})
