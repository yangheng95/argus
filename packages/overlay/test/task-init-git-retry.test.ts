import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"

// W2-V32 (commit aa14f20e7) removed every auto git-init in the project
// bootstrap. Task creation now throws WorktreeNotGitError (HTTP 412) when the
// active directory is not a git repo. The overlay's createTask must catch
// that single error and offer the explicit init gesture, then retry once;
// any other failure (or a declined prompt) must propagate unchanged.

let dialogResponse: { confirmed: boolean } = { confirmed: true }
const dialogCalls: Array<{
  title?: string
  message?: string
  select?: boolean
  kind?: string
}> = []
const initCalls: number[] = []
let initResult = true

mock.module("../src/utils/icon-html", () => ({
  hydrateIconPlaceholders() {},
  iconHtml() {
    return ""
  },
}))

mock.module("../src/utils/icon-html.tsx", () => ({
  hydrateIconPlaceholders() {},
  iconHtml() {
    return ""
  },
}))

mock.module("../src/services/app-dialog", () => ({
  showAppDialog: async (options: any) => {
    dialogCalls.push({
      title: options?.title,
      message: options?.message,
      select: options?.select === true,
      kind: options?.kind,
    })
    return { confirmed: dialogResponse.confirmed, value: null }
  },
  nativeMessage: async (message: string, options: any = {}) => {
    dialogCalls.push({ title: options?.title, message, kind: options?.kind })
    return { confirmed: dialogResponse.confirmed, value: null }
  },
}))

mock.module("../src/utils/git", () => ({
  initGitCurrent: async (_options: any) => {
    initCalls.push(Date.now())
    return initResult
  },
}))

const { createTask } = await import("../src/services/task")
const { ApiError } = await import("../src/services/api")
const { configure } = await import("../src/services/api")

const PROJECT_DIRECTORY = "D:/repo/task-init-git"

type Responder = (req: TransportRequest) => TransportResponse<unknown>
function fakeTransport(responder: Responder): HostTransport {
  return {
    kind: "tauri",
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
  } as unknown as HostTransport
}

beforeEach(() => {
  dialogCalls.length = 0
  initCalls.length = 0
  dialogResponse = { confirmed: true }
  initResult = true
  configure({ directory: PROJECT_DIRECTORY })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

describe("createTask + WorktreeNotGitError init-git retry", () => {
  test("412 WorktreeNotGitError → confirm dialog → init git → retry succeeds", async () => {
    let attempts = 0
    __setHostTransportForTest(
      fakeTransport(() => {
        attempts += 1
        if (attempts === 1) {
          return {
            status: 412,
            ok: false,
            headers: {},
            body: {
              name: "WorktreeNotGitError",
              data: { message: "Cannot create a task in /tmp/x: the directory is not a git repository." },
            },
          }
        }
        return { status: 200, ok: true, headers: {}, body: { task_id: "tsk_abc123" } }
      }),
    )

    const taskID = await createTask({ text: "hello", queue: false, kind: "workflow" })
    expect(taskID).toBe("tsk_abc123")
    expect(attempts).toBe(2)
    expect(dialogCalls.length).toBe(1)
    expect(initCalls.length).toBe(1)
  })

  test("412 WorktreeNotGitError → user cancels dialog → original error propagates", async () => {
    dialogResponse = { confirmed: false }
    __setHostTransportForTest(
      fakeTransport(() => ({
        status: 412,
        ok: false,
        headers: {},
        body: {
          name: "WorktreeNotGitError",
          data: { message: "not a git repo" },
        },
      })),
    )

    let caught: unknown
    try {
      await createTask({ text: "hello", queue: false, kind: "workflow" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(412)
    expect(dialogCalls.length).toBe(1)
    expect(initCalls.length).toBe(0)
  })

  test("412 with a different error name does not trigger the retry", async () => {
    __setHostTransportForTest(
      fakeTransport(() => ({
        status: 412,
        ok: false,
        headers: {},
        body: { name: "SomeOtherPreconditionError", message: "nope" },
      })),
    )

    let caught: unknown
    try {
      await createTask({ text: "hello", queue: false, kind: "workflow" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect(dialogCalls.length).toBe(0)
    expect(initCalls.length).toBe(0)
  })

  test("non-412 ApiError propagates without prompting", async () => {
    __setHostTransportForTest(
      fakeTransport(() => ({
        status: 500,
        ok: false,
        headers: {},
        body: { error: "boom" },
      })),
    )

    let caught: unknown
    try {
      await createTask({ text: "hello", queue: false, kind: "workflow" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(500)
    expect(dialogCalls.length).toBe(0)
    expect(initCalls.length).toBe(0)
  })

  test("missing queue defaults to immediate start without opening a queue dialog", async () => {
    let posted: any
    __setHostTransportForTest(
      fakeTransport((req) => {
        posted = req.body?.kind === "json" ? req.body.value : JSON.parse(String(req.body))
        return { status: 200, ok: true, headers: {}, body: { task_id: "tsk_queue_default" } }
      }),
    )

    const taskID = await createTask({ text: "hello", kind: "workflow" })

    expect(taskID).toBe("tsk_queue_default")
    expect(posted.queue).toBe(false)
    expect(dialogCalls.length).toBe(0)
  })

  test("explicit queue true still posts true", async () => {
    let posted: any
    __setHostTransportForTest(
      fakeTransport((req) => {
        posted = req.body?.kind === "json" ? req.body.value : JSON.parse(String(req.body))
        return { status: 200, ok: true, headers: {}, body: { task_id: "tsk_queue_explicit" } }
      }),
    )

    const taskID = await createTask({ text: "hello", queue: true, kind: "workflow" })

    expect(taskID).toBe("tsk_queue_explicit")
    expect(posted.queue).toBe(true)
    expect(dialogCalls.length).toBe(0)
  })

  test("missing task kind defaults to workflow without opening the removed route dialog", async () => {
    let posted: any
    __setHostTransportForTest(
      fakeTransport((req) => {
        posted = req.body?.kind === "json" ? req.body.value : JSON.parse(String(req.body))
        return { status: 200, ok: true, headers: {}, body: { task_id: "tsk_workflow_route" } }
      }),
    )

    const taskID = await createTask({ text: "hello", queue: false })

    expect(taskID).toBe("tsk_workflow_route")
    expect(dialogCalls.some((item) => item.kind === "task-route-decision")).toBe(false)
    expect(posted.kind).toBe("workflow")
  })

  test("explicit task kind can still create a direct build task", async () => {
    let posted: any
    __setHostTransportForTest(
      fakeTransport((req) => {
        posted = req.body?.kind === "json" ? req.body.value : JSON.parse(String(req.body))
        return { status: 200, ok: true, headers: {}, body: { task_id: "tsk_build_route" } }
      }),
    )

    const taskID = await createTask({ text: "hello", queue: false, kind: "build" })

    expect(taskID).toBe("tsk_build_route")
    expect(dialogCalls.some((item) => item.kind === "task-route-decision")).toBe(false)
    expect(posted.kind).toBe("build")
  })
})
