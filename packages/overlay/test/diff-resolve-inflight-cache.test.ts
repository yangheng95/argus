import { beforeEach, expect, mock, test } from "bun:test"

let acceptanceCalls = 0
let vcsCalls = 0
let concurrentAcceptance: Deferred<unknown> | null = null
let emptyAcceptance: Deferred<unknown> | null = null
const boardStore: any = {
  board: null,
  changes: [],
  selectedSource: null,
  snapshotVersion: "",
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function acceptanceDiff(file: string) {
  return [
    {
      file,
      before: "",
      after: "export const value = 1;\n",
      additions: 1,
      deletions: 0,
      status: "added",
    },
  ]
}

mock.module("../src/services/api", () => ({
  ApiError: class ApiError extends Error {},
  DEFAULT_SERVER: "http://localhost:4096",
  apiHeaders: () => ({}),
  apiUrl: (path: string) => path,
  configure: () => {},
  getServerUrl: () => "http://localhost:4096",
  onAuthChange: () => () => {},
  queryWithDirectory: () => undefined,
  apiJson: async (path: string) => {
    const requestPath = path.split("?")[0] || path
    if (requestPath === "vcs/diff") {
      vcsCalls += 1
      throw new Error("resolveDiff must not use live VCS diff as a preview source")
    }
    acceptanceCalls += 1
    if (requestPath === "goal-run/gr_inflight_cache/diff") {
      if (acceptanceCalls === 1) return null
      return acceptanceDiff("src/new-file.ts")
    }
    if (requestPath === "goal-run/gr_concurrent/diff") {
      if (!concurrentAcceptance) throw new Error("missing concurrent acceptance test promise")
      return concurrentAcceptance.promise
    }
    if (requestPath === "goal-run/gr_empty_recheck/diff") {
      return emptyAcceptance?.promise ?? []
    }
    if (requestPath === "goal-run/gr_no_body/diff") {
      return []
    }
    throw new Error(`unexpected api path ${path}`)
  },
  apiJsonWithTimeout: async () => ({}),
  apiRequest: async () => new Response(null, { status: 204 }),
}))

mock.module("../src/store/board", () => ({
  boardStore,
  activeTaskID: () => (boardStore.selectedSource?.kind === "task" ? boardStore.selectedSource.id : ""),
  setPath: () => {},
  setVcs: () => {},
}))

mock.module("../src/services/meta", () => ({
  deriveChanges: () => [],
  normalizeDiffs: (list: any[]) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item.file === "string")
      .map((item) => ({
        file: String(item.file || "").replace(/^[ab]\//, ""),
        before: typeof item.before === "string" ? item.before : undefined,
        after: typeof item.after === "string" ? item.after : undefined,
        additions: Number.isFinite(Number(item.additions)) ? Number(item.additions) : 0,
        deletions: Number.isFinite(Number(item.deletions)) ? Number(item.deletions) : 0,
        status: item.status === "added" || item.status === "deleted" ? item.status : "modified",
      })),
}))

const { resolveDiff } = await import("../src/services/diff")

function setGoalBoard(goalRunID: string, file: string) {
  boardStore.selectedSource = { kind: "task", id: "task_inflight_cache" }
  boardStore.board = {
    task: { directory: "C:/repo" },
    goalWorkflows: [
      {
        goalID: "goal_inflight_cache",
        goalRunID,
        steps: [
          {
            payload: {
              changedFileDiffs: [
                {
                  file,
                  additions: 1,
                  deletions: 0,
                  status: file === "src/new-file.ts" ? "added" : "modified",
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  acceptanceCalls = 0
  vcsCalls = 0
  concurrentAcceptance = null
  emptyAcceptance = null
  setGoalBoard("gr_inflight_cache", "src/new-file.ts")
})

test("resolveDiff does not cache an in-flight empty acceptance over added-file content", async () => {
  const target = { goalRunID: "gr_inflight_cache", filePath: "src/new-file.ts" }

  const first = await resolveDiff(target)
  expect(first).toBeNull()

  const second = await resolveDiff(target)
  expect(second).toMatchObject({
    file: "src/new-file.ts",
    before: "",
    after: "export const value = 1;\n",
    status: "added",
  })
  expect(acceptanceCalls).toBe(2)
  expect(vcsCalls).toBe(0)
})

test("resolveDiff shares one in-flight acceptance request for concurrent same-goal lookups", async () => {
  concurrentAcceptance = deferred()
  setGoalBoard("gr_concurrent", "src/new-file.ts")
  const target = { goalRunID: "gr_concurrent", filePath: "src/new-file.ts" }

  const first = resolveDiff(target)
  const second = resolveDiff(target)
  const third = resolveDiff(target)
  await Promise.resolve()

  expect(acceptanceCalls).toBe(1)
  concurrentAcceptance.resolve(acceptanceDiff("src/new-file.ts"))
  const resolved = await Promise.all([first, second, third])

  expect(resolved.map((item) => item?.after)).toEqual([
    "export const value = 1;\n",
    "export const value = 1;\n",
    "export const value = 1;\n",
  ])
  expect(acceptanceCalls).toBe(1)
  expect(vcsCalls).toBe(0)
})

test("resolveDiff coalesces concurrent empty acceptance but re-fetches after it settles", async () => {
  emptyAcceptance = deferred()
  setGoalBoard("gr_empty_recheck", "src/live-file.ts")
  const target = { goalRunID: "gr_empty_recheck", filePath: "src/live-file.ts" }

  const first = resolveDiff(target)
  const second = resolveDiff(target)
  await Promise.resolve()

  expect(acceptanceCalls).toBe(1)
  emptyAcceptance.resolve([])
  expect(await Promise.all([first, second])).toEqual([null, null])

  expect(await resolveDiff(target)).toBeNull()
  expect(acceptanceCalls).toBe(2)
  expect(vcsCalls).toBe(0)
})

test("resolveDiff returns null when scoped acceptance has no preview body", async () => {
  setGoalBoard("gr_no_body", "src/live-file.ts")

  const resolved = await resolveDiff({ goalRunID: "gr_no_body", filePath: "C:/repo/src/live-file.ts" })

  expect(resolved).toBeNull()
  expect(acceptanceCalls).toBe(1)
  expect(vcsCalls).toBe(0)
})
