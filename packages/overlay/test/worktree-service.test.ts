import { afterEach, beforeEach, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { __setHostTransportForTest } from "../src/services/host-transport"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { deleteProjectWorktree, loadProjectWorktrees } from "../src/services/worktree"

const SAVED_DIRECTORY = "D:/workspace/app"

function transport(body: unknown, capture: (req: TransportRequest) => void): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      capture(req)
      return {
        status: 200,
        ok: true,
        headers: {},
        body: body as T,
      }
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
  configure({ serverUrl: "http://127.0.0.1:7878", directory: SAVED_DIRECTORY })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
})

test("loadProjectWorktrees reads the project worktree route with directory context", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    transport(
      [
        {
          name: "goal-a",
          branch: "opencorvus/goal-a",
          directory: "D:/workspace/app/.opencorvus/runtime/worktrees/goal-a",
          goalID: "gol_a",
          status: "active",
          removable: true,
        },
      ],
      (req) => {
        captured = req
      },
    ),
  )

  const items = await loadProjectWorktrees()

  expect(captured?.path).toBe("project/current/worktrees")
  expect(captured?.method).toBe("GET")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(items).toEqual([
    {
      name: "goal-a",
      branch: "opencorvus/goal-a",
      directory: "D:/workspace/app/.opencorvus/runtime/worktrees/goal-a",
      goalID: "gol_a",
      status: "active",
      removable: true,
    },
  ])
})

test("deleteProjectWorktree sends the target directory in the DELETE JSON body", async () => {
  let captured: TransportRequest | undefined
  __setHostTransportForTest(
    transport({ ok: true }, (req) => {
      captured = req
    }),
  )

  const ok = await deleteProjectWorktree("D:/workspace/app/.opencorvus/runtime/worktrees/old")

  expect(ok).toBe(true)
  expect(captured?.path).toBe("project/current/worktrees")
  expect(captured?.method).toBe("DELETE")
  expect(captured?.query?.directory).toBe(SAVED_DIRECTORY)
  expect(captured?.body).toEqual({
    kind: "json",
    value: {
      directory: "D:/workspace/app/.opencorvus/runtime/worktrees/old",
    },
  })
})

test("loadProjectWorktrees rejects malformed project worktree payloads", async () => {
  __setHostTransportForTest(
    transport(
      [
        {
          name: "broken",
          directory: "D:/workspace/app/.opencorvus/runtime/worktrees/broken",
          status: "unknown",
          removable: true,
        },
      ],
      () => {},
    ),
  )

  await expect(loadProjectWorktrees()).rejects.toThrow("project worktree has an unknown status")
})
