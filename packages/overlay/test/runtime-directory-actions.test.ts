import { afterEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { HOST_CAPABILITIES, __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, StreamHandlers, StreamOpenRequest, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { loadBoard, setBoardStore, setTasksData } from "../src/store/board"
import { setChatRequest } from "../src/store/messages"
import { registerConversationSourceDirectory } from "../src/services/conversation"
import { panelMessage, stopChatRequest } from "../src/services/chat"
import { taskOwningDirectory } from "../src/services/task-directory"
import { currentTraceDirectory } from "../src/services/trace-directory"
import { fetchFullDiffs } from "../src/services/diff"

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
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setBoardStore("selectedSource", null)
  setBoardStore("board", null)
  setTasksData([])
  setChatRequest(null as any)
})

function userMessage(sessionID: string): unknown {
  return {
    info: { id: `msg_${sessionID}`, role: "user", channel: "main", sessionID, time: { created: 1 } },
    parts: [
      {
        id: `part_${sessionID}`,
        type: "text",
        text: "operator input",
        messageID: `msg_${sessionID}`,
        sessionID,
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

test("acceptance diff fetch uses the selected task directory in request and cache key", async () => {
  const captures: TransportRequest[] = []
  configure({ directory: SETTINGS_DIRECTORY })
  setBoardStore("board", {
    task: { id: "tsk_diff", directory: TASK_DIRECTORY },
  })

  __setHostTransportForTest(
    fakeTransport((req) => {
      captures.push(req)
      return ok({ result: { diffs: [{ file: "src/app.ts", status: "modified", additions: 1, deletions: 0 }] } })
    }),
  )

  await fetchFullDiffs("run_diff")
  await fetchFullDiffs("run_diff")

  expect(captures).toHaveLength(1)
  expect(captures[0]?.path).toBe("run/run_diff/acceptance")
  expect(captures[0]?.query?.directory).toBe(TASK_DIRECTORY)
})
