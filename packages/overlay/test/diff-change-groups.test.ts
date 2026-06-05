import { expect, mock, test } from "bun:test"
import type { ChangeGroup } from "../src/services/diff"

mock.module("../src/store/board", () => ({
  boardStore: { board: null, changes: [], selectedSource: null, snapshotVersion: "" },
  activeTaskID: () => "",
  setPath: () => {},
  setVcs: () => {},
}))

mock.module("../src/services/meta", () => ({
  deriveChanges: () => [],
  normalizeDiffs: (list: any[]) => list,
}))

const { changeGroupsRevisionKey } = await import("../src/services/diff")

function group(changes: ChangeGroup["changes"]): ChangeGroup {
  return {
    id: "goal:g3:run-1",
    goalRunID: "run-1",
    goalLabel: "G3V1",
    additions: changes.reduce((sum, item) => sum + (item.additions ?? 0), 0),
    deletions: changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
    changes,
  }
}

test("changeGroupsRevisionKey changes when an existing goal group gains files", () => {
  const running = changeGroupsRevisionKey([group([])])
  const completed = changeGroupsRevisionKey([
    group([
      {
        file: "src/KeyStatisticsMTts.tsx",
        status: "added",
        additions: 120,
        deletions: 0,
      },
    ]),
  ])

  expect(completed).not.toBe(running)
})

test("changeGroupsRevisionKey changes when per-file stats are upgraded", () => {
  const stub = changeGroupsRevisionKey([
    group([
      {
        file: "src/KeyStatisticsMTts.tsx",
        status: "modified",
        additions: 0,
        deletions: 0,
      },
    ]),
  ])
  const resolved = changeGroupsRevisionKey([
    group([
      {
        file: "src/KeyStatisticsMTts.tsx",
        status: "modified",
        additions: 8,
        deletions: 2,
      },
    ]),
  ])

  expect(resolved).not.toBe(stub)
})
