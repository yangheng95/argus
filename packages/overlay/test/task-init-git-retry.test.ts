import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type {
  HostTransport,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"

// W2-V32 (commit aa14f20e7) removed every auto git-init in the project
// bootstrap. Task creation now throws WorktreeNotGitError (HTTP 412) when the
// active directory is not a git repo. The overlay's createTask must catch
// that single error and offer the explicit init gesture, then retry once;
// any other failure (or a declined prompt) must propagate unchanged.

let dialogResponse: { confirmed: boolean } = { confirmed: true }
const dialogCalls: Array<{ title?: string; message?: string }> = []
const initCalls: number[] = []
let initResult = true

// Preserve every other export so unrelated consumers (nativeMessage,
// gitCheckpointTitle, etc.) keep working.
const realAppDialog = await import("../src/services/app-dialog")
const realGit = await import("../src/utils/git")

mock.module("../src/services/app-dialog", () => ({
  ...realAppDialog,
  showAppDialog: async (options: any) => {
    dialogCalls.push({ title: options?.title, message: options?.message })
    return { confirmed: dialogResponse.confirmed, value: null }
  },
}))

mock.module("../src/utils/git", () => ({
  ...realGit,
  initGitCurrent: async (_options: any) => {
    initCalls.push(Date.now())
    return initResult
  },
}))

const { createTask } = await import("../src/services/task")
const { ApiError } = await import("../src/services/api")

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
})

afterEach(() => __setHostTransportForTest(undefined))

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

    const taskID = await createTask({ text: "hello" })
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
      await createTask({ text: "hello" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(412)
    expect(dialogCalls.length).toBe(1)
    expect(initCalls.length).toBe(0)
  })

  test("412 with a different error name does NOT trigger the retry", async () => {
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
      await createTask({ text: "hello" })
    } catch (e) {
      caught = e
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
      await createTask({ text: "hello" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(500)
    expect(dialogCalls.length).toBe(0)
    expect(initCalls.length).toBe(0)
  })
})
