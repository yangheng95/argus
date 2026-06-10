import { afterEach, expect, test } from "bun:test"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

const { __setHostTransportForTest } = await import("../src/services/host-transport")
const { boardStore, loadMoreTasks, loadTasks, setBoardStore, TASK_LIST_PAGE_SIZE } = await import("../src/store/board")

function taskItem(index: number): any {
  const updated = 10_000 - index
  return {
    task: {
      id: `tsk_${String(index).padStart(2, "0")}`,
      requestID: `req_${index}`,
      title: `Task ${index}`,
      request: `Task ${index}`,
      status: "queued",
      time: {
        created: updated,
        updated,
      },
    },
  }
}

afterEach(() => {
  __setHostTransportForTest(undefined)
  setBoardStore({
    tasks: [],
    pendingTasks: [],
    tasksHasMore: false,
    tasksLoadedLimit: 0,
    tasksCursorUpdated: null,
    tasksCursorTaskID: "",
    tasksLoadingMore: false,
    tasksError: "",
    tasksLoaded: false,
  })
})

test("loadTasks fetches one sentinel row and keeps only the first ten task records", async () => {
  const requests: TransportRequest[] = []
  const firstPage = Array.from({ length: TASK_LIST_PAGE_SIZE + 1 }, (_, index) => taskItem(index))
  __setHostTransportForTest({
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      return { status: 200, ok: true, headers: {}, body: { tasks: firstPage } as T }
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
  } satisfies HostTransport)

  await loadTasks()

  expect(requests).toHaveLength(1)
  expect(requests[0].path).toBe("global/tasks")
  expect(String(requests[0].query?.limit)).toBe(String(TASK_LIST_PAGE_SIZE + 1))
  expect(boardStore.tasks).toHaveLength(TASK_LIST_PAGE_SIZE)
  expect(boardStore.tasksHasMore).toBe(true)
  expect(boardStore.tasksCursorTaskID).toBe("tsk_09")
})

test("loadMoreTasks fetches the next page from the database using the last visible task cursor", async () => {
  const requests: TransportRequest[] = []
  const firstPage = Array.from({ length: TASK_LIST_PAGE_SIZE + 1 }, (_, index) => taskItem(index))
  const secondPage = [taskItem(11), taskItem(12), taskItem(13)]
  __setHostTransportForTest({
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      requests.push(req)
      const body = requests.length === 1 ? { tasks: firstPage } : { tasks: secondPage }
      return { status: 200, ok: true, headers: {}, body: body as T }
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
  } satisfies HostTransport)

  await loadTasks()
  await loadMoreTasks()

  expect(requests).toHaveLength(2)
  expect(requests[1].path).toBe("global/tasks")
  expect(String(requests[1].query?.limit)).toBe(String(TASK_LIST_PAGE_SIZE + 1))
  expect(String(requests[1].query?.cursor)).toBe(String(firstPage[9].task.time.updated))
  expect(requests[1].query?.cursorTaskID).toBe(firstPage[9].task.id)
  expect(boardStore.tasks.map((item: any) => item.task.id)).toEqual([
    ...firstPage.slice(0, TASK_LIST_PAGE_SIZE).map((item) => item.task.id),
    ...secondPage.map((item) => item.task.id),
  ])
  expect(boardStore.tasksHasMore).toBe(false)
})
