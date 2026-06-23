import { afterEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest, HOST_CAPABILITIES } from "../src/services/host-transport"
import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
import { deleteMemory, fetchMemoryDetail, loadMemory, searchMemory } from "../src/services/memory"
import { installRealOverlayI18n } from "./fixtures/i18n"

const WRONG_DIRECTORY = "D:/memory/wrong"
const TASK_DIRECTORY = "D:/memory/task"

installRealOverlayI18n()

function recordingTransport(requests: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    capabilities: HOST_CAPABILITIES.tauri,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      const body = req.path.endsWith("/memory/search")
        ? [{ fileId: "mem_search", fileTitle: "Search", content: "found", timeCreated: 1 }]
        : req.path.endsWith("/memory/mem_detail")
          ? { file: { id: "mem_detail" }, content: "detail" }
          : []
      return { status: 200, ok: true, headers: {}, body: body as T }
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

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

test("legacy memory service wrappers require and send explicit directories", async () => {
  const requests: TransportRequest[] = []
  configure({ directory: WRONG_DIRECTORY })
  __setHostTransportForTest(recordingTransport(requests))

  await loadMemory({ taskID: "tsk_memory", directory: TASK_DIRECTORY })
  await searchMemory({ taskID: "tsk_memory", directory: TASK_DIRECTORY }, "needle")
  await fetchMemoryDetail({ fileId: "mem_detail", directory: TASK_DIRECTORY })
  await deleteMemory({ fileId: "mem_delete", taskID: "tsk_memory", directory: TASK_DIRECTORY })

  expect(requests.map((req) => req.query?.directory)).toEqual([
    TASK_DIRECTORY,
    TASK_DIRECTORY,
    TASK_DIRECTORY,
    TASK_DIRECTORY,
    TASK_DIRECTORY,
  ])
  expect(requests[0]?.query?.taskID).toBe("tsk_memory")
  expect(requests[1]?.body).toEqual({
    kind: "json",
    value: { query: "needle", taskID: "tsk_memory", limit: 20 },
  })
})

test("legacy memory service rejects missing explicit directories", async () => {
  await expect(loadMemory({ taskID: "tsk_memory", directory: "" })).rejects.toThrow("directory is required")
  await expect(fetchMemoryDetail({ fileId: "mem_detail", directory: "" })).rejects.toThrow("directory is required")
})
