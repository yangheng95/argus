import { beforeEach, expect, mock, test } from "bun:test"

let acceptanceCalls = 0
let vcsCalls = 0
let scenario: "acceptance-inflight" | "vcs-backfill" | "vcs-inflight" | "vcs-non-text" = "acceptance-inflight"
const boardStore: any = {
  board: null,
  changes: [],
  selectedSource: null,
  snapshotVersion: "",
}

const VCS_PATCH = [
  "Index: src/live-file.ts",
  "===================================================================",
  "--- src/live-file.ts",
  "+++ src/live-file.ts",
  "@@ -1,2 +1,3 @@",
  " export const value = 1;",
  "+export const next = 2;",
  " export const end = true;",
  "",
].join("\n")

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
    if (path === "vcs/diff") {
      vcsCalls += 1
      if (scenario === "vcs-backfill") {
        return [
          {
            file: "src/live-file.ts",
            patch: VCS_PATCH,
            additions: 1,
            deletions: 0,
            status: "modified",
          },
        ]
      }
      if (scenario === "vcs-inflight") {
        if (vcsCalls === 1) return []
        return [
          {
            file: "src/live-file.ts",
            patch: VCS_PATCH,
            additions: 1,
            deletions: 0,
            status: "modified",
          },
        ]
      }
      if (scenario === "vcs-non-text") {
        return [
          {
            file: "assets/logo.png",
            additions: 0,
            deletions: 0,
            status: "added",
          },
        ]
      }
      return []
    }
    acceptanceCalls += 1
    if (path === "goal-run/gr_inflight_cache/acceptance") {
      if (acceptanceCalls === 1) return null
      return {
        result: {
          diffs: [
            {
              file: "src/new-file.ts",
              before: "",
              after: "export const value = 1;\n",
              additions: 1,
              deletions: 0,
              status: "added",
            },
          ],
        },
      }
    }
    if (
      path === "goal-run/gr_vcs_backfill/acceptance" ||
      path === "goal-run/gr_vcs_inflight/acceptance" ||
      path === "goal-run/gr_vcs_non_text/acceptance"
    ) {
      return { result: { diffs: [] } }
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
  scenario = "acceptance-inflight"
  setGoalBoard("gr_inflight_cache", "src/new-file.ts")
})

test("resolveDiff does not cache an in-flight empty acceptance over added-file content", async () => {
  const target = { goalRunID: "gr_inflight_cache", filePath: "src/new-file.ts" }

  const first = await resolveDiff(target)
  expect(first).toMatchObject({
    file: "src/new-file.ts",
    status: "added",
    additions: 1,
    deletions: 0,
  })
  expect(first?.after).toBeUndefined()

  const second = await resolveDiff(target)
  expect(second).toMatchObject({
    file: "src/new-file.ts",
    before: "",
    after: "export const value = 1;\n",
    status: "added",
  })
  expect(acceptanceCalls).toBe(2)
  expect(vcsCalls).toBe(1)
})

test("resolveDiff backfills stub rows from the live VCS patch when acceptance has no body", async () => {
  scenario = "vcs-backfill"
  setGoalBoard("gr_vcs_backfill", "src/live-file.ts")

  const resolved = await resolveDiff({ goalRunID: "gr_vcs_backfill", filePath: "C:/repo/src/live-file.ts" })

  expect(resolved).toMatchObject({
    file: "src/live-file.ts",
    before: "export const value = 1;\nexport const end = true;",
    after: "export const value = 1;\nexport const next = 2;\nexport const end = true;",
    additions: 1,
    deletions: 0,
    status: "modified",
  })
  expect(acceptanceCalls).toBe(1)
  expect(vcsCalls).toBe(1)
})

test("resolveDiff does not cache an empty live VCS diff over later patch content", async () => {
  scenario = "vcs-inflight"
  setGoalBoard("gr_vcs_inflight", "src/live-file.ts")

  const target = { goalRunID: "gr_vcs_inflight", filePath: "src/live-file.ts" }
  const first = await resolveDiff(target)
  expect(first).toMatchObject({
    file: "src/live-file.ts",
    additions: 1,
    deletions: 0,
  })
  expect(first?.before).toBeUndefined()

  const second = await resolveDiff(target)
  expect(second).toMatchObject({
    file: "src/live-file.ts",
    before: "export const value = 1;\nexport const end = true;",
    after: "export const value = 1;\nexport const next = 2;\nexport const end = true;",
  })
  expect(vcsCalls).toBe(2)
})

test("resolveDiff marks VCS rows without text patches as non-text", async () => {
  scenario = "vcs-non-text"
  setGoalBoard("gr_vcs_non_text", "assets/logo.png")

  const resolved = await resolveDiff({ goalRunID: "gr_vcs_non_text", filePath: "assets/logo.png" })

  expect(resolved).toMatchObject({
    file: "assets/logo.png",
    additions: 0,
    deletions: 0,
    status: "added",
    isText: false,
  })
  expect(resolved?.before).toBeUndefined()
  expect(resolved?.after).toBeUndefined()
})
