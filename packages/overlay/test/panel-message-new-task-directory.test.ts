import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

const PROJECT_DIRECTORY = "D:/repo/new-project"
const CREATED_TASK_ID = "tsk_created_directory"
const PANEL_MODEL = "openai/gpt-5.5"
const hydrateCalls: Array<{ taskID: string; options: any }> = []
const startedStreams: Array<{ kind: string; id: string; sequence: number; options?: any }> = []

mock.module("../src/services/app-dialog", () => ({
  showAppDialog: async () => ({ confirmed: true, value: null }),
  nativeMessage: async () => ({ confirmed: true, value: null }),
}))

mock.module("../src/utils/i18n", () => ({
  UnsupportedLocaleError: class UnsupportedLocaleError extends Error {},
  MissingI18nKeyError: class MissingI18nKeyError extends Error {},
  sanitizeLocale: (value: string) => (String(value || "").startsWith("zh") ? "zh-CN" : "en-US"),
  fillTemplate: (text: string) => text,
  t: (key: string) => key,
  tArray: (key: string) => [key],
  tc: (key: string) => key,
  localeTag: () => "en-US",
  getLocale: () => "en-US",
  loadLocale: async () => undefined,
  setLocale: async () => undefined,
  loadAllLocales: async () => undefined,
  setLocaleData: () => undefined,
  i18nTargets: () => [],
  applyI18n: () => undefined,
}))

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
  startSSE: (source: { kind: string; id: string }, sequence: number, options?: any) => {
    startedStreams.push({ ...source, sequence, options })
  },
  startTaskListSSE: () => undefined,
  stopSSE: () => undefined,
  stopTaskListSSE: () => undefined,
}))

const { panelMessage } = await import("../src/services/chat")
const { configure } = await import("../src/services/api")
const { boardStore, setBoardStore, setTasksData } = await import("../src/store/board")
const { setAppStore } = await import("../src/store/app")
const { setSelectedTaskID, setMessages, setChatRequest } = await import("../src/store/messages")
const { setSettingsStore } = await import("../src/store/settings")
const { taskOwningDirectory } = await import("../src/services/task-directory")
const { HOST_CAPABILITIES, __setHostTransportForTest } = await import("../src/services/host-transport")
const { resetWriter } = await import("../src/services/tree-writer")

function ok(body: unknown = {}): TransportResponse<unknown> {
  return { status: 200, ok: true, headers: {}, body }
}

function fakeTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      if (req.method === "POST" && req.path === "task") return ok({ task_id: CREATED_TASK_ID }) as TransportResponse<T>
      return {
        status: 404,
        ok: false,
        headers: {},
        body: { error: `unhandled ${req.method || "GET"} ${req.path}` },
      } as TransportResponse<T>
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
  } as HostTransport
}

beforeEach(() => {
  hydrateCalls.length = 0
  startedStreams.length = 0
  configure({ directory: PROJECT_DIRECTORY })
  setSettingsStore({
    directory: PROJECT_DIRECTORY,
    savedDirectory: PROJECT_DIRECTORY,
    workspaceTaskID: "",
    workspaceDirectory: "",
    directoryEpoch: 0,
    autoServer: false,
  })
  setBoardStore("board", null as any)
  setBoardStore("selectedSource", null)
  setBoardStore("taskSwitching", false)
  setBoardStore("selectEpoch", 0)
  setTasksData([])
  setSelectedTaskID("")
  setMessages([])
  setChatRequest(null as any)
  setAppStore("config", { model: PANEL_MODEL })
  resetWriter()
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setAppStore("config", null as any)
})

test("panelMessage freezes the active project directory on a newly created task", async () => {
  const requests: TransportRequest[] = []
  __setHostTransportForTest(fakeTransport(requests))

  const result = await panelMessage("create from a new directory")

  expect(result).toEqual({ task_id: CREATED_TASK_ID })
  expect(requests[0]?.path).toBe("task")
  expect(requests[0]?.query?.directory).toBe(PROJECT_DIRECTORY)
  expect(requests[0]?.body?.kind).toBe("json")
  expect((requests[0]?.body as any).value.model).toBe(PANEL_MODEL)
  expect(boardStore.selectedSource).toEqual({
    kind: "task",
    id: CREATED_TASK_ID,
    directory: PROJECT_DIRECTORY,
  })
  expect(taskOwningDirectory(CREATED_TASK_ID)).toBe(PROJECT_DIRECTORY)
  expect(hydrateCalls).toEqual([
    {
      taskID: CREATED_TASK_ID,
      options: expect.objectContaining({ directory: PROJECT_DIRECTORY, tailLimit: 8 }),
    },
  ])
  expect(startedStreams[0]).toEqual({
    kind: "task",
    id: CREATED_TASK_ID,
    sequence: 0,
    options: { directory: PROJECT_DIRECTORY },
  })
})
